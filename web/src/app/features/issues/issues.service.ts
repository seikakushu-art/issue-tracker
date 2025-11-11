import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import { Auth, User } from '@angular/fire/auth';
import { Storage, deleteObject, ref, getDownloadURL, uploadBytes } from '@angular/fire/storage';
import { Issue, Project, Task, Tag } from '../../models/schema';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { authState } from '@angular/fire/auth';
import { ProgressService } from '../projects/progress.service';
import { ProjectsService } from '../projects/projects.service';
import { TagsService } from '../tags/tags.service';

/**
 * 課題（Issue）管理サービス
 * プロジェクト配下の課題を作成・編集・削除・取得する
 */
@Injectable({ providedIn: 'root' })
export class IssuesService {
  private db = inject(Firestore);
  private auth = inject(Auth);
  private storage = inject(Storage);
  private progressService = inject(ProgressService);
  private projectsService = inject(ProjectsService);
  private tagsService = inject(TagsService);

  /**
   * Firestoreから取得した日時フィールドをDate型へ正規化するユーティリティ
   * @param value Firestore Timestamp / string / Date など
   */
  private normalizeDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (
      typeof value === 'object' &&
      value !== null &&
      'toDate' in value &&
      typeof (value as { toDate: () => Date }).toDate === 'function'
    ) {
      const converted = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }

    return null;
  }

  /**
   * Firestoreから取得した課題ドキュメントをUIで扱いやすい形に整形する
   * @param id ドキュメントID
   * @param data Firestoreから取得した生データ
   */
  private hydrateIssue(id: string, data: Issue): Issue {
    const dataRecord = data as unknown as Record<string, unknown>;
    return {
      ...data,
      id,
      startDate: this.normalizeDate(dataRecord['startDate']) ?? null,
      endDate: this.normalizeDate(dataRecord['endDate']) ?? null,
      createdAt: this.normalizeDate(dataRecord['createdAt']) ?? null,
      progress: dataRecord['progress'] as number ?? 0,
      archived: (dataRecord['archived'] as boolean) ?? false,
      representativeTaskId: (dataRecord['representativeTaskId'] as string | null | undefined) ?? null,
      pinnedBy: Array.isArray(dataRecord['pinnedBy']) ? (dataRecord['pinnedBy'] as string[]) : [],
    };
  }

  /**
   * プロジェクト期間内に課題期間が収まっているか検証する
   * @param projectId プロジェクトID
   * @param startDate 課題開始日
   * @param endDate 課題終了日
   */
  private async validateWithinProjectPeriod(
    projectId: string,
    startDate?: Date | null,
    endDate?: Date | null,
  ): Promise<void> {
    const projectSnap = await getDoc(doc(this.db, 'projects', projectId));
    if (!projectSnap.exists()) {
      // プロジェクトが存在しない場合は制約できないので終了
      return;
    }

    const project = projectSnap.data() as Project;
    const projectRecord = project as unknown as Record<string, unknown>;
    const projectStart = this.normalizeDate(projectRecord['startDate']);
    const projectEnd = this.normalizeDate(projectRecord['endDate']);

    if (projectStart && startDate && startDate < projectStart) {
      throw new Error('課題の開始日はプロジェクト期間内に設定してください');
    }

    if (projectEnd && endDate && endDate > projectEnd) {
      throw new Error('課題の終了日はプロジェクト期間内に設定してください');
    }
  }

  private async ensureIssueEndCoversTasks(
    projectId: string,
    issueId: string,
    issueEnd: Date,
  ): Promise<void> {
    const tasksSnap = await getDocs(collection(this.db, `projects/${projectId}/issues/${issueId}/tasks`));
    for (const docSnap of tasksSnap.docs) {
      const record = docSnap.data() as Record<string, unknown>;
      const taskEnd = this.normalizeDate(record['endDate']);
      if (taskEnd && taskEnd > issueEnd) {
        throw new Error('課題の終了日は配下のタスクの終了日をカバーするよう設定してください');
      }
    }
  }

  private async waitForUser(): Promise<User | null> {

    const current = this.auth.currentUser;
    if (current) {
      return current;
    }

    try {
      return await firstValueFrom(
        authState(this.auth).pipe(
          filter((user): user is User => user !== null),
          take(1),
          timeout(2000),
        ),
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        console.warn('Timed out while waiting for Firebase auth state');
      } else {
        console.error('Unexpected error while waiting for Firebase auth state:', error);
      }
      return null;
    }
  }

  private async requireUser(): Promise<User> {
    const user = await this.waitForUser();
    if (!user) {
      throw new Error('not signed in');
    }
    return user;
  }

  /**
   * プロジェクト配下の課題を作成する
   * @param projectId プロジェクトID
   * @param input 課題の入力データ
   * @returns 作成された課題のドキュメントID
   */
  async createIssue(projectId: string, input: {
    name: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
    goal?: string;
    themeColor?: string;
  }): Promise<string> {
    await this.projectsService.ensureProjectRole(projectId, ['admin']);
    
    // アクティブな課題数の上限チェック（50件）
    const activeIssueCount = await this.countActiveIssues(projectId);
    const MAX_ACTIVE_ISSUES = 50;
    if (activeIssueCount >= MAX_ACTIVE_ISSUES) {
      throw new Error(`アクティブな課題の上限（${MAX_ACTIVE_ISSUES}件）に達しています。新しい課題を作成するには、既存の課題をアーカイブするか削除してください。`);
    }
    
    // 名称重複チェック
    await this.checkNameUniqueness(projectId, input.name);

     // プロジェクト期間内チェック
     await this.validateWithinProjectPeriod(
      projectId,
      input.startDate ?? null,
      input.endDate ?? null,
    );

    const payload: Record<string, unknown> = {
      projectId,
      name: input.name,
      archived: false,
      createdAt: serverTimestamp(),
      representativeTaskId: null,
    };

    if (input.description !== undefined && input.description !== null && input.description !== '') {
      payload['description'] = input.description;
    }
    if (input.goal !== undefined && input.goal !== null && input.goal !== '') {
      payload['goal'] = input.goal;
    }
    if (input.startDate !== undefined && input.startDate !== null) {
      payload['startDate'] = input.startDate;
    }
    if (input.endDate !== undefined && input.endDate !== null) {
      payload['endDate'] = input.endDate;
    }
    if (input.themeColor !== undefined && input.themeColor !== null && input.themeColor !== '') {
      payload['themeColor'] = input.themeColor;
    }

    // バリデーション: 開始日は終了日以前
    if (payload['startDate'] && payload['endDate']) {
      const start = payload['startDate'] as Date;
      const end = payload['endDate'] as Date;
      if (start > end) {
        throw new Error('開始日は終了日以前である必要があります');
      }
    }

    // Firestoreサブコレクションとして登録: projects/{projectId}/issues/{issueId}
    const ref = await addDoc(
      collection(this.db, `projects/${projectId}/issues`),
      payload
    );
    return ref.id;
  }

  /**
   * プロジェクト配下の課題一覧を取得する
   * @param projectId プロジェクトID
   * @returns 課題の配列
   */
  async listIssues(projectId: string, includeArchived = false): Promise<Issue[]> {
    const uid = (await this.waitForUser())?.uid;
    if (!uid) {
      return [];
    }

    try {
      const snap = await getDocs(
        query(
          collection(this.db, `projects/${projectId}/issues`),
        ),
      );
      return snap.docs
        .map((d) => this.hydrateIssue(d.id, d.data() as Issue))
        .filter(issue => includeArchived || !issue.archived);
    } catch (error) {
      console.error('Error in listIssues:', error);
      return [];
    }
  }
  /**
   * プロジェクト配下の課題数を取得する（一覧表示での統計用）
   * @param projectId プロジェクトID
   * @param includeArchived アーカイブ済み課題も含めるかどうか
   */
  async countIssues(projectId: string, includeArchived = false): Promise<number> {
    const uid = (await this.waitForUser())?.uid;
    if (!uid) {
      return 0;
    }

    try {
      const q = includeArchived
        ? query(collection(this.db, `projects/${projectId}/issues`))
        : query(collection(this.db, `projects/${projectId}/issues`), where('archived', '==', false));
      const snap = await getDocs(q);
      return snap.docs.length;
    } catch (error) {
      console.error('Error counting issues:', error);
      return 0;
    }
  }

  /**
   * アクティブな課題数をカウントする
   * @param projectId プロジェクトID
   * @returns アクティブな課題数（アーカイブされていないもの）
   */
  private async countActiveIssues(projectId: string): Promise<number> {
    return await this.countIssues(projectId, false);
  }


  /**
   * 特定の課題を取得する
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @returns 課題データ（存在しない場合はnull）
   */
  async getIssue(projectId: string, issueId: string): Promise<Issue | null> {
    const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}`);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return this.hydrateIssue(docSnap.id, docSnap.data() as Issue);
    }
    return null;
  }

  /**
   * 課題を更新する
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param updates 更新データ
   */
  async updateIssue(
    projectId: string,
    issueId: string,
    updates: Partial<{
      name: string;
      description: string | null;
      startDate: Date | null;
      endDate: Date | null;
      goal: string | null;
      themeColor: string | null;
      archived: boolean;
      representativeTaskId: string | null;
    }>
  ): Promise<void> {
    await this.projectsService.ensureProjectRole(projectId, ['admin']);
    // 名称変更の場合、重複チェック
    if (updates.name !== undefined) {
      await this.checkNameUniqueness(projectId, updates.name, issueId);
    }

    const issue = await this.getIssue(projectId, issueId);
    if (issue) {
      const currentStart = this.normalizeDate(issue.startDate ?? null);
      const currentEnd = this.normalizeDate(issue.endDate ?? null);
      const nextStart = updates.startDate !== undefined
        ? this.normalizeDate(updates.startDate)
        : currentStart;
      const nextEnd = updates.endDate !== undefined
        ? this.normalizeDate(updates.endDate)
        : currentEnd;

      if (nextStart && nextEnd && nextStart > nextEnd) {
        throw new Error('開始日は終了日以前である必要があります');
      }
      if (updates.startDate !== undefined || updates.endDate !== undefined) {
        await this.validateWithinProjectPeriod(projectId, nextStart ?? null, nextEnd ?? null);
      }

      if (nextEnd) {
        await this.ensureIssueEndCoversTasks(projectId, issueId, nextEnd);
      }
    }

    const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(docRef, updates as any);
  }
/**
   * 代表タスクを設定／解除する
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param taskId タスクID（null指定で解除）
   */
async setRepresentativeTask(projectId: string, issueId: string, taskId: string | null): Promise<void> {
  await this.projectsService.ensureProjectRole(projectId, ['admin']);
  const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}`);
  await updateDoc(docRef, { representativeTaskId: taskId });
}

/**
   * 課題のピン止め状態を切り替える
   */
async togglePin(projectId: string, issueId: string, pinned: boolean): Promise<void> {
  const user = await this.requireUser();
  const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}`);
  const snap = await getDoc(docRef);

  if (!snap.exists()) {
    throw new Error('課題が見つかりません');
  }

  const data = snap.data() as Record<string, unknown>;
  const currentPinnedBy = Array.isArray(data['pinnedBy']) ? (data['pinnedBy'] as string[]) : [];

  let nextPinnedBy: string[];
  if (pinned) {
    if (currentPinnedBy.includes(user.uid)) {
      return;
    }
    nextPinnedBy = [...currentPinnedBy, user.uid];
  } else {
    nextPinnedBy = currentPinnedBy.filter(id => id !== user.uid);
  }

  await updateDoc(docRef, {
    pinnedBy: nextPinnedBy,
  });
}

  /**
   * 課題をアーカイブする
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param archived アーカイブ状態
   */
  async archiveIssue(projectId: string, issueId: string, archived: boolean): Promise<void> {
    await this.projectsService.ensureProjectRole(projectId, ['admin']);
    await this.updateIssue(projectId, issueId, { archived });
  }

  /**
   * 課題を削除する（物理削除）
   * - 配下のタスク・コメント・添付ファイルも合わせて物理削除する
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   */
  async deleteIssue(projectId: string, issueId: string): Promise<void> {
    await this.projectsService.ensureProjectRole(projectId, ['admin']);
    
    // 課題配下のタスクを取得
    const tasksRef = collection(this.db, `projects/${projectId}/issues/${issueId}/tasks`);
    const tasksSnap = await getDocs(tasksRef);
    
    for (const taskDoc of tasksSnap.docs) {
      const taskId = taskDoc.id;
      
      // タスクのコメントを削除
      const commentsRef = collection(this.db, `projects/${projectId}/issues/${issueId}/tasks/${taskId}/comments`);
      const commentsSnap = await getDocs(commentsRef);
      for (const commentDoc of commentsSnap.docs) {
        await deleteDoc(commentDoc.ref);
      }

      // タスクの添付ファイルを削除（FirestoreとStorage）
      const attachmentsRef = collection(this.db, `projects/${projectId}/issues/${issueId}/tasks/${taskId}/attachments`);
      const attachmentsSnap = await getDocs(attachmentsRef);
      for (const attachmentDoc of attachmentsSnap.docs) {
        const attachmentData = attachmentDoc.data() as Record<string, unknown>;
        const attachmentId = attachmentDoc.id;
        const fileName = typeof attachmentData['fileName'] === 'string' ? attachmentData['fileName'] : '';
        let storagePath = typeof attachmentData['storagePath'] === 'string' ? attachmentData['storagePath'] : null;
        
        // storagePathが存在しない場合、パスを再構築
        if (!storagePath && fileName) {
          const safeName = fileName
            .normalize('NFKC')
            .replace(/[\s]+/g, '_')
            .replace(/[^a-zA-Z0-9_.-]/g, '_');
          storagePath = `projects/${projectId}/issues/${issueId}/tasks/${taskId}/attachments/${attachmentId}_${safeName}`;
        }
        
        // Storageからファイルを削除
        if (storagePath) {
          try {
            await deleteObject(ref(this.storage, storagePath));
          } catch (error) {
            console.warn(`ストレージファイルの削除に失敗しました: ${storagePath}`, error);
            // エラーが発生しても続行（ファイルが既に存在しない場合など）
          }
        } else {
          console.warn(`添付ファイルのstoragePathが取得できませんでした: attachmentId=${attachmentId}, fileName=${fileName}`);
        }
        
        // Firestoreから添付ファイルドキュメントを削除
        await deleteDoc(attachmentDoc.ref);
      }

      // タスクを削除
      await deleteDoc(taskDoc.ref);
    }
    
    // 課題本体を削除
    const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}`);
    await deleteDoc(docRef);
    await this.progressService.updateProjectProgress(projectId); // プロジェクト進捗を再計算
  }

  /**
   * プロジェクト内で課題名の重複をチェックする
   * 同じプロジェクト内で同じ名前のアクティブな課題が存在する場合、エラーをスローする
   * @param projectId プロジェクトID
   * @param name 課題名
   * @param excludeIssueId 除外する課題ID（更新時に使用）
   */
  private async checkNameUniqueness(projectId: string, name: string, excludeIssueId?: string): Promise<void> {
    const issues = await this.listIssues(projectId, true);
    const duplicate = issues.find(issue => issue.name === name && issue.id !== excludeIssueId);
    if (duplicate) {
      throw new Error(`課題名 "${name}" は既にこのプロジェクト内で使用されています`);
    }
  }
    /**
   * 課題を別プロジェクトへ移動する
   * @param currentProjectId 現在のプロジェクトID
   * @param issueId 課題ID
   * @param targetProjectId 移動先プロジェクトID
   * @returns 移動結果（名前、期間調整情報）
   */
    async moveIssue(
      currentProjectId: string,
      issueId: string,
      targetProjectId: string,
      overrides?: Partial<{
        name: string;
        description: string | null;
        startDate: Date | null;
        endDate: Date | null;
        goal: string | null;
        themeColor: string | null;
        archived: boolean;
        progress: number | null;
      }>,
    ): Promise<{ finalName: string; dateAdjusted: boolean; originalStart?: Date | null; originalEnd?: Date | null; adjustedStart?: Date | null; adjustedEnd?: Date | null; removedAssignees?: { taskId: string; assigneeIds: string[] }[]; skippedTags?: string[] }> {
      await this.projectsService.ensureProjectRole(currentProjectId, ['admin']);
      await this.projectsService.ensureProjectRole(targetProjectId, ['admin']);
      if (currentProjectId === targetProjectId) {
        const originalName = overrides?.name ?? (await this.getIssue(currentProjectId, issueId))?.name ?? '';
        return { finalName: originalName, dateAdjusted: false };
      }
  
      const sourceIssueRef = doc(this.db, `projects/${currentProjectId}/issues/${issueId}`);
      const issueSnap = await getDoc(sourceIssueRef);
      if (!issueSnap.exists()) {
        throw new Error('移動対象の課題が見つかりません');
      }
  
      const rawIssue = issueSnap.data() as Issue;
      const rawIssueRecord = rawIssue as unknown as Record<string, unknown>;

      const normalizedStart = this.normalizeDate(rawIssueRecord['startDate']);
      const normalizedEnd = this.normalizeDate(rawIssueRecord['endDate']);

      const overrideStart = overrides && Object.prototype.hasOwnProperty.call(overrides, 'startDate')
        ? this.normalizeDate(overrides.startDate ?? null)
        : normalizedStart;
      const overrideEnd = overrides && Object.prototype.hasOwnProperty.call(overrides, 'endDate')
        ? this.normalizeDate(overrides.endDate ?? null)
        : normalizedEnd;

      // 移動先プロジェクトの期間を取得
      const targetProjectSnap = await getDoc(doc(this.db, 'projects', targetProjectId));
      if (!targetProjectSnap.exists()) {
        throw new Error('移動先のプロジェクトが見つかりません');
      }
      const targetProject = targetProjectSnap.data() as Project;
      const targetProjectRecord = targetProject as unknown as Record<string, unknown>;
      const targetProjectStart = this.normalizeDate(targetProjectRecord['startDate']);
      const targetProjectEnd = this.normalizeDate(targetProjectRecord['endDate']);

      // 移動先プロジェクトのアクティブな課題数の上限チェック
      // 移動する課題がアーカイブ済みの場合は、アクティブな課題数の上限には影響しない
      const willBeArchived = overrides?.archived ?? (rawIssueRecord['archived'] as boolean) ?? false;
      if (!willBeArchived) {
        const activeIssueCount = await this.countActiveIssues(targetProjectId);
        const MAX_ACTIVE_ISSUES = 50;
        // 移動元のプロジェクトから移動する課題を除外してカウントする必要はない
        // （移動先プロジェクトにはまだ存在しないため）
        if (activeIssueCount >= MAX_ACTIVE_ISSUES) {
          throw new Error(`移動先のプロジェクトのアクティブな課題の上限（${MAX_ACTIVE_ISSUES}件）に達しています。課題を移動するには、移動先プロジェクトの既存の課題をアーカイブするか削除してください。`);
        }
      }

      // 課題の期間が移動先プロジェクトの期間を超える場合、自動的に調整する
      let adjustedStart = overrideStart;
      let adjustedEnd = overrideEnd;
      let dateAdjusted = false;

      if (targetProjectStart && adjustedStart && adjustedStart < targetProjectStart) {
        adjustedStart = targetProjectStart;
        dateAdjusted = true;
      }

      if (targetProjectEnd && adjustedEnd && adjustedEnd > targetProjectEnd) {
        adjustedEnd = targetProjectEnd;
        dateAdjusted = true;
      }

      // 調整後の期間でバリデーション（タスクの期間チェックなど）
      await this.validateWithinProjectPeriod(targetProjectId, adjustedStart, adjustedEnd);

      // 期間が調整された場合、配下のタスクの期間をカバーできているかチェック
      if (adjustedStart || adjustedEnd) {
        // 移動元プロジェクトのタスクをチェック（移動前の状態）
        const sourceTasksSnap = await getDocs(collection(this.db, `projects/${currentProjectId}/issues/${issueId}/tasks`));
        for (const docSnap of sourceTasksSnap.docs) {
          const record = docSnap.data() as Record<string, unknown>;
          const taskStart = this.normalizeDate(record['startDate']);
          const taskEnd = this.normalizeDate(record['endDate']);
          
          // 開始日のチェック：課題の開始日がタスクの開始日より後になっている場合はエラー
          if (adjustedStart && taskStart && taskStart < adjustedStart) {
            throw new Error(
              `移動先プロジェクトの期間内に収めるため課題の開始日を${adjustedStart.toLocaleDateString('ja-JP')}に調整しましたが、` +
              `配下のタスク（開始日: ${taskStart.toLocaleDateString('ja-JP')}）の期間をカバーできません。` +
              `移動先プロジェクトの期間を拡張するか、タスクの期間を調整してから再度お試しください。`
            );
          }
          
          // 終了日のチェック：課題の終了日がタスクの終了日より前になっている場合はエラー
          if (adjustedEnd && taskEnd && taskEnd > adjustedEnd) {
            throw new Error(
              `移動先プロジェクトの期間内に収めるため課題の終了日を${adjustedEnd.toLocaleDateString('ja-JP')}に調整しましたが、` +
              `配下のタスク（終了日: ${taskEnd.toLocaleDateString('ja-JP')}）の期間をカバーできません。` +
              `移動先プロジェクトの期間を拡張するか、タスクの期間を調整してから再度お試しください。`
            );
          }
        }
      }

      // 期間が調整された場合、overridesに反映
      if (dateAdjusted) {
        if (!overrides) {
          overrides = {};
        }
        if (adjustedStart !== overrideStart) {
          overrides.startDate = adjustedStart;
        }
        if (adjustedEnd !== overrideEnd) {
          overrides.endDate = adjustedEnd;
        }
      }

      // 移動先に同じ名前の課題がある場合、自動的に名前を変更する
      let targetName = overrides?.name ?? rawIssue.name;
      const existingIssues = await this.listIssues(targetProjectId, true);
      const duplicate = existingIssues.find(issue => issue.name === targetName && issue.id !== issueId);
      if (duplicate) {
        // 名前の末尾に番号を追加して重複を回避
        let counter = 1;
        let newName = `${targetName} (${counter})`;
        while (existingIssues.some(issue => issue.name === newName && issue.id !== issueId)) {
          counter++;
          newName = `${targetName} (${counter})`;
        }
        targetName = newName;
        // overridesに新しい名前を設定
        if (overrides) {
          overrides.name = targetName;
        } else {
          overrides = { name: targetName };
        }
      }

      // 元の期間を保存（通知用）
      const originalStart = overrideStart;
      const originalEnd = overrideEnd;
  
      const tasksSnap = await getDocs(collection(this.db, `projects/${currentProjectId}/issues/${issueId}/tasks`));
      const tasks = tasksSnap.docs.map(docSnap => ({ id: docSnap.id, ...(docSnap.data() as Task) }));

      // 移動元プロジェクトのタグを取得
      const sourceTags = await this.tagsService.listTags(currentProjectId);
      const sourceTagMap = new Map<string, Tag>();
      for (const tag of sourceTags) {
        if (tag.id) {
          sourceTagMap.set(tag.id, tag);
        }
      }

      // 移動先プロジェクトのタグを取得
      const targetTags = await this.tagsService.listTags(targetProjectId);
      const targetTagMapByName = new Map<string, Tag>();
      const targetTagMapById = new Map<string, Tag>();
      for (const tag of targetTags) {
        if (tag.id) {
          targetTagMapById.set(tag.id, tag);
        }
        if (tag.name) {
          targetTagMapByName.set(tag.name, tag);
        }
      }

      // タスクに使用されているタグIDを収集
      const usedTagIds = new Set<string>();
      for (const task of tasks) {
        if (task.tagIds && Array.isArray(task.tagIds)) {
          for (const tagId of task.tagIds) {
            if (typeof tagId === 'string' && tagId.trim().length > 0) {
              usedTagIds.add(tagId);
            }
          }
        }
      }

      // 移動先プロジェクトに存在しないタグを追加
      const tagIdMapping = new Map<string, string>(); // 移動元タグID → 移動先タグID
      const MAX_TAGS_PER_PROJECT = 20;
      const skippedTags: string[] = [];
      
      // 移動先プロジェクトのタグ数をチェック
      const currentTagCount = targetTags.length;
      const tagsToCreate = new Set<string>();
      
      // 作成が必要なタグを特定
      for (const tagId of usedTagIds) {
        const sourceTag = sourceTagMap.get(tagId);
        if (!sourceTag || !sourceTag.name) {
          continue;
        }

        // 移動先プロジェクトに同じ名前のタグが存在するかチェック
        const existingTag = targetTagMapByName.get(sourceTag.name);
        if (existingTag && existingTag.id) {
          // 既に存在する場合は、そのIDを使用
          tagIdMapping.set(tagId, existingTag.id);
        } else {
          // 存在しない場合は、作成が必要
          tagsToCreate.add(sourceTag.name);
        }
      }
      
      // タグの上限をチェック
      const canCreateAllTags = currentTagCount + tagsToCreate.size <= MAX_TAGS_PER_PROJECT;
      
      if (!canCreateAllTags) {
        // 上限に達している場合、作成できる分だけ作成する
        const availableSlots = MAX_TAGS_PER_PROJECT - currentTagCount;
        const tagsToCreateArray = Array.from(tagsToCreate);
        const tagsToCreateLimited = tagsToCreateArray.slice(0, availableSlots);
        const tagsToSkip = tagsToCreateArray.slice(availableSlots);
        
        // スキップされたタグを保存
        skippedTags.push(...tagsToSkip);
        
        // 作成できるタグのみを作成
        for (const tagName of tagsToCreateLimited) {
          const sourceTag = Array.from(sourceTagMap.values()).find(t => t.name === tagName);
          if (!sourceTag) {
            continue;
          }
          
          const tagId = Array.from(usedTagIds).find(id => {
            const tag = sourceTagMap.get(id);
            return tag?.name === tagName;
          });
          
          if (!tagId) {
            continue;
          }
          
          try {
            const newTagId = await this.tagsService.createTag(targetProjectId, {
              name: sourceTag.name,
              color: sourceTag.color ?? undefined,
            });
            tagIdMapping.set(tagId, newTagId);
          } catch (error) {
            console.error(`タグ「${sourceTag.name}」の作成に失敗しました:`, error);
            // 作成に失敗したタグもスキップされたタグとして扱う
            skippedTags.push(sourceTag.name);
          }
        }
        
        // スキップされたタグはマッピングしない（タグが使用されない）
      } else {
        // 上限に達していない場合、すべてのタグを作成
        for (const tagId of usedTagIds) {
          const sourceTag = sourceTagMap.get(tagId);
          if (!sourceTag || !sourceTag.name) {
            continue;
          }

          // 移動先プロジェクトに同じ名前のタグが存在するかチェック
          const existingTag = targetTagMapByName.get(sourceTag.name);
          if (existingTag && existingTag.id) {
            // 既に存在する場合は、そのIDを使用
            tagIdMapping.set(tagId, existingTag.id);
          } else {
            // 存在しない場合は、新しいタグを作成
            try {
              const newTagId = await this.tagsService.createTag(targetProjectId, {
                name: sourceTag.name,
                color: sourceTag.color ?? undefined,
              });
              tagIdMapping.set(tagId, newTagId);
            } catch (error) {
              console.error(`タグ「${sourceTag.name}」の作成に失敗しました:`, error);
              // 作成に失敗したタグもスキップされたタグとして扱う
              skippedTags.push(sourceTag.name);
            }
          }
        }
      }

      // 移動先プロジェクトのメンバーを取得
      const targetProjectMemberIds = new Set(targetProject.memberIds ?? []);
      
      // タスクの担当者が移動先プロジェクトのメンバーかチェックし、メンバーでない担当者を削除
      const tasksWithRemovedAssignees: { taskId: string; removedAssignees: string[] }[] = [];
      for (const task of tasks) {
        if (task.assigneeIds && Array.isArray(task.assigneeIds)) {
          const originalAssigneeIds = task.assigneeIds;
          const validAssigneeIds = originalAssigneeIds.filter(
            assigneeId => typeof assigneeId === 'string' && assigneeId.trim().length > 0 && targetProjectMemberIds.has(assigneeId)
          );
          
          if (validAssigneeIds.length !== originalAssigneeIds.length) {
            const removedAssignees = originalAssigneeIds.filter(
              assigneeId => typeof assigneeId === 'string' && assigneeId.trim().length > 0 && !targetProjectMemberIds.has(assigneeId)
            );
            tasksWithRemovedAssignees.push({
              taskId: task.id!,
              removedAssignees: removedAssignees.filter((id): id is string => typeof id === 'string'),
            });
            // タスクの担当者リストを更新
            task.assigneeIds = validAssigneeIds;
          }
        }
      }
  
      const targetIssueRef = doc(this.db, `projects/${targetProjectId}/issues/${issueId}`);
      const payload = {
        ...rawIssue,
        projectId: targetProjectId,
      } as Record<string, unknown>;
  
      if (overrides) {
        for (const [key, value] of Object.entries(overrides)) {
          if (value !== undefined) {
            payload[key] = value;
          }
        }
      }
  
      await setDoc(targetIssueRef, payload);

      // 課題名とプロジェクト名を取得（添付ファイル一覧で表示するため）
      const targetProjectName = targetProject.name || null;
      const issueName = targetName;

      for (const task of tasks) {
        const { id: taskId, ...taskData } = task;
        
        // タスクのタグIDを移動先プロジェクトのタグIDにマッピング
        let mappedTagIds: string[] | undefined;
        if (task.tagIds && Array.isArray(task.tagIds)) {
          mappedTagIds = task.tagIds
            .map(tagId => {
              if (typeof tagId === 'string' && tagId.trim().length > 0) {
                return tagIdMapping.get(tagId) ?? null;
              }
              return null;
            })
            .filter((id): id is string => id !== null);
        }
        
        const taskPayload = {
          ...taskData,
          projectId: targetProjectId,
          issueId,
          tagIds: mappedTagIds ?? task.tagIds, // マッピングされたタグIDを使用
        } as Record<string, unknown>;
  
        await setDoc(
          doc(this.db, `projects/${targetProjectId}/issues/${issueId}/tasks/${taskId}`),
          taskPayload,
        );
  
        // 添付ファイルも移動先プロジェクトのStorageに移動
        const attachmentsRef = collection(this.db, `projects/${currentProjectId}/issues/${issueId}/tasks/${taskId}/attachments`);
        const attachmentsSnap = await getDocs(attachmentsRef);
        
        for (const attachmentDoc of attachmentsSnap.docs) {
          const attachmentData = attachmentDoc.data() as Record<string, unknown>;
          const attachmentId = attachmentDoc.id;
          const fileName = typeof attachmentData['fileName'] === 'string' ? attachmentData['fileName'] : '';
          const fileSize = typeof attachmentData['fileSize'] === 'number' ? attachmentData['fileSize'] : 0;
          const uploadedBy = typeof attachmentData['uploadedBy'] === 'string' ? attachmentData['uploadedBy'] : '';
          const uploadedAt = attachmentData['uploadedAt'];
          const oldStoragePath = typeof attachmentData['storagePath'] === 'string' ? attachmentData['storagePath'] : null;
          const oldFileUrl = typeof attachmentData['fileUrl'] === 'string' ? attachmentData['fileUrl'] : null;
          
          // 新しいStorageパスを構築
          const safeName = fileName
            .normalize('NFKC')
            .replace(/[\s]+/g, '_')
            .replace(/[^a-zA-Z0-9_.-]/g, '_');
          const newStoragePath = `projects/${targetProjectId}/issues/${issueId}/tasks/${taskId}/attachments/${attachmentId}_${safeName}`;
          
          let newFileUrl = oldFileUrl;
          
          // Storageファイルを移動（ダウンロード→アップロード→削除）
          // oldStoragePathが存在する場合は、それから直接ダウンロードURLを取得して使用
          if (oldStoragePath) {
            try {
              // Storageパスから直接ダウンロードURLを取得（古いURLが無効になっている可能性があるため）
              const oldStorageRef = ref(this.storage, oldStoragePath);
              let downloadUrl = oldFileUrl;
              
              // 古いURLが無効な場合に備えて、Storageパスから直接URLを取得
              try {
                downloadUrl = await getDownloadURL(oldStorageRef);
              } catch (error) {
                // StorageパスからURLを取得できない場合は、古いURLを使用
                if (!downloadUrl) {
                  console.warn(`StorageパスからダウンロードURLを取得できませんでした: ${oldStoragePath}`, error);
                }
              }
              
              if (downloadUrl) {
                // ファイルをダウンロード
                const response = await fetch(downloadUrl);
                if (response.ok) {
                  const blob = await response.blob();
                  
                  // 新しいパスにアップロード
                  const newStorageRef = ref(this.storage, newStoragePath);
                  await uploadBytes(newStorageRef, blob, {
                    contentType: blob.type || undefined,
                  });
                  newFileUrl = await getDownloadURL(newStorageRef);
                  
                  // 古いファイルを削除（移動先プロジェクトのパスから）
                  try {
                    await deleteObject(oldStorageRef);
                  } catch (error) {
                    console.warn(`古いStorageファイルの削除に失敗しました: ${oldStoragePath}`, error);
                    // エラーが発生しても続行
                  }
                } else {
                  console.warn(`添付ファイルのダウンロードに失敗しました: ${downloadUrl}`);
                }
              }
            } catch (error) {
              console.error(`添付ファイルの移動に失敗しました: ${attachmentId}`, error);
              // エラーが発生しても続行（ファイルが既に存在しない場合など）
            }
          } else if (oldFileUrl) {
            // storagePathが無いがfileUrlがある場合（古いデータの可能性）
            try {
              const response = await fetch(oldFileUrl);
              if (response.ok) {
                const blob = await response.blob();
                
                const newStorageRef = ref(this.storage, newStoragePath);
                await uploadBytes(newStorageRef, blob, {
                  contentType: blob.type || undefined,
                });
                newFileUrl = await getDownloadURL(newStorageRef);
              }
            } catch (error) {
              console.error(`添付ファイルの移動に失敗しました（fileUrl使用）: ${attachmentId}`, error);
            }
          }
          
          // Firestoreの添付ファイルドキュメントを移動先に作成
          const newAttachmentRef = doc(this.db, `projects/${targetProjectId}/issues/${issueId}/tasks/${taskId}/attachments/${attachmentId}`);
          await setDoc(newAttachmentRef, {
            fileName,
            fileUrl: newFileUrl,
            fileSize,
            uploadedBy,
            uploadedAt,
            storagePath: newStoragePath,
            projectId: targetProjectId, // プロジェクトIDを設定（添付ファイル一覧でフィルタリングするため）
            projectName: targetProjectName, // プロジェクト名を設定（添付ファイル一覧で表示するため）
            issueId, // 課題IDを設定
            issueName, // 課題名を設定（添付ファイル一覧で表示するため）
            taskId, // タスクIDを設定
            taskTitle: task.title || null, // タスク名を設定（添付ファイル一覧で表示するため）
          });
          
          // 古い添付ファイルドキュメントを削除
          await deleteDoc(attachmentDoc.ref);
        }
  
        await deleteDoc(doc(this.db, `projects/${currentProjectId}/issues/${issueId}/tasks/${taskId}`));
      }
  
      await deleteDoc(sourceIssueRef);
  
      await this.progressService.updateProjectProgress(currentProjectId);
      await this.progressService.updateProjectProgress(targetProjectId);
      await this.progressService.updateIssueProgress(targetProjectId, issueId);
      
      return {
        finalName: targetName,
        dateAdjusted,
        originalStart: dateAdjusted ? originalStart : undefined,
        originalEnd: dateAdjusted ? originalEnd : undefined,
        adjustedStart: dateAdjusted ? adjustedStart : undefined,
        adjustedEnd: dateAdjusted ? adjustedEnd : undefined,
        removedAssignees: tasksWithRemovedAssignees.length > 0
          ? tasksWithRemovedAssignees.map(item => ({ taskId: item.taskId, assigneeIds: item.removedAssignees }))
          : undefined,
        skippedTags: skippedTags.length > 0 ? skippedTags : undefined,
      };
    }
}


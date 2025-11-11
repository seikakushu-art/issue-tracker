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
import { Storage, deleteObject, ref } from '@angular/fire/storage';
import { Issue, Project, Task } from '../../models/schema';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { authState } from '@angular/fire/auth';
import { ProgressService } from '../projects/progress.service';
import { ProjectsService } from '../projects/projects.service';

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
    ): Promise<void> {
      await this.projectsService.ensureProjectRole(currentProjectId, ['admin']);
      await this.projectsService.ensureProjectRole(targetProjectId, ['admin']);
      if (currentProjectId === targetProjectId) {
        return;
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
  
      await this.validateWithinProjectPeriod(targetProjectId, overrideStart, overrideEnd);
  
      const targetName = overrides?.name ?? rawIssue.name;
      await this.checkNameUniqueness(targetProjectId, targetName, issueId);
  
      const tasksSnap = await getDocs(collection(this.db, `projects/${currentProjectId}/issues/${issueId}/tasks`));
      const tasks = tasksSnap.docs.map(docSnap => ({ id: docSnap.id, ...(docSnap.data() as Task) }));
  
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
  
      for (const task of tasks) {
        const { id: taskId, ...taskData } = task;
        const taskPayload = {
          ...taskData,
          projectId: targetProjectId,
          issueId,
        } as Record<string, unknown>;
  
        await setDoc(
          doc(this.db, `projects/${targetProjectId}/issues/${issueId}/tasks/${taskId}`),
          taskPayload,
        );
  
        await deleteDoc(doc(this.db, `projects/${currentProjectId}/issues/${issueId}/tasks/${taskId}`));
      }
  
      await deleteDoc(sourceIssueRef);
  
      await this.progressService.updateProjectProgress(currentProjectId);
      await this.progressService.updateProjectProgress(targetProjectId);
      await this.progressService.updateIssueProgress(targetProjectId, issueId);
    }
}


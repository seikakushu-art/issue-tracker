import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionGroup,
  addDoc,
  query,
  getDocs,
  orderBy,
  limit,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
  where,
} from '@angular/fire/firestore';
import { Auth, User } from '@angular/fire/auth';
import { Task, TaskStatus, ChecklistItem, Importance, Comment, Attachment } from '../../models/schema';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { authState } from '@angular/fire/auth';
import { ProgressService } from '../projects/progress.service';
import { ProjectsService } from '../projects/projects.service';
import { Storage, deleteObject, getDownloadURL, ref, uploadBytes } from '@angular/fire/storage';

/**
 * 課題カードに表示する代表タスク情報
 */
export interface TaskSummary {
  count: number; // タスク総数
  representativeTask: {
    taskId: string;
    title: string;
    importance?: Importance | null;
    tagIds: string[]; // 代表タスクに紐づくタグを併せて提示する
  } | null; // 一番手前に見せるタスク
}

/**
 * タスク管理サービス
 * 課題配下のタスクを作成・編集・削除・取得する
 */
@Injectable({ providedIn: 'root' })
export class TasksService {
  private db = inject(Firestore);
  private auth = inject(Auth);
  private authReady: Promise<void> | null = null;
  private progressService = inject(ProgressService);
  private projectsService = inject(ProjectsService);
  private storage = inject(Storage);

  private readonly attachmentCountLimit = 20;
  private readonly attachmentTotalSizeLimit = 500 * 1024 * 1024; // 500MB

  /**
   * Firestore から取得した日時相当の値を Date 型へ正規化する
   */
  private normalizeDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
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
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private hydrateAttachment(id: string, data: Record<string, unknown>): Attachment {
    const fileSizeRaw = data['fileSize'];
    const parsedSize = typeof fileSizeRaw === 'number'
      ? fileSizeRaw
      : typeof fileSizeRaw === 'string'
        ? Number.parseInt(fileSizeRaw, 10)
        : 0;

    const attachment: Attachment = {
      id,
      fileName: typeof data['fileName'] === 'string' ? data['fileName'] : '未設定のファイル名',
      fileUrl: typeof data['fileUrl'] === 'string' ? data['fileUrl'] : '',
      fileSize: Number.isNaN(parsedSize) ? 0 : parsedSize,
      uploadedBy: typeof data['uploadedBy'] === 'string' ? data['uploadedBy'] : '',
      uploadedAt: this.normalizeDate(data['uploadedAt']),
    };

    if (typeof data['storagePath'] === 'string' && data['storagePath'].trim().length > 0) {
      attachment.storagePath = data['storagePath'];
    }
    if (typeof data['projectId'] === 'string' && data['projectId'].trim().length > 0) {
      attachment.projectId = data['projectId'];
    }
    if (typeof data['projectName'] === 'string') {
      attachment.projectName = data['projectName'];
    }
    if (typeof data['issueId'] === 'string' && data['issueId'].trim().length > 0) {
      attachment.issueId = data['issueId'];
    }
    if (typeof data['issueName'] === 'string') {
      attachment.issueName = data['issueName'];
    }
    if (typeof data['taskId'] === 'string' && data['taskId'].trim().length > 0) {
      attachment.taskId = data['taskId'];
    }
    if (typeof data['taskTitle'] === 'string') {
      attachment.taskTitle = data['taskTitle'];
    }

    return attachment;
  }

  private buildAttachmentStoragePath(
    projectId: string,
    issueId: string,
    taskId: string,
    attachmentId: string,
    fileName: string,
  ): string {
    const safeName = fileName
      .normalize('NFKC')
      .replace(/[\s]+/g, '_')
      .replace(/[^a-zA-Z0-9_.-]/g, '_');
    return `projects/${projectId}/issues/${issueId}/tasks/${taskId}/attachments/${attachmentId}_${safeName}`;
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    if (size <= 0) {
      return [items];
    }
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }


  private async ensureAuthReady() {
    if (!this.authReady) {
      this.authReady = this.auth.authStateReady();
    }
    try {
      await this.authReady;
    } catch (error) {
      this.authReady = null;
      throw error;
    }
  }

  private async waitForUser(): Promise<User | null> {
    try {
      await this.ensureAuthReady();
    } catch (error) {
      console.error('Failed to await auth readiness:', error);
    }

    const current = this.auth.currentUser;
    if (current) {
      return current;
    }

    try {
      return await firstValueFrom(
        authState(this.auth).pipe(
          filter((user): user is User => user !== null),
          take(1),
          timeout(10000),
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
   * 課題配下のタスクを作成する
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param input タスクの入力データ
   * @returns 作成されたタスクのドキュメントID
   */
  async createTask(
    projectId: string,
    issueId: string,
    input: {
      title: string;
      description?: string;
      startDate?: Date;
      endDate?: Date;
      goal?: string;
      importance?: 'Critical' | 'High' | 'Medium' | 'Low';
      status: TaskStatus;
      assigneeIds?: string[];
      tagIds?: string[];
      checklist?: ChecklistItem[];
    }
  ): Promise<string> {
    const { uid } = await this.projectsService.ensureProjectRole(projectId, ['admin', 'member']);
    
    // 名称重複チェック
    await this.checkTitleUniqueness(projectId, issueId, input.title);

    const checklist = input.checklist || [];
    const progress = this.calculateProgressFromChecklist(checklist);

    // タグ数の上限チェック（最大10個）
    if (input.tagIds && input.tagIds.length > 10) {
      throw new Error('タスクに付与できるタグは最大10個までです');
    }

    // チェックリスト項目数の上限チェック（最大200個）
    if (checklist.length > 200) {
      throw new Error('チェックリスト項目は最大200個までです');
    }

    const payload: Record<string, unknown> = {
      projectId,
      issueId,
      title: input.title,
      status: input.status,
      archived: false,
      assigneeIds: input.assigneeIds || [],
      tagIds: input.tagIds || [],
      checklist,
      progress,
      createdBy: uid,
      createdAt: serverTimestamp(),
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
    if (input.importance !== undefined) {
      payload['importance'] = input.importance;
    }

    // バリデーション: 開始日は終了日以前
    if (payload['startDate'] && payload['endDate']) {
      const start = payload['startDate'] as Date;
      const end = payload['endDate'] as Date;
      if (start > end) {
        throw new Error('開始日は終了日以前である必要があります');
      }
    }

    // Firestoreサブコレクションとして登録: projects/{projectId}/issues/{issueId}/tasks/{taskId}
    const ref = await addDoc(
      collection(this.db, `projects/${projectId}/issues/${issueId}/tasks`),
      payload
    );
    await this.refreshProgress(projectId, issueId);
    return ref.id;
  }

  /**
   * 課題配下のタスク一覧を取得する
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param includeArchived アーカイブ済みタスクも含めるか
   * @returns タスクの配列
   */
  async listTasks(projectId: string, issueId: string, includeArchived = true): Promise<Task[]> {
    try {
      const q = query(collection(this.db, `projects/${projectId}/issues/${issueId}/tasks`));
      const snap = await getDocs(q);
      const tasks = snap.docs.map((docSnap) => this.hydrateTask(docSnap.id, docSnap.data() as Task));
      return includeArchived ? tasks : tasks.filter((task) => !task.archived);
    } catch (error) {
      console.error('Error in listTasks:', error);
      return [];
    }
  }

  /**
   * プロジェクト全体のタスクを横断的に取得する（スマートフィルター用）
   * @param projectId プロジェクトID
   * @param includeArchived アーカイブ済みタスクを含めるかどうか
   */
  async listTasksByProject(projectId: string, includeArchived = true): Promise<Task[]> {
    try {
      const constraints = [where('projectId', '==', projectId)];
      if (!includeArchived) {
        constraints.push(where('archived', '==', false));
      }

      const q = query(collectionGroup(this.db, 'tasks'), ...constraints);
      const snap = await getDocs(q);
      return snap.docs.map((docSnap) => this.hydrateTask(docSnap.id, docSnap.data() as Task));
    } catch (error) {
      console.error('Error in listTasksByProject:', error);
      return [];
    }
  }

  /**
   * タスクドキュメントをUIで扱いやすい形に整形する
   * @param id タスクID
   * @param data Firestoreから取得した生データ
   */
  private hydrateTask(id: string, data: Task): Task {
    const record = data as unknown as Record<string, unknown>;
    const normalized: Task = {
      ...data,
      id,
      assigneeIds: Array.isArray(record['assigneeIds']) ? (record['assigneeIds'] as string[]) : [],
      tagIds: Array.isArray(record['tagIds']) ? (record['tagIds'] as string[]) : [],
      checklist: Array.isArray(record['checklist']) ? (record['checklist'] as ChecklistItem[]) : [],
      archived: typeof record['archived'] === 'boolean' ? (record['archived'] as boolean) : false,
    };

    if (record['startDate']) {
      normalized.startDate = this.normalizeDate(record['startDate']);
    }
    if (record['endDate']) {
      normalized.endDate = this.normalizeDate(record['endDate']);
    }
    if (record['createdAt']) {
      normalized.createdAt = this.normalizeDate(record['createdAt']);
    }

    return normalized;
  }


  /**
   * 課題配下のタスク数を取得する
   * 一覧画面の統計表示用に件数のみを高速に集計する
   */
  async countTasks(projectId: string, issueId: string): Promise<number> {
    try {
      const q = query(collection(this.db, `projects/${projectId}/issues/${issueId}/tasks`));
      const snap = await getDocs(q);
      return snap.docs.length;
    } catch (error) {
      console.error('Error counting tasks:', error);
      return 0;
    }
  }

  /**
   * 課題配下のタスク概要を取得する
   * 一覧カードに表示する件数と代表タスク情報を一度のアクセスでまとめて返す
   */
  async getTaskSummary(
    projectId: string,
    issueId: string,
    representativeTaskId: string | null = null,
  ): Promise<TaskSummary> {
    try {
      const q = query(collection(this.db, `projects/${projectId}/issues/${issueId}/tasks`));
      const snap = await getDocs(q);

     // 指定された代表タスクIDと一致するものを優先して選択
     const matchedDoc = representativeTaskId
     ? snap.docs.find(docSnap => docSnap.id === representativeTaskId)
     : undefined;

   const candidateDoc = matchedDoc ?? snap.docs[0];
   const candidateData = candidateDoc?.data() as Task | undefined;

   const representativeTask = candidateDoc && candidateData
     ? {
         taskId: candidateDoc.id,
         title: candidateData.title,
         importance: candidateData.importance ?? null,
         tagIds: candidateData.tagIds ?? [], // タグ未設定時は空配列で扱う
    } : null;
    return {
      count: snap.docs.length,
      representativeTask,
    };
  } catch (error) {
    console.error('Error fetching task summary:', error);
    return { count: 0, representativeTask: null };
  }
}


  /**
   * 特定のタスクを取得する
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param taskId タスクID
   * @returns タスクデータ（存在しない場合はnull）
   */
  async getTask(projectId: string, issueId: string, taskId: string): Promise<Task | null> {
    const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}/tasks/${taskId}`);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data() as Task;
      return {
        id: docSnap.id,
        ...data,
        assigneeIds: data.assigneeIds ?? [],
        tagIds: data.tagIds ?? [],
        checklist: data.checklist ?? [],
        archived: data.archived ?? false,
      };
    }
    return null;
  }

  /**
   * タスクを更新する
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param taskId タスクID
   * @param updates 更新データ
   */
  async updateTask(
    projectId: string,
    issueId: string,
    taskId: string,
    updates: Partial<{
      title: string;
      description: string | null;
      startDate: Date | null;
      endDate: Date | null;
      goal: string | null;
      importance: 'Critical' | 'High' | 'Medium' | 'Low';
      status: TaskStatus;
      assigneeIds: string[];
      tagIds: string[];
      checklist: ChecklistItem[];
      progress: number;
      archived: boolean;
    }>
  ): Promise<void> {
    const { role, uid } = await this.projectsService.ensureProjectRole(projectId, ['admin', 'member']);

    // タイトル変更の場合、重複チェック
    if (updates.title !== undefined) {
      await this.checkTitleUniqueness(projectId, issueId, updates.title, taskId);
    }

    // タグ数の上限チェック
    if (updates.tagIds && updates.tagIds.length > 10) {
      throw new Error('タスクに付与できるタグは最大10個までです');
    }

    // チェックリスト項目数の上限チェック
    if (updates.checklist && updates.checklist.length > 200) {
      throw new Error('チェックリスト項目は最大200個までです');
    }

    // バリデーション: 開始日は終了日以前
    const task = await this.getTask(projectId, issueId, taskId);
    if (task) {
      if (role === 'member') {
        const canEdit = task.createdBy === uid || (task.assigneeIds ?? []).includes(uid);
        if (!canEdit) {
          throw new Error('このタスクを編集する権限がありません');
        }
      }
      const startDate = updates.startDate !== undefined ? updates.startDate : task.startDate;
      const endDate = updates.endDate !== undefined ? updates.endDate : task.endDate;
      if (startDate && endDate && startDate > endDate) {
        throw new Error('開始日は終了日以前である必要があります');
      }

      // チェックリストが更新された場合、進捗を再計算
      if (updates.checklist !== undefined) {
        const progress = this.calculateProgressFromChecklist(updates.checklist);
        updates = { ...updates, progress };
      }
    }

    const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}/tasks/${taskId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(docRef, updates as any);
    await this.refreshProgress(projectId, issueId);
  }
  /**
   * タスクのアーカイブ状態を切り替える
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param taskId タスクID
   * @param archived trueでアーカイブ、falseで復元
   */
  async archiveTask(
    projectId: string,
    issueId: string,
    taskId: string,
    archived: boolean
  ): Promise<void> {
    await this.updateTask(projectId, issueId, taskId, { archived });
  }


  /**
   * タスクを削除する（物理削除）
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param taskId タスクID
   */
  async deleteTask(projectId: string, issueId: string, taskId: string): Promise<void> {
    const { role, uid } = await this.projectsService.ensureProjectRole(projectId, ['admin', 'member']);
    const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}/tasks/${taskId}`);
    const taskSnap = await getDoc(docRef);
    if (!taskSnap.exists()) {
      throw new Error('タスクが見つかりません');
    }
    const task = taskSnap.data() as Task;
    if (role === 'member' && task.createdBy !== uid) {
      throw new Error('このタスクを削除する権限がありません');
    }
    await deleteDoc(docRef);
    await this.refreshProgress(projectId, issueId);
  }
  /**
   * タスクに紐づくコメント一覧を取得する
   */
  async listComments(projectId: string, issueId: string, taskId: string): Promise<Comment[]> {
    await this.projectsService.ensureProjectRole(projectId, ['admin', 'member', 'guest']);

    const commentRef = collection(
      this.db,
      `projects/${projectId}/issues/${issueId}/tasks/${taskId}/comments`
    );

    const snap = await getDocs(query(commentRef, orderBy('createdAt', 'asc'), limit(500)));
    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      return this.hydrateComment(docSnap.id, data);
    });
  }

  /**
   * コメントを追加する
   */
  async addComment(
    projectId: string,
    issueId: string,
    taskId: string,
    input: { text: string; mentions?: string[]; authorUsername?: string | null; authorPhotoUrl?: string | null }
  ): Promise<Comment> {
    const { uid } = await this.projectsService.ensureProjectRole(projectId, ['admin', 'member']);

    const trimmed = (input.text ?? '').trim();
    if (!trimmed) {
      throw new Error('コメントを入力してください');
    }
    if (trimmed.length > 5000) {
      throw new Error('コメントは5000文字以内で入力してください');
    }

    const mentions = Array.from(new Set((input.mentions ?? []).filter((value): value is string => Boolean(value))));

    const commentRef = collection(
      this.db,
      `projects/${projectId}/issues/${issueId}/tasks/${taskId}/comments`
    );

    const countSnap = await getDocs(query(commentRef, limit(501)));
    if (countSnap.size >= 500) {
      throw new Error('コメントは最大500件までです');
    }

    const payload: Record<string, unknown> = {
      text: trimmed,
      createdBy: uid,
      createdAt: serverTimestamp(),
    };

    if (mentions.length > 0) {
      payload['mentions'] = mentions;
    }

    if (input.authorUsername !== undefined && input.authorUsername !== null && input.authorUsername.trim().length > 0) {
      payload['authorUsername'] = input.authorUsername.trim();
    }

    if (input.authorPhotoUrl !== undefined) {
      payload['authorPhotoUrl'] = input.authorPhotoUrl || null;
    }

    const createdRef = await addDoc(commentRef, payload);
    const createdSnap = await getDoc(createdRef);
    const data = createdSnap.data();
    if (!data) {
      return {
        id: createdRef.id,
        text: trimmed,
        createdBy: uid,
        createdAt: new Date(),
        mentions,
        authorUsername: input.authorUsername ?? null,
        authorPhotoUrl: input.authorPhotoUrl ?? null,
      } satisfies Comment;
    }

    return this.hydrateComment(createdRef.id, data as Record<string, unknown>);
  }

   /**
   * タスクに紐づく添付ファイル一覧を取得する
   */
   async listAttachments(projectId: string, issueId: string, taskId: string): Promise<Attachment[]> {
    await this.projectsService.ensureProjectRole(projectId, ['admin', 'member', 'guest']);

    const attachmentRef = collection(
      this.db,
      `projects/${projectId}/issues/${issueId}/tasks/${taskId}/attachments`
    );

    const snap = await getDocs(
      query(
        attachmentRef,
        orderBy('uploadedAt', 'desc'),
        limit(this.attachmentCountLimit),
      ),
    );

    return snap.docs.map((docSnap) =>
      this.hydrateAttachment(docSnap.id, docSnap.data() as Record<string, unknown>)
    );
  }

  /**
   * 添付ファイルをアップロードする
   */
  async uploadAttachment(
    projectId: string,
    issueId: string,
    taskId: string,
    file: File,
    metadata: { taskTitle: string; projectName?: string | null; issueName?: string | null },
  ): Promise<Attachment> {
    const { uid } = await this.projectsService.ensureProjectRole(projectId, ['admin', 'member']);

    if (!(file instanceof File)) {
      throw new Error('有効なファイルを選択してください');
    }

    const attachmentRef = collection(
      this.db,
      `projects/${projectId}/issues/${issueId}/tasks/${taskId}/attachments`
    );

    const existingSnap = await getDocs(attachmentRef);
    const existingAttachments = existingSnap.docs.map((docSnap) =>
      this.hydrateAttachment(docSnap.id, docSnap.data() as Record<string, unknown>)
    );

    if (existingAttachments.length >= this.attachmentCountLimit) {
      throw new Error(`添付ファイルは最大${this.attachmentCountLimit}件までです`);
    }

    const totalSize = existingAttachments.reduce((sum, attachment) => sum + (attachment.fileSize ?? 0), 0);
    if (totalSize + file.size > this.attachmentTotalSizeLimit) {
      throw new Error('添付ファイルの合計サイズは500MBまでです');
    }

    const docRef = doc(attachmentRef);
    const storagePath = this.buildAttachmentStoragePath(projectId, issueId, taskId, docRef.id, file.name);
    const storageRef = ref(this.storage, storagePath);

    await uploadBytes(storageRef, file, {
      contentType: file.type || undefined,
    });
    const downloadUrl = await getDownloadURL(storageRef);

    const payload: Record<string, unknown> = {
      fileName: file.name,
      fileUrl: downloadUrl,
      fileSize: file.size,
      uploadedBy: uid,
      uploadedAt: serverTimestamp(),
      storagePath,
      projectId,
      issueId,
      taskId,
    };

    if (metadata.taskTitle) {
      payload['taskTitle'] = metadata.taskTitle;
    }
    if (metadata.projectName !== undefined) {
      payload['projectName'] = metadata.projectName;
    }
    if (metadata.issueName !== undefined) {
      payload['issueName'] = metadata.issueName;
    }

    await setDoc(docRef, payload);
    const createdSnap = await getDoc(docRef);
    const createdData = createdSnap.data();
    if (!createdData) {
      return {
        id: docRef.id,
        fileName: file.name,
        fileUrl: downloadUrl,
        fileSize: file.size,
        uploadedBy: uid,
        uploadedAt: new Date(),
        storagePath,
        projectId,
        projectName: metadata.projectName ?? null,
        issueId,
        issueName: metadata.issueName ?? null,
        taskId,
        taskTitle: metadata.taskTitle,
      } satisfies Attachment;
    }

    return this.hydrateAttachment(docRef.id, createdData as Record<string, unknown>);
  }

  /**
   * 添付ファイルを削除する
   */
  async deleteAttachment(
    projectId: string,
    issueId: string,
    taskId: string,
    attachmentId: string,
  ): Promise<void> {
    const { role, uid } = await this.projectsService.ensureProjectRole(projectId, ['admin', 'member']);

    const docRef = doc(
      this.db,
      `projects/${projectId}/issues/${issueId}/tasks/${taskId}/attachments/${attachmentId}`
    );
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('添付ファイルが見つかりません');
    }

    const attachment = this.hydrateAttachment(snap.id, snap.data() as Record<string, unknown>);
    if (role === 'member' && attachment.uploadedBy !== uid) {
      throw new Error('この添付ファイルを削除する権限がありません');
    }

    if (attachment.storagePath) {
      try {
        await deleteObject(ref(this.storage, attachment.storagePath));
      } catch (error) {
        console.warn('ストレージファイルの削除に失敗しました:', error);
      }
    }

    await deleteDoc(docRef);
  }

  /**
   * 指定したプロジェクトに紐づく添付ファイルをまとめて取得する
   */
  async listAttachmentsForProjects(projectIds: string[]): Promise<Attachment[]> {
    const normalized = Array.from(
      new Set(
        projectIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      ),
    );

    if (normalized.length === 0) {
      return [];
    }

    const attachmentsGroup = collectionGroup(this.db, 'attachments');
    const results: Attachment[] = [];

    for (const chunk of this.chunkArray(normalized, 10)) {
      if (chunk.length === 0) {
        continue;
      }
      const snap = await getDocs(query(attachmentsGroup, where('projectId', 'in', chunk)));
      for (const docSnap of snap.docs) {
        results.push(this.hydrateAttachment(docSnap.id, docSnap.data() as Record<string, unknown>));
      }
    }

    results.sort((a, b) => {
      const timeA = a.uploadedAt?.getTime() ?? 0;
      const timeB = b.uploadedAt?.getTime() ?? 0;
      return timeB - timeA;
    });

    return results;
  }

  /**
   * 課題内でタスクタイトルの重複をチェックする
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param title タスクタイトル
   * @param excludeTaskId 除外するタスクID（更新時に使用）
   */
  private async checkTitleUniqueness(
    projectId: string,
    issueId: string,
    title: string,
    excludeTaskId?: string
  ): Promise<void> {
    const tasks = await this.listTasks(projectId, issueId);
    const duplicate = tasks.find(task => task.title === title && task.id !== excludeTaskId);
    if (duplicate) {
      throw new Error(`タスク名 "${title}" は既にこの課題内で使用されています`);
    }
  }

  private hydrateComment(id: string, data: Record<string, unknown>): Comment {
    const mentionsRaw = Array.isArray(data['mentions']) ? data['mentions'] : [];
    const createdAt = this.normalizeDate(data['createdAt']) ?? new Date();
    const authorUsernameRaw = data['authorUsername'] ?? data['authorName'];
    const authorPhotoRaw = data['authorPhotoUrl'];

    return {
      id,
      text: (data['text'] as string) ?? '',
      createdBy: (data['createdBy'] as string) ?? '',
      createdAt,
      mentions: mentionsRaw.map((value) => String(value)),
      authorUsername: typeof authorUsernameRaw === 'string' && authorUsernameRaw.trim().length > 0 ? authorUsernameRaw : null,
      authorPhotoUrl: typeof authorPhotoRaw === 'string' && authorPhotoRaw.trim().length > 0 ? authorPhotoRaw : null,
    } satisfies Comment;
  }

  /**
   * チェックリストから進捗率を計算する
   * - チェックリスト方式: 完了項目数 ÷ 総項目数（小数点1位で四捨五入）
   * - チェックリスト未設定時: ステータス基準で 0%（未完了）、50%（進行中）、100%（完了）
   * @param checklist チェックリスト項目
   * @param status タスクステータス
   * @returns 進捗率（0-100）
   */
  calculateProgressFromChecklist(
    checklist: ChecklistItem[],
    status?: TaskStatus
  ): number {
    if (!checklist || checklist.length === 0) {
      // チェックリスト未設定時、ステータス基準で計算
      switch (status) {
        case 'completed':
          return 100;
        case 'in_progress':
          return 50;
        case 'on_hold':
          return 25;
        case 'discarded':
          return 0;
        case 'incomplete':
        default:
          return 0;
      }
    }

    const completedCount = checklist.filter(item => item.completed).length;
    const totalCount = checklist.length;
    const progress = Math.round((completedCount / totalCount) * 100 * 10) / 10; // 小数点1位で四捨五入
    return progress;
  }

  /**
   * チェックリストの完了状態を更新する
   * 完了状態に応じてステータスを自動遷移させる
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param taskId タスクID
   * @param checklist 更新後のチェックリスト
   */
  async updateChecklist(
    projectId: string,
    issueId: string,
    taskId: string,
    checklist: ChecklistItem[]
  ): Promise<void> {
    const task = await this.getTask(projectId, issueId, taskId);
    if (!task) {
      throw new Error('タスクが見つかりません');
    }

    // 進捗率を再計算
    const progress = this.calculateProgressFromChecklist(checklist, task.status);

    // ステータスを自動遷移
    let newStatus = task.status;
    
    // チェックリスト未設定の場合は自動遷移しない
    if (checklist.length === 0) {
      if (newStatus === 'in_progress' || newStatus === 'completed') {
        newStatus = 'incomplete';
      }
    } else {
      // すべてのチェックリストが完了した場合
      const allCompleted = checklist.every(item => item.completed);
      if (allCompleted) {
        newStatus = 'completed';
      } else {
        // 1つ以上のチェック項目が完了している場合
        const hasCompleted = checklist.some(item => item.completed);
        if (hasCompleted) {
          newStatus = 'in_progress';
        } else {
          newStatus = 'incomplete';
        }
      }
    }

    // タスクを更新
    await this.updateTask(projectId, issueId, taskId, {
      checklist,
      progress,
      status: newStatus,
    });
  }
  /**
   * 課題・プロジェクトの進捗率を再計算する
   * タスクのCRUD後に必ず呼び出してデータの整合性を保つ
   */
  private async refreshProgress(projectId: string, issueId: string): Promise<void> {
    try {
      await this.progressService.updateIssueProgress(projectId, issueId);
      await this.progressService.updateProjectProgress(projectId);
    } catch (error) {
      console.error('進捗率の再計算に失敗しました:', error);
    }
  }
}


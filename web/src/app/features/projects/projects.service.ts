import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionGroup,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  doc,
  updateDoc,
  getDoc,
  deleteDoc,
} from '@angular/fire/firestore';
import { Auth, User, authState } from '@angular/fire/auth';
import { Project, Role } from '../../models/schema';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
//プロジェクトを作成する
@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private db = inject(Firestore);
  private auth = inject(Auth);
  private authReady: Promise<void> | null = null;

  /**
   * Firestoreから受け取った日付相当の値をDate型へ統一するユーティリティ
   * Timestamp/Date/stringのいずれが来ても安全にDateへ変換し、解釈できない値はnullを返す
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

    const parsed = new Date(value as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Firestoreから取得した生のプロジェクトデータを画面で扱いやすい形に整形する
   * - ドキュメントIDをidへ格納
   * - Timestampなどの日時をDate型へ変換
   * - undefinedをnullへ揃える
   */
  private hydrateProject(id: string, data: Project): Project {
    const dataRecord = data as unknown as Record<string, unknown>;
    const memberIds = (dataRecord['memberIds'] as string[] | undefined) ?? [];
    const roles = (dataRecord['roles'] as Record<string, Role> | undefined) ?? {};
    return {
      ...data,
      id,
      memberIds,
      roles,
      startDate: this.normalizeDate(dataRecord['startDate']),
      endDate: this.normalizeDate(dataRecord['endDate']),
      createdAt: this.normalizeDate(dataRecord['createdAt']),
      progress: (dataRecord['progress'] as number) ?? 0,
      archived: (dataRecord['archived'] as boolean) ?? false,
      pinnedBy: (dataRecord['pinnedBy'] as string[] | undefined) ?? [],
    };
  }

  private async ensureProjectStartCoversDescendants(projectId: string, projectStart: Date): Promise<void> {
    const issuesSnap = await getDocs(collection(this.db, `projects/${projectId}/issues`));
    for (const issueDoc of issuesSnap.docs) {
      const record = issueDoc.data() as Record<string, unknown>;
      const issueStart = this.normalizeDate(record['startDate']);
      if (issueStart && issueStart < projectStart) {
        throw new Error('プロジェクトの開始日は配下の課題・タスクの開始日をカバーするよう設定してください');
      }
    }

    const tasksSnap = await getDocs(
      query(
        collectionGroup(this.db, 'tasks'),
        where('projectId', '==', projectId),
      ),
    );

    for (const taskDoc of tasksSnap.docs) {
      const record = taskDoc.data() as Record<string, unknown>;
      const taskStart = this.normalizeDate(record['startDate']);
      if (taskStart && taskStart < projectStart) {
        throw new Error('プロジェクトの開始日は配下の課題・タスクの開始日をカバーするよう設定してください');
      }
    }
  }

  private async ensureProjectEndCoversDescendants(projectId: string, projectEnd: Date): Promise<void> {
    const issuesSnap = await getDocs(collection(this.db, `projects/${projectId}/issues`));
    for (const issueDoc of issuesSnap.docs) {
      const record = issueDoc.data() as Record<string, unknown>;
      const issueEnd = this.normalizeDate(record['endDate']);
      if (issueEnd && issueEnd > projectEnd) {
        throw new Error('プロジェクトの終了日は配下の課題・タスクの終了日をカバーするよう設定してください');
      }
    }

    const tasksSnap = await getDocs(
      query(
        collectionGroup(this.db, 'tasks'),
        where('projectId', '==', projectId),
      ),
    );

    for (const taskDoc of tasksSnap.docs) {
      const record = taskDoc.data() as Record<string, unknown>;
      const taskEnd = this.normalizeDate(record['endDate']);
      if (taskEnd && taskEnd > projectEnd) {
        throw new Error('プロジェクトの終了日は配下の課題・タスクの終了日をカバーするよう設定してください');
      }
    }
  }


  private resolveRoleForUser(project: Project, uid: string): Role | null {
    const roles = project.roles ?? {};
    return roles[uid] ?? null;
  }

  public async getSignedInUid(): Promise<string> {
    const user = await this.requireUser();
    return user.uid;
  }

  public async ensureProjectRole(projectId: string, allowedRoles: Role[]): Promise<{ project: Project; role: Role; uid: string }> {
    const uid = await this.getSignedInUid();
    const projectSnap = await getDoc(doc(this.db, 'projects', projectId));
    if (!projectSnap.exists()) {
      throw new Error('対象のプロジェクトが見つかりません');
    }
    const project = this.hydrateProject(projectSnap.id, projectSnap.data() as Project);
    const role = this.resolveRoleForUser(project, uid);
    if (!role || !allowedRoles.includes(role)) {
      throw new Error('この操作を行う権限がありません');
    }
    return { project, role, uid };
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
        console.warn('●●●Timed out while waiting for Firebase auth state');
      } else {
        console.error('●●●Unexpected error while waiting for Firebase auth state:', error);
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


  async createProject(input: {
    name: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
    goal?: string;
  }) {
    console.log('●●●createProject called with:', input);
    const uid = (await this.requireUser()).uid;
    
    // プロジェクト名重複チェック（アクティブ内で一意）
    await this.checkNameUniqueness(input.name);
    
    // バリデーション: 開始日は終了日以前
    if (input.startDate && input.endDate && input.startDate > input.endDate) {
      throw new Error('開始日は終了日以前である必要があります');
    }
    
    const payload: Record<string, unknown> = {
      name: input.name,
      memberIds: [uid],
      roles: { [uid]: 'admin' },
      archived: false,
      progress: 0,  // 初期進捗率は0%
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
    console.log('●●●Creating document with payload:', payload);
    try {
    const ref = await addDoc(collection(this.db, 'projects'), payload);
    console.log('●●●Document created with ID:', ref.id);
    return ref.id;
    } catch (error) {
      console.error('●●●Error creating document:', error);
      throw error;
    }
  }
  public async listMyProjects(): Promise<Project[]> {
    console.log('●●●listMyProjects called');
    const uid = (await this.waitForUser())?.uid;
    console.log('●●●Current UID:', uid);
    if (!uid) {
      console.error('●●●User not authenticated - returning empty array');
      return [];
    }
    try {
      console.log('●●●Creating Firestore query...');
    const q = query(
      collection(this.db, 'projects'),
      where('memberIds', 'array-contains', uid),
    );
    console.log('●●●Executing Firestore query...');
    const snap = await getDocs(q);
    console.log('●●●Firestore query completed, documents:', snap.docs.length);
    const projects = snap.docs.map((d) => this.hydrateProject(d.id, d.data() as Project));
    projects.forEach((project) => {
      project.currentRole = this.resolveRoleForUser(project, uid) ?? undefined;
    });
    console.log('●●●Mapped projects:', projects);
    return projects;
    } catch (error) {
      console.error('●●●Error in listMyProjects:', error);
      return [];
    }
  }
   /**
   * プロジェクトを削除する
   * - 配下の課題・タスクも合わせて物理削除する
   */
   async deleteProject(projectId: string): Promise<void> {
    await this.ensureProjectRole(projectId, ['admin']);

    // プロジェクト配下の課題を取得
    const issuesRef = collection(this.db, `projects/${projectId}/issues`);
    const issuesSnap = await getDocs(issuesRef);

    for (const issueDoc of issuesSnap.docs) {
      // 課題配下のタスクを逐次削除
      const tasksRef = collection(this.db, `projects/${projectId}/issues/${issueDoc.id}/tasks`);
      const tasksSnap = await getDocs(tasksRef);
      for (const taskDoc of tasksSnap.docs) {
        await deleteDoc(taskDoc.ref);
      }

      await deleteDoc(issueDoc.ref); // 課題本体を削除
    }

    // 最後にプロジェクトドキュメントを削除
    await deleteDoc(doc(this.db, `projects/${projectId}`));
  }
  /**
   * 単一のプロジェクト情報を取得する
   * プロジェクト詳細パネルで利用するため、存在しない場合はnullを返す
   */
  public async getProject(id: string): Promise<Project | null> {
    try {
      const snapshot = await getDoc(doc(this.db, 'projects', id));
      if (!snapshot.exists()) {
        return null;
      }
      return this.hydrateProject(snapshot.id, snapshot.data() as Project);
    } catch (error) {
      console.error('●●●Error fetching project detail:', error);
      return null;
    }
  }


  async archive(id: string, archived: boolean) {
    await this.ensureProjectRole(id, ['admin']);
    return updateDoc(doc(this.db, 'projects', id), { archived });
  }
  async removeProjectMember(projectId: string, memberId: string): Promise<void> {
    const { project } = await this.ensureProjectRole(projectId, ['admin']);

    if (!project.memberIds.includes(memberId)) {
      throw new Error('指定されたユーザーはこのプロジェクトのメンバーではありません');
    }

    const nextMemberIds = project.memberIds.filter((id) => id !== memberId);
    const nextRoles = { ...(project.roles ?? {}) } as Record<string, Role>;
    if (memberId in nextRoles) {
      delete nextRoles[memberId];
    }

    const hasAdmin = Object.values(nextRoles).some((role) => role === 'admin');
    if (!hasAdmin) {
      throw new Error('少なくとも1人の管理者が必要です。');
    }

    await updateDoc(doc(this.db, 'projects', projectId), {
      memberIds: nextMemberIds,
      roles: nextRoles,
    });
  }

  /**
   * 既存プロジェクトの情報を更新する
   * @param id 更新対象のプロジェクトID
   * @param updates 更新内容（空文字はnullとして扱う）
   */
  async updateProject(
    id: string,
    updates: Partial<{
      name: string;
      description: string | null;
      startDate: Date | null;
      endDate: Date | null;
      goal: string | null;
    }>,
  ): Promise<void> {
    // --- プロジェクト名変更時は重複チェックを実施 ---
    const { project: current } = await this.ensureProjectRole(id, ['admin']);

    if (updates.name !== undefined) {
      await this.checkNameUniqueness(updates.name, id);
    }

    // --- FirestoreのTimestampが渡される場合に備えてDateへ正規化 ---
    const normalizeDate = (value: unknown): Date | null => {
      if (!value) {
        return null;
      }
      if (value instanceof Date) {
        return value;
      }
      if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
        return (value as { toDate: () => Date }).toDate();
      }
      const parsed = new Date(value as string);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    // --- 更新後の開始・終了日を算出（未指定の場合は既存値を利用） ---
    const currentStart = normalizeDate(current.startDate ?? null);
    const currentEnd = normalizeDate(current.endDate ?? null);
    const startDate = updates.startDate !== undefined ? normalizeDate(updates.startDate ?? null) : currentStart;
    const endDate = updates.endDate !== undefined ? normalizeDate(updates.endDate ?? null) : currentEnd;
    // --- 期間の整合性チェック（開始日 <= 終了日） ---
    if (startDate && endDate && startDate > endDate) {
      throw new Error('開始日は終了日以前である必要があります');
    }
    if (startDate) {
      await this.ensureProjectStartCoversDescendants(id, startDate);
    }
    if (endDate) {
      await this.ensureProjectEndCoversDescendants(id, endDate);
    }

    // --- Firestoreへ更新を反映（undefinedは送らず、nullは許容） ---
    const docRef = doc(this.db, 'projects', id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(docRef, updates as any);
  }


  /**
   * プロジェクト名の重複をチェックする
   * アクティブなプロジェクト内で同じ名前が存在する場合、エラーをスローする
   * @param name プロジェクト名
   * @param excludeProjectId 除外するプロジェクトID（更新時に使用）
   */
  private async checkNameUniqueness(name: string, excludeProjectId?: string): Promise<void> {
    const projects = await this.listMyProjects();
    const duplicate = projects.find(
      project => project.name === name && 
                 project.id !== excludeProjectId && 
                 !project.archived
    );
    if (duplicate) {
      throw new Error(`プロジェクト名 "${name}" は既に使用されています`);
    }
  }

  /**
   * プロジェクトをピン止め/解除する
   * @param projectId プロジェクトID
   * @param pinned ピン止めする場合はtrue、解除する場合はfalse
   */
  async togglePin(projectId: string, pinned: boolean): Promise<void> {
    const uid = await this.getSignedInUid();
    const projectSnap = await getDoc(doc(this.db, 'projects', projectId));
    
    if (!projectSnap.exists()) {
      throw new Error('プロジェクトが見つかりません');
    }

    const project = this.hydrateProject(projectSnap.id, projectSnap.data() as Project);
    const currentPinnedBy = project.pinnedBy ?? [];
    
    let nextPinnedBy: string[];
    if (pinned) {
      // ピン止め: 既に含まれていなければ追加
      if (!currentPinnedBy.includes(uid)) {
        nextPinnedBy = [...currentPinnedBy, uid];
      } else {
        return; // 既にピン止め済み
      }
    } else {
      // 解除: ユーザーIDを削除
      nextPinnedBy = currentPinnedBy.filter(id => id !== uid);
    }

    await updateDoc(doc(this.db, 'projects', projectId), {
      pinnedBy: nextPinnedBy,
    });
  }
}

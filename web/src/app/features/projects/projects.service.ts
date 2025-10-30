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
  getDoc,
} from '@angular/fire/firestore';
import { Auth, User, authState } from '@angular/fire/auth';
import { Project } from '../../models/schema';
import { firstValueFrom,TimeoutError} from 'rxjs';
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
    return {
      ...data,
      id,
      startDate: this.normalizeDate(dataRecord['startDate']),
      endDate: this.normalizeDate(dataRecord['endDate']),
      createdAt: this.normalizeDate(dataRecord['createdAt']),
      progress: (dataRecord['progress'] as number) ?? 0,
      archived: (dataRecord['archived'] as boolean) ?? false,
    };
  }

  private async ensureAuthReady() {
    if (!this.authReady) {
      this.authReady = this.auth.authStateReady();
    }

    try {
      await this.authReady;
    } catch (error) {
      // reset so we can try again on the next call
      this.authReady = null;
      throw error;
    }
  }

  private async waitForUser(): Promise<User | null> {
    try {
      await this.ensureAuthReady();
    } catch (error) {
      console.error('●●●Failed to await auth readiness:', error);
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
  async listMyProjects(): Promise<Project[]> {
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
    const projects = snap.docs.map((d) =>this.hydrateProject(d.id, d.data() as Project));
    console.log('●●●Mapped projects:', projects);
    return projects;
    } catch (error) {
      console.error('●●●Error in listMyProjects:', error);
      return [];
    }
  }
  /**
   * 単一のプロジェクト情報を取得する
   * プロジェクト詳細パネルで利用するため、存在しない場合はnullを返す
   */
  async getProject(id: string): Promise<Project | null> {
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
    return updateDoc(doc(this.db, 'projects', id), { archived });
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
    if (updates.name !== undefined) {
      await this.checkNameUniqueness(updates.name, id);
    }

    // --- Firestoreから最新のプロジェクトを取得して期間バリデーションに利用 ---
    const projectSnap = await getDoc(doc(this.db, 'projects', id));
    if (!projectSnap.exists()) {
      throw new Error('対象のプロジェクトが見つかりません');
    }
    const current = projectSnap.data() as Project;

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
    const startDate = updates.startDate !== undefined ? updates.startDate ?? null : currentStart;
    const endDate = updates.endDate !== undefined ? updates.endDate ?? null : currentEnd;

    // --- 期間の整合性チェック（開始日 <= 終了日） ---
    if (startDate && endDate && startDate > endDate) {
      throw new Error('開始日は終了日以前である必要があります');
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
}

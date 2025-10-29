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
} from '@angular/fire/firestore';
import { Auth, User } from '@angular/fire/auth';
import { Issue } from '../../models/schema';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { authState } from '@angular/fire/auth';

/**
 * 課題（Issue）管理サービス
 * プロジェクト配下の課題を作成・編集・削除・取得する
 */
@Injectable({ providedIn: 'root' })
export class IssuesService {
  private db = inject(Firestore);
  private auth = inject(Auth);
  private authReady: Promise<void> | null = null;

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
    await this.requireUser();
    
    // 名称重複チェック
    await this.checkNameUniqueness(projectId, input.name);

    const payload: Record<string, unknown> = {
      projectId,
      name: input.name,
      archived: false,
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
  async listIssues(projectId: string): Promise<Issue[]> {
    const uid = (await this.waitForUser())?.uid;
    if (!uid) {
      return [];
    }

    try {
      const q = query(
        collection(this.db, `projects/${projectId}/issues`),
        where('archived', '==', false)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Issue) }));
    } catch (error) {
      console.error('Error in listIssues:', error);
      return [];
    }
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
      return { id: docSnap.id, ...(docSnap.data() as Issue) };
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
    }>
  ): Promise<void> {
    // 名称変更の場合、重複チェック
    if (updates.name !== undefined) {
      await this.checkNameUniqueness(projectId, updates.name, issueId);
    }

    // バリデーション: 開始日は終了日以前
    if (updates.startDate !== undefined && updates.endDate !== undefined) {
      if (updates.startDate && updates.endDate && updates.startDate > updates.endDate) {
        throw new Error('開始日は終了日以前である必要があります');
      }
    }

    // 日付の大小をチェック（既存の開始日・終了日との比較）
    const issue = await this.getIssue(projectId, issueId);
    if (issue) {
      const startDate = updates.startDate !== undefined ? updates.startDate : issue.startDate;
      const endDate = updates.endDate !== undefined ? updates.endDate : issue.endDate;
      if (startDate && endDate && startDate > endDate) {
        throw new Error('開始日は終了日以前である必要があります');
      }
    }

    const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(docRef, updates as any);
  }

  /**
   * 課題をアーカイブする
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @param archived アーカイブ状態
   */
  async archiveIssue(projectId: string, issueId: string, archived: boolean): Promise<void> {
    await this.updateIssue(projectId, issueId, { archived });
  }

  /**
   * 課題を削除する（物理削除）
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   */
  async deleteIssue(projectId: string, issueId: string): Promise<void> {
    const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}`);
    await deleteDoc(docRef);
  }

  /**
   * プロジェクト内で課題名の重複をチェックする
   * 同じプロジェクト内で同じ名前のアクティブな課題が存在する場合、エラーをスローする
   * @param projectId プロジェクトID
   * @param name 課題名
   * @param excludeIssueId 除外する課題ID（更新時に使用）
   */
  private async checkNameUniqueness(projectId: string, name: string, excludeIssueId?: string): Promise<void> {
    const issues = await this.listIssues(projectId);
    const duplicate = issues.find(issue => issue.name === name && issue.id !== excludeIssueId);
    if (duplicate) {
      throw new Error(`課題名 "${name}" は既にこのプロジェクト内で使用されています`);
    }
  }
}


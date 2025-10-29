import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  query,
  getDocs,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  getDoc,
} from '@angular/fire/firestore';
import { Auth, User } from '@angular/fire/auth';
import { Tag } from '../../models/schema';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { authState } from '@angular/fire/auth';

/**
 * タグ管理サービス
 * ワークスペース全体で共有されるタグを作成・編集・削除・取得する
 */
@Injectable({ providedIn: 'root' })
export class TagsService {
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
   * タグを作成する
   * @param input タグの入力データ
   * @returns 作成されたタグのドキュメントID
   */
  async createTag(input: {
    name: string;
    color?: string;
  }): Promise<string> {
    await this.requireUser();
    
    // 名称重複チェック（ワークスペースで一意）
    await this.checkNameUniqueness(input.name);

    const payload: Record<string, unknown> = {
      name: input.name,
      createdAt: serverTimestamp(),
    };

    if (input.color !== undefined && input.color !== null && input.color !== '') {
      payload['color'] = input.color;
    }

    const ref = await addDoc(collection(this.db, 'tags'), payload);
    return ref.id;
  }

  /**
   * タグ一覧を取得する
   * @returns タグの配列
   */
  async listTags(): Promise<Tag[]> {
    try {
      const q = query(collection(this.db, 'tags'));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Tag) }));
    } catch (error) {
      console.error('Error in listTags:', error);
      return [];
    }
  }

  /**
   * 特定のタグを取得する
   * @param tagId タグID
   * @returns タグデータ（存在しない場合はnull）
   */
  async getTag(tagId: string): Promise<Tag | null> {
    const docRef = doc(this.db, `tags/${tagId}`);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return { id: docSnap.id, ...(docSnap.data() as Tag) };
    }
    return null;
  }

  /**
   * タグを更新する
   * @param tagId タグID
   * @param updates 更新データ
   */
  async updateTag(
    tagId: string,
    updates: Partial<{
      name: string;
      color: string | null;
    }>
  ): Promise<void> {
    // 名称変更の場合、重複チェック
    if (updates.name !== undefined) {
      await this.checkNameUniqueness(updates.name, tagId);
    }

    const docRef = doc(this.db, `tags/${tagId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(docRef, updates as any);
  }

  /**
   * タグを削除する
   * @param tagId タグID
   */
  async deleteTag(tagId: string): Promise<void> {
    const docRef = doc(this.db, `tags/${tagId}`);
    await deleteDoc(docRef);
  }

  /**
   * タグ名の重複をチェックする
   * ワークスペース全体で同じ名前のタグが存在する場合、エラーをスローする
   * @param name タグ名
   * @param excludeTagId 除外するタグID（更新時に使用）
   */
  private async checkNameUniqueness(name: string, excludeTagId?: string): Promise<void> {
    const tags = await this.listTags();
    const duplicate = tags.find(tag => tag.name === name && tag.id !== excludeTagId);
    if (duplicate) {
      throw new Error(`タグ名 "${name}" は既に使用されています`);
    }
  }
}


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

type TagWithId = Tag & { id: string };

/**
 * タグ管理サービス
 * ワークスペース全体で共有されるタグを作成・編集・削除・取得する
 */
@Injectable({ providedIn: 'root' })
export class TagsService {
  private db = inject(Firestore);
  private auth = inject(Auth);
  private authReady: Promise<void> | null = null;
  private colorAssignments = new Map<string, string>(); // 表示用に確保したカラーを保持

  /** Firestoreからタグ一覧をそのまま取得する */
  private async fetchTagsRaw(): Promise<TagWithId[]> {
    const tagsCollection = collection(this.db, 'tags');
    const snap = await getDocs(query(tagsCollection));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Tag) }));
  }

  /** 16進カラーコードを正規化（#付き・大文字6桁） */
  private normalizeColor(color: string | null | undefined): string | null {
    if (!color) {
      return null;
    }
    const trimmed = color.trim();
    if (!trimmed) {
      return null;
    }
    const hexMatch = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hexMatch) {
      return null;
    }
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map((char) => char + char).join('');
    }
    return `#${hex.toUpperCase()}`;
  }

  /** 使用済みカラーと衝突しないランダムカラーを生成 */
  private generateUniqueColor(usedColors: Set<string>): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const color = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
      if (!usedColors.has(color)) {
        return color;
      }
    }

    // ランダムで解決できなかった場合のフォールバック（決定論的にカラーを算出）
    let fallback = usedColors.size + 1;
    while (true) {
      const value = ((fallback * 2654435761) & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
      const color = `#${value}`;
      if (!usedColors.has(color)) {
        return color;
      }
      fallback++;
    }
  }

  /** タグ名の一意性を検証 */
  private ensureUniqueName(name: string, tags: TagWithId[], excludeTagId?: string): void {
    const duplicate = tags.find(tag => tag.name === name && tag.id !== excludeTagId);
    if (duplicate) {
      throw new Error(`タグ名 "${name}" は既に使用されています`);
    }
  }

  /** 希望色を尊重しつつ、他タグと重複しないカラーを決定 */
  private resolveUniqueColor(
    preferredColor: string | null | undefined,
    tags: TagWithId[],
    excludeTagId?: string,
  ): string {
    const usedColors = new Set<string>();

    for (const tag of tags) {
      if (excludeTagId && tag.id === excludeTagId) {
        continue;
      }
      const normalized = this.normalizeColor(tag.color);
      if (normalized) {
        usedColors.add(normalized);
      }
    }

    for (const [tagId, assigned] of this.colorAssignments.entries()) {
      if (excludeTagId && tagId === excludeTagId) {
        continue;
      }
      usedColors.add(assigned);
    }

    const normalizedPreferred = this.normalizeColor(preferredColor);
    if (normalizedPreferred && !usedColors.has(normalizedPreferred)) {
      usedColors.add(normalizedPreferred);
      return normalizedPreferred;
    }

    const generated = this.generateUniqueColor(usedColors);
    usedColors.add(generated);
    return generated;
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
   * タグを作成する
   * @param input タグの入力データ
   * @returns 作成されたタグのドキュメントID
   */
  async createTag(input: {
    name: string;
    color?: string;
  }): Promise<string> {
    const user = await this.requireUser();

    const tags = await this.fetchTagsRaw();
    this.ensureUniqueName(input.name, tags);

    const resolvedColor = this.resolveUniqueColor(input.color ?? null, tags);

    const payload: Record<string, unknown> = {
      name: input.name,
      color: resolvedColor,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    };
    const ref = await addDoc(collection(this.db, 'tags'), payload);
    this.colorAssignments.set(ref.id, resolvedColor);
    return ref.id;
  }

  /**
   * タグ一覧を取得する
   * @returns タグの配列
   */
  async listTags(): Promise<Tag[]> {
    try {
      const tags = await this.fetchTagsRaw();
      const assignedThisRound = new Set<string>();
      const normalizedTags: Tag[] = tags.map(tag => {
        const tagId = tag.id;
        const cachedColor = tagId ? this.colorAssignments.get(tagId) ?? null : null;
        const normalizedOriginal = this.normalizeColor(tag.color);
        let colorToUse = cachedColor ?? normalizedOriginal;

        if (!colorToUse || assignedThisRound.has(colorToUse)) {
          const generated = this.generateUniqueColor(assignedThisRound);
          assignedThisRound.add(generated);
          colorToUse = generated;
        } else {
          assignedThisRound.add(colorToUse);
        }

        if (tagId) {
          this.colorAssignments.set(tagId, colorToUse);
        }

        return {
          ...tag,
          color: colorToUse,
        };
      });

      const validIds = new Set(tags.map(tag => tag.id));
      for (const cachedId of Array.from(this.colorAssignments.keys())) {
        if (!validIds.has(cachedId)) {
          this.colorAssignments.delete(cachedId);
        }
      }

      return normalizedTags;
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
    let cachedTags: TagWithId[] | null = null;

    if (updates.name !== undefined || updates.color !== undefined) {
      cachedTags = await this.fetchTagsRaw();
    }

    if (updates.name !== undefined && cachedTags) {
      this.ensureUniqueName(updates.name, cachedTags, tagId);
    }

    if (updates.color !== undefined) {
      cachedTags ??= await this.fetchTagsRaw();
      const resolvedColor = this.resolveUniqueColor(updates.color ?? null, cachedTags, tagId);
      updates.color = resolvedColor;
      this.colorAssignments.set(tagId, resolvedColor);
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
    const user = await this.requireUser();
    const tag = await this.getTag(tagId);
    if (!tag) {
      throw new Error('指定したタグが見つかりません');
    }
    if (tag.createdBy && tag.createdBy !== user.uid) {
      throw new Error('タグを削除する権限がありません');
    }
    const docRef = doc(this.db, `tags/${tagId}`);
    await deleteDoc(docRef);
    this.colorAssignments.delete(tagId);
  }
}


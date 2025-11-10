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
import { Role, Tag } from '../../models/schema';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { authState } from '@angular/fire/auth';

type TagWithId = Tag & { id: string };

/**
 * タグ管理サービス
 * プロジェクト単位で利用するタグの作成・編集・削除・取得を担う
 */
@Injectable({ providedIn: 'root' })
export class TagsService {
  private db = inject(Firestore);
  private auth = inject(Auth);
  private authReady: Promise<void> | null = null;
  // プロジェクト単位で色割り当てを保持（projectId -> (tagId -> color)）
  private colorAssignments = new Map<string, Map<string, string>>();

  /** 指定プロジェクト向けのタグコレクションを組み立てる */
  private getTagsCollection(projectId: string) {
    const normalized = projectId?.trim();
    if (!normalized) {
      throw new Error('projectId is required');
    }
    return collection(this.db, `projects/${normalized}/tags`);
  }

  /** プロジェクト単位のカラー割り当てマップを取得（存在しなければ初期化） */
  private getProjectColorAssignments(projectId: string): Map<string, string> {
    const normalized = projectId.trim();
    let assignments = this.colorAssignments.get(normalized);
    if (!assignments) {
      assignments = new Map<string, string>();
      this.colorAssignments.set(normalized, assignments);
    }
    return assignments;
  }

  /** Firestoreからタグ一覧をそのまま取得する */
  private async fetchTagsRaw(projectId: string): Promise<TagWithId[]> {
    const tagsCollection = this.getTagsCollection(projectId);
    const snap = await getDocs(query(tagsCollection));
    return snap.docs.map((d) => {
      const data = d.data() as Tag;
      return { id: d.id, ...data, projectId: data.projectId ?? projectId };
    });
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
    projectId: string,
    preferredColor: string | null | undefined,
    tags: TagWithId[],
    excludeTagId?: string,
  ): string {
    const usedColors = new Set<string>();
    const assignments = this.getProjectColorAssignments(projectId);

    for (const tag of tags) {
      if (excludeTagId && tag.id === excludeTagId) {
        continue;
      }
      const normalized = this.normalizeColor(tag.color);
      if (normalized) {
        usedColors.add(normalized);
      }
    }

    for (const [tagId, assigned] of assignments.entries()) {
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
  async createTag(projectId: string, input: {
    name: string;
    color?: string;
  }): Promise<string> {
    const user = await this.requireUser();

    const trimmedName = input.name.trim();
    if (!trimmedName) {
      throw new Error('タグ名を入力してください');
    }

    // タグ名の文字数上限チェック（10文字）
    const MAX_TAG_NAME_LENGTH = 10;
    if (trimmedName.length > MAX_TAG_NAME_LENGTH) {
      throw new Error(`タグ名は最大${MAX_TAG_NAME_LENGTH}文字までです`);
    }

    const tags = await this.fetchTagsRaw(projectId);
    if (tags.length >= 20) {
      throw new Error('タグは1プロジェクトあたり最大20個までです');
    }
    this.ensureUniqueName(trimmedName, tags);

    const resolvedColor = this.resolveUniqueColor(projectId, input.color ?? null, tags);

    const payload: Record<string, unknown> = {
      projectId,
      name: trimmedName,
      color: resolvedColor,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    };
    const ref = await addDoc(this.getTagsCollection(projectId), payload);
    this.getProjectColorAssignments(projectId).set(ref.id, resolvedColor);
    return ref.id;
  }

  /**
   * タグ一覧を取得する
   * @returns タグの配列
   */
  async listTags(projectId: string): Promise<Tag[]> {
    try {
      const tags = await this.fetchTagsRaw(projectId);
      const usedColors = new Set<string>();
      const tagsNeedingColor: { id: string; fallbackColor: string }[] = [];
      const assignments = this.getProjectColorAssignments(projectId);

      // 既存タグのカラーを正規化し、使用済みカラー集合を先に構築
      for (const tag of tags) {
        const normalized = this.normalizeColor(tag.color);
        if (normalized) {
          usedColors.add(normalized);
        }
      }

      const normalizedTags: Tag[] = tags.map((tag) => {
        const normalized = this.normalizeColor(tag.color);
        let resolvedColor = normalized;

        if (!resolvedColor) {
          // カラー未設定のタグには新たに一意なカラーを割り当てる（以後変更しない）
          resolvedColor = this.generateUniqueColor(usedColors);
          usedColors.add(resolvedColor);
          tagsNeedingColor.push({ id: tag.id, fallbackColor: resolvedColor });
        }

        if (tag.id) {
          assignments.set(tag.id, resolvedColor);
        }

        return {
          ...tag,
          projectId,
          color: resolvedColor,
        };
      });
      if (tagsNeedingColor.length > 0) {
        await Promise.all(
          tagsNeedingColor.map(({ id, fallbackColor }) => {
            const docRef = doc(this.db, `projects/${projectId}/tags/${id}`);
            return updateDoc(docRef, { color: fallbackColor });
          }),
        );
      }

      const validIds = new Set(tags.map(tag => tag.id));
      for (const cachedId of Array.from(assignments.keys())) {
        if (!validIds.has(cachedId)) {
          assignments.delete(cachedId);
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
  async getTag(projectId: string, tagId: string): Promise<Tag | null> {
    const docRef = doc(this.db, `projects/${projectId}/tags/${tagId}`);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data() as Tag;
      return { id: docSnap.id, ...data, projectId: data.projectId ?? projectId };
    }
    return null;
  }

  /**
   * タグを更新する
   * @param tagId タグID
   * @param updates 更新データ
   */
  async updateTag(
    projectId: string,
    tagId: string,
    updates: Partial<{
      name: string;
      color: string | null;
    }>
  ): Promise<void> {
    let cachedTags: TagWithId[] | null = null;

    if (updates.name !== undefined || updates.color !== undefined) {
      cachedTags = await this.fetchTagsRaw(projectId);
    }

    if (updates.name !== undefined && cachedTags) {
      const trimmedName = updates.name.trim();
      if (!trimmedName) {
        throw new Error('タグ名を入力してください');
      }

      // タグ名の文字数上限チェック（10文字）
      const MAX_TAG_NAME_LENGTH = 10;
      if (trimmedName.length > MAX_TAG_NAME_LENGTH) {
        throw new Error(`タグ名は最大${MAX_TAG_NAME_LENGTH}文字までです`);
      }

      updates.name = trimmedName;
      this.ensureUniqueName(trimmedName, cachedTags, tagId);
    }

    if (updates.color !== undefined) {
      cachedTags ??= await this.fetchTagsRaw(projectId);
      const resolvedColor = this.resolveUniqueColor(projectId, updates.color ?? null, cachedTags, tagId);
      updates.color = resolvedColor;
      this.getProjectColorAssignments(projectId).set(tagId, resolvedColor);
    }

    const docRef = doc(this.db, `projects/${projectId}/tags/${tagId}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(docRef, updates as any);
  }

  /**
   * タグを削除する
   * @param tagId タグID
   */
  async deleteTag(projectId: string, tagId: string, requesterRole: Role | null): Promise<void> {
    const user = await this.requireUser();
    const tag = await this.getTag(projectId, tagId);
    if (!tag) {
      throw new Error('指定したタグが見つかりません');
    }
    if (requesterRole !== 'admin') {
      if (!tag.createdBy || tag.createdBy !== user.uid) {
        throw new Error('タグを削除する権限がありません');
      }
    }
    const docRef = doc(this.db, `projects/${projectId}/tags/${tagId}`);
    await deleteDoc(docRef);
    this.getProjectColorAssignments(projectId).delete(tagId);
  }
}


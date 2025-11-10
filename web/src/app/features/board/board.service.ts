import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  doc,
  getDoc,
  getCountFromServer,
  deleteDoc,
} from '@angular/fire/firestore';
import { Auth, User, authState } from '@angular/fire/auth';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { BulletinPost, Project, Role } from '../../models/schema';
import { ProjectsService } from '../projects/projects.service';

interface ListOptions {
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly db = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly projectsService = inject(ProjectsService);

  private authReady: Promise<void> | null = null;

  private async ensureAuthReady(): Promise<void> {
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

    if (this.auth.currentUser) {
      return this.auth.currentUser;
    }

    try {
      return await firstValueFrom(
        authState(this.auth).pipe(
          filter((value): value is User => value !== null),
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

  private hydratePost(id: string, data: BulletinPost): BulletinPost {
    const record = data as unknown as Record<string, unknown>;
    const projectIdsRaw = record['projectIds'];
    const projectIds = Array.isArray(projectIdsRaw)
      ? projectIdsRaw.map((projectId) => String(projectId))
      : [];
      const authorUsernameRaw = record['authorUsername'] ?? record['authorName'];
      const authorIdRaw = record['authorId'];
      const authorUsername = typeof authorUsernameRaw === 'string' && authorUsernameRaw.trim().length > 0
        ? authorUsernameRaw.trim()
        : typeof authorIdRaw === 'string'
          ? authorIdRaw
          : 'unknown';

    return {
      ...data,
      id,
      projectIds,
      authorUsername,
      authorPhotoUrl: (record['authorPhotoUrl'] as string | null | undefined) ?? null,
      createdAt: this.normalizeDate(record['createdAt']) ?? null,
      updatedAt: this.normalizeDate(record['updatedAt']) ?? null,
    };
  }

  private chunkProjectIds(projectIds: string[], chunkSize = 10): string[][] {
    const result: string[][] = [];
    for (let index = 0; index < projectIds.length; index += chunkSize) {
      result.push(projectIds.slice(index, index + chunkSize));
    }
    return result;
  }

  private resolveRole(project: Project, uid: string): Role | null {
    if (project.currentRole) {
      return project.currentRole;
    }
    const roles = project.roles ?? {};
    return roles[uid] ?? null;
  }

  private async resolveAuthorProfile(user: User): Promise<{ username: string; photoURL: string | null }> {
    const usernamePattern = /^[a-z0-9_]{3,10}$/;
    try {
      const snapshot = await getDoc(doc(this.db, 'users', user.uid));
      if (snapshot.exists()) {
        const data = snapshot.data() as Record<string, unknown>;
        const rawUsername = typeof data['username'] === 'string' ? data['username'].trim().toLowerCase() : '';
        const username = usernamePattern.test(rawUsername) ? rawUsername : user.uid;
        const photoUrlRaw = data['photoURL'];
        const photoURL = typeof photoUrlRaw === 'string' && photoUrlRaw.trim().length > 0
          ? photoUrlRaw
          : user.photoURL ?? null;
        return { username, photoURL };
      }
    } catch (error) {
      console.error('掲示板投稿用のユーザー情報取得に失敗しました:', error);
    }

    const fallbackDisplayName = typeof user.displayName === 'string' ? user.displayName.trim().toLowerCase() : '';
    const fallbackEmailId = typeof user.email === 'string' && user.email.includes('@')
      ? user.email.split('@')[0].trim().toLowerCase()
      : '';
    const fallbackUsername = [fallbackDisplayName, fallbackEmailId]
      .map((candidate) => candidate.replace(/[^a-z0-9_]/g, ''))
      .map((candidate) => candidate.slice(0, 10))
      .find((candidate) => usernamePattern.test(candidate))
      ?? user.uid;

    return { username: fallbackUsername, photoURL: user.photoURL ?? null };
  }

  async createPost(input: { title: string; content: string; projectIds: string[] }): Promise<string> {
    const user = await this.requireUser();
    const rawTitle = (input.title ?? '').trim();
    const rawContent = (input.content ?? '').trim();

    if (!rawTitle) {
      throw new Error('タイトルを入力してください');
    }
    if (rawTitle.length > 120) {
      throw new Error('タイトルは120文字以内で入力してください');
    }
    if (!rawContent) {
      throw new Error('内容を入力してください');
    }
    if (rawContent.length > 20000) {
      throw new Error('内容は20000文字以内で入力してください');
    }


    const uniqueProjectIds = Array.from(new Set((input.projectIds ?? []).filter(Boolean)));
    if (uniqueProjectIds.length === 0) {
      throw new Error('少なくとも1つのプロジェクトを選択してください');
    }
    if (uniqueProjectIds.length > 5) {
      throw new Error('プロジェクトは最大5件まで選択できます');
    }

    const projects = await this.projectsService.listMyProjects();
    const uid = user.uid;
    const allowedProjectIds = new Set(
      projects
        .filter((project): project is Project & { id: string } => Boolean(project.id))
        .filter((project) => {
          const role = this.resolveRole(project, uid);
          return role === 'admin' || role === 'member';
        })
        .map((project) => project.id!),
    );

    for (const projectId of uniqueProjectIds) {
      if (!allowedProjectIds.has(projectId)) {
        throw new Error('所属していない、または投稿権限のないプロジェクトが含まれています');
      }
    }
    const authorProfile = await this.resolveAuthorProfile(user);

    const payload: Record<string, unknown> = {
      title: rawTitle,
      content: rawContent,
      projectIds: uniqueProjectIds,
      authorId: uid,
      authorUsername: authorProfile.username,
      authorPhotoUrl: authorProfile.photoURL,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const ref = await addDoc(collection(this.db, 'bulletinPosts'), payload);
    return ref.id;
  }

  async listAccessiblePosts(options?: ListOptions): Promise<BulletinPost[]> {
    const projects = await this.projectsService.listMyProjects();
    const accessibleProjects = projects.filter((project): project is Project & { id: string } => Boolean(project.id));
    if (accessibleProjects.length === 0) {
      return [];
    }
    const accessibleIds = accessibleProjects.map((project) => project.id!);
    const accessibleSet = new Set(accessibleIds);

    const chunks = this.chunkProjectIds(accessibleIds);
    const collectionRef = collection(this.db, 'bulletinPosts');
    const requestedLimit = options?.limit ?? 500;

    // 各チャンククエリでorderByとlimitを使用して効率的に取得
    // 複数チャンクがある場合に備えて、各チャンクでrequestedLimit件取得
    const snapshots = await Promise.all(
      chunks.map((ids) => {
        if (ids.length === 0) {
          return Promise.resolve(null);
        }
        const q = query(
          collectionRef,
          where('projectIds', 'array-contains-any', ids),
          orderBy('createdAt', 'desc'),
          limit(requestedLimit),
        );
        return getDocs(q);
      }),
    );

    const postsMap = new Map<string, BulletinPost>();

    for (const snapshot of snapshots) {
      if (!snapshot) {
        continue;
      }
      snapshot.forEach((docSnap) => {
        const post = this.hydratePost(docSnap.id, docSnap.data() as BulletinPost);
        if (post.projectIds.some((projectId) => accessibleSet.has(projectId))) {
          postsMap.set(post.id!, post);
        }
      });
    }

    // マージ後の投稿を日付順にソート（クエリで既にソート済みだが、複数チャンクのマージのため再ソート）
    const posts = Array.from(postsMap.values());
    posts.sort((a, b) => {
      const left = a.createdAt ? a.createdAt.getTime() : 0;
      const right = b.createdAt ? b.createdAt.getTime() : 0;
      return right - left;
    });

    // 最終的にrequestedLimit件に制限
    return posts.slice(0, requestedLimit);
  }

  async deletePost(postId: string): Promise<void> {
    const user = await this.requireUser();
    if (!postId) {
      throw new Error('投稿IDが指定されていません');
    }

    const postRef = doc(this.db, 'bulletinPosts', postId);
    const postSnap = await getDoc(postRef);

    if (!postSnap.exists()) {
      throw new Error('投稿が見つかりません');
    }

    const postData = postSnap.data() as BulletinPost;
    if (postData.authorId !== user.uid) {
      throw new Error('自分の投稿のみ削除できます');
    }

    await deleteDoc(postRef);
  }
}
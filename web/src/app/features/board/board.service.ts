import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  where,
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

    return {
      ...data,
      id,
      projectIds,
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

  async createPost(input: { title: string; content: string; projectIds: string[] }): Promise<string> {
    const user = await this.requireUser();
    const rawTitle = (input.title ?? '').trim();
    const rawContent = (input.content ?? '').trim();

    if (!rawTitle) {
      throw new Error('タイトルを入力してください');
    }
    if (!rawContent) {
      throw new Error('内容を入力してください');
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

    const payload: Record<string, unknown> = {
      title: rawTitle,
      content: rawContent,
      projectIds: uniqueProjectIds,
      authorId: uid,
      authorName: user.displayName ?? '名称未設定ユーザー',
      authorPhotoUrl: user.photoURL ?? null,
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

    const snapshots = await Promise.all(
      chunks.map((ids) => {
        if (ids.length === 0) {
          return Promise.resolve(null);
        }
        const q = query(collectionRef, where('projectIds', 'array-contains-any', ids));
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

    const posts = Array.from(postsMap.values());
    posts.sort((a, b) => {
      const left = a.createdAt ? a.createdAt.getTime() : 0;
      const right = b.createdAt ? b.createdAt.getTime() : 0;
      return right - left;
    });

    if (options?.limit && options.limit > 0) {
      return posts.slice(0, options.limit);
    }

    return posts;
  }
}
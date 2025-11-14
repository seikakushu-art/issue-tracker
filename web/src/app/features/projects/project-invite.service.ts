import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { ProjectInvite, Role, InviteStatus, Project } from '../../models/schema';
import { ProjectsService } from './projects.service';
import { normalizeDate } from '../../shared/date-utils';

interface InviteCreationOptions {
  role: Role;
  expiresInHours: number;
  maxUses?: number | null;  // 最大使用回数（nullまたはundefinedで無制限、0以下も無制限として扱う）
}

interface InvitePreview {
  invite: ProjectInvite;
  project: Pick<Project, 'id' | 'name' | 'description'> | null;
}

@Injectable({ providedIn: 'root' })
export class ProjectInviteService {
  private db = inject(Firestore);
  private projectsService = inject(ProjectsService);

  private invitesCol = collection(this.db, 'projectInvites');

  private hydrateInvite(id: string, data: Record<string, unknown>): ProjectInvite {
    return {
      id,
      projectId: data['projectId'] as string,
      token: data['token'] as string,
      role: data['role'] as Role,
      status: (data['status'] as InviteStatus) ?? 'active',
      createdBy: data['createdBy'] as string,
      createdAt: normalizeDate(data['createdAt']) ?? null,
      expiresAt: normalizeDate(data['expiresAt']) ?? new Date(),
      maxUses: data['maxUses'] !== undefined ? (data['maxUses'] as number | null) : null,
      useCount: (data['useCount'] as number | undefined) ?? 0,
      usedBy: (data['usedBy'] as string | null | undefined) ?? null,
      usedAt: normalizeDate(data['usedAt']) ?? null,
      revokedBy: (data['revokedBy'] as string | null | undefined) ?? null,
      revokedAt: normalizeDate(data['revokedAt']) ?? null,
    };
  }

  private buildToken(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID().replace(/-/g, '');
    }
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 32; i += 1) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }
    return token;
  }

  private isExpired(invite: ProjectInvite): boolean {
    // expiresAtがnullまたは未設定の場合は期限切れとみなさない（無期限として扱う）
    if (!invite.expiresAt) {
      return false;
    }
    return invite.expiresAt.getTime() <= Date.now();
  }

  async createInvite(projectId: string, options: InviteCreationOptions): Promise<{ invite: ProjectInvite; url: string }> {
    const { uid } = await this.projectsService.ensureProjectRole(projectId, ['admin']);
    const token = this.buildToken();
    const expiresAt = new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000);
    
    // maxUsesが0以下またはnull/undefinedの場合は無制限（nullとして保存）
    const maxUses = options.maxUses && options.maxUses > 0 ? options.maxUses : null;

    const inviteRef = doc(this.invitesCol, token);
    await setDoc(inviteRef, {
      projectId,
      token,
      role: options.role,
      status: 'active',
      createdBy: uid,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
      maxUses,
      useCount: 0,
    });

    const invite: ProjectInvite = {
      id: token,
      projectId,
      token,
      role: options.role,
      status: 'active',
      createdBy: uid,
      createdAt: new Date(),
      expiresAt,
      maxUses,
      useCount: 0,
    };

    const url = `${location.origin}/invite/${token}`;
    return { invite, url };
  }

  async listInvites(projectId: string): Promise<ProjectInvite[]> {
    await this.projectsService.ensureProjectRole(projectId, ['admin']);

    const snap = await getDocs(
      query(
        this.invitesCol,
        where('projectId', '==', projectId),
        orderBy('createdAt', 'desc'),
      ),
    );

    const invites: ProjectInvite[] = [];
    for (const docSnap of snap.docs) {
      const invite = this.hydrateInvite(docSnap.id, docSnap.data());
      if (invite.status === 'active' && this.isExpired(invite)) {
        await updateDoc(doc(this.invitesCol, docSnap.id), {
          status: 'expired',
        });
        invite.status = 'expired';
      }
      invites.push(invite);
    }
    return invites;
  }

  async revokeInvite(token: string): Promise<void> {
    const inviteRef = doc(this.invitesCol, token);
    const inviteSnap = await getDoc(inviteRef);
    if (!inviteSnap.exists()) {
      throw new Error('招待リンクが見つかりません');
    }
    const invite = this.hydrateInvite(inviteSnap.id, inviteSnap.data());
    const { uid } = await this.projectsService.ensureProjectRole(invite.projectId, ['admin']);

    if (invite.status !== 'active') {
      throw new Error('この招待リンクはすでに無効です');
    }

    await updateDoc(inviteRef, {
      status: 'revoked',
      revokedBy: uid,
      revokedAt: serverTimestamp(),
    });
  }

  async previewInvite(token: string): Promise<InvitePreview> {
    const inviteRef = doc(this.invitesCol, token);
    const inviteSnap = await getDoc(inviteRef);
    if (!inviteSnap.exists()) {
      throw new Error('招待リンクが無効です');
    }
    let invite = this.hydrateInvite(inviteSnap.id, inviteSnap.data());

    if (invite.status === 'active' && this.isExpired(invite)) {
      await updateDoc(inviteRef, {
        status: 'expired',
      });
      invite = { ...invite, status: 'expired' };
    }

    const projectSnap = await getDoc(doc(this.db, 'projects', invite.projectId));
    const project = projectSnap.exists()
      ? {
          id: projectSnap.id,
          name: (projectSnap.data() as Project).name,
          description: (projectSnap.data() as Project).description ?? null,
        }
      : null;

    return { invite, project };
  }

  async acceptInvite(token: string): Promise<{ projectId: string; role: Role }> {
    const uid = await this.projectsService.getSignedInUid();

    // アクティブプロジェクト数の上限チェック（トランザクション外で実行）
    const activeProjectCount = await this.projectsService.countActiveProjects();
    const MAX_ACTIVE_PROJECTS = 30;
    if (activeProjectCount >= MAX_ACTIVE_PROJECTS) {
      throw new Error(`アクティブなプロジェクトの上限（${MAX_ACTIVE_PROJECTS}件）に達しています。プロジェクトに参加するには、既存のプロジェクトをアーカイブするか削除してください。`);
    }

    return runTransaction(this.db, async (tx) => {
      const inviteRef = doc(this.invitesCol, token);
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists()) {
        throw new Error('招待リンクが無効です');
      }

      const inviteData = inviteSnap.data() as Record<string, unknown>;
      let invite = this.hydrateInvite(inviteSnap.id, inviteData);

      if (invite.status === 'active' && this.isExpired(invite)) {
        tx.update(inviteRef, { status: 'expired' });
        invite = { ...invite, status: 'expired' };
      }

      if (invite.status !== 'active') {
        throw new Error('この招待リンクは使用できません');
      }

      // 使用回数チェック
      const currentUseCount = invite.useCount ?? 0;
      const maxUses = invite.maxUses;
      
      // maxUsesがnullまたはundefinedの場合は無制限
      if (maxUses !== null && maxUses !== undefined && maxUses > 0) {
        if (currentUseCount >= maxUses) {
          // エラーを先に投げる（トランザクションは自動的にロールバックされる）
          throw new Error('この招待リンクの使用回数上限に達しています');
        }
      }

      const projectRef = doc(this.db, 'projects', invite.projectId);
      const projectSnap = await tx.get(projectRef);
      if (!projectSnap.exists()) {
        throw new Error('対象のプロジェクトが存在しません');
      }

      const projectData = projectSnap.data() as Project;
      const memberIds = new Set<string>((projectData.memberIds ?? []) as string[]);
      const roles = { ...(projectData.roles ?? {}) } as Record<string, Role>;

      // プロジェクトのメンバー数の上限チェック（50人）
      const MAX_PROJECT_MEMBERS = 50;
      if (!memberIds.has(uid) && memberIds.size >= MAX_PROJECT_MEMBERS) {
        throw new Error('プロジェクトの参加人数の上限（50人）に達しています。');
      }

      memberIds.add(uid);
      const currentRole = roles[uid];
      const isInviteCreator = invite.createdBy === uid;
      const nextRole: Role = isInviteCreator && currentRole ? currentRole : invite.role;

      roles[uid] = nextRole;

      tx.update(projectRef, {
        memberIds: Array.from(memberIds),
        roles,
      });

      // 使用回数をインクリメント
      const newUseCount = currentUseCount + 1;
      
      // 使用回数が上限に達した場合はstatusも更新
      if (maxUses !== null && maxUses !== undefined && maxUses > 0 && newUseCount >= maxUses) {
        tx.update(inviteRef, {
          useCount: newUseCount,
          usedBy: uid,
          usedAt: serverTimestamp(),
          status: 'used',
        });
      } else {
        tx.update(inviteRef, {
          useCount: newUseCount,
          usedBy: uid,
          usedAt: serverTimestamp(),
        });
      }

      return { projectId: invite.projectId, role: roles[uid] };
    });
  }
}


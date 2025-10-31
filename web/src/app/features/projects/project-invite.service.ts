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

interface InviteCreationOptions {
  role: Role;
  expiresInHours: number;
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

  private normalizeDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (value instanceof Timestamp) return value.toDate();
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private hydrateInvite(id: string, data: Record<string, unknown>): ProjectInvite {
    return {
      id,
      projectId: data['projectId'] as string,
      token: data['token'] as string,
      role: data['role'] as Role,
      status: (data['status'] as InviteStatus) ?? 'active',
      createdBy: data['createdBy'] as string,
      createdAt: this.normalizeDate(data['createdAt']) ?? null,
      expiresAt: this.normalizeDate(data['expiresAt']) ?? new Date(),
      usedBy: (data['usedBy'] as string | null | undefined) ?? null,
      usedAt: this.normalizeDate(data['usedAt']) ?? null,
      revokedBy: (data['revokedBy'] as string | null | undefined) ?? null,
      revokedAt: this.normalizeDate(data['revokedAt']) ?? null,
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
    return invite.expiresAt.getTime() <= Date.now();
  }

  async createInvite(projectId: string, options: InviteCreationOptions): Promise<{ invite: ProjectInvite; url: string }> {
    const { uid } = await this.projectsService.ensureProjectRole(projectId, ['admin']);
    const token = this.buildToken();
    const expiresAt = new Date(Date.now() + options.expiresInHours * 60 * 60 * 1000);

    const inviteRef = doc(this.invitesCol, token);
    await setDoc(inviteRef, {
      projectId,
      token,
      role: options.role,
      status: 'active',
      createdBy: uid,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(expiresAt),
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
          revokedAt: invite.revokedAt ?? serverTimestamp(),
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
        revokedAt: serverTimestamp(),
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

      const projectRef = doc(this.db, 'projects', invite.projectId);
      const projectSnap = await tx.get(projectRef);
      if (!projectSnap.exists()) {
        throw new Error('対象のプロジェクトが存在しません');
      }

      const projectData = projectSnap.data() as Project;
      const memberIds = new Set<string>((projectData.memberIds ?? []) as string[]);
      const roles = { ...(projectData.roles ?? {}) } as Record<string, Role>;

      memberIds.add(uid);
      roles[uid] = invite.role;

      tx.update(projectRef, {
        memberIds: Array.from(memberIds),
        roles,
      });

      tx.update(inviteRef, {
        status: 'used',
        usedBy: uid,
        usedAt: serverTimestamp(),
      });

      return { projectId: invite.projectId, role: invite.role };
    });
  }
}


import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { UserDirectoryService } from '../../core/user-directory.service';
import { Attachment, Project, Role } from '../../models/schema';

interface AttachmentRow {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  uploadedAt: Date | null;
  uploadedBy: string;
  uploaderName: string;
  projectId?: string;
  projectName?: string | null;
  issueId?: string;
  issueName?: string | null;
  taskId?: string;
  taskTitle?: string | null;
}

@Component({
  selector: 'app-attachments-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './attachments-list.component.html',
  styleUrls: ['./attachments-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttachmentsListComponent implements OnInit {
  private readonly projectsService = inject(ProjectsService);
  private readonly tasksService = inject(TasksService);
  private readonly userDirectoryService = inject(UserDirectoryService);
  private readonly auth = inject(Auth);

  readonly attachments = signal<AttachmentRow[]>([]);
  readonly loading = signal<boolean>(false);
  readonly deletingId = signal<string | null>(null);
  readonly error = signal<string>('');
  readonly lastUpdated = signal<Date | null>(null);
  readonly projects = signal<Project[]>([]);
  readonly activeProjects = signal<Project[]>([]); // アーカイブされていないプロジェクトのみ
  readonly selectedProjectId = signal<string>('');
  readonly currentUid = signal<string | null>(null);
  readonly projectRoles = signal<Map<string, Role>>(new Map());

  async ngOnInit(): Promise<void> {
    await this.loadCurrentUser();
    await this.loadProjects();
    await this.refresh();
  }

  private async loadCurrentUser(): Promise<void> {
    const user = this.auth.currentUser;
    if (user) {
      this.currentUid.set(user.uid);
    } else {
      this.currentUid.set(null);
    }
  }

  async loadProjects(): Promise<void> {
    try {
      const projects = await this.projectsService.listMyProjects();
      this.projects.set(projects);
      // アーカイブされていないプロジェクトのみをフィルタリング
      this.activeProjects.set(projects.filter(p => !p.archived));
      
      // プロジェクトごとの権限をマップに保存
      const uid = this.currentUid();
      if (uid) {
        const rolesMap = new Map<string, Role>();
        for (const project of projects) {
          const role = project.roles?.[uid] ?? null;
          if (role) {
            rolesMap.set(project.id ?? '', role);
          }
        }
        this.projectRoles.set(rolesMap);
      }
      
      // 選択されているプロジェクトがアーカイブされている場合は選択をクリア
      const selectedProjectId = this.selectedProjectId();
      if (selectedProjectId) {
        const selectedProject = projects.find(p => p.id === selectedProjectId);
        if (selectedProject?.archived) {
          this.selectedProjectId.set('');
        }
      }
    } catch (error) {
      console.error('プロジェクト一覧の取得に失敗しました:', error);
    }
  }

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    try {
      const projects = this.projects();
      const selectedProjectId = this.selectedProjectId();
      
      // プロジェクトが選択されている場合はそのプロジェクトのみ、そうでなければ全て
      // アーカイブされたプロジェクトは除外
      const projectIds = selectedProjectId
        ? (() => {
            const selectedProject = projects.find(p => p.id === selectedProjectId);
            // 選択されたプロジェクトがアーカイブされている場合は除外
            return selectedProject && !selectedProject.archived ? [selectedProjectId] : [];
          })()
        : this.extractProjectIds(projects);

      if (projectIds.length === 0) {
        this.attachments.set([]);
        this.lastUpdated.set(new Date());
        return;
      }

      const attachments = await this.tasksService.listAttachmentsForProjects(projectIds);
      if (attachments.length === 0) {
        this.attachments.set([]);
        this.lastUpdated.set(new Date());
        return;
      }

      // アーカイブされたタスクの添付ファイルを除外するため、タスクのアーカイブ状態を取得
      const taskArchivedMap = new Map<string, boolean>();
      for (const projectId of projectIds) {
        try {
          const tasks = await this.tasksService.listTasksByProject(projectId, true);
          for (const task of tasks) {
            if (task.id) {
              taskArchivedMap.set(task.id, task.archived ?? false);
            }
          }
        } catch (error) {
          console.error(`プロジェクト ${projectId} のタスク取得に失敗しました:`, error);
        }
      }

      // アーカイブされたタスクの添付ファイルを除外
      const filteredAttachments = attachments.filter((attachment) => {
        if (!attachment.taskId) {
          // タスクIDが無い場合は表示する（互換性のため）
          return true;
        }
        const isArchived = taskArchivedMap.get(attachment.taskId);
        // タスクが見つからない場合も表示する（削除されたタスクの可能性があるため）
        return isArchived === undefined ? true : !isArchived;
      });

      if (filteredAttachments.length === 0) {
        this.attachments.set([]);
        this.lastUpdated.set(new Date());
        return;
      }

      const profileMap = await this.buildProfileMap(filteredAttachments);
      const projectNameMap = new Map<string, string>(); // 使用されなくなったが、型の互換性のため残す

      const rows = filteredAttachments.map(attachment => this.composeRow(attachment, {
        profileMap,
        projectNameMap,
      }));

      this.attachments.set(rows);
      this.lastUpdated.set(new Date());
    } catch (error) {
      console.error('添付ファイル一覧の取得に失敗しました:', error);
      const message = error instanceof Error ? error.message : '添付ファイル一覧の取得に失敗しました。';
      this.error.set(message);
      this.attachments.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  onProjectChange(): void {
    void this.refresh();
  }

  formatFileSize(bytes: number | null | undefined): string {
    if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const formatted = unitIndex === 0 ? Math.round(size).toString() : size.toFixed(size >= 10 ? 0 : 1);
    return `${formatted} ${units[unitIndex]}`;
  }

  getTaskLink(row: AttachmentRow): string[] | null {
    if (!row.projectId || !row.issueId) {
      return null;
    }
    return ['/projects', row.projectId, 'issues', row.issueId];
  }

  trackByAttachmentId(_: number, row: AttachmentRow): string {
    return row.id;
  }

  canDeleteAttachment(row: AttachmentRow): boolean {
    const uid = this.currentUid();
    if (!uid || !row.projectId) {
      return false;
    }
    const role = this.projectRoles().get(row.projectId);
    if (role === 'admin') {
      return true; // 管理者はすべての添付ファイルを削除可能
    }
    if (role === 'member') {
      return row.uploadedBy === uid; // メンバーは自分がアップロードしたファイルのみ削除可能
    }
    return false;
  }

  async deleteAttachment(row: AttachmentRow, event: Event): Promise<void> {
    event.stopPropagation();
    event.preventDefault();

    if (!this.canDeleteAttachment(row)) {
      alert('この添付ファイルを削除する権限がありません');
      return;
    }

    if (!row.projectId || !row.issueId || !row.taskId || !row.id) {
      alert('添付ファイル情報が不完全です');
      return;
    }

    if (!confirm(`添付ファイル「${row.fileName}」を削除しますか？`)) {
      return;
    }

    this.deletingId.set(row.id);
    this.error.set('');

    try {
      await this.tasksService.deleteAttachment(row.projectId, row.issueId, row.taskId, row.id);
      // 一覧を更新
      await this.refresh();
    } catch (error) {
      console.error('添付ファイルの削除に失敗しました:', error);
      const message = error instanceof Error ? error.message : '添付ファイルの削除に失敗しました';
      this.error.set(message);
      alert(message);
    } finally {
      this.deletingId.set(null);
    }
  }

  private extractProjectIds(projects: Project[]): string[] {
    return Array.from(new Set(
      projects
        .filter(project => !project.archived) // アーカイブされたプロジェクトを除外
        .map(project => project.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    ));
  }

  private async buildProfileMap(attachments: Attachment[]): Promise<Map<string, string>> {
    const uploaderIds = Array.from(new Set(
      attachments
        .map(attachment => attachment.uploadedBy)
        .filter((uid): uid is string => typeof uid === 'string' && uid.trim().length > 0),
    ));

    if (uploaderIds.length === 0) {
      return new Map();
    }

    const profiles = await this.userDirectoryService.getProfiles(uploaderIds);
    const profileMap = new Map<string, string>();
    for (const profile of profiles) {
      profileMap.set(profile.uid, profile.username);
    }
    return profileMap;
  }

  private getProjectDisplayName(projectId: string | undefined, allProjects: Project[]): string | null {
    if (!projectId) {
      return null;
    }
    const project = allProjects.find(p => p.id === projectId);
    if (!project) {
      return '削除されたプロジェクト';
    }
    if (project.archived) {
      return 'アーカイブされたプロジェクト';
    }
    return project.name;
  }

  private composeRow(
    attachment: Attachment,
    context: { profileMap: Map<string, string>; projectNameMap: Map<string, string> },
  ): AttachmentRow {
    const uploaderName = context.profileMap.get(attachment.uploadedBy) ?? attachment.uploadedBy ?? '不明なユーザー';
    const projects = this.projects();
    const projectName = attachment.projectName
      ?? this.getProjectDisplayName(attachment.projectId, projects);

    return {
      id: attachment.id,
      fileName: attachment.fileName,
      fileUrl: attachment.fileUrl,
      fileSize: attachment.fileSize,
      uploadedAt: attachment.uploadedAt ?? null,
      uploadedBy: attachment.uploadedBy,
      uploaderName,
      projectId: attachment.projectId,
      projectName,
      issueId: attachment.issueId,
      issueName: attachment.issueName ?? null,
      taskId: attachment.taskId,
      taskTitle: attachment.taskTitle ?? null,
    } satisfies AttachmentRow;
  }
}
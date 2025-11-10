import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { UserDirectoryService } from '../../core/user-directory.service';
import { Attachment, Project } from '../../models/schema';

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

  readonly attachments = signal<AttachmentRow[]>([]);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string>('');
  readonly lastUpdated = signal<Date | null>(null);
  readonly projects = signal<Project[]>([]);
  readonly activeProjects = signal<Project[]>([]); // アーカイブされていないプロジェクトのみ
  readonly selectedProjectId = signal<string>('');

  async ngOnInit(): Promise<void> {
    await this.loadProjects();
    await this.refresh();
  }

  async loadProjects(): Promise<void> {
    try {
      const projects = await this.projectsService.listMyProjects();
      this.projects.set(projects);
      // アーカイブされていないプロジェクトのみをフィルタリング
      this.activeProjects.set(projects.filter(p => !p.archived));
      
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

      const profileMap = await this.buildProfileMap(attachments);
      const projectNameMap = new Map<string, string>(); // 使用されなくなったが、型の互換性のため残す

      const rows = attachments.map(attachment => this.composeRow(attachment, {
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
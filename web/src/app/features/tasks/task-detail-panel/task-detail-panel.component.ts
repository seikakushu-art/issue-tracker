import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    Input,
    OnChanges,
    Output,
    SimpleChanges,
    inject,
  } from '@angular/core';
  import { CommonModule } from '@angular/common';
  import { FormsModule } from '@angular/forms';
  import { Auth } from '@angular/fire/auth';
  import {
    Attachment,
    ChecklistItem,
    Comment,
    Importance,
    Issue,
    Project,
    Role,
    Tag,
    Task,
  } from '../../../models/schema';
  import { TasksService } from '../tasks.service';
  import { TagsService } from '../../tags/tags.service';
  import { IssuesService } from '../../issues/issues.service';
  import { ProjectsService } from '../../projects/projects.service';
  import { UserDirectoryService, UserDirectoryProfile } from '../../../core/user-directory.service';
  import { resolveIssueThemeColor } from '../../../shared/issue-theme';
  import { getAvatarColor, getAvatarInitial } from '../../../shared/avatar-utils';
  
  interface TaskCommentView extends Comment {
    authorUsername: string;
    authorPhotoUrl: string | null;
    mentions: string[];
  }
  
  interface TaskAttachmentView extends Attachment {
    uploaderLabel: string;
    uploaderPhotoUrl: string | null;
  }
  
  @Component({
    selector: 'app-task-detail-panel',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './task-detail-panel.component.html',
    styleUrls: ['./task-detail-panel.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  export class TaskDetailPanelComponent implements OnChanges {
    private tasksService = inject(TasksService);
    private tagsService = inject(TagsService);
    private issuesService = inject(IssuesService);
    private projectsService = inject(ProjectsService);
    private userDirectoryService = inject(UserDirectoryService);
    private auth = inject(Auth);
    private cdr = inject(ChangeDetectorRef);
  
    @Input() projectId: string | null = null;
    @Input() issueId: string | null = null;
    @Input() taskId: string | null = null;
    @Input() visible = false;
    @Input() allowEditing = false; // 親コンポーネントからの編集許可フラグ
  
    @Output() closed = new EventEmitter<void>();
    @Output() taskChanged = new EventEmitter<Task>();
    @Output() editRequested = new EventEmitter<void>();
  
    project: Project | null = null;
    issue: Issue | null = null;
    task: Task | null = null;
  
    tags: Tag[] = [];
    availableTagIds = new Set<string>();
  
    currentUid: string | null = null;
    currentRole: Role | null = null;
    currentUserProfile: UserDirectoryProfile | null = null;
    projectMemberProfiles: Record<string, UserDirectoryProfile> = {};
    mentionableMembers: UserDirectoryProfile[] = [];
  
    newChecklistText = '';
  
    attachments: TaskAttachmentView[] = [];
    attachmentsLoading = false;
    attachmentsError = '';
    attachmentUploadError = '';
    attachmentUploadMessage = '';
    attachmentUploading = false;
    attachmentDeletingId: string | null = null;
    attachmentLimitReached = false;
    readonly attachmentLimit = 20;
  
    comments: TaskCommentView[] = [];
    commentsLoading = false;
    commentSubmitting = false;
    commentError = '';
    commentLimitReached = false;
    commentForm = {
      text: '',
      mentions: [] as string[],
    };
    mentionSelectorOpen = false;
    readonly mentionSelectorPanelId = 'task-detail-mention-selector';
  
    private readonly importanceDisplay: Record<Importance, { label: string; weight: number }> = {
      Critical: { label: '至急重要', weight: 4 },
      High: { label: '至急', weight: 3 },
      Medium: { label: '重要', weight: 2 },
      Low: { label: '普通', weight: 1 },
    };
  
    ngOnChanges(changes: SimpleChanges): void {
      if (!this.visible) {
        return;
      }
      if (changes['projectId'] || changes['issueId'] || changes['taskId'] || changes['visible']) {
        void this.loadDetails();
      }
    }
  
    close(): void {
      this.closed.emit();
    }
  
    requestEdit(): void {
      this.editRequested.emit();
    }
  
    getIssueThemeColor(): string {
      const fallbackKey = this.issue?.id ?? this.issueId ?? null;
      return resolveIssueThemeColor(this.issue?.themeColor ?? null, fallbackKey);
    }
  
    getImportanceLabel(importance?: Importance | null): string {
      return this.importanceDisplay[importance ?? 'Low'].label;
    }
  
    getImportanceClass(importance?: Importance | null): string {
      return `importance-${(importance ?? 'Low').toLowerCase()}`;
    }
  
    getStatusLabel(status: Task['status']): string {
      switch (status) {
        case 'completed':
          return '完了';
        case 'in_progress':
          return '進行中';
        case 'on_hold':
          return '保留';
        case 'discarded':
          return '破棄';
        case 'incomplete':
        default:
          return '未完了';
      }
    }
  
    getTaskProgress(task: Task | null): number {
      if (!task) {
        return 0;
      }
      if (typeof task.progress === 'number') {
        return task.progress;
      }
      return this.tasksService.calculateProgressFromChecklist(task.checklist ?? [], task.status);
    }
  
    getVisibleTagIds(task: Task | null): string[] {
      if (!task) {
        return [];
      }
      return (task.tagIds ?? []).filter((id): id is string => Boolean(id) && this.availableTagIds.has(id));
    }
  
    getTagName(tagId: string): string {
      return this.tags.find((tag) => tag.id === tagId)?.name ?? tagId;
    }
  
    getTagColor(tagId: string): string {
      return this.tags.find((tag) => tag.id === tagId)?.color ?? '#ccc';
    }
  
    getAssigneePhotoUrl(assigneeId: string): string | null {
      return this.projectMemberProfiles[assigneeId]?.photoURL ?? null;
    }
  
    getAssigneeDisplayName(assigneeId: string): string {
      return this.projectMemberProfiles[assigneeId]?.username ?? '不明なメンバー';
    }
  
    getAssigneeInitial(assigneeId: string): string {
      const name = this.projectMemberProfiles[assigneeId]?.username ?? assigneeId;
      return getAvatarInitial(name);
    }
  
    getMemberAvatarColor(uid: string | null | undefined): string {
      return getAvatarColor(uid ?? 'unknown');
    }
  
    getAttachmentInitial(attachment: TaskAttachmentView): string {
      return getAvatarInitial(attachment.uploaderLabel ?? attachment.fileName ?? 'A');
    }
  
    getCommentAvatarColor(comment: TaskCommentView): string {
      return getAvatarColor(comment.createdBy ?? comment.id ?? 'unknown');
    }
  
    getCommentInitial(comment: TaskCommentView): string {
      return getAvatarInitial(comment.authorUsername ?? comment.createdBy ?? 'U');
    }
  
    getMentionLabel(uid: string): string {
      return this.projectMemberProfiles[uid]?.username ?? uid;
    }
  
    getMemberInitial(member: UserDirectoryProfile): string {
      return getAvatarInitial(member.username ?? member.uid ?? 'U');
    }
  
    canEditTask(task: Task | null): boolean {
      if (!this.allowEditing || !task || !this.currentUid) {
        return false;
      }
      if (this.isAdmin()) {
        return true;
      }
      if (this.currentRole === 'member') {
        return task.createdBy === this.currentUid || (task.assigneeIds ?? []).includes(this.currentUid);
      }
      return false;
    }
  
    canUploadAttachment(task: Task | null): boolean {
      return this.canEditTask(task) && !this.attachmentLimitReached && !this.attachmentUploading;
    }
  
    canDeleteAttachment(attachment: TaskAttachmentView): boolean {
      if (!this.currentUid) {
        return false;
      }
      if (this.isAdmin()) {
        return true;
      }
      return this.currentRole === 'member' && attachment.uploadedBy === this.currentUid;
    }
  
    canPostComment(): boolean {
      return this.currentRole === 'admin' || this.currentRole === 'member';
    }
  
    canSubmitComment(): boolean {
      const trimmed = this.commentForm.text.trim();
      return (
        this.canPostComment() &&
        trimmed.length > 0 &&
        trimmed.length <= 5000 &&
        !this.commentSubmitting &&
        !this.commentLimitReached
      );
    }
  
    isMentionSelected(uid: string): boolean {
      return this.commentForm.mentions.includes(uid);
    }
  
    toggleMention(member: UserDirectoryProfile): void {
      if (this.commentLimitReached) {
        return;
      }

      const uid = member.uid;
      if (!uid) {
        return;
      }

      if (this.commentForm.mentions.includes(uid)) {
        this.commentForm.mentions = this.commentForm.mentions.filter((id) => id !== uid);
        // テキストからもメンションを削除
        const mentionToken = `@${member.username}`;
        this.commentForm.text = this.commentForm.text
          .replace(new RegExp(`\\s*${mentionToken}\\s*`, 'g'), ' ')
          .trim();
        return;
      }

      const mentionToken = `@${member.username}`;
      const trimmed = this.commentForm.text.trimEnd();
      const appended = trimmed.length > 0 ? `${trimmed} ${mentionToken} ` : `${mentionToken} `;

      if (appended.length > 5000) {
        this.commentError = 'メンションを追加すると文字数上限を超えます。';
        return;
      }

      this.commentForm.mentions = [...this.commentForm.mentions, uid];
      this.commentForm.text = appended;
      this.commentError = '';
    }

    toggleMentionSelector(): void {
      if (this.mentionableMembers.length === 0) {
        this.mentionSelectorOpen = false;
        return;
      }

      this.mentionSelectorOpen = !this.mentionSelectorOpen;
    }
  
    async toggleChecklistItem(itemId: string, completed: boolean): Promise<void> {
      if (!this.task || !this.canEditTask(this.task)) {
        return;
      }
      const nextChecklist = (this.task.checklist ?? []).map((item) =>
        item.id === itemId ? { ...item, completed } : item,
      );
      await this.persistChecklist(nextChecklist);
    }
  
    async addChecklistItem(): Promise<void> {
      if (!this.task || !this.canEditTask(this.task)) {
        return;
      }
      const text = this.newChecklistText.trim();
      if (!text) {
        return;
      }
      const nextChecklist: ChecklistItem[] = [
        ...(this.task.checklist ?? []),
        { id: this.generateChecklistId(), text, completed: false },
      ];
      this.newChecklistText = '';
      await this.persistChecklist(nextChecklist);
    }
  
    async removeChecklistItem(itemId: string): Promise<void> {
      if (!this.task || !this.canEditTask(this.task)) {
        return;
      }
      const nextChecklist = (this.task.checklist ?? []).filter((item) => item.id !== itemId);
      await this.persistChecklist(nextChecklist);
    }
  
    async toggleArchive(task: Task): Promise<void> {
      if (!this.canEditTask(task) || !this.projectId || !this.issueId || !task.id) {
        return;
      }
      try {
        await this.tasksService.updateTask(this.projectId, this.issueId, task.id, {
          archived: !task.archived,
        });
        await this.refreshTask();
      } catch (error) {
        console.error('タスクのアーカイブ切り替えに失敗しました:', error);
      }
    }
  
    async onAttachmentSelected(event: Event): Promise<void> {
      if (!this.task || !this.projectId || !this.issueId || !this.task.id) {
        return;
      }
      if (!this.canUploadAttachment(this.task)) {
        return;
      }
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input || !input.files || input.files.length === 0) {
        return;
      }
      const files = Array.from(input.files).filter((file) => file.size > 0);
      if (files.length === 0) {
        input.value = '';
        return;
      }
      this.attachmentUploadError = '';
      this.attachmentUploadMessage = '';
      this.attachmentUploading = true;
      try {
        for (const file of files) {
          await this.tasksService.uploadAttachment(this.projectId, this.issueId, this.task.id, file, {
            taskTitle: this.task.title,
            projectName: this.project?.name ?? null,
            issueName: this.issue?.name ?? null,
          });
        }
        this.attachmentUploadMessage = '添付ファイルを追加しました。';
        await this.loadAttachments();
        await this.refreshTask();
      } catch (error) {
        console.error('添付ファイルの追加に失敗しました:', error);
        this.attachmentUploadError = '添付ファイルの追加に失敗しました。時間を置いて再試行してください。';
      } finally {
        this.attachmentUploading = false;
        if (input) {
          input.value = '';
        }
        this.cdr.markForCheck();
      }
    }
  
    trackAttachmentById(_: number, attachment: TaskAttachmentView): string {
      return attachment.id ?? `${attachment.fileUrl}-${attachment.fileName}`;
    }
  
    formatFileSize(bytes: number | null | undefined): string {
      if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) {
        return '0 B';
      }
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let size = bytes;
      let index = 0;
      while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
      }
      const formatted = index === 0 ? Math.round(size).toString() : size.toFixed(size >= 10 ? 0 : 1);
      return `${formatted} ${units[index]}`;
    }
  
    async deleteAttachment(attachment: TaskAttachmentView): Promise<void> {
      if (!this.task || !this.projectId || !this.issueId || !this.task.id || !attachment.id) {
        return;
      }
      if (!this.canDeleteAttachment(attachment)) {
        return;
      }
      this.attachmentDeletingId = attachment.id;
      this.attachmentUploadError = '';
      try {
        await this.tasksService.deleteAttachment(this.projectId, this.issueId, this.task.id, attachment.id);
        await this.loadAttachments();
        await this.refreshTask();
      } catch (error) {
        console.error('添付ファイルの削除に失敗しました:', error);
        this.attachmentUploadError = '添付ファイルの削除に失敗しました。';
      } finally {
        this.attachmentDeletingId = null;
        this.cdr.markForCheck();
      }
    }
  
    async submitComment(): Promise<void> {
      if (!this.task || !this.projectId || !this.issueId || !this.task.id || !this.canSubmitComment()) {
        return;
      }
      this.commentSubmitting = true;
      this.commentError = '';
      try {
        const created = await this.tasksService.addComment(
          this.projectId,
          this.issueId,
          this.task.id,
          {
            text: this.commentForm.text,
            mentions: this.commentForm.mentions,
            authorUsername: this.currentUserProfile?.username ?? this.currentUid ?? null,
            authorPhotoUrl: this.currentUserProfile?.photoURL ?? null,
          },
        );
        const view = this.composeCommentView(created);
        this.comments = [...this.comments, view].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        this.commentForm = { text: '', mentions: [] };
        this.mentionSelectorOpen = false;
        this.updateCommentLimitState();
        await this.refreshTask();
      } catch (error) {
        console.error('コメントの投稿に失敗しました:', error);
        this.commentError = error instanceof Error ? error.message : 'コメントの投稿に失敗しました。';
      } finally {
        this.commentSubmitting = false;
        this.cdr.markForCheck();
      }
    }
  
    private async loadDetails(): Promise<void> {
      if (!this.projectId || !this.issueId || !this.taskId) {
        return;
      }
      try {
        const [task, issue, project, tags, uid] = await Promise.all([
          this.tasksService.getTask(this.projectId, this.issueId, this.taskId),
          this.issuesService.getIssue(this.projectId, this.issueId),
          (this.projectsService as unknown as { getProject(id: string): Promise<Project | null> }).getProject(this.projectId),
          this.tagsService.listTags(),
          (this.projectsService as unknown as { getSignedInUid(): Promise<string> }).getSignedInUid(),
        ]);
  
        this.task = this.normalizeTask(task);
        this.issue = issue ?? null;
        this.project = project ?? null;
        this.tags = tags;
        this.availableTagIds = new Set(tags.map((tag) => tag.id!).filter((id): id is string => Boolean(id)));
        this.currentUid = uid ?? null;
        this.currentRole = project?.roles?.[uid] ?? null;
  
        await this.loadProjectMembers(project?.memberIds ?? [], uid ?? null);
        await this.loadAttachments();
        await this.loadComments();
        this.updateAttachmentLimitState();
        this.updateCommentLimitState();
      } catch (error) {
        console.error('タスク詳細の読み込みに失敗しました:', error);
      } finally {
        this.cdr.markForCheck();
      }
    }
  
    private normalizeTask(task: Task | null): Task | null {
      if (!task) {
        return null;
      }
      return {
        ...task,
        checklist: Array.isArray(task.checklist) ? task.checklist : [],
        tagIds: Array.isArray(task.tagIds) ? task.tagIds : [],
        assigneeIds: Array.isArray(task.assigneeIds) ? task.assigneeIds : [],
      };
    }
  
    private async loadProjectMembers(memberIds: string[], currentUid: string | null): Promise<void> {
      let authUserFallback: import('@angular/fire/auth').User | null = null;
      try {
        await this.auth.authStateReady();
        authUserFallback = this.auth.currentUser;
      } catch (error) {
        console.warn('Firebase Auth の初期化に失敗しました:', error);
      }
  
      const normalizeUsername = (value: string | null | undefined): string | null => {
        if (typeof value !== 'string') {
          return null;
        }
        const normalized = value.trim().toLowerCase();
        return /^[a-z0-9_]{3,10}$/.test(normalized) ? normalized : null;
      };
  
      const fallbackProfile = (uid: string): UserDirectoryProfile => {
        const authUser = authUserFallback && authUserFallback.uid === uid ? authUserFallback : null;
        const usernameFromAuth = normalizeUsername(authUser?.displayName)
          ?? normalizeUsername(authUser?.email?.split('@')[0] ?? null)
          ?? uid;
        const photoUrl = typeof authUser?.photoURL === 'string' && authUser.photoURL.trim().length > 0 ? authUser.photoURL : null;
        return { uid, username: usernameFromAuth, photoURL: photoUrl };
      };
  
      if (!memberIds || memberIds.length === 0) {
        this.projectMemberProfiles = {};
        this.mentionableMembers = [];
        this.mentionSelectorOpen = false;
        this.currentUserProfile = currentUid ? fallbackProfile(currentUid) : null;
        return;
      }
  
      try {
        const profiles = await this.userDirectoryService.getProfiles(memberIds);
        const profileMap: Record<string, UserDirectoryProfile> = {};
        for (const profile of profiles) {
          profileMap[profile.uid] = profile;
        }
        this.projectMemberProfiles = profileMap;
        this.mentionableMembers = profiles.filter((profile) => profile.uid !== currentUid);
        if (this.mentionableMembers.length === 0) {
          this.mentionSelectorOpen = false;
        }
        if (currentUid) {
          const directoryProfile = profileMap[currentUid];
          const fallback = fallbackProfile(currentUid);
          this.currentUserProfile = {
            uid: currentUid,
            username: directoryProfile?.username ?? fallback.username,
            photoURL: directoryProfile?.photoURL ?? fallback.photoURL,
          };
        } else {
          this.currentUserProfile = null;
        }
      } catch (error) {
        console.error('メンバー情報の取得に失敗しました:', error);
        this.projectMemberProfiles = {};
        this.mentionableMembers = [];
        this.mentionSelectorOpen = false;
        this.currentUserProfile = currentUid ? fallbackProfile(currentUid) : null;
      }
    }
  
    private async loadAttachments(): Promise<void> {
      if (!this.projectId || !this.issueId || !this.taskId) {
        return;
      }
      this.attachmentsLoading = true;
      this.attachmentsError = '';
      try {
        const attachments = await this.tasksService.listAttachments(this.projectId, this.issueId, this.taskId);
        this.attachments = attachments
          .map((attachment) => this.composeAttachmentView(attachment))
          .sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0));
        this.updateAttachmentLimitState();
      } catch (error) {
        console.error('添付ファイルの読み込みに失敗しました:', error);
        this.attachmentsError = error instanceof Error ? error.message : '添付ファイルを取得できませんでした。';
        this.attachments = [];
        this.updateAttachmentLimitState();
      } finally {
        this.attachmentsLoading = false;
      }
    }
  
    private composeAttachmentView(attachment: Attachment): TaskAttachmentView {
      const profile = attachment.uploadedBy ? this.projectMemberProfiles[attachment.uploadedBy] : undefined;
      const isCurrentUser = this.currentUid !== null && attachment.uploadedBy === this.currentUid;
      const fallback = isCurrentUser ? this.currentUserProfile : undefined;
      const uploaderLabel = profile?.username ?? fallback?.username ?? attachment.uploadedBy ?? '不明なユーザー';
      const uploaderPhotoUrl = profile?.photoURL ?? fallback?.photoURL ?? null;
  
      return {
        ...attachment,
        uploaderLabel,
        uploaderPhotoUrl,
      };
    }
  
    private async loadComments(): Promise<void> {
      if (!this.projectId || !this.issueId || !this.taskId) {
        return;
      }
      this.commentsLoading = true;
      this.commentError = '';
      try {
        const comments = await this.tasksService.listComments(this.projectId, this.issueId, this.taskId);
        this.comments = comments
          .map((comment) => this.composeCommentView(comment))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        this.updateCommentLimitState();
      } catch (error) {
        console.error('コメントの取得に失敗しました:', error);
        this.commentError = error instanceof Error ? error.message : 'コメントを取得できませんでした。';
        this.comments = [];
        this.updateCommentLimitState();
      } finally {
        this.commentsLoading = false;
      }
    }
  
    private composeCommentView(comment: Comment): TaskCommentView {
      const profile = comment.createdBy ? this.projectMemberProfiles[comment.createdBy] : undefined;
      const isCurrentUser = this.currentUid !== null && comment.createdBy === this.currentUid;
      const fallback = isCurrentUser ? this.currentUserProfile : undefined;
      const authorUsername = (comment.authorUsername && comment.authorUsername.trim().length > 0)
        ? comment.authorUsername
        : profile?.username ?? fallback?.username ?? comment.createdBy ?? '不明なユーザー';
      const authorPhotoUrl = comment.authorPhotoUrl ?? profile?.photoURL ?? fallback?.photoURL ?? null;
      return {
        ...comment,
        authorUsername,
        authorPhotoUrl,
        mentions: Array.isArray(comment.mentions) ? comment.mentions : [],
      };
    }
  
    private async persistChecklist(checklist: ChecklistItem[]): Promise<void> {
      if (!this.task || !this.projectId || !this.issueId || !this.task.id) {
        return;
      }
      if (!this.canEditTask(this.task)) {
        return;
      }

      try {
        // チェックリストからステータスを決定
        let status = this.task.status;
        if (checklist.length > 0) {
          const allCompleted = checklist.every((item) => item.completed);
          const someCompleted = checklist.some((item) => item.completed);
          if (allCompleted) {
            status = 'completed';
          } else if (someCompleted && status !== 'on_hold' && status !== 'discarded') {
            status = 'in_progress';
          } else if (!someCompleted && status !== 'on_hold' && status !== 'discarded') {
            status = 'incomplete';
          }
        }
        const progress = this.tasksService.calculateProgressFromChecklist(checklist, status);
        await this.tasksService.updateTask(this.projectId, this.issueId, this.task.id, {
          checklist,
          status,
          progress,
        });
        await this.refreshTask();
      } catch (error) {
        console.error('チェックリストの更新に失敗しました:', error);
      } finally {
        this.cdr.markForCheck();
      }
    }
  
    private async refreshTask(): Promise<void> {
      if (!this.projectId || !this.issueId || !this.taskId) {
        return;
      }
      try {
        const refreshed = await this.tasksService.getTask(this.projectId, this.issueId, this.taskId);
        this.task = this.normalizeTask(refreshed);
        if (this.task) {
          this.taskChanged.emit(this.task);
        }
      } catch (error) {
        console.error('タスクの再取得に失敗しました:', error);
      }
    }
  
    private updateAttachmentLimitState(): void {
      this.attachmentLimitReached = this.attachments.length >= this.attachmentLimit;
    }
  
    private updateCommentLimitState(): void {
      this.commentLimitReached = this.comments.length >= 500;
    }
  
    private generateChecklistId(): string {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return `chk_${Math.random().toString(36).slice(2, 10)}`;
    }
  
    private isAdmin(): boolean {
      return this.currentRole === 'admin';
    }
  }
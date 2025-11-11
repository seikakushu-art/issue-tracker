import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router'; // routerLink 用のディレクティブを読み込む
import { Subject, takeUntil } from 'rxjs';
import { TasksService } from '../tasks/tasks.service';
import { TagsService } from '../tags/tags.service';
import { IssuesService } from '../issues/issues.service';
import { Task, TaskStatus, Importance, Tag, Issue, ChecklistItem, Role, Project, Comment, Attachment } from '../../models/schema';
import { ProjectsService } from '../projects/projects.service';
import { UserDirectoryService, UserDirectoryProfile } from '../../core/user-directory.service';
import { getAvatarColor, getAvatarInitial } from '../../shared/avatar-utils';
import { Auth,User } from '@angular/fire/auth';
import { ProjectSidebarComponent } from '../../shared/project-sidebar/project-sidebar.component';
import { SmartFilterPanelComponent } from '../../shared/smart-filter/smart-filter-panel.component';
import {
  SmartFilterCriteria,
  SmartFilterTagOption,
  SmartFilterAssigneeOption,
  SMART_FILTER_STATUS_OPTIONS,
  SMART_FILTER_IMPORTANCE_OPTIONS,
  createEmptySmartFilterCriteria,
  matchesSmartFilterTask,
  isSmartFilterEmpty,
} from '../../shared/smart-filter/smart-filter.model';
import { resolveIssueThemeColor } from '../../shared/issue-theme';
import { FirebaseError } from '@angular/fire/app';

interface TaskCommentView extends Comment {
  authorUsername: string;
  authorPhotoUrl: string | null;
}

interface TaskAttachmentView extends Attachment {
  uploaderLabel: string;
  uploaderPhotoUrl: string | null;
}
/**
 * タスク一覧コンポーネント
 * 課題配下のタスク一覧表示、作成、編集、削除機能を提供
 */
@Component({
  selector: 'app-tasks-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ProjectSidebarComponent,
    SmartFilterPanelComponent,
    RouterLink, // 検索ボタンから検索画面へ遷移するために追加
  ],
  templateUrl: './tasks-list.component.html',
  styleUrls: ['./tasks-list.component.scss']
})
export class TasksListComponent implements OnInit, OnDestroy {
  private tasksService = inject(TasksService);
  private tagsService = inject(TagsService);
  private issuesService = inject(IssuesService);
  private projectsService = inject(ProjectsService);
  private userDirectoryService = inject(UserDirectoryService);
  private auth = inject(Auth);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  projectId!: string;
  issueId!: string;

  projectDetails: Project | null = null;
  issueDetails: Issue | null = null;
  issueProgress = 0;
  taskPreview: Task[] = [];
  tasks: Task[] = [];
  filteredTasks: Task[] = [];
  availableTags: Tag[] = [];
  showModal = false;
  editingTask: Task | null = null;
  saving = false;
  newTagName = ''; // カスタムタグ名の入力値
  newTagColor = '#4c6ef5'; // カスタムタグ用の既定カラー
  creatingTag = false; // タグ作成処理の二重実行防止
  showArchived = false;
  selectedTaskId: string | null = null;
  selectedTask: Task | null = null;
  pendingFocusTaskId: string | null = null;
  newChecklistText = '';
  currentRole: Role | null = null;
  currentUid: string | null = null;
  currentUserProfile: UserDirectoryProfile | null = null;
  projectMemberProfiles: Record<string, UserDirectoryProfile> = {};
  mentionableMembers: UserDirectoryProfile[] = [];
  mentionSelectorOpen = false;
  readonly mentionSelectorPanelId = 'task-list-mention-selector';
  /**
   * 担当者欄でのフィードバック表示用ステート。
   * 参加処理時に逐一リセット・設定するため個別に保持しておく。
   */
  assigneeActionMessage = '';
  assigneeActionMessageType: 'success' | 'error' | 'info' = 'info';
  assigneeActionInProgress = false;
  assigneeActionInProgressLabel: 'join' | 'leave' | null = null;

  // フィルター設定
  statusFilter: TaskStatus | '' = '';
  importanceFilter: Importance | '' = '';

   // スマートフィルター関連
   smartFilterVisible = false;
   smartFilterCriteria: SmartFilterCriteria = createEmptySmartFilterCriteria();
   smartFilterTagOptions: SmartFilterTagOption[] = [];
   smartFilterAssigneeOptions: SmartFilterAssigneeOption[] = [];
   readonly smartFilterStatusOptions = SMART_FILTER_STATUS_OPTIONS;
   readonly smartFilterImportanceOptions = SMART_FILTER_IMPORTANCE_OPTIONS;
   readonly smartFilterScope = 'tasks';

  // 並び替え設定
  sortBy: 'title' | 'startDate' | 'endDate' | 'progress' | 'importance' | 'createdAt' | 'period' = 'title';
  sortOrder: 'asc' | 'desc' = 'asc';

  /** localStorage用のキー */
  private readonly SORT_BY_KEY = 'tasks-sort-by';
  private readonly SORT_ORDER_KEY = 'tasks-sort-order';

  // フォームデータ
  taskForm = {
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    goal: '',
    importance: 'Low' as Importance,
    status: 'incomplete' as TaskStatus,
    tagIds: [] as string[],
    checklist: [] as ChecklistItem[]
  };
  comments: TaskCommentView[] = [];
  commentsLoading = false;
  commentSubmitting = false;
  commentError = '';
  commentForm = {
    text: '',
    mentions: [] as string[],
  };
  commentLimitReached = false;

  /** ステータス変更メニューで使用する選択肢 */
  readonly taskStatusMenuOptions: { value: TaskStatus; label: string }[] = [
    { value: 'incomplete', label: '未完了' },
    { value: 'in_progress', label: '進行中' },
    { value: 'on_hold', label: '保留' },
    { value: 'completed', label: '完了' },
    { value: 'discarded', label: '破棄' },
  ];

  /** どのタスクのステータスメニューを開いているか識別する */
  statusMenuTaskId: string | null = null;

  attachments: TaskAttachmentView[] = [];
  attachmentsLoading = false;
  attachmentsError = '';
  attachmentUploadError = '';
  attachmentUploadMessage = '';
  attachmentUploading = false;
  attachmentDeletingId: string | null = null;
  attachmentLimitReached = false;

  private tagsLoaded = false;
  private availableTagIdSet = new Set<string>();

  /**
   * チェックリスト完了時に表示する確認メッセージ。
   * UI からもサービス層からも参照しやすいように定数化しておく。
   */
  private readonly checklistCompletionConfirmMessage = 'チェックリストがすべてクリアしました。タスクを完了しますか？';

  // 重要度表示用
  private importanceDisplay: Record<Importance, { label: string; weight: number }> = {
    Critical: { label: '至急重要', weight: 4 },
    High: { label: '至急', weight: 3 },
    Medium: { label: '重要', weight: 2 },
    Low: { label: '普通', weight: 1 }
  };

  readonly attachmentLimit = 20;

  ngOnInit() {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.projectId = params['projectId'];
      this.issueId = params['issueId'];
      void this.loadData();
    });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const focus = params.get('focus');
      this.pendingFocusTaskId = focus;
      if (focus) {
        this.trySelectTaskById(focus);
      }
    });
    this.loadSortPreferences();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goToIssuesList(): void {
    if (!this.projectId) {
      return;
    }

    void this.router.navigate(['/projects', this.projectId]);
  }

  /** データ読み込み */
  private async loadData() {
    if (!this.projectId || !this.issueId) return;
    await this.loadTags(); // タグ情報を先に同期しておく
    this.statusMenuTaskId = null; // 再読み込み時はメニュー状態をリセット

    try {
      const projectPromise = (this.projectsService as unknown as { getProject: (id: string) => Promise<Project | null> }).getProject(this.projectId);
      const uidPromise = (this.projectsService as unknown as { getSignedInUid: () => Promise<string> }).getSignedInUid();
      const [tasks, issue, project, uid] = await Promise.all([
        this.tasksService.listTasks(this.projectId, this.issueId),
        this.issuesService.getIssue(this.projectId, this.issueId),
        projectPromise,
        uidPromise,
      ]);

      await this.loadProjectMembers(project?.memberIds ?? [], uid);

      this.issueDetails = issue;
      this.projectDetails = project;
      this.tasks = tasks;
      this.currentUid = uid;
      this.currentRole = project?.roles?.[uid] ?? null;
      this.sanitizeAllTagSelections();
      this.filterTasks();
      this.updateIssueProgress();
      if (this.pendingFocusTaskId) {
        this.trySelectTaskById(this.pendingFocusTaskId);
      }
      if (this.selectedTaskId) {
        const refreshed = tasks.find(task => task.id === this.selectedTaskId);
        if (refreshed && refreshed.id) {
          this.selectedTask = refreshed;
          this.resetCommentState();
          this.resetAttachmentState();
          void this.loadTaskComments(refreshed.id);
          void this.loadTaskAttachments(refreshed.id);
        } else {
          this.closeDetailPanel();
        }
      }
    } catch (error) {
      console.error('データの読み込みに失敗しました:', error);
    }
  }

  /** タグ一覧読み込み */
  private async loadTags() {
    if (!this.projectId) {
      return; // プロジェクト未確定時は何もしない
    }
    try {
      this.availableTags = await this.tagsService.listTags(this.projectId);
      this.tagsLoaded = true;
      this.updateAvailableTagIndex();
      this.sanitizeAllTagSelections();
      this.newTagColor = this.generateRandomUniqueTagColor(); // 既存タグと被らない初期カラーを再計算
      this.refreshSmartFilterTags();
    } catch (error) {
      console.error('タグの読み込みに失敗しました:', error);
    }
  }

  isAdmin(): boolean {
    return this.currentRole === 'admin';
  }

  canCreateTask(): boolean {
    return this.currentRole === 'admin' || this.currentRole === 'member';
  }

  canPostComment(): boolean {
    return this.currentRole === 'admin' || this.currentRole === 'member';
  }

  canUploadAttachment(task: Task | null): boolean {
    return this.canEditTask(task);
  }

  canDeleteAttachment(attachment: TaskAttachmentView): boolean {
    if (this.isAdmin()) {
      return true;
    }
    return this.currentRole === 'member' && this.currentUid === attachment.uploadedBy;
  }

  canEditTask(task: Task | null): boolean {
    if (!task || !this.currentUid) {
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

  canDeleteTask(task: Task): boolean {
    if (this.isAdmin()) {
      return true;
    }
    return this.currentRole === 'member' && this.currentUid === task.createdBy;
  }

   /** 参加ボタンを押下できるロールかどうか（admin / member のみ） */
   canAttemptJoinTask(): boolean {
    return this.currentRole === 'admin' || this.currentRole === 'member';
  }

   /** 選択中のタスクに参加・退出ボタン群を表示するか */
   shouldShowAssigneeActions(): boolean {
    return this.selectedTask !== null;
  }

  /** 選択中のタスクに参加ボタンを表示するか判定 */
  shouldShowJoinButton(): boolean {
    return this.canAttemptJoinTask() && this.selectedTask !== null;
  }

  /** 選択中のタスクに退出ボタンを表示するか判定 */
  shouldShowLeaveButton(): boolean {
    return this.canAttemptJoinTask() && this.selectedTask !== null && this.isCurrentUserAssignee();
  }

  /** 現在のユーザーが選択中タスクの担当者かを判定 */
  private isCurrentUserAssignee(): boolean {
    if (!this.selectedTask || !this.currentUid) {
      return false;
    }
    return this.selectedTask.assigneeIds.includes(this.currentUid);
  }

  /** フィードバックメッセージを初期化する小さなヘルパー */
  private resetAssigneeActionFeedback(): void {
    this.assigneeActionMessage = '';
    this.assigneeActionMessageType = 'info';
    this.assigneeActionInProgress = false;
  }

  /** メッセージと種別をまとめて更新するヘルパー */
  private setAssigneeActionFeedback(message: string, type: 'success' | 'error' | 'info'): void {
    this.assigneeActionMessage = message;
    this.assigneeActionMessageType = type;
  }

  /** 種別に応じたアイコン用クラス名を返却 */
  getAssigneeActionIcon(): string {
    switch (this.assigneeActionMessageType) {
      case 'success':
        return 'icon-success';
      case 'error':
        return 'icon-error';
      default:
        return 'icon-info';
    }
  }

  /** 選択中タスクへの参加処理本体 */
  async joinSelectedTask(): Promise<void> {
    if (!this.selectedTask || !this.projectId || !this.issueId || !this.selectedTask.id) {
      this.setAssigneeActionFeedback('タスク情報を取得できませんでした。', 'error');
      return;
    }

    if (!this.canAttemptJoinTask()) {
      this.setAssigneeActionFeedback('ゲストは参加できません。', 'error');
      return;
    }

    if (!this.currentUid) {
      this.setAssigneeActionFeedback('サインイン情報を確認できませんでした。', 'error');
      return;
    }

    if (this.selectedTask.assigneeIds.includes(this.currentUid)) {
      this.setAssigneeActionFeedback('すでに参加しています。', 'info');
      return;
    }

    if (this.selectedTask.assigneeIds.length >= 10) {
      this.setAssigneeActionFeedback('参加人数の上限を超えています。', 'error');
      return;
    }

    this.assigneeActionInProgress = true;
    this.assigneeActionInProgressLabel = 'join';
    this.setAssigneeActionFeedback('', 'info');

    try {
      const updatedAssignees = await this.tasksService.joinTask(this.projectId, this.issueId, this.selectedTask.id);
      this.setAssigneeActionFeedback('タスクに参加しました。', 'success');

      // 選択中タスクと一覧の両方を最新の担当者リストで更新
      this.selectedTask = { ...this.selectedTask, assigneeIds: updatedAssignees };
      this.tasks = this.tasks.map(task =>
        task.id === this.selectedTaskId ? { ...task, assigneeIds: updatedAssignees } : task
      );
      this.filterTasks(); // フィルター済みリストにも即時反映
    } catch (error) {
      const message = error instanceof Error ? error.message : '参加処理に失敗しました。';
      const normalized = message === '参加人数の上限を超えています'
        ? message
        : message === 'この操作を行う権限がありません'
          ? '参加する権限がありません。'
          : message;
      this.setAssigneeActionFeedback(normalized, 'error');
    } finally {
      this.assigneeActionInProgress = false;
      this.assigneeActionInProgressLabel = null;
    }
  }

  /** 選択中タスクからの退出処理本体 */
  async leaveSelectedTask(): Promise<void> {
    if (!this.selectedTask || !this.projectId || !this.issueId || !this.selectedTask.id) {
      this.setAssigneeActionFeedback('タスク情報を取得できませんでした。', 'error');
      return;
    }

    if (!this.currentUid) {
      this.setAssigneeActionFeedback('サインイン情報を確認できませんでした。', 'error');
      return;
    }

    if (!this.canAttemptJoinTask() || !this.isCurrentUserAssignee()) {
      this.setAssigneeActionFeedback('まだ参加していません', 'info');
      return;
    }

    this.assigneeActionInProgress = true;
    this.assigneeActionInProgressLabel = 'leave';
    this.setAssigneeActionFeedback('', 'info');

    try {
      const updatedAssignees = await this.tasksService.leaveTask(this.projectId, this.issueId, this.selectedTask.id);
      this.setAssigneeActionFeedback('タスクから退出しました。', 'success');

      this.selectedTask = { ...this.selectedTask, assigneeIds: updatedAssignees };
      this.tasks = this.tasks.map(task =>
        task.id === this.selectedTaskId ? { ...task, assigneeIds: updatedAssignees } : task
      );
      this.filterTasks();
    } catch (error) {
      const message = error instanceof Error ? error.message : '退出処理に失敗しました。';
      const normalized = message === 'この操作を行う権限がありません'
        ? '退出する権限がありません。'
        : message;
      this.setAssigneeActionFeedback(normalized, 'error');
    } finally {
      this.assigneeActionInProgress = false;
      this.assigneeActionInProgressLabel = null;
    }
  }

  /** フィルタリング */
  filterTasks() {
    let filtered = [...this.tasks];

    // アーカイブフィルター
    if (!this.showArchived) {
      filtered = filtered.filter(task => !task.archived);
    }

    // 既存のステータス・重要度フィルター
    if (this.statusFilter) {
      filtered = filtered.filter(task => task.status === this.statusFilter);
    }
    if (this.importanceFilter) {
      filtered = filtered.filter(task => task.importance === this.importanceFilter);
    }

    // スマートフィルター（複合条件）
    if (!isSmartFilterEmpty(this.smartFilterCriteria)) {
      filtered = filtered.filter(task => matchesSmartFilterTask(task, this.smartFilterCriteria));
    }

    this.filteredTasks = filtered;
    this.sortTasks();
  }

  /** 並び替え */
  sortTasks() {
    this.saveSortPreferences();
    const sorted = [...this.filteredTasks].sort((a, b) => {
      // ピン止めされたタスクを先頭に表示
      const aPinned = this.isTaskPinned(a);
      const bPinned = this.isTaskPinned(b);
      if (aPinned && !bPinned) {
        return -1;
      }
      if (!aPinned && bPinned) {
        return 1;
      }

      let aValue: unknown;
      let bValue: unknown;

      switch (this.sortBy) {
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case 'startDate':
          aValue = this.normalizeDate(a.startDate)?.getTime() || 0;
          bValue = this.normalizeDate(b.startDate)?.getTime() || 0;
          break;
        case 'endDate':
          aValue = this.normalizeDate(a.endDate)?.getTime() || 0;
          bValue = this.normalizeDate(b.endDate)?.getTime() || 0;
          break;
        case 'progress':
          aValue = this.getTaskProgress(a);
          bValue = this.getTaskProgress(b);
          break;
        case 'importance':
          aValue = this.getImportanceWeight(a.importance);
          bValue = this.getImportanceWeight(b.importance);
          break;
        case 'createdAt':
          aValue = this.normalizeDate(a.createdAt)?.getTime() || 0;
          bValue = this.normalizeDate(b.createdAt)?.getTime() || 0;
          break;
        case 'period':
          aValue = this.getTaskDuration(a);
          bValue = this.getTaskDuration(b);
          break;
        default:
          return 0;
      }

      // 型を統一して比較
      const comparison = (aValue as string | number | Date) > (bValue as string | number | Date)
        ? 1
        : (aValue as string | number | Date) < (bValue as string | number | Date)
        ? -1
        : 0;

      return this.sortOrder === 'asc' ? comparison : -comparison;
    });

    this.filteredTasks = sorted;
  }

  /** 現在のユーザーがタスクをピン止めしているか */
  isTaskPinned(task: Task): boolean {
    if (!this.currentUid || !task.pinnedBy) {
      return false;
    }
    return task.pinnedBy.includes(this.currentUid);
  }

  /** タスクのピン止め状態を切り替える */
  async toggleTaskPin(task: Task, event: Event): Promise<void> {
    event.stopPropagation();
    if (!task.id) {
      return;
    }
    const currentlyPinned = this.isTaskPinned(task);
    try {
      await this.tasksService.togglePin(this.projectId, this.issueId, task.id, !currentlyPinned);
      await this.loadData();
    } catch (error) {
      console.error('タスクのピン止め切り替えに失敗しました:', error);
      alert('タスクのピン止め切り替えに失敗しました');
    }
  }

  /** チェックリスト完了時の確認ダイアログを表示 */
  private confirmChecklistCompletion(): boolean {
    // window が未定義な環境（テスト等）でも安全に動くようにガードを入れる
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(this.checklistCompletionConfirmMessage);
    }
    return true; // フォールバックでは完了扱いとして処理を継続する
  }

  /**
   * localStorageから並び替え設定を読み込む
   */
  private loadSortPreferences(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const savedSortBy = window.localStorage.getItem(this.SORT_BY_KEY);
      const savedSortOrder = window.localStorage.getItem(this.SORT_ORDER_KEY);
      
      if (savedSortBy && ['title', 'startDate', 'endDate', 'progress', 'importance', 'createdAt', 'period'].includes(savedSortBy)) {
        this.sortBy = savedSortBy as typeof this.sortBy;
      }
      if (savedSortOrder && ['asc', 'desc'].includes(savedSortOrder)) {
        this.sortOrder = savedSortOrder as typeof this.sortOrder;
      }
    } catch (error) {
      console.warn('並び替え設定の読み込みに失敗しました:', error);
    }
  }

  /**
   * 並び替え設定をlocalStorageに保存する
   */
  private saveSortPreferences(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(this.SORT_BY_KEY, this.sortBy);
      window.localStorage.setItem(this.SORT_ORDER_KEY, this.sortOrder);
    } catch (error) {
      console.warn('並び替え設定の保存に失敗しました:', error);
    }
  }

  /** スマートフィルターパネルの開閉 */
  toggleSmartFilterPanel(): void {
    this.smartFilterVisible = !this.smartFilterVisible;
  }

  /** スマートフィルター適用時のハンドラ */
  onSmartFilterApply(criteria: SmartFilterCriteria): void {
    this.smartFilterCriteria = criteria;
    this.smartFilterVisible = false;
    this.filterTasks();
  }

  /** タグ一覧からスマートフィルター用オプションを生成 */
  private refreshSmartFilterTags(): void {
    this.smartFilterTagOptions = this.availableTags
      .filter((tag): tag is Tag & { id: string } => Boolean(tag.id))
      .map((tag) => ({
        id: tag.id!,
        name: tag.name,
        color: tag.color ?? null,
      }));
  }

  /** 有効なタグID集合を再構築 */
  private updateAvailableTagIndex(): void {
    this.availableTagIdSet = new Set(
      this.availableTags
        .filter((tag): tag is Tag & { id: string } => Boolean(tag.id))
        .map((tag) => tag.id!),
    );
  }

  /** 利用可能タグが変わった際に、タスクやフォームのタグ選択を正規化 */
  private sanitizeAllTagSelections(): void {
    if (!this.tagsLoaded) {
      return;
    }

    const isValid = (id: string) => this.availableTagIdSet.has(id);

    const sanitizeTask = (task: Task | null): Task | null => {
      if (!task) {
        return task;
      }
      const current = task.tagIds ?? [];
      const filtered = current.filter(isValid);
      if (filtered.length !== current.length) {
        task.tagIds = filtered;
      }
      return task;
    };

    this.tasks.forEach(task => sanitizeTask(task));
    this.filteredTasks.forEach(task => sanitizeTask(task));

    if (this.selectedTask) {
      this.selectedTask = { ...this.selectedTask, tagIds: (this.selectedTask.tagIds ?? []).filter(isValid) };
    }

    if (this.editingTask) {
      this.editingTask = { ...this.editingTask, tagIds: (this.editingTask.tagIds ?? []).filter(isValid) };
    }

    this.taskForm.tagIds = this.taskForm.tagIds.filter(isValid);

    this.smartFilterCriteria = {
      ...this.smartFilterCriteria,
      tagIds: this.smartFilterCriteria.tagIds.filter(isValid),
    };

    this.filterTasks();
  }

  /** 表示可能なタグID一覧を取得（削除済みタグは除外） */
  getVisibleTagIds(task: Task | null | undefined): string[] {
    if (!task) {
      return [];
    }
    const base = task.tagIds ?? [];
    if (!this.tagsLoaded) {
      return base;
    }
    return base.filter((id) => this.availableTagIdSet.has(id));
  }


  /** メンバー一覧からスマートフィルター用担当者リストを整形 */
  private updateSmartFilterAssignees(): void {
    const options: SmartFilterAssigneeOption[] = Object.values(this.projectMemberProfiles ?? {})
      .filter((profile): profile is UserDirectoryProfile & { uid: string } => Boolean(profile?.uid))
      .map((profile) => ({
        id: profile.uid,
        displayName: profile.username && profile.username.trim().length > 0 ? profile.username : profile.uid,
        photoUrl: profile.photoURL ?? null,
      }));
    this.smartFilterAssigneeOptions = options;
  }

  /** 日付を正規化 */
  private toDate(date: Date | string | null | undefined): Date | null {
    if (!date) return null;
    if (date instanceof Date) return date;
    if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  /** 重要度の重みを取得 */
  private getImportanceWeight(importance?: Importance): number {
    return this.importanceDisplay[importance ?? 'Low'].weight;
  }

  private resetCommentState(): void {
    this.comments = [];
    this.commentsLoading = false;
    this.commentSubmitting = false;
    this.commentError = '';
    this.commentForm = {
      text: '',
      mentions: [],
    };
    this.commentLimitReached = false;
  }

  private resetAttachmentState(): void {
    this.attachments = [];
    this.attachmentsLoading = false;
    this.attachmentsError = '';
    this.attachmentUploadError = '';
    this.attachmentUploadMessage = '';
    this.attachmentUploading = false;
    this.attachmentDeletingId = null;
    this.attachmentLimitReached = false;
  }

  private async loadProjectMembers(memberIds: string[], currentUid: string | null): Promise<void> {
    let authUserForFallback: User | null = null;
    try {
      await this.auth.authStateReady();
      authUserForFallback = this.auth.currentUser;
    } catch (error) {
      console.warn('Firebase Auth の初期化に時間がかかっています:', error);
    }

    const normalizeUsername = (value: string | null | undefined): string | null => {
      if (typeof value !== 'string') {
        return null;
      }
      const normalized = value.trim().toLowerCase();
      return /^[a-z0-9_]{3,10}$/.test(normalized) ? normalized : null;
    };

    const baseFallbackProfile = (uid: string): UserDirectoryProfile => {
      const authUser = authUserForFallback && authUserForFallback.uid === uid ? authUserForFallback : null;
      const usernameFromAuth = normalizeUsername(authUser?.displayName)
      ?? normalizeUsername(authUser?.email?.split('@')[0] ?? null)
      ?? uid;
      const photoUrlFromAuth = typeof authUser?.photoURL === 'string' && authUser.photoURL.trim().length > 0
        ? authUser.photoURL
        : null;
      return { uid, username: usernameFromAuth, photoURL: photoUrlFromAuth };
    };
    if (!memberIds || memberIds.length === 0) {
      this.projectMemberProfiles = {};
      this.mentionableMembers = [];
      this.mentionSelectorOpen = false;
      this.currentUserProfile = currentUid ? baseFallbackProfile(currentUid)  : null;
      this.updateSmartFilterAssignees();
      return;
    }

    try {
      const profiles = await this.userDirectoryService.getProfiles(memberIds);
      const profileMap: Record<string, UserDirectoryProfile> = {};
      for (const profile of profiles) {
        profileMap[profile.uid] = profile;
      }
      this.projectMemberProfiles = profileMap;
      this.mentionableMembers = profiles.filter(profile => profile.uid !== currentUid);
      if (this.mentionableMembers.length === 0) {
        this.mentionSelectorOpen = false;
      }
      if (currentUid) {
        const directoryProfile = profileMap[currentUid];
        const fallbackProfile = baseFallbackProfile(currentUid);
        this.currentUserProfile = {
          uid: currentUid,
          username: directoryProfile?.username ?? fallbackProfile.username,
          photoURL: directoryProfile?.photoURL ?? fallbackProfile.photoURL,
        };
      } else {
        this.currentUserProfile = null;
      }

      this.attachments = this.attachments.map(attachment => this.composeAttachmentView(attachment));
      this.updateSmartFilterAssignees();
    } catch (error) {
      console.error('メンバー情報の取得に失敗しました:', error);
      this.projectMemberProfiles = {};
      this.mentionableMembers = [];
      this.mentionSelectorOpen = false;
      this.currentUserProfile = currentUid ? baseFallbackProfile(currentUid) : null;
      this.attachments = this.attachments.map(attachment => this.composeAttachmentView(attachment));
      this.updateSmartFilterAssignees();
    }
  }

  private composeAttachmentView(attachment: Attachment): TaskAttachmentView {
    const profile = attachment.uploadedBy ? this.projectMemberProfiles[attachment.uploadedBy] : undefined;
    const isCurrentUserAttachment = this.currentUid !== null && attachment.uploadedBy === this.currentUid;
    const fallbackProfile = isCurrentUserAttachment ? this.currentUserProfile : undefined;
    const uploaderLabel = profile?.username
      ?? fallbackProfile?.username
      ?? (attachment.uploadedBy || '不明なユーザー');
    const uploaderPhotoUrl = profile?.photoURL
      ?? fallbackProfile?.photoURL
      ?? null;

    return {
      ...attachment,
      uploaderLabel,
      uploaderPhotoUrl,
    };
  }

  private composeCommentView(comment: Comment): TaskCommentView {
    const profile = comment.createdBy ? this.projectMemberProfiles[comment.createdBy] : undefined;
    const isCurrentUserComment = this.currentUid !== null && comment.createdBy === this.currentUid;
    const fallbackProfile = isCurrentUserComment ? this.currentUserProfile : undefined;
    const authorUsername = typeof comment.authorUsername === 'string' && comment.authorUsername.trim().length > 0
    ? comment.authorUsername
    : profile?.username ?? fallbackProfile?.username ?? comment.createdBy;
    const authorPhotoUrl = comment.authorPhotoUrl
      ?? profile?.photoURL
      ?? fallbackProfile?.photoURL
      ?? null;

    return {
      ...comment,
      authorUsername,
      authorPhotoUrl,
      mentions: Array.isArray(comment.mentions) ? comment.mentions : [],
    };
  }

  private updateCommentLimitState(): void {
    this.commentLimitReached = this.comments.length >= 500;
  }

  private async loadTaskComments(taskId: string): Promise<void> {
    if (!this.projectId || !this.issueId) {
      return;
    }
    this.commentsLoading = true;
    this.commentError = '';
    try {
      const comments = await this.tasksService.listComments(this.projectId, this.issueId, taskId);
      this.comments = comments.map(comment => this.composeCommentView(comment));
    } catch (error) {
      console.error('コメントの読み込みに失敗しました:', error);
      this.commentError = 'コメントの読み込みに失敗しました。';
      this.comments = [];
    } finally {
      this.commentsLoading = false;
      this.updateCommentLimitState();
    }
  }

  private updateAttachmentLimitState(): void {
    this.attachmentLimitReached = this.attachments.length >= this.attachmentLimit;
  }

  private async loadTaskAttachments(taskId: string, options: { silent?: boolean } = {}): Promise<void> {
    if (!this.projectId || !this.issueId) {
      return;
    }

    const { silent = false } = options;
    if (!silent) {
      this.attachmentsLoading = true;
      this.attachmentsError = '';
    }

    try {
      this.attachmentsError = '';
      const attachments = await this.tasksService.listAttachments(this.projectId, this.issueId, taskId);
      this.attachments = attachments
        .map(attachment => this.composeAttachmentView(attachment))
        .sort((a, b) => {
          const timeA = a.uploadedAt?.getTime() ?? 0;
          const timeB = b.uploadedAt?.getTime() ?? 0;
          return timeB - timeA;
        });
      this.updateAttachmentLimitState();
    } catch (error) {
      console.error('添付ファイルの読み込みに失敗しました:', error);
      this.attachmentsError = error instanceof Error ? error.message : '添付ファイルの読み込みに失敗しました。';
      this.attachments = [];
      this.updateAttachmentLimitState();
    } finally {
      this.attachmentsLoading = false;
    }
  }

  canSubmitComment(): boolean {
    if (!this.canPostComment() || !this.selectedTaskId) {
      return false;
    }
    const trimmed = this.commentForm.text.trim();
    return trimmed.length > 0 && trimmed.length <= 5000 && !this.commentLimitReached;
  }

  async submitComment(): Promise<void> {
    if (!this.selectedTaskId || !this.canSubmitComment()) {
      return;
    }

    this.commentSubmitting = true;
    this.commentError = '';
    try {
      const created = await this.tasksService.addComment(
        this.projectId,
        this.issueId,
        this.selectedTaskId,
        {
          text: this.commentForm.text,
          mentions: this.commentForm.mentions,
          authorUsername: this.currentUserProfile?.username ?? this.currentUid ?? null,
          authorPhotoUrl: this.currentUserProfile?.photoURL ?? null,
        },
      );
      const view = this.composeCommentView(created);
      this.comments = [...this.comments, view].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
      );
      this.commentForm = { text: '', mentions: [] };
      this.mentionSelectorOpen = false;
      this.updateCommentLimitState();
    } catch (error) {
      console.error('コメントの投稿に失敗しました:', error);
      this.commentError = error instanceof Error ? error.message : 'コメントの投稿に失敗しました。';
    } finally {
      this.commentSubmitting = false;
    }
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

  trackAttachmentById(_: number, attachment: TaskAttachmentView): string {
    return attachment.id;
  }

  async onAttachmentSelected(event: Event): Promise<void> {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input || !input.files || !this.selectedTaskId || !this.selectedTask) {
      return;
    }

    if (!this.canUploadAttachment(this.selectedTask)) {
      alert('添付ファイルを追加する権限がありません');
      input.value = '';
      return;
    }

    if (this.attachmentLimitReached) {
      this.attachmentUploadError = `添付ファイルは最大${this.attachmentLimit}件までです。`;
      input.value = '';
      return;
    }

    const files = Array.from(input.files).filter(file => file.size > 0);
    if (files.length === 0) {
      input.value = '';
      return;
    }

    this.attachmentUploadError = '';
    this.attachmentUploadMessage = '';
    this.attachmentUploading = true;

    let successCount = 0;
    for (const file of files) {
      try {
        const created = await this.tasksService.uploadAttachment(
          this.projectId,
          this.issueId,
          this.selectedTaskId,
          file,
          {
            taskTitle: this.selectedTask.title,
            projectName: this.projectDetails?.name ?? null,
            issueName: this.issueDetails?.name ?? null,
          },
        );
        this.attachments = [
          this.composeAttachmentView(created),
          ...this.attachments,
        ].sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0));
        successCount += 1;
      } catch (error) {
        console.error('添付ファイルのアップロードに失敗しました:', error);
        this.attachmentUploadError = error instanceof Error ? error.message : '添付ファイルのアップロードに失敗しました。';
        break;
      }
    }

    if (successCount > 0) {
      const suffix = this.attachmentUploadError ? '（一部失敗）' : '';
      this.attachmentUploadMessage = `${successCount}件の添付ファイルを追加しました${suffix}。`;
    }

    this.updateAttachmentLimitState();
    this.attachmentUploading = false;
    if (this.selectedTaskId) {
      void this.loadTaskAttachments(this.selectedTaskId, { silent: true });
    }
    input.value = '';
  }

  async deleteAttachment(attachment: TaskAttachmentView): Promise<void> {
    if (!this.selectedTaskId || !this.selectedTask) {
      return;
    }

    if (!this.canDeleteAttachment(attachment)) {
      alert('この添付ファイルを削除する権限がありません');
      return;
    }

    const confirmed = confirm(`添付ファイル「${attachment.fileName}」を削除しますか？`);
    if (!confirmed) {
      return;
    }

    this.attachmentDeletingId = attachment.id;
    this.attachmentsError = '';
    try {
      await this.tasksService.deleteAttachment(
        this.projectId,
        this.issueId,
        this.selectedTaskId,
        attachment.id,
      );
      await this.loadTaskAttachments(this.selectedTaskId, { silent: true });
    } catch (error) {
      console.error('添付ファイルの削除に失敗しました:', error);
      this.attachmentsError = error instanceof Error ? error.message : '添付ファイルの削除に失敗しました。';
    } finally {
      this.attachmentDeletingId = null;
      this.updateAttachmentLimitState();
    }
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
      this.commentForm.mentions = this.commentForm.mentions.filter(id => id !== uid);
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

  isMentionSelected(uid: string): boolean {
    return this.commentForm.mentions.includes(uid);
  }

  getMentionLabel(uid: string): string {
    return this.projectMemberProfiles[uid]?.username ?? uid;
  }

  /**
   * コメントテキストを解析して、テキスト部分とメンション部分を分離する
   */
  parseCommentText(text: string, mentionIds: string[]): { type: 'text' | 'mention'; content: string; mentionId?: string }[] {
    if (!text) {
      return [];
    }

    const segments: { type: 'text' | 'mention'; content: string; mentionId?: string }[] = [];
    const mentionMap = new Map<string, string>();
    
    // メンションIDからユーザー名のマップを作成
    for (const uid of mentionIds) {
      const username = this.getMentionLabel(uid);
      mentionMap.set(`@${username}`, uid);
    }

    // 正規表現で@usernameパターンを検出
    const mentionPattern = /@(\S+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = mentionPattern.exec(text)) !== null) {
      // メンションの前のテキスト部分
      if (match.index > lastIndex) {
        segments.push({
          type: 'text',
          content: text.substring(lastIndex, match.index),
        });
      }

      // メンション部分
      const mentionText = match[0];
      const mentionId = mentionMap.get(mentionText);
      
      if (mentionId) {
        segments.push({
          type: 'mention',
          content: mentionText,
          mentionId,
        });
      } else {
        // メンションIDが見つからない場合は通常のテキストとして扱う
        segments.push({
          type: 'text',
          content: mentionText,
        });
      }

      lastIndex = mentionPattern.lastIndex;
    }

    // 残りのテキスト部分
    if (lastIndex < text.length) {
      segments.push({
        type: 'text',
        content: text.substring(lastIndex),
      });
    }

    return segments;
  }

  getCommentInitial(comment: TaskCommentView): string {
    return getAvatarInitial(comment.authorUsername || comment.createdBy, '?');
  }

  getCommentAvatarColor(comment: TaskCommentView): string {
    const base = comment.createdBy || comment.authorUsername;
    return getAvatarColor(base);
  }

  getMemberAvatarColor(uid: string): string {
    return getAvatarColor(uid);
  }

  getAssigneeDisplayName(uid: string): string {
    const profile = this.projectMemberProfiles[uid];
    if (profile?.username && profile.username.trim().length > 0) {
      return profile.username;
    }
    return uid;
  }

  getAssigneePhotoUrl(uid: string): string | null {
    const photoUrl = this.projectMemberProfiles[uid]?.photoURL;
    return typeof photoUrl === 'string' && photoUrl.trim().length > 0 ? photoUrl : null;
  }

  getAssigneeInitial(uid: string): string {
    const profile = this.projectMemberProfiles[uid];
    const source = profile?.username && profile.username.trim().length > 0 ? profile.username : uid;
    return getAvatarInitial(source, '?');
  }

  getMemberInitial(member: UserDirectoryProfile): string {
    return getAvatarInitial(member.username || member.uid, '?');
  }

  getAttachmentInitial(attachment: TaskAttachmentView): string {
    return getAvatarInitial(attachment.uploaderLabel || attachment.uploadedBy, '?');
  }

  /** タスク選択 */
  selectTask(task: Task) {
    if (task.id) {
      this.selectedTaskId = task.id;
      this.selectedTask = task;
      this.resetAssigneeActionFeedback(); // 新しいタスク表示時は前回のメッセージをクリア
      this.resetCommentState();
      this.resetAttachmentState();
      void this.loadTaskComments(task.id);
      void this.loadTaskAttachments(task.id);
    }
  }

  /** 詳細パネルを閉じる */
  closeDetailPanel() {
    this.selectedTaskId = null;
    this.selectedTask = null;
    this.newChecklistText = '';
    this.resetAssigneeActionFeedback(); // 閉じたタイミングでもフィードバックを初期化
    this.resetCommentState();
    this.resetAttachmentState();
  }

  /** 指定IDのタスクを選択候補として適用する */
  private trySelectTaskById(taskId: string | null): void {
    if (!taskId) {
      return;
    }
    const target = this.tasks.find((task) => task.id === taskId);
    if (target) {
      this.selectTask(target);
      this.pendingFocusTaskId = null;
    }
  }

  /** 新規作成モーダルを開く */
  openCreateModal() {
    if (!this.canCreateTask()) {
      alert('タスクを作成する権限がありません');
      return;
    }
    this.editingTask = null;
    this.taskForm = {
      title: '',
      description: '',
      startDate: '',
      endDate: '',
      goal: '',
      importance: 'Low',
      status: 'incomplete',
      tagIds: [],
      checklist: []
    };
    this.showModal = true;
  }

  /** 編集モーダルを開く */
  editTask(task: Task, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    if (!this.canEditTask(task)) {
      alert('このタスクを編集する権限がありません');
      return;
    }

    this.editingTask = task;
    this.taskForm = {
      title: task.title,
      description: task.description || '',
      startDate: task.startDate ? this.formatDateForInput(task.startDate) : '',
      endDate: task.endDate ? this.formatDateForInput(task.endDate) : '',
      goal: task.goal || '',
      importance: task.importance || 'Low',
      status: task.status || 'incomplete',
      tagIds: [...task.tagIds],
      checklist: task.checklist.map(item => ({ ...item }))
    };
    this.showModal = true;
  }

  private readonly tokyoTimezone = 'Asia/Tokyo';

  /** 東京時間での日付部分を取得するヘルパー */
  private getTokyoDateParts(date: Date): { year: number; month: number; day: number } {
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: this.tokyoTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    return {
      year: parseInt(parts.find((p) => p.type === 'year')!.value, 10),
      month: parseInt(parts.find((p) => p.type === 'month')!.value, 10) - 1, // 0-indexed
      day: parseInt(parts.find((p) => p.type === 'day')!.value, 10),
    };
  }

  /** 日付を入力用フォーマットに変換（東京時間ベース） */
  private formatDateForInput(date: Date | string): string {
    const d = this.normalizeDate(date);
    if (!d) return '';
    const { year, month, day } = this.getTokyoDateParts(d);
    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    return `${year}-${monthStr}-${dayStr}`;
  }

  /** タスク保存 */
  async saveTask() {
    if (this.saving) return;

    if (this.editingTask) {
      if (!this.canEditTask(this.editingTask)) {
        alert('このタスクを編集する権限がありません');
        return;
      }
    } else if (!this.canCreateTask()) {
      alert('タスクを作成する権限がありません');
      return;
    }

    const trimmedTitle = this.taskForm.title?.trim() || '';
    if (!trimmedTitle) {
      alert('タスクのタイトルを入力してください');
      return;
    }
    if (trimmedTitle.length > 80) {
      alert('タスクのタイトルは80文字以内で入力してください');
      return;
    }

    const trimmedDescription = this.taskForm.description?.trim() || '';
    if (trimmedDescription.length > 500) {
      alert('説明は500文字以内で入力してください');
      return;
    }

    const trimmedGoal = this.taskForm.goal?.trim() || '';
    if (trimmedGoal.length > 500) {
      alert('達成目標は500文字以内で入力してください');
      return;
    }

    // チェックリスト項目の文字数チェック
    for (const item of this.taskForm.checklist) {
      const trimmedText = item.text?.trim() || '';
      if (trimmedText.length > 100) {
        alert('チェックリスト項目は100文字以内で入力してください');
        return;
      }
    }

    this.saving = true;
    try {
      const taskData = {
        title: trimmedTitle,
        description: trimmedDescription || null,
        startDate: this.taskForm.startDate ? this.normalizeDate(this.taskForm.startDate) : null,
        endDate: this.taskForm.endDate ? this.normalizeDate(this.taskForm.endDate) : null,
        goal: trimmedGoal || null,
        importance: this.taskForm.importance,
        status: this.taskForm.status,
        tagIds: this.taskForm.tagIds,
        checklist: this.taskForm.checklist.filter(item => item.text.trim() !== '')
      };

      if (this.editingTask?.id) {
        await this.tasksService.updateTask(
          this.projectId,
          this.issueId,
          this.editingTask.id,
          taskData
        );
      } else {
        await this.tasksService.createTask(this.projectId, this.issueId, {
          ...taskData,
          description: taskData.description || undefined,
          startDate: taskData.startDate || undefined,
          endDate: taskData.endDate || undefined,
          goal: taskData.goal || undefined
        });
      }

      this.closeModal();
      await this.loadData();
      this.refreshSelectedTask();
    } catch (error) {
      console.error('タスクの保存に失敗しました:', error);
      alert(this.buildTaskSaveErrorMessage(error));
    } finally {
      this.saving = false;
    }
  }

  /**
   * Firestoreエラーを人間にわかりやすいメッセージへ変換する
   * バージョン衝突（FAILED_PRECONDITION/ABORTED）を検出して案内を表示
   */
  private buildTaskSaveErrorMessage(error: unknown): string {
    // FirebaseErrorかどうかを判定し、バージョン違反コードを優先的に扱う
    if (error instanceof FirebaseError) {
      const conflictCodes = ['aborted', 'failed-precondition'];
      if (conflictCodes.includes(error.code) || error.message.includes('FAILED_PRECONDITION')) {
        return '最新の情報と競合したため保存できませんでした。画面を再読み込みしてからもう一度お試しください。';
      }
      if (error.message) {
        return error.message;
      }
    }

    // 通常のErrorであればメッセージを返却し、その他は汎用文を表示
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return '予期しないエラーが発生しました。時間をおいて再度お試しください。';
  }

  /** モーダルを閉じる */
  closeModal() {
    this.showModal = false;
    this.editingTask = null;
    this.saving = false;
  }

  /** タスク削除 */
  async deleteTask(task: Task, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    if (!task.id) return;
    if (!this.canDeleteTask(task)) {
      alert('このタスクを削除する権限がありません');
      return;
    }
    if (!confirm(`タスク「${task.title}」を削除しますか？`)) return;

    try {
      await this.tasksService.deleteTask(this.projectId, this.issueId, task.id);
      await this.loadData();

      if (this.selectedTaskId === task.id) {
        this.closeDetailPanel();
      } else {
        this.refreshSelectedTask();
      }
    } catch (error) {
      console.error('タスクの削除に失敗しました:', error);
      alert('タスクの削除に失敗しました');
    }
  }

  /** アーカイブ切替 */
  async archiveTask(task: Task, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    if (!task.id) return;
    if (!this.canEditTask(task)) {
      alert('このタスクを変更する権限がありません');
      return;
    }
    const actionLabel = task.archived ? '復元' : 'アーカイブ';
    const confirmed = confirm(`タスク「${task.title}」を${actionLabel}しますか？`);
    if (!confirmed) {
      return; // キャンセル時は処理しない
    }

    try {
      await this.tasksService.updateTask(this.projectId, this.issueId, task.id, {
        archived: !task.archived
      });
      await this.loadData();
      this.refreshSelectedTask();
    } catch (error) {
      console.error('アーカイブの切替に失敗しました:', error);
      alert('アーカイブの切替に失敗しました');
    }
  }

  /** ステータスメニューの開閉状態を判定 */
  isStatusMenuOpen(task: Task): boolean {
    return Boolean(task.id && this.statusMenuTaskId === task.id);
  }

  /** ステータス変更メニューのトグル処理 */
  toggleStatusMenu(task: Task, event?: Event): void {
    if (event) {
      event.stopPropagation(); // カード選択イベントを抑止
    }

    if (!task.id) {
      return; // ID がなければ操作できない
    }
    if (!this.canEditTask(task)) {
      alert('このタスクを変更する権限がありません');
      return;
    }

    this.statusMenuTaskId = this.statusMenuTaskId === task.id ? null : task.id;
  }

  /** タスクのステータスを指定の値へ更新 */
  async updateTaskStatus(task: Task, status: TaskStatus, event?: Event): Promise<void> {
    if (event) {
      event.stopPropagation(); // メニュー選択でもカードのクリックを阻止
    }

    if (!task.id) {
      return; // 何らかの理由で ID が欠けている場合は処理しない
    }
    if (!this.canEditTask(task)) {
      alert('このタスクを変更する権限がありません');
      return;
    }

    try {
      const checklist = Array.isArray(task.checklist) ? task.checklist : [];
      const progress = this.tasksService.calculateProgressFromChecklist(checklist, status);

      await this.tasksService.updateTask(this.projectId, this.issueId, task.id, {
        status,
        progress,
      });
      this.statusMenuTaskId = null; // 成功時はメニューを閉じておく

      await this.loadData();
      this.refreshSelectedTask();
      await this.updateIssueProgress();
    } catch (error) {
      console.error('タスクのステータス更新に失敗しました:', error);
      alert('タスクのステータス更新に失敗しました');
    }
  }

  /** ステータスラベル取得 */
  getStatusLabel(status: TaskStatus): string {
    const labels: Record<TaskStatus, string> = {
      incomplete: '未完了',
      in_progress: '進行中',
      completed: '完了',
      on_hold: '保留',
      discarded: '破棄'
    };
    return labels[status];
  }

  /** ClecklistItem追加 */
  addChecklistItem() {
    if (this.editingTask) {
      if (!this.canEditTask(this.editingTask)) {
        alert('チェックリストを編集する権限がありません');
        return;
      }
    } else if (!this.canCreateTask()) {
      alert('チェックリストを編集する権限がありません');
      return;
    }

    if (this.taskForm.checklist.length < 200) {
      this.taskForm.checklist.push({
        id: this.generateId(),
        text: '',
        completed: false
      });
    } else {
      alert('チェックリスト項目は最大200個までです');
    }
  }

  /** ChecklistItem削除 */
  removeChecklistItem(index: number) {
    if (this.editingTask) {
      if (!this.canEditTask(this.editingTask)) {
        alert('チェックリストを編集する権限がありません');
        return;
      }
    } else if (!this.canCreateTask()) {
      alert('チェックリストを編集する権限がありません');
      return;
    }

    this.taskForm.checklist.splice(index, 1);
  }

  /** ID生成 */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /** タグ選択切替 */
  toggleTag(tagId: string) {
    if (this.editingTask) {
      if (!this.canEditTask(this.editingTask)) {
        alert('タグを編集する権限がありません');
        return;
      }
    } else if (!this.canCreateTask()) {
      alert('タグを編集する権限がありません');
      return;
    }

    const index = this.taskForm.tagIds.indexOf(tagId);
    if (index >= 0) {
      this.taskForm.tagIds.splice(index, 1);
    } else {
      if (this.taskForm.tagIds.length < 10) {
        this.taskForm.tagIds.push(tagId);
      } else {
        alert('タグは最大10個まで選択できます');
      }
    }
  }

    /** タグが削除可能か（作成者本人か）を判定 */
  canDeleteTag(tag: Tag): boolean {
    if (!tag.id) {
      return false;
    }
    if (this.isAdmin()) {
      return true; // 管理者はプロジェクト内のタグを全て削除可能
    }
    return Boolean(this.currentUid && tag.createdBy === this.currentUid);
  }

  /** カスタムタグを一覧から削除し、フォームの選択状態も同期する */
  async deleteCustomTag(tag: Tag, event: Event) {
    event.stopPropagation();
    event.preventDefault();

    if (!tag.id) {
      return;
    }

    if (!this.canDeleteTag(tag)) {
      alert('このタグを削除する権限がありません');
      return;
    }

    if (!confirm(`タグ「${tag.name}」を削除しますか？`)) {
      return;
    }

    if (!this.projectId) {
      alert('プロジェクト情報を取得できませんでした。');
      return;
    }

    try {
      await this.tagsService.deleteTag(this.projectId, tag.id, this.currentRole ?? null);
      this.availableTags = this.availableTags.filter(t => t.id !== tag.id); // 表示リストから除外
      this.taskForm.tagIds = this.taskForm.tagIds.filter(id => id !== tag.id); // フォームで選択されていれば外す
      this.updateAvailableTagIndex();
      this.sanitizeAllTagSelections();
      this.refreshSmartFilterTags();
      this.newTagColor = this.generateRandomUniqueTagColor(); // 削除で空いた色を考慮し初期色を再計算
    } catch (error) {
      console.error('タグの削除に失敗しました:', error);
      alert('タグの削除に失敗しました。権限を確認してください。');
    }
  }

  /** カスタムタグを即時作成し、一覧とフォームへ反映する */
  async createCustomTag() {
    const name = this.newTagName.trim(); // 前後の空白を除去
    if (!name) {
      alert('タグ名を入力してください');
      return;
    }

    // タグ名の文字数上限チェック（10文字）
    const MAX_TAG_NAME_LENGTH = 10;
    if (name.length > MAX_TAG_NAME_LENGTH) {
      alert(`タグ名は最大${MAX_TAG_NAME_LENGTH}文字までです`);
      return;
    }

    if (this.creatingTag) {
      return; // 二重クリックによる多重送信を防止
    }

    this.creatingTag = true;
    if (!this.projectId) {
      alert('プロジェクト情報を取得できませんでした。');
      return;
    }
    try {
      const preferredColor = this.normalizeHexColorInput(this.newTagColor); // 入力値を正規化（未指定ならundefined）
      const tagId = await this.tagsService.createTag(this.projectId, { name, color: preferredColor ?? undefined }); // Firestoreへタグを保存
      const createdTag = await this.tagsService.getTag(this.projectId, tagId); // 付与されたカラーや作成者情報を取得
      const newTag: Tag = createdTag ?? {
        id: tagId,
        projectId: this.projectId,
        name,
        color: preferredColor ?? undefined,
        createdBy: this.currentUid ?? null,
      };
      this.availableTags = [...this.availableTags, newTag]; // Change Detectionを確実に発火
      this.updateAvailableTagIndex();
      this.sanitizeAllTagSelections();
      this.refreshSmartFilterTags(); // フィルター用のタグ一覧も更新

      if (!this.taskForm.tagIds.includes(tagId) && this.taskForm.tagIds.length < 10) {
        this.taskForm.tagIds.push(tagId); // 作成したタグを自動的に選択
      }

      this.newTagName = ''; // 入力欄をクリア
      this.newTagColor = this.generateRandomUniqueTagColor(); // 次回用にランダムカラーを再割り当て
    } catch (error) {
      console.error('カスタムタグの作成に失敗しました:', error);
       // サービス層からの詳細メッセージをそのまま伝えて重複検知を明示
       if (error instanceof Error && error.message) {
        alert(error.message);
      } else {
        alert('タグの作成に失敗しました。時間を置いて再度お試しください。');
      }
    } finally {
      this.creatingTag = false; // ローディング状態を解除
    }
  }
   /** カラー入力値を正規化し、不正な値はundefined扱いにする */
   private normalizeHexColorInput(color: string | null | undefined): string | undefined {
    if (!color) {
      return undefined;
    }
    const trimmed = color.trim();
    const match = trimmed.match(/^#([0-9a-fA-F]{6})$/);
    if (!match) {
      return undefined;
    }
    return `#${match[1].toUpperCase()}`;
  }

  /** 既存タグと重複しないランダムカラーを算出 */
  private generateRandomUniqueTagColor(): string {
    const usedColors = new Set(
      this.availableTags
        .map(tag => tag.color)
        .filter((color): color is string => typeof color === 'string' && color.trim().length > 0)
        .map(color => color.trim().toUpperCase()),
    );

    for (let attempt = 0; attempt < 100; attempt++) {
      const color = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase()}`;
      if (!usedColors.has(color)) {
        return color;
      }
    }

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
  /** 課題進捗更新 */
  private async updateIssueProgress() {
    if (!this.issueDetails?.id) return;

    const activeTasks = this.tasks.filter(t => !t.archived);
    if (activeTasks.length === 0) {
      this.issueProgress = 0;
      this.taskPreview = [];
      return;
    }

    let totalProgressWeight = 0;
    let totalWeight = 0;

    for (const task of activeTasks) {
      const weight = this.getImportanceWeight(task.importance);
      const progress = typeof task.progress === 'number'
        ? task.progress
        : this.tasksService.calculateProgressFromChecklist(task.checklist, task.status);
      totalProgressWeight += progress * weight;
      totalWeight += weight;
    }

    const computedProgress = totalWeight === 0
      ? 0
      : Math.round((totalProgressWeight / totalWeight) * 10) / 10;
    this.issueProgress = Math.min(100, Math.max(0, computedProgress));

    const sortedTasks = [...activeTasks].sort((a, b) => {
      const weightDiff = this.getImportanceWeight(b.importance) - this.getImportanceWeight(a.importance);
      if (weightDiff !== 0) {
        return weightDiff;
      }
      const endA = this.normalizeDate(a.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const endB = this.normalizeDate(b.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return endA - endB;
    });

    this.taskPreview = sortedTasks.slice(0, 1);
  }

  /** 選択中タスクを最新情報に更新 */
  private refreshSelectedTask(): void {
    if (!this.selectedTaskId) {
      this.selectedTask = null;
      return;
    }

    const updated = this.tasks.find(task => task.id === this.selectedTaskId);
    if (updated) {
      this.selectedTask = updated;
    } else {
      this.selectedTaskId = null;
      this.selectedTask = null;
    }
  }

   /**
   * 課題サマリーに適用するCSSカスタムプロパティを生成
   * テンプレート側でテーマカラーを強調表示するために使用
   */
   getIssueSummaryStyles(): Record<string, string> {
    const baseColor = this.getIssueThemeColor();
    return {
      '--issue-color': baseColor,
      '--issue-color-soft': this.getIssueThemeTint(0.16),
      '--issue-color-glow': this.getIssueThemeTint(0.22)
    };
  }

  /** 課題のテーマカラーを取得 */
  getIssueThemeColor(): string {
    const fallbackKey = this.issueDetails?.id ?? this.issueId ?? null;
    return resolveIssueThemeColor(this.issueDetails?.themeColor ?? null, fallbackKey);
  }
  /**
   * テーマカラーを透過色に変換
   * CSS変数で柔らかな背景や影を作るための補助関数
   */
  private getIssueThemeTint(alpha: number): string {
    const base = this.getIssueThemeColor();
    const rgb = this.parseColor(base);
    const normalizedAlpha = Math.min(Math.max(alpha, 0), 1);
    if (rgb) {
      return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${normalizedAlpha})`;
    }
    // 変換できなかった場合はブランドカラーにフォールバック
    return `rgba(0, 123, 255, ${normalizedAlpha})`;
  }

  /**
   * カラーコードをRGB値に変換
   * #RGB / #RRGGBB / rgb(r,g,b) の表記に対応
   */
  private parseColor(color: string): { r: number; g: number; b: number } | null {
    const trimmed = color.trim();

    // rgb() 形式にも対応
    const rgbMatch = trimmed.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
    if (rgbMatch) {
      return {
        r: Number(rgbMatch[1]),
        g: Number(rgbMatch[2]),
        b: Number(rgbMatch[3])
      };
    }

    const hexMatch = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hexMatch) {
      return null;
    }

    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map(char => char + char).join('');
    }

    const value = parseInt(hex, 16);
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff
    };
  }
  /** 重要度のラベルを日本語で取得 */
  getImportanceLabel(importance?: Importance): string {
    const key = importance ?? 'Low';
    return this.importanceDisplay[key].label;
  }

  /** 重要度バッジ用のクラス名を返す */
  getImportanceClass(importance?: Importance): string {
    const key = (importance ?? 'Low').toLowerCase() as Lowercase<Importance>;
    return `importance-${key}`;
  }

  /** 選択中タスクの進捗率を取得 */
  getTaskProgress(task: Task): number {
    if (typeof task.progress === 'number') {
      return task.progress;
    }
    return this.tasksService.calculateProgressFromChecklist(task.checklist, task.status);
  }

  /** 詳細パネルからチェックリストの完了状態を切り替える */
  async toggleChecklistItem(task: Task, itemId: string, completed: boolean) {
    if (!this.canEditTask(task)) {
      alert('チェックリストを更新する権限がありません');
      return;
    }
    const updatedChecklist = task.checklist.map(item =>
      item.id === itemId ? { ...item, completed } : item
    );
    await this.persistChecklist(task, updatedChecklist);
  }

  /** 詳細パネルからチェックリスト項目を追加 */
  async addChecklistItemFromDetail() {
    const text = this.newChecklistText.trim();
    if (!text || !this.selectedTask) {
      return;
    }
    if (text.length > 100) {
      alert('チェックリスト項目は100文字以内で入力してください');
      return;
    }
    if (!this.canEditTask(this.selectedTask)) {
      alert('チェックリストを更新する権限がありません');
      return;
    }

    const updatedChecklist = [
      ...this.selectedTask.checklist,
      { id: this.generateId(), text, completed: false }
    ];

    await this.persistChecklist(this.selectedTask, updatedChecklist);
    this.newChecklistText = '';
  }

  /** 詳細パネルからチェックリスト項目を削除 */
  async removeChecklistItemFromDetail(itemId: string) {
    if (!this.selectedTask) {
      return;
    }
    if (!this.canEditTask(this.selectedTask)) {
      alert('チェックリストを更新する権限がありません');
      return;
    }

    const updatedChecklist = this.selectedTask.checklist.filter(item => item.id !== itemId);
    await this.persistChecklist(this.selectedTask, updatedChecklist);
  }

  /** チェックリスト更新をFirestoreに反映 */
  private async persistChecklist(task: Task, checklist: ChecklistItem[]): Promise<void> {
    if (!task.id) {
      return;
    }
    if (!this.canEditTask(task)) {
      alert('チェックリストを更新する権限がありません');
      return;
    }

    try {
      // チェックリストの結果から次のステータスを慎重に判定
      let status = task.status;
      if (checklist.length > 0) {
        const allCompleted = checklist.every(item => item.completed);
        const someCompleted = checklist.some(item => item.completed);
        const fallbackStatus = someCompleted ? 'in_progress' : 'incomplete';

        if (allCompleted) {
          if (status !== 'completed' && status !== 'on_hold' && status !== 'discarded') {
            const shouldComplete = this.confirmChecklistCompletion();
            status = shouldComplete ? 'completed' : fallbackStatus;
          }
        } else if (status !== 'on_hold' && status !== 'discarded') {
          status = fallbackStatus;
        }
      }
      const progress = this.tasksService.calculateProgressFromChecklist(checklist, status);
      await this.tasksService.updateTask(this.projectId, this.issueId, task.id, {
        checklist,
        status,
        progress
      });

      await this.loadData();
      this.refreshSelectedTask();
      await this.updateIssueProgress();
    } catch (error) {
      console.error('チェックリストの更新に失敗しました:', error);
      alert('チェックリストの更新に失敗しました');
    }
  }

  /** タグ名を取得 */
  getTagName(tagId: string): string {
    const tag = this.availableTags.find(t => t.id === tagId);
    return tag ? tag.name : tagId;
  }

  /** タグカラーを取得 */
  getTagColor(tagId: string): string {
    const tag = this.availableTags.find(t => t.id === tagId);
    return tag?.color || '#ccc';
  }

  /** 完了したチェックリスト項目数を取得 */
  getCompletedChecklistCount(task: Task): number {
    return task.checklist.filter(item => item.completed).length;
  }

  /** 日付をDateオブジェクトに正規化 */
  private normalizeDate(date: Date | string | null | undefined): Date | null {
    return this.toDate(date);
  }

  /** タスク期間（日数）を算出する（開始・終了がそろっていない場合は0） */
  private getTaskDuration(task: Task): number {
    const startDate = this.normalizeDate(task.startDate);
    const endDate = this.normalizeDate(task.endDate);
    if (!startDate || !endDate) {
      return 0;
    }
    const start = startDate.getTime();
    const end = endDate.getTime();
    const diff = end - start;
    return diff > 0 ? Math.round(diff / (1000 * 60 * 60 * 24)) : 0;
  }
}

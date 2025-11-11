import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterLink } from '@angular/router'; // 画面遷移ボタンを有効にする
import { Subject, takeUntil } from 'rxjs';
import { IssuesService } from '../issues/issues.service';
import { Issue, Project, Importance, Tag, Role, Task } from '../../models/schema';
import { ProjectsService } from '../projects/projects.service';
import { FirebaseError } from 'firebase/app';
import { TasksService, TaskSummary } from '../tasks/tasks.service';
import { TagsService } from '../tags/tags.service';
import { getAvatarColor, getAvatarInitial } from '../../shared/avatar-utils';
import { ISSUE_THEME_PALETTE, resolveIssueThemeColor } from '../../shared/issue-theme';
import { UserDirectoryProfile, UserDirectoryService } from '../../core/user-directory.service';
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
  doesDateMatchDue,
} from '../../shared/smart-filter/smart-filter.model';
/**
 * 課題一覧コンポーネント
 * プロジェクト配下の課題一覧表示、作成、編集、アーカイブ機能を提供
 */
@Component({
  selector: 'app-issues-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ProjectSidebarComponent,
    SmartFilterPanelComponent,
    RouterLink, // 検索ボタンの routerLink を解決
  ],
  templateUrl: './issues-list.component.html',
  styleUrls: ['./issues-list.component.scss']
})
export class IssuesListComponent implements OnInit, OnDestroy {
  private issuesService = inject(IssuesService);
  private projectsService = inject(ProjectsService);
  private tasksService = inject(TasksService);
  private tagsService = inject(TagsService);
  private userDirectoryService = inject(UserDirectoryService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy$ = new Subject<void>();

  projectId!: string;

  /** プロジェクトの詳細情報（新規作成直後でも内容が消えないよう保持） */
  projectDetails: Project | null = null;
  issues: Issue[] = [];
  filteredIssues: Issue[] = [];
  showModal = false;
  editingIssue: Issue | null = null;
  saving = false;
  showArchived = false;
  currentRole: Role | null = null;
  currentUid: string | null = null;
  readonly maxVisibleMembers = 10;
  /**
   * 課題IDごとのタスク概要（件数と代表タスク情報）をキャッシュ
   * UIのカード上で素早く表示できるよう、サービスからまとめて取得した内容を保持する
   */
  private taskSummaryMap: Record<string, TaskSummary> = {}; // タスク概要をキャッシュ
  private tagMap: Record<string, Tag> = {}; // タグID→タグ情報の逆引きを保持
  private importanceLabels: Record<Importance, string> = { // 課題カード用の重要度表示
    Critical: '至急重要',
    High: '至急',
    Medium: '重要',
    Low: '普通',
  };
  private memberColorCache = new Map<string, string>();
  private memberProfiles: Record<string, UserDirectoryProfile> = {};

  // 所属プロジェクトの選択肢を保持
  availableProjects: Project[] = [];

  // スマートフィルターとタスクキャッシュ
  private issueTasksMap: Record<string, Task[]> = {};
  smartFilterVisible = false;
  smartFilterCriteria: SmartFilterCriteria = createEmptySmartFilterCriteria();
  smartFilterTagOptions: SmartFilterTagOption[] = [];
  smartFilterAssigneeOptions: SmartFilterAssigneeOption[] = [];
  readonly smartFilterStatusOptions = SMART_FILTER_STATUS_OPTIONS;
  readonly smartFilterImportanceOptions = SMART_FILTER_IMPORTANCE_OPTIONS;
  readonly smartFilterScope = 'issues';

  // 並び替え設定
  sortBy: 'name' | 'startDate' | 'endDate' | 'progress' | 'createdAt' | 'period' | 'taskCount' = 'name';
  sortOrder: 'asc' | 'desc' = 'asc';

  /** localStorage用のキー */
  private readonly SORT_BY_KEY = 'issues-sort-by';
  private readonly SORT_ORDER_KEY = 'issues-sort-order';

  // フォームデータ
  issueForm = {
    projectId: '',
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    goal: '',
    themeColor: ''
  };

  // ランダムカラー生成用
   /** 課題テーマカラーの候補一覧（タスク側と共通化） */
   readonly colorPalette = ISSUE_THEME_PALETTE;

  ngOnInit() {
    void this.loadAvailableProjects();
    // ルートパラメータからprojectIdを取得
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.projectId = params['projectId'];
      if (this.projectId) {
        this.issueForm.projectId = this.projectId;
        this.loadIssues();
      }
    });
    this.loadSortPreferences();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * 課題一覧を読み込む
   */
  async loadIssues() {
    if (!this.projectId) return;
    
    try {
      const projectPromise = (this.projectsService as unknown as { getProject: (id: string) => Promise<Project | null> }).getProject(this.projectId);
      const uidPromise = (this.projectsService as unknown as { getSignedInUid: () => Promise<string> }).getSignedInUid();
      const [issues, project, uid] = await Promise.all([
        this.issuesService.listIssues(this.projectId, this.showArchived),
        projectPromise,
        uidPromise,
      ]);

      this.projectDetails = project;
      this.issues = issues;
      this.currentUid = uid;
      this.currentRole = project?.roles?.[uid] ?? null;
      await this.loadMemberProfiles(project?.memberIds ?? []);
      this.updateSmartFilterAssignees();
      await this.loadIssueTasks();
      this.filterIssues();
      await this.refreshTaskSummaries();
      await this.loadTagsForProject(this.projectId); // 直近で作成されたタグも反映
    } catch (error) {
      console.error('課題の読み込みに失敗しました:', error);
    }
  }
 /**
   * 選択可能なプロジェクト一覧を取得する
   * 課題移動時のプルダウンで利用する
   */
 private async loadAvailableProjects(): Promise<void> {
  try {
    const projectsServiceAny = this.projectsService as unknown as { listMyProjects: () => Promise<Project[]> };
    const projects: Project[] = await projectsServiceAny.listMyProjects();
    this.availableProjects = projects.filter((project): project is Project => Boolean(project.id) && project.currentRole === 'admin');
  } catch (error) {
    console.error('プロジェクト一覧の取得に失敗しました:', error);
    this.availableProjects = [];
  }
}

  isAdmin(): boolean {
    return this.currentRole === 'admin';
  }

/**
   * タグ一覧を読み込み、IDから即座に参照できるようマップ化する
   */
private async loadTagsForProject(projectId: string): Promise<void> {
  if (!projectId) {
    this.tagMap = {};
    this.smartFilterTagOptions = [];
    return;
  }

  try {
    const tags = await this.tagsService.listTags(projectId);
    this.tagMap = tags.reduce<Record<string, Tag>>((acc, tag) => {
      if (tag.id) {
        acc[tag.id] = tag; // 代表タスク表示で名称と色を即座に取り出す
      }
      return acc;
    }, {});
    this.smartFilterTagOptions = tags
      .filter((tag): tag is Tag & { id: string } => Boolean(tag.id))
      .map((tag) => ({
        id: tag.id!,
        name: tag.name,
        color: tag.color ?? null,
      }));
  } catch (error) {
    console.error('タグの取得に失敗しました:', error);
    this.tagMap = {};
    this.smartFilterTagOptions = [];
  }
}

private async loadMemberProfiles(memberIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set((memberIds ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
  if (uniqueIds.length === 0) {
    this.memberProfiles = {};
    return;
  }

  try {
    const profiles = await this.userDirectoryService.getProfiles(uniqueIds);
    this.memberProfiles = profiles.reduce<Record<string, UserDirectoryProfile>>((acc, profile) => {
      acc[profile.uid] = profile;
      return acc;
    }, {});
    this.updateSmartFilterAssignees();
  } catch (error) {
    console.error('メンバー情報の取得に失敗しました:', error);
    this.memberProfiles = {};
    this.updateSmartFilterAssignees();
  }
  }

  /** 課題が現在のユーザーによってピン止めされているか */
  isIssuePinned(issue: Issue): boolean {
    if (!this.currentUid || !issue.pinnedBy) {
      return false;
    }
    return issue.pinnedBy.includes(this.currentUid);
  }

  /** 課題のピン止め状態を切り替える */
  async toggleIssuePin(issue: Issue, event: Event): Promise<void> {
    event.stopPropagation();
    if (!issue.id) {
      return;
    }
    const currentlyPinned = this.isIssuePinned(issue);
    try {
      await this.issuesService.togglePin(this.projectId, issue.id, !currentlyPinned);
      await this.loadIssues();
    } catch (error) {
      console.error('課題のピン止め切り替えに失敗しました:', error);
      alert('課題のピン止め切り替えに失敗しました');
    }
  }

  /**
   * 課題をフィルタリング
   */
  filterIssues() {
    this.filteredIssues = this.issues.filter(issue => {
      if (!this.showArchived && issue.archived) {
        return false;
      }

      if (!isSmartFilterEmpty(this.smartFilterCriteria)) {
        const tasks = this.issueTasksMap[issue.id ?? ''] ?? [];
        const effectiveTasks = this.showArchived ? tasks : tasks.filter(task => !task.archived);
        const hasMatchingTask = effectiveTasks.some(task => matchesSmartFilterTask(task, this.smartFilterCriteria));

        const onlyDueFilter =
          this.smartFilterCriteria.due !== '' &&
          this.smartFilterCriteria.tagIds.length === 0 &&
          this.smartFilterCriteria.assigneeIds.length === 0 &&
          this.smartFilterCriteria.importanceLevels.length === 0 &&
          this.smartFilterCriteria.statuses.length === 0;

        const dueMatchesIssue = onlyDueFilter && doesDateMatchDue(issue.endDate ?? null, this.smartFilterCriteria.due);

        if (!hasMatchingTask && !dueMatchesIssue) {
          return false;
        }
      }

      return true;
    });
    this.sortIssues();
  }

  goToProjectsList(): void {
    void this.router.navigate(['/projects']);
  }

  /** スマートフィルターの開閉をトグル */
  toggleSmartFilterPanel(): void {
    this.smartFilterVisible = !this.smartFilterVisible;
  }

  /** スマートフィルター適用時の処理 */
  onSmartFilterApply(criteria: SmartFilterCriteria): void {
    this.smartFilterCriteria = criteria;
    this.smartFilterVisible = false;
    this.filterIssues();
  }

  getVisibleMemberIds(memberIds: string[]): string[] {
    return memberIds.slice(0, this.maxVisibleMembers);
  }

   /** スマートフィルター用に課題配下のタスクを取得してキャッシュ */
   private async loadIssueTasks(): Promise<void> {
    if (!this.projectId) {
      this.issueTasksMap = {};
      return;
    }

    try {
      const pairs = await Promise.all(
        this.issues
          .filter((issue): issue is Issue & { id: string } => Boolean(issue.id))
          .map(async (issue) => {
            const tasks = await this.tasksService.listTasks(this.projectId, issue.id!, true);
            return { issueId: issue.id!, tasks };
          })
      );

      const map = pairs.reduce<Record<string, Task[]>>((acc, item) => {
        acc[item.issueId] = item.tasks;
        return acc;
      }, {});

      if (!this.destroy$.closed) {
        this.issueTasksMap = map;
      }
    } catch (error) {
      console.error('課題配下のタスク取得に失敗しました:', error);
      this.issueTasksMap = {};
    }
  }

  /** プロジェクトメンバーからスマートフィルター用担当者リストを生成 */
  private updateSmartFilterAssignees(): void {
    const options: SmartFilterAssigneeOption[] = Object.values(this.memberProfiles ?? {})
      .filter((profile): profile is UserDirectoryProfile & { uid: string } => Boolean(profile?.uid))
      .map((profile) => ({
        id: profile.uid,
        displayName: profile.username && profile.username.trim().length > 0 ? profile.username : profile.uid,
        photoUrl: profile.photoURL ?? null,
      }));
    this.smartFilterAssigneeOptions = options;
  }

  getMemberInitial(memberId: string): string {
    return getAvatarInitial(this.getMemberDisplayName(memberId));
  }

  getMemberColor(memberId: string): string {
    if (!this.memberColorCache.has(memberId)) {
      this.memberColorCache.set(memberId, getAvatarColor(memberId));
    }
    return this.memberColorCache.get(memberId)!;
  }

  getMemberLabel(memberId: string, index: number): string {
    return `メンバー${index + 1} (${this.getMemberDisplayName(memberId)})`;
  }

  getMemberDisplayName(memberId: string): string {
    const profile = this.memberProfiles[memberId];
    if (profile?.username && profile.username.trim().length > 0) {
      return profile.username;
    }
    return memberId;
  }

  getMemberPhoto(memberId: string): string | null {
    const profile = this.memberProfiles[memberId];
    const photoUrl = profile?.photoURL;
    return typeof photoUrl === 'string' && photoUrl.trim().length > 0 ? photoUrl : null;
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
      
      if (savedSortBy && ['name', 'startDate', 'endDate', 'progress', 'createdAt', 'period', 'taskCount'].includes(savedSortBy)) {
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

  /**
   * 課題を並び替え
   */
  sortIssues() {
    this.saveSortPreferences();
    this.filteredIssues.sort((a, b) => {
      // ピン止めされた課題を先頭に表示
      const aPinned = this.isIssuePinned(a);
      const bPinned = this.isIssuePinned(b);
      if (aPinned && !bPinned) {
        return -1;
      }
      if (!aPinned && bPinned) {
        return 1;
      }

      let aValue: unknown;
      let bValue: unknown;

      switch (this.sortBy) {
        case 'name':
          aValue = a.name;
          bValue = b.name;
          break;
        case 'startDate':
          aValue = a.startDate || new Date(0);
          bValue = b.startDate || new Date(0);
          break;
        case 'endDate':
          aValue = a.endDate || new Date(0);
          bValue = b.endDate || new Date(0);
          break;
        case 'progress':
          aValue = a.progress || 0;
          bValue = b.progress || 0;
          break;
        case 'createdAt':
          aValue = a.createdAt || new Date(0);
          bValue = b.createdAt || new Date(0);
          break;
        case 'period':
          aValue = this.getIssueDuration(a);
          bValue = this.getIssueDuration(b);
          break;
        case 'taskCount':
          aValue = this.getTaskCount(a.id ?? '');
          bValue = this.getTaskCount(b.id ?? '');
          break;
        default:
          return 0;
      }

      if ((aValue as string | number | Date) < (bValue as string | number | Date)) return this.sortOrder === 'asc' ? -1 : 1;
      if ((aValue as string | number | Date) > (bValue as string | number | Date)) return this.sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /**
   * 課題を選択（詳細表示）
   */
  selectIssue(issue: Issue) {
    this.router.navigate(['/projects', this.projectId, 'issues', issue.id]);
  }

  /**
   * タスク詳細画面に遷移
   */
  goToTaskDetail(issueId: string, taskId: string | null | undefined, event: Event): void {
    event.stopPropagation(); // 課題カードのクリックイベントを阻止
    if (!taskId) {
      return;
    }
    void this.router.navigate(['/projects', this.projectId, 'issues', issueId], {
      queryParams: { focus: taskId },
    });
  }

  /**
   * 新規課題作成モーダルを開く
   */
  openCreateModal() {
    if (!this.isAdmin()) {
      alert('課題を作成する権限がありません');
      return;
    }
    this.editingIssue = null;
    this.issueForm = {
      projectId: this.projectId,
      name: '',
      description: '',
      startDate: '',
      endDate: '',
      goal: '',
      themeColor: ''
    };
    this.showModal = true;
  }

  /**
   * 課題編集モーダルを開く
   */
  editIssue(issue: Issue, event: Event) {
    event.stopPropagation();
    if (!this.isAdmin()) {
      alert('課題を編集する権限がありません');
      return;
    }
    this.editingIssue = issue;
    this.issueForm = {
      projectId: issue.projectId,
      name: issue.name,
      description: issue.description || '',
      startDate: issue.startDate ? this.formatDateForInput(issue.startDate) : '',
      endDate: issue.endDate ? this.formatDateForInput(issue.endDate) : '',
      goal: issue.goal || '',
      themeColor: issue.themeColor || ''
    };
    this.showModal = true;
  }

  /**
   * 課題をアーカイブ
   */
  async archiveIssue(issue: Issue, event: Event) {
    event.stopPropagation();
    if (!this.isAdmin()) {
      alert('課題を変更する権限がありません');
      return;
    }
    const actionLabel = issue.archived ? '復元' : 'アーカイブ';
    if (confirm(`課題「${issue.name}」を${actionLabel}しますか？`)) {
      try {
        await this.issuesService.archiveIssue(this.projectId, issue.id!, !issue.archived);
        await this.loadIssues();
      } catch (error) {
        console.error(`${actionLabel}に失敗しました:`, error);
        alert(`${actionLabel}に失敗しました`);
      }
    }
  }
   /**
   * 課題を削除（関連タスクもFirestoreのルールに従って削除される）
   */
   async deleteIssue(issue: Issue, event: Event) {
    event.stopPropagation(); // カード遷移を阻止

    if (!this.isAdmin()) {
      alert('課題を削除する権限がありません');
      return;
    }

    if (!issue.id) {
      return; // ID未確定の課題は削除不可
    }

    const confirmed = confirm(`課題「${issue.name}」を削除します。よろしいですか？`);
    if (!confirmed) {
      return; // ユーザーキャンセル
    }

    try {
      await this.issuesService.deleteIssue(this.projectId, issue.id); // Firestoreドキュメント削除
      await this.loadIssues(); // UI再読み込み
    } catch (error) {
      console.error('課題の削除に失敗しました:', error);
      alert('課題の削除に失敗しました');
    }
  }


  /**
   * 課題を保存
   */
  async saveIssue() {
    if (!this.isAdmin()) {
      alert('課題を変更する権限がありません');
      return;
    }
    const trimmedName = this.issueForm.name.trim();
    if (!trimmedName) {
      alert('課題名を入力してください');
      return;
    }
    if (trimmedName.length > 80) {
      alert('課題名は80文字以内で入力してください');
      return;
    }

    const trimmedDescription = this.issueForm.description?.trim() || '';
    if (trimmedDescription.length > 500) {
      alert('説明は500文字以内で入力してください');
      return;
    }

    const trimmedGoal = this.issueForm.goal?.trim() || '';
    if (trimmedGoal.length > 500) {
      alert('達成目標は500文字以内で入力してください');
      return;
    }

    this.saving = true;
    try {
      const targetProjectId = this.editingIssue ? (this.issueForm.projectId || this.projectId) : this.projectId;
      const issueData = {
        name: this.issueForm.name.trim(),
        description: trimmedDescription || undefined,
        startDate: this.issueForm.startDate ? new Date(this.issueForm.startDate) : undefined,
        endDate: this.issueForm.endDate ? new Date(this.issueForm.endDate) : undefined,
        goal: trimmedGoal || undefined,
        themeColor: this.issueForm.themeColor || undefined
      };

      if (this.editingIssue) {
        const updatePayload = {
          name: issueData.name,
          description: issueData.description ?? null,
          startDate: issueData.startDate ?? null,
          endDate: issueData.endDate ?? null,
          goal: issueData.goal ?? null,
          themeColor: issueData.themeColor ?? null,
        };
        if (targetProjectId !== this.projectId) {
          await this.issuesService.moveIssue(this.projectId, this.editingIssue.id!, targetProjectId, updatePayload);
          alert('課題を選択したプロジェクトへ移動しました。');
        } else {
          await this.issuesService.updateIssue(this.projectId, this.editingIssue.id!, updatePayload);
        }
      } else {
        await this.issuesService.createIssue(targetProjectId, issueData);
        if (targetProjectId !== this.projectId) {
          alert('別のプロジェクトに課題を作成しました。対象のプロジェクトに移動して内容を確認してください。');
        }
      }

      this.closeModal();
      await this.loadIssues();
    } catch (error) {
      console.error('課題の保存に失敗しました:', error);
       // Firestoreのバージョン衝突（楽観的ロック違反）を検出して、再読み込みを案内
       const actionLabel = this.editingIssue ? '保存' : '作成';
      if (
        error instanceof FirebaseError &&
        (error.code === 'failed-precondition' || /version/i.test(error.message))
      ) {
        alert(`データのバージョンが古いため課題を${actionLabel}できませんでした。画面を再読み込みしてから再度お試しください。`);
      } else if(error instanceof Error && error.message) {
        alert(error.message);
        alert(`課題の${actionLabel}に失敗しました`);
      }
    } finally {
      this.saving = false;
    }
  }

  /**
   * モーダルを閉じる
   */
  closeModal() {
    this.showModal = false;
    this.editingIssue = null;
    this.saving = false;
  }

  /** 課題期間（日数）を算出する（開始・終了がそろっていない場合は0） */
  private getIssueDuration(issue: Issue): number {
    const startDate = this.normalizeToDate(issue.startDate);
    const endDate = this.normalizeToDate(issue.endDate);
    if (!startDate || !endDate) {
      return 0;
    }
    const start = startDate.getTime();
    const end = endDate.getTime();
    const diff = end - start;
    return diff > 0 ? Math.round(diff / (1000 * 60 * 60 * 24)) : 0;
  }

  /** 任意の値をDate型へ正規化する（Timestamp互換にも対応） */
  private normalizeToDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'object' && 'toDate' in (value as Record<string, unknown>)) {
      const candidate = value as { toDate?: () => Date };
      if (typeof candidate.toDate === 'function') {
        return candidate.toDate();
      }
    }
    const parsed = new Date(value as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * 日付をinput用にフォーマット
   */
  private formatDateForInput(date: Date): string {
    return new Date(date).toISOString().split('T')[0];
  }

  /**
   * 課題カードで利用するテーマカラーを一元的に算出
   * 明示カラーが無ければIDから決定論的に引き当てる
   */
  getIssueThemeColorValue(issue: Issue): string {
    return resolveIssueThemeColor(issue.themeColor ?? null, issue.id ?? null);
  }

  /**
   * Firestoreからタスク数を集計し、課題カードへ反映する
   * Destroy後に反映しないようSubjectの状態を参照
   */
  private async refreshTaskSummaries(): Promise<void> {
    if (!this.projectId) {
      this.taskSummaryMap = {};
      return;
    }

    try {
      const pairs = await Promise.all(
        this.issues
          .filter((issue): issue is Issue & { id: string } => Boolean(issue.id))
          .map(async (issue) => {
            const summary = await this.tasksService.getTaskSummary(
              this.projectId,
              issue.id!,
              issue.representativeTaskId ?? null
            );
            return { issueId: issue.id!, summary };
          })
      );

      const map = pairs.reduce<Record<string, TaskSummary>>((acc, item) => {
        acc[item.issueId] = item.summary;
        return acc;
      }, {});

      if (!this.destroy$.closed) {
        this.taskSummaryMap = map;
      }
    } catch (error) {
      console.error('タスク概要の取得に失敗しました:', error);
    }
  }

  /** 指定課題のタスク数を返却（キャッシュがない場合は0） */
  getTaskCount(issueId: string): number {
    return this.taskSummaryMap[issueId]?.count ?? 0;
  }

  /** 課題カードに表示する代表タスク情報を取得（存在しない場合はnull） */
  getRepresentativeTask(issueId: string): TaskSummary['representativeTask'] {
    const summary = this.taskSummaryMap[issueId];
    if (!summary || summary.count === 0) {
      return null;
    }
    return summary.representativeTask;
  }

  /** 課題配下のすべてのタスクを取得（アーカイブ済みは除外） */
  getAllTasks(issueId: string): Task[] {
    const tasks = this.issueTasksMap[issueId] ?? [];
    const filtered = tasks.filter(task => !task.archived);
    return filtered
      .slice()
      .sort((a, b) => {
        const pinnedDiff = Number(this.isTaskPinned(b)) - Number(this.isTaskPinned(a));
        return pinnedDiff;
      });
  }

  /** 指定タスクが現在のユーザーによってピン止めされているか */
  isTaskPinned(task: Task): boolean {
    if (!this.currentUid || !task.pinnedBy) {
      return false;
    }
    return task.pinnedBy.includes(this.currentUid);
  }

  /** タスクに紐づくタグ情報を取得し、カードに表示できる形式で返却 */
  getTaskTags(task: Task): Tag[] {
    if (!task.tagIds || task.tagIds.length === 0) {
      return [];
    }

    return task.tagIds
      .map(tagId => this.tagMap[tagId])
      .filter((tag): tag is Tag => Boolean(tag)); // 情報が揃っているタグのみ表示
  }
  /** 重要度の日本語ラベルを取得 */
  getImportanceLabel(importance?: Importance | null): string {
    const key = importance ?? 'Low';
    return this.importanceLabels[key];
  }

  /** 重要度ごとのバッジクラス名を返却 */
  getImportanceClass(importance?: Importance | null): string {
    const key = (importance ?? 'Low').toLowerCase() as Lowercase<Importance>;
    return `importance-${key}`;
  }
}

import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ProjectsService } from './projects.service';
import { InviteStatus, Project, ProjectInvite, ProjectTemplate, Role, Task, Tag } from '../../models/schema';
import { IssuesService } from '../issues/issues.service';
import { FirebaseError } from '@angular/fire/app';
import { ProjectInviteService } from './project-invite.service';
import { getAvatarColor, getAvatarInitial } from '../../shared/avatar-utils';
import { UserDirectoryProfile, UserDirectoryService } from '../../core/user-directory.service';
import { ProjectTemplatesService } from './project-templates.service';
import { TasksService } from '../tasks/tasks.service';
import { TagsService } from '../tags/tags.service';
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
 * プロジェクト一覧コンポーネント
 * プロジェクトの一覧表示、作成、編集、アーカイブ機能を提供
 */
@Component({
  selector: 'app-projects-list',
  standalone: true,
  imports: [CommonModule, FormsModule, SmartFilterPanelComponent],
  templateUrl: './projects-list.component.html',
  styleUrls: ['./projects-list.component.scss']
})
export class ProjectsListComponent implements OnInit, OnDestroy {
  private projectsService = inject(ProjectsService);
  private issuesService = inject(IssuesService);
  private inviteService = inject(ProjectInviteService);
  private userDirectoryService = inject(UserDirectoryService);
  private projectTemplatesService = inject(ProjectTemplatesService);
  private tasksService = inject(TasksService);
  private tagsService = inject(TagsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy$ = new Subject<void>();

  projects: Project[] = [];
  filteredProjects: Project[] = [];
  showModal = false;
  editingProject: Project | null = null;
  saving = false;
  showArchived = false;
  currentUid: string | null = null;
  readonly maxVisibleMembers = 4;

  // スマートフィルターとタスクキャッシュ
  private projectTasksMap: Record<string, Task[]> = {};
  smartFilterVisible = false;
  smartFilterCriteria: SmartFilterCriteria = createEmptySmartFilterCriteria();
  smartFilterTagOptions: SmartFilterTagOption[] = [];
  smartFilterAssigneeOptions: SmartFilterAssigneeOption[] = [];
  readonly smartFilterStatusOptions = SMART_FILTER_STATUS_OPTIONS;
  readonly smartFilterImportanceOptions = SMART_FILTER_IMPORTANCE_OPTIONS;
  readonly smartFilterScope = 'projects';
  availableTags: Tag[] = [];
  // テンプレート関連
  templates: ProjectTemplate[] = [];
  templatesLoading = false;
  templateLoadError = '';
  selectedTemplateId: string | null = null;
  templateNotice = '';

  // 招待リンク関連
  showInviteModal = false;
  inviteProject: Project | null = null;
  inviteForm = {
    role: 'member' as Role,
    expiresInHours: 24,
  };
  inviteLinks: ProjectInvite[] = [];
  inviteLoading = false;
  inviteMessage = '';
  inviteError = '';
  generatedUrl = '';

  // 並び替え設定
  sortBy: 'name' | 'startDate' | 'endDate' | 'progress' | 'createdAt' | 'period' | 'issueCount' | 'memberCount' = 'name';
  sortOrder: 'asc' | 'desc' = 'asc';

  // フォームデータ
  projectForm = {
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    goal: ''
  };

  /** 課題数のキャッシュ（一覧表示・並び替え用） */
  private issueCountMap: Record<string, number> = {};
  private memberColorCache = new Map<string, string>();
  private memberProfiles: Record<string, UserDirectoryProfile> = {};


  ngOnInit() {
    this.loadProjects();
    this.loadTemplates();
    void this.loadTags();
    this.observeCreateQuery();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * クエリパラメータ ?create=true が付与された場合に自動でモーダルを開く。
   */
  private observeCreateQuery(): void {
    this.route.queryParamMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        if (params.get('create') === 'true') {
          this.openCreateModal();
          void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { create: null },
            queryParamsHandling: 'merge',
          });
        }
      });
  }


  /**
   * プロジェクト一覧を読み込む
   */
  async loadProjects() {
    try {
      this.currentUid = await this.projectsService.getSignedInUid();
      this.projects = await this.projectsService.listMyProjects();
      await this.loadIssueCounts();
      await this.loadMemberProfiles(this.projects);
      await this.loadProjectTasks();
      this.filterProjects();
    } catch (error) {
      console.error('プロジェクトの読み込みに失敗しました:', error);
    }
  }
  private async loadMemberProfiles(projects: Project[]): Promise<void> {
    const memberIdSet = new Set<string>();
    for (const project of projects ?? []) {
      for (const memberId of project.memberIds ?? []) {
        if (typeof memberId === 'string' && memberId.trim().length > 0) {
          memberIdSet.add(memberId);
        }
      }
    }

    if (memberIdSet.size === 0) {
      this.memberProfiles = {};
      this.updateSmartFilterAssignees();
      return;
    }

    try {
      const profiles = await this.userDirectoryService.getProfiles(Array.from(memberIdSet));
      this.memberProfiles = profiles.reduce<Record<string, UserDirectoryProfile>>((acc, profile) => {
        acc[profile.uid] = profile;
        return acc;
      }, {});
    } catch (error) {
      console.error('プロジェクトメンバーの取得に失敗しました:', error);
      this.memberProfiles = {};
    }
    this.updateSmartFilterAssignees();
  }

  getRole(project: Project): Role | null {
    if (project.currentRole) {
      return project.currentRole;
    }
    if (!this.currentUid) {
      return null;
    }
    return project.roles?.[this.currentUid] ?? null;
  }

  isAdmin(project: Project): boolean {
    return this.getRole(project) === 'admin';
  }

  canManage(project: Project): boolean {
    return this.isAdmin(project);
  }

  /**
   * プロジェクトをフィルタリング
   */
  filterProjects() {
    this.filteredProjects = this.projects.filter(project =>
      this.showArchived || !project.archived
    ).filter(project => this.isProjectMatchingSmartFilter(project));
    this.sortProjects();
  }

  /** スマートフィルターパネルの開閉 */
  toggleSmartFilterPanel(): void {
    this.smartFilterVisible = !this.smartFilterVisible;
  }

  /** スマートフィルター適用時 */
  onSmartFilterApply(criteria: SmartFilterCriteria): void {
    this.smartFilterCriteria = criteria;
    this.smartFilterVisible = false;
    this.filterProjects();
  }

  /** プロジェクトがスマートフィルター条件に合致するか判定 */
  private isProjectMatchingSmartFilter(project: Project): boolean {
    if (isSmartFilterEmpty(this.smartFilterCriteria)) {
      return true;
    }
    if (!project.id) {
      return false;
    }

    const tasks = this.projectTasksMap[project.id] ?? [];
    const relevantTasks = this.showArchived ? tasks : tasks.filter(task => !task.archived);
    const hasMatchingTask = relevantTasks.some(task => matchesSmartFilterTask(task, this.smartFilterCriteria));

    const onlyDueFilter =
      this.smartFilterCriteria.due !== '' &&
      this.smartFilterCriteria.tagIds.length === 0 &&
      this.smartFilterCriteria.assigneeIds.length === 0 &&
      this.smartFilterCriteria.importanceLevels.length === 0 &&
      this.smartFilterCriteria.statuses.length === 0;

    const dueMatchesProject = onlyDueFilter && doesDateMatchDue(project.endDate ?? null, this.smartFilterCriteria.due);

    return hasMatchingTask || dueMatchesProject;
  }

  /** スマートフィルター用に担当者一覧を生成 */
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

  /**
   * プロジェクトを並び替え
   */
  sortProjects() {
    this.filteredProjects.sort((a, b) => {
      let aValue: string | number | Date;
      let bValue: string | number | Date;

      switch (this.sortBy) {
        case 'name':
          aValue = a.name;
          bValue = b.name;
          break;
        case 'startDate':
          aValue = this.normalizeToDate(a.startDate) ?? new Date(0);
          bValue = this.normalizeToDate(b.startDate) ?? new Date(0);
          break;
        case 'endDate':
          aValue = this.normalizeToDate(a.endDate) ?? new Date(0);
          bValue = this.normalizeToDate(b.endDate) ?? new Date(0);
          break;
        case 'progress':
          aValue = a.progress || 0;
          bValue = b.progress || 0;
          break;
        case 'createdAt':
          aValue = this.normalizeToDate(a.createdAt) ?? new Date(0);
          bValue = this.normalizeToDate(b.createdAt) ?? new Date(0);
          break;
        case 'period':
          aValue = this.getProjectDuration(a);
          bValue = this.getProjectDuration(b);
          break;
        case 'issueCount':
          aValue = this.getIssueCount(a.id!);
          bValue = this.getIssueCount(b.id!);
          break;
        case 'memberCount':
          aValue = a.memberIds.length;
          bValue = b.memberIds.length;
          break;
        default:
          aValue = 0;
          bValue = 0;
      }

      if (aValue < bValue) {
        return this.sortOrder === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return this.sortOrder === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }

  /**
   * プロジェクトを選択（詳細表示）
   */
  selectProject(project: Project) {
    this.router.navigate(['/projects', project.id]);
  }

  goToDashboard(): void {
    void this.router.navigate(['/dashboard']);
  }

  getVisibleMemberIds(memberIds: string[]): string[] {
    return memberIds.slice(0, this.maxVisibleMembers);
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
   * 新規プロジェクト作成モーダルを開く
   */
  openCreateModal() {
    this.editingProject = null;
    this.projectForm = {
      name: '',
      description: '',
      startDate: '',
      endDate: '',
      goal: ''
    };
    this.selectedTemplateId = null;
    this.templateNotice = '';
    this.showModal = true;
  }

  /**
   * プロジェクト編集モーダルを開く
   */
  editProject(project: Project, event: Event) {
    event.stopPropagation();
    if (!this.isAdmin(project)) {
      alert('この操作を行う権限がありません');
      return;
    }
    this.editingProject = project;
    this.projectForm = {
      name: project.name,
      description: project.description || '',
      startDate: project.startDate ? this.formatDateForInput(project.startDate) : '',
      endDate: project.endDate ? this.formatDateForInput(project.endDate) : '',
      goal: project.goal || ''
    };
    this.selectedTemplateId = null;
    this.templateNotice = '';
    this.showModal = true;
  }

  /**
   * プロジェクトをアーカイブ
   */
  async archiveProject(project: Project, event: Event) {
    event.stopPropagation();
    if (!this.isAdmin(project)) {
      alert('この操作を行う権限がありません');
      return;
    }
    const actionLabel = project.archived ? '復元' : 'アーカイブ';
    if (confirm(`プロジェクト「${project.name}」を${actionLabel}しますか？`)) {
      try {
        await this.projectsService.archive(project.id!, !project.archived);
        await this.loadProjects();
    } catch (error) {
        console.error('アーカイブに失敗しました:', error);
        alert(`${actionLabel}に失敗しました`);
      }
    }
  }
  /**
   * プロジェクトを削除（サブコレクションもまとめて削除）
   */
  async deleteProject(project: Project, event: Event) {
    event.stopPropagation(); // カード遷移を防ぐ

    if (!this.isAdmin(project)) {
      alert('この操作を行う権限がありません');
      return;
    }

    if (!project.id) {
      return; // IDが無ければ操作不可
    }

    const confirmed = confirm(`プロジェクト「${project.name}」を完全に削除します。よろしいですか？\n関連する課題とタスクも削除されます。`);
    if (!confirmed) {
      return; // ユーザーがキャンセルした場合
    }

    try {
      await this.projectsService.deleteProject(project.id); // Firestore上のプロジェクトを削除
      await this.loadProjects(); // 最新状態へ更新
    } catch (error) {
      console.error('プロジェクトの削除に失敗しました:', error);
      alert('プロジェクトの削除に失敗しました');
    }
  }

  async loadInvites(projectId: string) {
    this.inviteLoading = true;
    this.inviteError = '';
    try {
      this.inviteLinks = await this.inviteService.listInvites(projectId);
    } catch (error) {
      console.error('招待リンクの取得に失敗しました:', error);
      this.inviteError = error instanceof Error ? error.message : '招待リンクの取得に失敗しました';
    } finally {
      this.inviteLoading = false;
    }
  }

  /**
   * プロジェクトテンプレート一覧を取得
   */
  async loadTemplates() {
    this.templatesLoading = true;
    this.templateLoadError = '';
    try {
      this.templates = await this.projectTemplatesService.listTemplates();
    } catch (error) {
      console.error('テンプレートの取得に失敗しました:', error);
      this.templateLoadError = 'テンプレートの取得に失敗しました';
    } finally {
      this.templatesLoading = false;
    }
  }

  /**
   * テンプレートを適用してフォームを初期化
   */
  applyTemplate(templateId: string) {
    if (!templateId) {
      this.selectedTemplateId = null;
      this.templateNotice = '';
      return;
    }
    this.selectedTemplateId = templateId;
    const template = this.templates.find((item) => item.id === templateId);
    if (!template) {
      this.templateNotice = '';
      return;
    }

    this.projectForm.name = template.name;
    this.projectForm.description = template.description ?? '';
    this.projectForm.goal = template.goal ?? '';
    this.projectForm.startDate = '';
    this.projectForm.endDate = '';
    this.templateNotice = 'テンプレートを適用しました。期間・担当者・ステータス・添付ファイルは空の状態で作成されます。';
  }

  /**
   * プロジェクトをテンプレートとして保存
   */
  async saveAsTemplate(project: Project, event: Event) {
    event.stopPropagation();
    if (!this.isAdmin(project)) {
      alert('この操作を行う権限がありません');
      return;
    }
    if (!project.id) {
      return;
    }

    // テンプレート名をユーザーに入力させる（初期値はプロジェクト名）
    const templateName = prompt('テンプレート名を入力してください', project.name);
    if (templateName === null) {
      // キャンセル時は何もしない
      return;
    }

    const normalizedName = templateName.trim();
    if (!normalizedName) {
      alert('テンプレート名を入力してください');
      return;
    }

    const confirmed = confirm(
      `プロジェクト「${project.name}」をテンプレート名「${normalizedName}」で保存しますか？`,
    );
    if (!confirmed) {
      return;
    }

    try {
       // 入力されたテンプレート名をサービスへ引き渡して保存
      await this.projectTemplatesService.saveFromProject(project.id, normalizedName);
      await this.loadTemplates();
      alert('テンプレートを保存しました。');
    } catch (error) {
      console.error('テンプレートの保存に失敗しました:', error);
      alert('テンプレートの保存に失敗しました');
    }
  }


  async openInviteModal(project: Project, event: Event) {
    event.stopPropagation();
    if (!project.id) return;
    if (!this.isAdmin(project)) {
      alert('招待リンクの管理権限がありません');
      return;
    }
    this.inviteProject = project;
    this.inviteForm = { role: 'member', expiresInHours: 24 };
    this.generatedUrl = '';
    this.inviteMessage = '';
    this.showInviteModal = true;
    await this.loadInvites(project.id);
  }

  async createInvite() {
    if (!this.inviteProject?.id) return;
    this.inviteLoading = true;
    this.inviteMessage = '';
    this.inviteError = '';
    try {
      const { invite, url } = await this.inviteService.createInvite(this.inviteProject.id, this.inviteForm);
      this.generatedUrl = url;
      this.inviteLinks = [invite, ...this.inviteLinks];
      this.inviteMessage = '招待リンクを発行しました。';
    } catch (error) {
      console.error('招待リンクの発行に失敗しました:', error);
      this.inviteError = error instanceof Error ? error.message : '招待リンクの発行に失敗しました';
    } finally {
      this.inviteLoading = false;
    }
  }

  async revokeInvite(invite: ProjectInvite) {
    if (invite.status !== 'active') {
      return;
    }
    if (!confirm('この招待リンクを無効にしますか？')) {
      return;
    }
    try {
      await this.inviteService.revokeInvite(invite.token);
      if (this.inviteProject?.id) {
        await this.loadInvites(this.inviteProject.id);
      }
    } catch (error) {
      console.error('招待リンクの取り消しに失敗しました:', error);
      alert(error instanceof Error ? error.message : '招待リンクの取り消しに失敗しました');
    }
  }

  copyInvite(url: string) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        this.inviteMessage = 'クリップボードにコピーしました。';
      }).catch((error) => {
        console.error('コピーに失敗しました:', error);
        this.inviteError = 'コピーに失敗しました';
      });
    } else {
      this.inviteError = 'クリップボードにコピーできませんでした';
    }
  }

  closeInviteModal() {
    this.showInviteModal = false;
    this.inviteProject = null;
    this.inviteLinks = [];
    this.generatedUrl = '';
    this.inviteMessage = '';
    this.inviteError = '';
  }

  translateRole(role: Role): string {
    switch (role) {
      case 'admin':
        return '管理者';
      case 'member':
        return 'メンバー';
      case 'guest':
        return 'ゲスト';
      default:
        return role;
    }
  }

  translateInviteStatus(status: InviteStatus): string {
    switch (status) {
      case 'active':
        return '有効';
      case 'used':
        return '使用済み';
      case 'expired':
        return '期限切れ';
      case 'revoked':
        return '取り消し済み';
      default:
        return status;
    }
  }

  buildInviteUrl(invite: ProjectInvite): string {
    return `${location.origin}/invite/${invite.token}`;
  }

  /**
   * プロジェクトを保存
   */
  async saveProject() {
    if (!this.projectForm.name.trim()) {
      alert('プロジェクト名を入力してください');
      return;
    }

    this.saving = true;
    try {
      const projectData = {
        name: this.projectForm.name.trim(),
        description: this.projectForm.description.trim() || undefined,
        startDate: this.projectForm.startDate ? new Date(this.projectForm.startDate) : undefined,
        endDate: this.projectForm.endDate ? new Date(this.projectForm.endDate) : undefined,
        goal: this.projectForm.goal.trim() || undefined
      };

      if (this.editingProject) {
        await this.projectsService.updateProject(this.editingProject.id!, {
          name: projectData.name,
          description: projectData.description ?? null,
          startDate: projectData.startDate ?? null,
          endDate: projectData.endDate ?? null,
          goal: projectData.goal ?? null,
        });
      } else {
        await this.projectsService.createProject(projectData);
      }

      this.closeModal();
      await this.loadProjects();
    } catch (error) {
      console.error('プロジェクトの保存に失敗しました:', error);
      alert(this.buildProjectSaveErrorMessage(error));
    } finally {
      this.saving = false;
    }
  }
  /**
   * Firestoreエラーを人間にわかりやすいメッセージへ変換する
   * バージョン衝突（FAILED_PRECONDITION/ABORTED）を検出して案内を表示
   */
  private buildProjectSaveErrorMessage(error: unknown): string {
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

  /**
   * モーダルを閉じる
   */
  closeModal() {
    this.showModal = false;
    this.editingProject = null;
    this.saving = false;
    this.selectedTemplateId = null;
    this.templateNotice = '';
  }

  /**
   * 日付をinput用にフォーマット
   */
  private formatDateForInput(date: Date | null | undefined): string {
    const normalized = this.normalizeToDate(date ?? null);
    return normalized ? normalized.toISOString().split('T')[0] : '';
  }

  /**
   * 課題数を取得（非同期で取得したキャッシュを参照）
   */
  getIssueCount(projectId: string): number {
    return this.issueCountMap[projectId] ?? 0;
  }

  /**
   * タスク数を取得（実装予定）
   */
  getTaskCount(projectId: string): number {
    return this.issueCountMap[projectId] ?? 0;
  }

  /** プロジェクト期間（日数）を算出する（開始・終了がそろっていない場合は0） */
  private getProjectDuration(project: Project): number {
    const startDate = this.normalizeToDate(project.startDate);
    const endDate = this.normalizeToDate(project.endDate);
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

  /** Firestoreから課題数を取得してキャッシュする */
  private async loadIssueCounts(): Promise<void> {
    const results = await Promise.all(this.projects.map(async (project) => {
      if (!project.id) {
        return { id: '', count: 0 };
      }
      const count = await this.issuesService.countIssues(project.id, this.showArchived);
      return { id: project.id, count };
    }));

    this.issueCountMap = results.reduce<Record<string, number>>((acc, item) => {
      if (item.id) {
        acc[item.id] = item.count;
      }
      return acc;
    }, {});
  }
 /** プロジェクト配下のタスクを取得し、スマートフィルター用にキャッシュ */
 private async loadProjectTasks(): Promise<void> {
  try {
    const pairs = await Promise.all(
      this.projects
        .filter((project): project is Project & { id: string } => Boolean(project.id))
        .map(async (project) => {
          const tasks = await this.tasksService.listTasksByProject(project.id!, true);
          return { projectId: project.id!, tasks };
        })
    );

    this.projectTasksMap = pairs.reduce<Record<string, Task[]>>((acc, item) => {
      acc[item.projectId] = item.tasks;
      return acc;
    }, {});
  } catch (error) {
    console.error('プロジェクトのタスク取得に失敗しました:', error);
    this.projectTasksMap = {};
  }
}

/** タグ一覧を取得してスマートフィルターに反映 */
private async loadTags(): Promise<void> {
  try {
    this.availableTags = await this.tagsService.listTags();
    this.smartFilterTagOptions = this.availableTags
      .filter((tag): tag is Tag & { id: string } => Boolean(tag.id))
      .map((tag) => ({
        id: tag.id!,
        name: tag.name,
        color: tag.color ?? null,
      }));
  } catch (error) {
    console.error('タグ一覧の取得に失敗しました:', error);
    this.availableTags = [];
    this.smartFilterTagOptions = [];
  }
}
}
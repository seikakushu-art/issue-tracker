import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { ProjectsService } from './projects.service';
import { InviteStatus, Project, ProjectInvite, Role } from '../../models/schema';
import { IssuesService } from '../issues/issues.service';
import { FirebaseError } from '@angular/fire/app';
import { ProjectInviteService } from './project-invite.service';
import { getAvatarColor, getAvatarInitial } from '../../shared/avatar-utils';

/**
 * プロジェクト一覧コンポーネント
 * プロジェクトの一覧表示、作成、編集、アーカイブ機能を提供
 */
@Component({
  selector: 'app-projects-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './projects-list.component.html',
  styleUrls: ['./projects-list.component.scss']
})
export class ProjectsListComponent implements OnInit, OnDestroy {
  private projectsService = inject(ProjectsService);
  private issuesService = inject(IssuesService);
  private inviteService = inject(ProjectInviteService);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  projects: Project[] = [];
  filteredProjects: Project[] = [];
  showModal = false;
  editingProject: Project | null = null;
  saving = false;
  showArchived = false;
  currentUid: string | null = null;
  readonly maxVisibleMembers = 4;

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


  ngOnInit() {
    this.loadProjects();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * プロジェクト一覧を読み込む
   */
  async loadProjects() {
    try {
      this.currentUid = await this.projectsService.getSignedInUid();
      this.projects = await this.projectsService.listMyProjects();
      await this.loadIssueCounts();
      this.filterProjects();
    } catch (error) {
      console.error('プロジェクトの読み込みに失敗しました:', error);
    }
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
    );
    this.sortProjects();
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
    return getAvatarInitial(memberId);
  }

  getMemberColor(memberId: string): string {
    if (!this.memberColorCache.has(memberId)) {
      this.memberColorCache.set(memberId, getAvatarColor(memberId));
    }
    return this.memberColorCache.get(memberId)!;
  }

  getMemberLabel(memberId: string, index: number): string {
    return `メンバー${index + 1} (${memberId})`;
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
}

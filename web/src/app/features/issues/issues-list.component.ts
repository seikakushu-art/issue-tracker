import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { IssuesService } from '../issues/issues.service';
import { Issue, Project,Importance,Tag, Role } from '../../models/schema';
import { ProjectsService } from '../projects/projects.service';
import { FirebaseError } from 'firebase/app';
import { TasksService, TaskSummary } from '../tasks/tasks.service';
import { TagsService } from '../tags/tags.service';
/**
 * 課題一覧コンポーネント
 * プロジェクト配下の課題一覧表示、作成、編集、アーカイブ機能を提供
 */
@Component({
  selector: 'app-issues-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './issues-list.component.html',
  styleUrls: ['./issues-list.component.scss']
})
export class IssuesListComponent implements OnInit, OnDestroy {
  private issuesService = inject(IssuesService);
  private projectsService = inject(ProjectsService);
  private tasksService = inject(TasksService);
  private tagsService = inject(TagsService);
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

  // 所属プロジェクトの選択肢を保持
  availableProjects: Project[] = [];

  // 並び替え設定
  sortBy: 'name' | 'startDate' | 'endDate' | 'progress' | 'createdAt' = 'name';
  sortOrder: 'asc' | 'desc' = 'asc';

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
  private colorPalette = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ];

  ngOnInit() {
    void this.loadAvailableProjects();
    void this.loadTags(); // タグ表示用に初回読込
    // ルートパラメータからprojectIdを取得
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.projectId = params['projectId'];
      if (this.projectId) {
        this.issueForm.projectId = this.projectId;
        this.loadIssues();
      }
    });
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
      this.filterIssues();
      await this.refreshTaskSummaries();
      void this.loadTags(); // 直近で作成されたタグも反映
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
private async loadTags(): Promise<void> {
  try {
    const tags = await this.tagsService.listTags();
    this.tagMap = tags.reduce<Record<string, Tag>>((acc, tag) => {
      if (tag.id) {
        acc[tag.id] = tag; // 代表タスク表示で名称と色を即座に取り出す
      }
      return acc;
    }, {});
  } catch (error) {
    console.error('タグの取得に失敗しました:', error);
    this.tagMap = {};
  }
  }

  /**
   * 課題をフィルタリング
   */
  filterIssues() {
    this.filteredIssues = this.issues.filter(issue => 
      this.showArchived || !issue.archived
    );
    this.sortIssues();
  }

  /**
   * 課題を並び替え
   */
  sortIssues() {
    this.filteredIssues.sort((a, b) => {
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
    if (!this.issueForm.name.trim()) {
      alert('課題名を入力してください');
      return;
    }

    this.saving = true;
    try {
      const targetProjectId = this.editingIssue ? (this.issueForm.projectId || this.projectId) : this.projectId;
      const issueData = {
        name: this.issueForm.name.trim(),
        description: this.issueForm.description.trim() || undefined,
        startDate: this.issueForm.startDate ? new Date(this.issueForm.startDate) : undefined,
        endDate: this.issueForm.endDate ? new Date(this.issueForm.endDate) : undefined,
        goal: this.issueForm.goal.trim() || undefined,
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

  /**
   * 日付をinput用にフォーマット
   */
  private formatDateForInput(date: Date): string {
    return new Date(date).toISOString().split('T')[0];
  }

  /**
   * ランダムカラーを取得
   */
  getRandomColor(issueId: string): string {
    const hash = issueId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    return this.colorPalette[Math.abs(hash) % this.colorPalette.length];
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
/**
   * 代表タスクに紐づくタグ情報を取得し、カードに表示できる形式で返却
   */
getRepresentativeTags(issueId: string): Tag[] {
  const task = this.getRepresentativeTask(issueId);
  if (!task) {
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

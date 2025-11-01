import { CommonModule,DOCUMENT } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import {
  ActionableTaskCard,
  HighlightReason,
  NotificationService,
} from '../../core/notification.service';
import { TasksService } from '../tasks/tasks.service';
import { BulletinPost, Importance } from '../../models/schema';
import {
  DashboardService,
  DashboardSnapshot,
  ProjectCardMetric,
  BottleneckInsight,
  BulletinPreviewItem,
} from './dashboard.service';
import { BoardPreviewComponent } from './components/board-preview/board-preview.component';
import { UserProfileService } from '../../core/user-profile.service';
import { BoardService } from '../board/board.service';

type ProjectSortKey = 'overdue_first' | 'progress_desc' | 'backlog_desc';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, BoardPreviewComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private readonly notificationService = inject(NotificationService);
  private readonly tasksService = inject(TasksService);
  private readonly dashboardService = inject(DashboardService);
  private readonly router = inject(Router);
  private readonly userProfileService = inject(UserProfileService);
  private readonly boardService = inject(BoardService);
  private readonly document = inject(DOCUMENT);

  /** Mathオブジェクトをテンプレートで使用するため */
  readonly Math = Math;

  /** 期間フィルター候補 */
  readonly periodFilters = ['今週', '今月', '四半期'];

  /** プロジェクトカードの並び替え候補 */
  readonly projectSortOptions: { label: string; value: ProjectSortKey }[] = [
    { label: '遅延リスク順', value: 'overdue_first' },
    { label: '進捗率順', value: 'progress_desc' },
    { label: '重要タスク多い順', value: 'backlog_desc' },
  ];

   /** 掲示板プレビュー */
   readonly bulletinPosts = signal<BulletinPreviewItem[]>([]);
   readonly bulletinLoading = signal(false);
   readonly bulletinError = signal<string | null>(null);

  /** ダッシュボード集計スナップショット */
  readonly snapshot = signal<DashboardSnapshot | null>(null);
  /** スナップショットの読み込み状態 */
  readonly snapshotLoading = signal(false);
  /** 取得エラー表示 */
  readonly snapshotError = signal<string | null>(null);
  /** プロジェクトカードのソート状態 */
  readonly selectedSort = signal<ProjectSortKey>('overdue_first');

  /** サマリーメトリクス */
  readonly summaryMetrics = computed(() => this.snapshot()?.summary ?? null);
  /** ステータス別棒グラフ（全体） */
  readonly summaryStatusBars = computed(() => {
    const summary = this.summaryMetrics();
    if (!summary) {
      return [] as { label: string; value: number }[];
    }
    return [
      { label: '未着手', value: summary.statusCounts.incomplete },
      { label: '進行中', value: summary.statusCounts.in_progress },
      { label: '保留', value: summary.statusCounts.on_hold },
      { label: '完了', value: summary.statusCounts.completed },
    ];
  });

  /** ソート済みプロジェクトカード */
  readonly sortedProjectCards = computed(() =>
    this.sortProjectCards(this.snapshot()?.projectCards ?? []),
  );
  /** ボトルネック検知結果 */
  readonly bottlenecks = computed(() => this.snapshot()?.bottlenecks ?? []);

  /** アラート対象タスク */
  readonly actionableTasks = signal<ActionableTaskCard[]>([]);
  /** アラート取得の読み込み状態 */
  readonly actionableLoading = signal(false);
  /** アラート取得のエラーメッセージ */
  readonly actionableError = signal<string | null>(null);
  /** 更新中タスクID集合 */
  private readonly updatingTaskIds = signal<Set<string>>(new Set());
   /** ログイン中ユーザーの Signal */
   readonly currentUser = this.userProfileService.user;
   /** Firestore に登録されたユーザー名 */
   readonly currentUsername = this.userProfileService.username;
   /** 表示名（未設定の場合はフォールバック） */
   readonly userDisplayName = computed(() =>
    this.currentUsername() || this.currentUser()?.displayName || 'ゲストユーザー',
   );
   /** アイコン URL（未設定の場合は null） */
   readonly userPhotoUrl = computed(() => {
    const directoryProfile = this.userProfileService.directoryProfile();
    return directoryProfile?.photoURL ?? this.currentUser()?.photoURL ?? null;
  });

  ngOnInit(): void {
    void this.refreshDashboard();
    void this.refreshActionableTasks();
    void this.loadBulletinPreview();
  }
   /** ユーザー設定画面へ遷移する */
   goToUserSettings(): void {
    void this.router.navigate(['/settings']);
  }
  /** ダッシュボードデータを再取得する */
  async refreshDashboard(): Promise<void> {
    this.snapshotLoading.set(true);
    this.snapshotError.set(null);
    try {
      const snapshot = await this.dashboardService.loadSnapshot();
      this.snapshot.set(snapshot);
    } catch (error) {
      console.error('Failed to load dashboard snapshot', error);
      this.snapshotError.set(
        'ダッシュボード情報の取得に失敗しました。リロードしてください。',
      );
    } finally {
      this.snapshotLoading.set(false);
    }
  }

   /** 掲示板プレビューを読み込む */
   async loadBulletinPreview(): Promise<void> {
    this.bulletinLoading.set(true);
    this.bulletinError.set(null);
    try {
      const posts = await this.boardService.listAccessiblePosts({ limit: 5 });
      const transformed = posts
        .filter((post): post is BulletinPostWithRequiredId => Boolean(post.id))
        .map((post) => ({
          id: post.id!,
          title: post.title,
          authorId: post.authorId,
          authorUsername: post.authorUsername,
          authorPhotoUrl: post.authorPhotoUrl ?? null,
          author: post.authorUsername,
          postedAt: post.createdAt ?? new Date(),
          excerpt: this.buildExcerpt(post.content),
          href: '/board',
          fragment: post.id!,
        } satisfies BulletinPreviewItem));
      if (transformed.length === 0) {
        this.bulletinPosts.set([]);
      } else {
        this.bulletinPosts.set(transformed);
      }
    } catch (error) {
      console.error('Failed to load bulletin preview', error);
      this.bulletinError.set('掲示板の最新投稿を読み込めませんでした。時間をおいて再度お試しください。');
      this.bulletinPosts.set([]);
    } finally {
      this.bulletinLoading.set(false);
    }
  }
  /** 重要タスクリストを再取得する */
  async refreshActionableTasks(): Promise<void> {
    this.actionableLoading.set(true);
    this.actionableError.set(null);
    try {
      const cards = await this.notificationService.getActionableTaskCards();
      this.actionableTasks.set(cards);
    } catch (error) {
      console.error('Failed to load actionable tasks', error);
      this.actionableError.set(
        'タスクリストの読み込みに失敗しました。時間をおいて再度お試しください。',
      );
    } finally {
      this.actionableLoading.set(false);
    }
  }
  scrollToDailyWork(): void {
    const anchor = this.document.getElementById('daily-work-board');
    if (anchor) {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const fallback = this.document.getElementById('daily-work-actionable');
    fallback?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  /** プロジェクトの並び替えを切り替える */
  setProjectSort(value: ProjectSortKey): void {
    this.selectedSort.set(value);
  }

  /** プロジェクトカードのドーナツ表示用 dasharray を計算 */
  getCompletionDasharray(metric: ProjectCardMetric): string {
    const completed = Math.min(Math.max(metric.donutChart.completed, 0), 100);
    const remaining = Math.max(0, 100 - completed);
    return `${completed} ${remaining}`;
  }

  /** プロジェクトカードの進捗デルタラベルを返す */
  getProgressDelta(metric: ProjectCardMetric): string | null {
    if (metric.elapsedRatio === null) {
      return null;
    }
    const delta = metric.progress / 100 - metric.elapsedRatio;
    const percentage = Math.round(delta * 100);
    if (percentage === 0) {
      return '予定どおり';
    }
    return percentage > 0 ? `+${percentage}%` : `${percentage}%`;
  }

  /** 警告レベルに応じたクラス名 */
  getWarningClass(level: ProjectCardMetric['warningLevel']): string {
    return `project-card--${level}`;
  }

  /** 全体サマリーの棒グラフ幅を算出 */
  getStatusBarWidth(value: number): string {
    const summary = this.summaryMetrics();
    const total = summary?.totalTasks ?? 0;
    if (total === 0) {
      return '0%';
    }
    return `${Math.round((value / total) * 100)}%`;
  }

  /** プロジェクト内のステータス棒グラフ幅を算出 */
  getProjectStatusWidth(metric: ProjectCardMetric, value: number): string {
    const total = metric.statusBars.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) {
      return '0%';
    }
    return `${Math.round((value / total) * 100)}%`;
  }

  /** スマートフィルター用リンクを遷移 */
  goToSmartFilter(insight: BottleneckInsight): void {
    if (insight.issueId) {
      void this.router.navigate(
        ['/projects', insight.projectId, 'issues', insight.issueId],
        {
          queryParams: {
            smartFilter: insight.type,
            taskId: insight.taskId ?? null,
          },
        },
      );
      return;
    }
    void this.router.navigate(['/projects', insight.projectId], {
      queryParams: { smartFilter: insight.type },
    });
  }

  /** プロジェクトカードからスマートフィルター画面へ遷移する */
  openProjectSmartFilter(projectId: string): void {
    void this.router.navigate(['/projects', projectId], {
      queryParams: { smartFilter: 'project_health' },
    });
  }
  /** トラック関数 */
  trackTask(_: number, card: ActionableTaskCard): string {
    return card.taskId;
  }

  /** 重要度の表示ラベル */
  getImportanceLabel(importance: Importance | null): string {
    const labels: Record<Importance, string> = {
      Critical: '最重要',
      High: '高',
      Medium: '中',
      Low: '低',
    };
    return importance ? labels[importance] : '未設定';
  }

  /** 重要度に応じたクラス名 */
  getImportanceClass(importance: Importance | null): string {
    switch (importance) {
      case 'Critical':
        return 'importance-critical';
      case 'High':
        return 'importance-high';
      case 'Medium':
        return 'importance-medium';
      case 'Low':
        return 'importance-low';
      default:
        return 'importance-unknown';
    }
  }

  /** 指定カードが更新中か判定 */
  isUpdating(card: ActionableTaskCard): boolean {
    return this.updatingTaskIds().has(card.taskId);
  }

  /** 完了ボタン押下 */
  async markCompleted(card: ActionableTaskCard): Promise<void> {
    await this.executeTaskUpdate(card, { status: 'completed', progress: 100 });
  }

  /** 保留ボタン押下 */
  async markOnHold(card: ActionableTaskCard): Promise<void> {
    await this.executeTaskUpdate(card, { status: 'on_hold' });
  }

  /** ボトルネック行のトラック関数 */
  trackBottleneck(_: number, insight: BottleneckInsight): string {
    return [insight.projectId, insight.issueId, insight.taskId, insight.type]
      .filter(Boolean)
      .join(':');
  }

  /** 掲示板投稿トラック関数 */
  trackPost(_: number, post: BulletinPreviewItem): string {
    return post.id;
  }

  /** ハイライト理由を表示順に整形 */
  getHighlightLabels(card: ActionableTaskCard): string[] {
    const priority: HighlightReason[] = [
      'overdue',
      'due_today',
      'on_hold',
      'no_progress',
      'mentioned',
    ];
    const ordered = [...card.highlightDetails].sort(
      (a, b) => priority.indexOf(a.reason) - priority.indexOf(b.reason),
    );
    return ordered.map((detail) => detail.label);
  }

  /** タスク更新処理の共通化 */
  private async executeTaskUpdate(
    card: ActionableTaskCard,
    updates: Parameters<TasksService['updateTask']>[3],
  ): Promise<void> {
    this.mutateUpdatingSet('add', card.taskId);
    try {
      await this.tasksService.updateTask(
        card.projectId,
        card.issueId,
        card.taskId,
        updates,
      );
      await this.refreshActionableTasks();
      await this.refreshDashboard();
    } catch (error) {
      console.error('Failed to update task from dashboard shortcut', error);
      this.actionableError.set(
        'タスク更新に失敗しました。権限やネットワークをご確認ください。',
      );
    } finally {
      this.mutateUpdatingSet('delete', card.taskId);
    }
  }

  /** 更新中集合のミューテーション */
  private mutateUpdatingSet(action: 'add' | 'delete', taskId: string): void {
    this.updatingTaskIds.update((current) => {
      const next = new Set(current);
      if (action === 'add') {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  }

  /** プロジェクトカード配列を現在のソート条件で並び替える */
  private sortProjectCards(cards: ProjectCardMetric[]): ProjectCardMetric[] {
    const sortKey = this.selectedSort();
    const cloned = [...cards];
    switch (sortKey) {
      case 'progress_desc':
        return cloned.sort((a, b) => b.progress - a.progress);
      case 'backlog_desc':
        return cloned.sort(
          (a, b) => b.highPriorityBacklog - a.highPriorityBacklog,
        );
      case 'overdue_first':
      default:
        return cloned.sort((a, b) => {
          if (a.overdue === b.overdue) {
            return a.progress - b.progress;
          }
          return a.overdue ? -1 : 1;
        });
    }
  }
  private buildExcerpt(content: string, maxLength = 80): string {
    const normalized = (content ?? '').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength)}…`;
  }
}

type BulletinPostWithRequiredId = BulletinPost & { id: string };

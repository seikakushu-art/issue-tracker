import { CommonModule,DOCUMENT } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import {
  ActionableTaskCard,
  DueTodayNotification,
  HighlightReason,
  NotificationService,
  StartupNotifications,
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
import { UserDirectoryProfile, UserDirectoryService } from '../../core/user-directory.service';
import { resolveIssueThemeColor } from '../../shared/issue-theme';

type ProjectSortKey = 'overdue_first' | 'progress_desc' | 'backlog_desc';
type NotificationListType = 'mention' | 'due_today' | 'overdue';

interface NotificationListItem {
  key: string;
  type: NotificationListType;
  title: string;
  description: string;
  timestamp: Date | null;
  projectId: string;
  issueId: string;
  taskId: string;
  isUnread: boolean;
  commentId?: string; // メンション通知の場合のコメントID
}

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
  private readonly userDirectoryService = inject(UserDirectoryService);

  /** Mathオブジェクトをテンプレートで使用するため */
  readonly Math = Math;

  /** プロジェクトカードの並び替え候補 */
  readonly projectSortOptions: { label: string; value: ProjectSortKey }[] = [
    { label: '遅延リスク順', value: 'overdue_first' },
    { label: '進捗率順', value: 'progress_desc' },
    { label: '重要タスク多い順', value: 'backlog_desc' },
  ];

  /** 起動時通知の読み込み状態 */
  readonly notificationsLoading = signal(false);
  /** 起動時通知のエラーメッセージ */
  readonly notificationsError = signal<string | null>(null);
  /** 起動時通知データ本体 */
  readonly startupNotifications = signal<StartupNotifications | null>(null);
  /** 担当者プロフィールキャッシュ */
  readonly assigneeProfiles = signal<Record<string, UserDirectoryProfile>>({});
  /** 既読通知のキー集合（ローカルストレージに保存） */
  private readonly readNotificationKeys = signal<Set<string>>(new Set());
  /** 重要度の優先順位（Criticalが最優先） */
  private readonly importanceRank: Record<Importance, number> = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
  } as const;

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

  /** ソート済みプロジェクトカード */
  readonly sortedProjectCards = computed(() =>
    this.sortProjectCards(this.snapshot()?.projectCards ?? []),
  );
  /** ボトルネック検知結果 */
  readonly bottlenecks = computed(() => this.snapshot()?.bottlenecks ?? []);

  /** 当日終了タスクを担当者別にまとめた配列 */
  readonly dueTodayGroups = computed(() => {
    const notifications = this.startupNotifications();
    if (!notifications) {
      return [] as { assigneeId: string | null; assigneeLabel: string; tasks: DueTodayNotification[] }[];
    }
    const profileMap = this.assigneeProfiles();

    const sorted = [...notifications.dueTodayTasks].sort((a, b) => {
      const rankA = a.importance ? this.importanceRank[a.importance] : Number.MAX_SAFE_INTEGER;
      const rankB = b.importance ? this.importanceRank[b.importance] : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      const dueA = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
      const dueB = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
      if (dueA !== dueB) {
        return dueA - dueB;
      }
      return a.title.localeCompare(b.title);
    });

    const grouped = new Map<string | null, DueTodayNotification[]>();
    for (const task of sorted) {
      const assignees = task.assigneeIds.length > 0 ? task.assigneeIds : [null];
      for (const assignee of assignees) {
        if (!grouped.has(assignee)) {
          grouped.set(assignee, []);
        }
        grouped.get(assignee)!.push(task);
      }
    }

    return Array.from(grouped.entries())
      .map(([assigneeId, tasks]) => {
        const profile = assigneeId ? profileMap[assigneeId] : undefined;
        const label = profile?.username ?? (assigneeId ?? '未担当');
        return { assigneeId, assigneeLabel: label, tasks };
      })
      .sort((a, b) => a.assigneeLabel.localeCompare(b.assigneeLabel, 'ja'));
  });

  /** メンション通知一覧 */
  readonly mentionNotifications = computed(() => this.startupNotifications()?.mentions ?? []);

  /** 当日終了タスク件数（期限超過を除く） */
  readonly dueTodayTotalCount = computed(() => {
    const notifications = this.startupNotifications();
    if (!notifications) {
      return 0;
    }
    const now = new Date();
    // 期限超過タスクを除外して、ユニークなタスク数をカウント
    const uniqueTasks = new Set<string>();
    for (const task of notifications.dueTodayTasks) {
      const isOverdue = task.dueDate ? this.notificationService.isOverdue(task.dueDate, now) : false;
      if (!isOverdue) {
        uniqueTasks.add(task.taskId);
      }
    }
    return uniqueTasks.size;
  });

  /** ヘッダーに表示する通知の要約文 */
  readonly notificationHeadline = computed(() => {
    if (this.notificationsLoading()) {
      return '通知を読み込み中です…';
    }
    if (this.notificationsError()) {
      return this.notificationsError();
    }
    const total = this.totalNotificationCount();
    if (total === 0) {
      return '新しい通知はありません。';
    }
    return ;
  });

  /** 通知上限超過の警告メッセージ */
  readonly notificationLimitWarning = computed(() => {
    const notifications = this.startupNotifications();
    if (!notifications || this.notificationsLoading()) {
      return null;
    }

    const warnings: string[] = [];
    const { dueTodayTasks, mentions, limits } = notifications;

    if (dueTodayTasks.length >= limits.dueLimit) {
      warnings.push(`本日締切タスクが上限（${limits.dueLimit}件）に達しています。一部の通知が表示されていない可能性があります。`);
    }

    if (mentions.length >= limits.mentionLimit) {
      warnings.push(`メンション通知が上限（${limits.mentionLimit}件）に達しています。一部の通知が表示されていない可能性があります。`);
    }

    return warnings.length > 0 ? warnings.join(' ') : null;
  });

  /** 期限通知のキーを生成する（期限情報を含めることで、期限変更時に新しい通知として扱う） */
  private getDueNotificationKey(taskId: string, dueDate: Date | null): string {
    if (!dueDate) {
      return `due:${taskId}`;
    }
    // 期限の日付部分（YYYY-MM-DD）を含める（東京時間ベース）
    const tokyoDateParts = this.getTokyoDateParts(dueDate);
    const dateStr = `${tokyoDateParts.year}-${String(tokyoDateParts.month + 1).padStart(2, '0')}-${String(tokyoDateParts.day).padStart(2, '0')}`;
    return `due:${taskId}:${dateStr}`;
  }

  /** 東京時間での日付部分を取得するヘルパー */
  private getTokyoDateParts(date: Date): { year: number; month: number; day: number } {
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
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

  /** 通知総件数（未読のみ） */
  readonly totalNotificationCount = computed(() => {
    const notifications = this.startupNotifications();
    if (!notifications) {
      return 0;
    }
    const readKeys = this.readNotificationKeys();
    let unreadCount = 0;

    // 本日締切タスクの未読数をカウント
    for (const task of notifications.dueTodayTasks) {
      const key = this.getDueNotificationKey(task.taskId, task.dueDate);
      if (!readKeys.has(key)) {
        unreadCount++;
      }
    }

    // メンション通知の未読数をカウント
    for (const mention of notifications.mentions) {
      const key = `mention:${mention.id}`;
      if (!readKeys.has(key)) {
        unreadCount++;
      }
    }

    return unreadCount;
  });

  /** 通知リスト（スクロール可能） */
  readonly notificationListItems = computed(() => {
    const notifications = this.startupNotifications();
    if (!notifications) {
      return [] as NotificationListItem[];
    }

    const now = new Date();
    const readKeys = this.readNotificationKeys();

    const dueTodayItems = notifications.dueTodayTasks.map((task) => {
      const isOverdue = task.dueDate ? this.notificationService.isOverdue(task.dueDate, now) : false;
      const type: NotificationListType = isOverdue ? 'overdue' : 'due_today';
      const key = this.getDueNotificationKey(task.taskId, task.dueDate);
      return {
        key,
        type,
        title: task.title,
        description: this.composeProjectLabel(task.projectName, task.issueName),
        timestamp: task.dueDate,
        projectId: task.projectId,
        issueId: task.issueId,
        taskId: task.taskId,
        isUnread: !readKeys.has(key),
      } satisfies NotificationListItem;
    });

    const mentionItems = notifications.mentions.map((mention) => {
      const key = `mention:${mention.id}`;
      return {
        key,
        type: 'mention' as const,
        title: mention.taskTitle,
        description: this.buildExcerpt(mention.commentText ?? '', 48),
        timestamp: mention.createdAt,
        projectId: mention.projectId,
        issueId: mention.issueId,
        taskId: mention.taskId,
        commentId: mention.id, // コメントIDを追加
        isUnread: !readKeys.has(key),
      } satisfies NotificationListItem;
    });

    const combined = [...mentionItems, ...dueTodayItems];
    const sorted = combined.sort((a, b) => {
      const timeA = a.timestamp?.getTime() ?? 0;
      const timeB = b.timestamp?.getTime() ?? 0;
      if (timeA === timeB) {
        return 0;
      }
      return timeB - timeA;
    });

    return sorted;
  });


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
    this.loadReadNotificationKeys();
    void this.refreshDashboard();
    void this.loadStartupNotifications();
    void this.refreshActionableTasks();
    void this.loadBulletinPreview();
  }

  /** ローカルストレージから既読通知キーを読み込む */
  private loadReadNotificationKeys(): void {
    try {
      const stored = localStorage.getItem('readNotificationKeys');
      if (stored) {
        const keys = JSON.parse(stored) as string[];
        this.readNotificationKeys.set(new Set(keys));
      }
    } catch (error) {
      console.error('Failed to load read notification keys', error);
      this.readNotificationKeys.set(new Set());
    }
  }

  /** 既読通知キーをローカルストレージに保存する */
  private saveReadNotificationKeys(): void {
    try {
      const keys = Array.from(this.readNotificationKeys());
      localStorage.setItem('readNotificationKeys', JSON.stringify(keys));
    } catch (error) {
      console.error('Failed to save read notification keys', error);
    }
  }

  /** 通知を既読にする */
  private markNotificationAsRead(key: string): void {
    this.readNotificationKeys.update((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    this.saveReadNotificationKeys();
  }

  /** すべての通知を既読にする */
  markAllNotificationsAsRead(): void {
    const notifications = this.startupNotifications();
    if (!notifications) {
      return;
    }

    const allKeys = new Set<string>();

    // 本日締切タスクのキーを追加
    for (const task of notifications.dueTodayTasks) {
      allKeys.add(this.getDueNotificationKey(task.taskId, task.dueDate));
    }

    // メンション通知のキーを追加
    for (const mention of notifications.mentions) {
      allKeys.add(`mention:${mention.id}`);
    }

    // 既読キーを更新
    this.readNotificationKeys.update((current) => {
      const next = new Set(current);
      for (const key of allKeys) {
        next.add(key);
      }
      return next;
    });

    this.saveReadNotificationKeys();
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
  /** 起動時通知を取得する */
  async loadStartupNotifications(): Promise<void> {
    this.notificationsLoading.set(true);
    this.notificationsError.set(null);
    try {
      const notifications = await this.notificationService.getStartupNotifications();
      this.startupNotifications.set(notifications);
      await this.populateAssigneeProfiles(notifications.dueTodayTasks);
    } catch (error) {
      console.error('Failed to load startup notifications', error);
      const errorMessage = error instanceof Error ? error.message : '通知の取得に失敗しました。時間をおいて再試行してください。';
      console.error('Error details:', {
        message: errorMessage,
        error: error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.notificationsError.set(errorMessage);
      this.startupNotifications.set({ dueTodayTasks: [], mentions: [], limits: { dueLimit: 100, mentionLimit: 100 } });
    } finally {
      this.notificationsLoading.set(false);
    }
  }


   /** 掲示板プレビューを読み込む */
   async loadBulletinPreview(): Promise<void> {
    this.bulletinLoading.set(true);
    this.bulletinError.set(null);
    try {
      const result = await this.boardService.listAccessiblePosts({ limit: 5 });
      const transformed = result.posts
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
      const errorMessage = error instanceof Error ? error.message : 'タスクリストの読み込みに失敗しました。時間をおいて再度お試しください。';
      console.error('Error details:', {
        message: errorMessage,
        error: error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.actionableError.set(errorMessage);
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

  /** 再読み込みボタンのローディング状態 */
  readonly reloadLoading = signal(false);

  /** 通知も含めてダッシュボード全体を再読み込み */
  async reloadDashboard(): Promise<void> {
    this.reloadLoading.set(true);
    try {
      await Promise.all([this.refreshDashboard(), this.loadStartupNotifications()]);
    } finally {
      this.reloadLoading.set(false);
    }
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
      const queryParams: Record<string, string> = {
        smartFilter: insight.type,
      };
      // taskIdがある場合はタスク詳細画面に遷移（focusパラメータを使用）
      if (insight.taskId) {
        queryParams['focus'] = insight.taskId;
      }
      void this.router.navigate(
        ['/projects', insight.projectId, 'issues', insight.issueId],
        { queryParams },
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
      Critical: '至急重要',
      High: '至急',
      Medium: '重要',
      Low: '普通',
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

  /** プロジェクトIDからプロジェクト名を取得 */
  getProjectName(projectId: string): string {
    const snapshot = this.snapshot();
    if (!snapshot) {
      return projectId;
    }
    // projectCardsから取得を試みる
    const card = snapshot.projectCards.find((c) => c.projectId === projectId);
    if (card) {
      return card.name;
    }
    // フォールバック: projectsから取得
    const project = snapshot.projects.find((p) => p.id === projectId);
    return project?.name ?? projectId;
  }

  /** 課題IDから課題名を取得 */
  getIssueName(projectId: string, issueId: string | undefined): string | null {
    if (!issueId) {
      return null;
    }
    const snapshot = this.snapshot();
    if (!snapshot) {
      return null;
    }
    const project = snapshot.projects.find((p) => p.id === projectId);
    if (!project) {
      return null;
    }
    const issue = project.issues.find((i) => i.id === issueId);
    return issue?.name ?? null;
  }

  /** タスクIDからタスク名を取得 */
  getTaskName(projectId: string, issueId: string | undefined, taskId: string | undefined): string | null {
    if (!issueId || !taskId) {
      return null;
    }
    const snapshot = this.snapshot();
    if (!snapshot) {
      return null;
    }
    const project = snapshot.projects.find((p) => p.id === projectId);
    if (!project) {
      return null;
    }
    const issue = project.issues.find((i) => i.id === issueId);
    if (!issue) {
      return null;
    }
    const task = issue.tasks.find((t) => t.id === taskId);
    return task?.title ?? null;
  }

  /** 課題IDからテーマカラーを取得 */
  getIssueThemeColor(projectId: string, issueId: string | undefined): string | null {
    if (!issueId) {
      return null;
    }
    const snapshot = this.snapshot();
    if (!snapshot) {
      return null;
    }
    const project = snapshot.projects.find((p) => p.id === projectId);
    if (!project) {
      return null;
    }
    const issue = project.issues.find((i) => i.id === issueId);
    if (!issue) {
      return null;
    }
    // テーマカラーが設定されていない場合でも、課題IDから決定論的に色を生成
    return resolveIssueThemeColor(issue.themeColor ?? null, issueId);
  }

  /** テーマカラーを背景色用に薄くした色を取得 */
  getIssueThemeColorLight(projectId: string, issueId: string | undefined): string | null {
    const themeColor = this.getIssueThemeColor(projectId, issueId);
    if (!themeColor) {
      return null; // デフォルトの白背景を使用
    }
    // テーマカラーに透明度を加えて非常に薄くする（5%の透明度）
    return this.lightenColor(themeColor, 0.05);
  }

  /** テーマカラーを左側アクセントボーダー用に取得 */
  getIssueThemeColorAccent(projectId: string, issueId: string | undefined): string {
    const themeColor = this.getIssueThemeColor(projectId, issueId);
    if (!themeColor) {
      return '#e2e8f0';
    }
    return themeColor;
  }

  /** 色を薄くする（透明度を加える） */
  private lightenColor(color: string, opacity: number): string {
    // HEXカラーの場合
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    // 既にrgba/rgbの場合はそのまま返す
    return color;
  }

  /** 色を濃くする */
  private darkenColor(color: string, factor: number): string {
    // HEXカラーの場合
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      const r = Math.max(0, Math.min(255, parseInt(hex.slice(0, 2), 16) * (1 - factor)));
      const g = Math.max(0, Math.min(255, parseInt(hex.slice(2, 4), 16) * (1 - factor)));
      const b = Math.max(0, Math.min(255, parseInt(hex.slice(4, 6), 16) * (1 - factor)));
      return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }
    // 既にrgba/rgbの場合はそのまま返す
    return color;
  }

  /** 通知アイテムのトラック関数 */
  trackNotification(_: number, item: NotificationListItem): string {
    return item.key;
  }

  /** 通知タイプに応じたタグラベルを返す */
  getNotificationTagLabel(type: NotificationListType): string {
    const labels: Record<NotificationListType, string> = {
      mention: 'メンション',
      due_today: '本日締切',
      overdue: '期限超過',
    };
    return labels[type];
  }

  /** 通知アイテムの遷移 */
  openNotification(item: NotificationListItem): void {
    // 通知を既読にする
    this.markNotificationAsRead(item.key);
    // タスク詳細へ遷移（メンション通知の場合はコメントIDも含める）
    this.goToTaskDetail({
      projectId: item.projectId,
      issueId: item.issueId,
      taskId: item.taskId,
      commentId: item.commentId,
    });
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
      await this.loadStartupNotifications();
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
            if (a.progress === b.progress) {
              // 進捗率が同じ場合は重要タスク数（多い順）で並ぶ
              return b.highPriorityBacklog - a.highPriorityBacklog;
            }
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

  private composeProjectLabel(projectName: string, issueName: string | null): string {
    return issueName ? `${projectName} / ${issueName}` : projectName;
  }
   /** 通知一覧からタスクの詳細へ遷移する */
   goToTaskDetail(task: { projectId: string; issueId: string; taskId: string; commentId?: string }): void {
    const queryParams: Record<string, string> = { focus: task.taskId };
    if (task.commentId) {
      queryParams['commentId'] = task.commentId;
    }
    void this.router.navigate(['/projects', task.projectId, 'issues', task.issueId], {
      queryParams,
    });
  }

  /** 要対応タスクカードのメンションからタスク詳細へ遷移する */
  goToTaskDetailWithComment(card: ActionableTaskCard, commentId: string): void {
    this.goToTaskDetail({
      projectId: card.projectId,
      issueId: card.issueId,
      taskId: card.taskId,
      commentId,
    });
  }

  /** 担当者IDから表示名を引き当てる */
  getAssigneeLabel(assigneeId: string | null): string {
    if (!assigneeId) {
      return '未担当';
    }
    const profile = this.assigneeProfiles()[assigneeId];
    return profile?.username ?? assigneeId;
  }

  /** 通知に含まれる担当者のプロフィールを一括で取得する */
  private async populateAssigneeProfiles(tasks: DueTodayNotification[]): Promise<void> {
    const ids = new Set<string>();
    for (const task of tasks) {
      for (const assignee of task.assigneeIds) {
        if (assignee) {
          ids.add(assignee);
        }
      }
    }
    if (ids.size === 0) {
      this.assigneeProfiles.set({});
      return;
    }
    try {
      const profiles = await this.userDirectoryService.getProfiles(Array.from(ids));
      const map: Record<string, UserDirectoryProfile> = {};
      for (const profile of profiles) {
        map[profile.uid] = profile;
      }
      this.assigneeProfiles.set(map);
    } catch (error) {
      console.error('Failed to populate assignee profiles for notifications', error);
      this.assigneeProfiles.set({});
    }
  }
}

type BulletinPostWithRequiredId = BulletinPost & { id: string };

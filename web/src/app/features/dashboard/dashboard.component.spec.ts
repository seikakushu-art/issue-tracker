import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { NotificationService, StartupNotifications, ActionableTaskCard } from '../../core/notification.service';
import { TasksService } from '../tasks/tasks.service';
import { DashboardService, DashboardSnapshot, ProjectCardMetric, BottleneckInsight } from './dashboard.service';
import { UserProfileService } from '../../core/user-profile.service';
import { BoardService } from '../board/board.service';
import { UserDirectoryService } from '../../core/user-directory.service';
import { MentionNotification } from '../../core/notification.service';
import { Importance } from '../../models/schema';

type NotificationServiceMock = jasmine.SpyObj<
  Pick<NotificationService, 'getStartupNotifications' | 'getActionableTaskCards' | 'isOverdue'>
>;

type DashboardServiceMock = jasmine.SpyObj<Pick<DashboardService, 'loadSnapshot'>>;

type BoardServiceMock = jasmine.SpyObj<Pick<BoardService, 'listAccessiblePosts'>>;

type TasksServiceMock = jasmine.SpyObj<Pick<TasksService, 'updateTask'>>;

type UserDirectoryServiceMock = jasmine.SpyObj<Pick<UserDirectoryService, 'getProfiles'>>;

class UserProfileServiceStub {
  readonly user = signal({ uid: 'stub-user', displayName: 'Stub User' } as unknown as { uid: string; displayName: string } | null);
  readonly username = signal<string | null>('stub_name');
  readonly directoryProfile = signal<{ username: string; photoURL: string | null } | null>({
    username: 'stub_name',
    photoURL: null,
  });
}

function createComponent(
  notificationService: NotificationServiceMock,
  dashboardService: DashboardServiceMock,
  boardService: BoardServiceMock,
  tasksService: TasksServiceMock,
  userDirectoryService: UserDirectoryServiceMock,
  router: Router,
): DashboardComponent {
  TestBed.configureTestingModule({
    providers: [
      { provide: NotificationService, useValue: notificationService },
      { provide: DashboardService, useValue: dashboardService },
      { provide: TasksService, useValue: tasksService },
      { provide: BoardService, useValue: boardService },
      { provide: UserProfileService, useClass: UserProfileServiceStub },
      { provide: UserDirectoryService, useValue: userDirectoryService },
      { provide: Router, useValue: router },
      { provide: PLATFORM_ID, useValue: 'server' },
    ],
  });

  return TestBed.runInInjectionContext(() => new DashboardComponent());
}

function buildProjectCard(overdue: boolean, progress: number, backlog: number): ProjectCardMetric {
  return {
    projectId: `p-${progress}-${backlog}`,
    name: `Project ${progress}`,
    progress,
    issueCount: 2,
    memberCount: 3,
    highPriorityBacklog: backlog,
    overdue,
    warningLevel: overdue ? 'danger' : 'ok',
    elapsedRatio: 0.5,
    startDate: null,
    endDate: null,
    donutChart: { completed: progress, remaining: 100 - progress },
    statusBars: [
      { label: 'Todo', value: 1 },
      { label: 'Doing', value: 1 },
    ],
  };
}

describe('DashboardComponent', () => {
  let notificationService: NotificationServiceMock;
  let dashboardService: DashboardServiceMock;
  let boardService: BoardServiceMock;
  let tasksService: TasksServiceMock;
  let userDirectoryService: UserDirectoryServiceMock;
  let router: Router;
  let component: DashboardComponent;

  beforeEach(() => {
    notificationService = jasmine.createSpyObj<NotificationServiceMock>('NotificationService', [
      'getStartupNotifications',
      'getActionableTaskCards',
      'isOverdue',
    ]);
    dashboardService = jasmine.createSpyObj<DashboardServiceMock>('DashboardService', ['loadSnapshot']);
    boardService = jasmine.createSpyObj<BoardServiceMock>('BoardService', ['listAccessiblePosts']);
    tasksService = jasmine.createSpyObj<TasksServiceMock>('TasksService', ['updateTask']);
    userDirectoryService = jasmine.createSpyObj<UserDirectoryServiceMock>('UserDirectoryService', ['getProfiles']);
    router = { navigate: jasmine.createSpy('navigate') } as unknown as Router;

    component = createComponent(
      notificationService,
      dashboardService,
      boardService,
      tasksService,
      userDirectoryService,
      router,
    );
  });

  it('ダッシュボードのスナップショットを読み込み、プロジェクトカードを整形する', async () => {
    const cards = [buildProjectCard(true, 25, 3), buildProjectCard(false, 80, 1)];
    const snapshot: DashboardSnapshot = { projects: [], projectCards: cards, bottlenecks: [] };
    dashboardService.loadSnapshot.and.resolveTo(snapshot);

    await component.refreshDashboard();

    expect(component.snapshot()).toEqual(snapshot);
    expect(component.sortedProjectCards().length).toBe(2);
    expect(component.sortedProjectCards()[0].overdue).toBeTrue();
    expect(component.getCompletionDasharray(cards[0])).toBe('25 75');
    expect(component.getProjectStatusWidth(cards[0], 1)).toBe('50%');
  });

  it('通知リストは期限超過・本日締切・メンションを区別して生成する', () => {
    const now = new Date();
    notificationService.isOverdue.and.callFake((due: Date, base: Date) => due.getTime() < base.getTime());

    const mention: MentionNotification = {
      id: 'm-1',
      projectId: 'p1',
      issueId: 'i1',
      taskId: 't1',
      taskTitle: 'コメントされたタスク',
      commentText: '確認お願いします',
      createdAt: new Date(now.getTime() - 1000),
    } as MentionNotification;
    const notifications: StartupNotifications = {
      mentions: [mention],
      dueTodayTasks: [
        {
          projectId: 'p1',
          projectName: 'Proj',
          issueId: 'i1',
          issueName: 'Issue',
          taskId: 't2',
          title: '期限切れタスク',
          dueDate: new Date(now.getTime() - 86400000),
          assigneeIds: [],
          importance: 'High' as Importance,
        },
        {
          projectId: 'p1',
          projectName: 'Proj',
          issueId: 'i1',
          issueName: 'Issue',
          taskId: 't3',
          title: '今日締切タスク',
          dueDate: new Date(now.getTime() + 3600000),
          assigneeIds: [],
          importance: 'Medium' as Importance,
        },
      ],
      limits: { dueLimit: 10, mentionLimit: 10 },
    };

    component.startupNotifications.set(notifications);

    const items = component.notificationListItems();
    const types = items.map((item) => item.type);

    expect(types).toContain('mention');
    expect(types).toContain('overdue');
    expect(types).toContain('due_today');
    expect(component.dueTodayTotalCount()).toBe(1);
  });

  it('「すべて既読にする」で全通知が既読扱いになる', () => {
    const notifications: StartupNotifications = {
      mentions: [
        {
          id: 'm-2',
          projectId: 'p1',
          issueId: 'i1',
          taskId: 't1',
          taskTitle: 'メンション',
          createdAt: new Date(),
        } as MentionNotification,
      ],
      dueTodayTasks: [
        {
          projectId: 'p1',
          projectName: 'Proj',
          issueId: 'i1',
          issueName: 'Issue',
          taskId: 't2',
          title: '締切タスク',
          dueDate: new Date(),
          assigneeIds: [],
          importance: null,
        },
      ],
      limits: { dueLimit: 10, mentionLimit: 10 },
    };
    component.startupNotifications.set(notifications);

    expect(component.totalNotificationCount()).toBe(2);

    component.markAllNotificationsAsRead();

    expect(component.totalNotificationCount()).toBe(0);
  });

  it('通知をクリックすると既読にしつつタスク詳細へ遷移する', () => {
    component.startupNotifications.set({
      mentions: [
        {
          id: 'm-open',
          projectId: 'p1',
          issueId: 'i1',
          taskId: 't1',
          taskTitle: 'タスク',
          commentText: 'コメント',
          createdAt: new Date(),
        } as MentionNotification,
      ],
      dueTodayTasks: [],
      limits: { dueLimit: 10, mentionLimit: 10 },
    });

    const item = component.notificationListItems()[0];
    component.openNotification(item);

    expect((router.navigate as jasmine.Spy).calls.mostRecent().args[0]).toEqual([
      '/projects',
      'p1',
      'issues',
      'i1',
    ]);
    expect(component.totalNotificationCount()).toBe(0);
  });

  it('ボトルネック行からスマートフィルター画面へ遷移する', () => {
    const insight = {
      type: 'zero_progress_deadline',
      label: '停滞',
      projectId: 'p-smart',
      issueId: 'iss-1',
      taskId: 'task-1',
      severity: 'warning',
    } as const;

    component.goToSmartFilter(insight);

    expect(router.navigate).toHaveBeenCalledWith(
      ['/projects', 'p-smart', 'issues', 'iss-1'],
      { queryParams: { smartFilter: 'zero_progress_deadline', focus: 'task-1', openDetail: 'true' } },
    );
  });

  it('掲示板プレビューを読み込み、最新投稿IDを返す', async () => {
    boardService.listAccessiblePosts.and.resolveTo({
      posts: [
        {
          id: 'post-1',
          title: 'お知らせ',
          authorId: 'u1',
          authorUsername: 'alice',
          projectIds: [],
          content: '本文',
          createdAt: new Date(),
        },
      ],
      hasMore: false,
    });

    await component.loadBulletinPreview();

    expect(boardService.listAccessiblePosts).toHaveBeenCalledWith({ limit: 5 });
    expect(component.bulletinPosts().length).toBe(1);
    expect(component.getLatestPostId()).toBe('post-1');
  });

  it('プロジェクトカードの並び替えが指定どおりに反映される', () => {
    const cards = [buildProjectCard(true, 30, 1), buildProjectCard(false, 80, 5), buildProjectCard(false, 60, 3)];
    component.snapshot.set({ projects: [], projectCards: cards, bottlenecks: [] });

    expect(component.sortedProjectCards()[0].overdue).toBeTrue();

    component.setProjectSort('progress_desc');
    expect(component.sortedProjectCards()[0].progress).toBe(80);

    component.setProjectSort('backlog_desc');
    expect(component.sortedProjectCards()[0].highPriorityBacklog).toBe(5);
  });

  it('プロジェクトカードをクリックするとプロジェクトのスマートフィルターへ遷移する', () => {
    component.openProjectSmartFilter('project-smart');

    expect(router.navigate).toHaveBeenCalledWith(['/projects', 'project-smart'], {
      queryParams: { smartFilter: 'project_health' },
    });
  });

  it('重要タスクカードを読み込んで表示用シグナルに格納する', async () => {
    const actionable: ActionableTaskCard[] = [
      {
        projectId: 'p1',
        projectName: 'プロジェクト1',
        issueId: 'iss1',
        taskId: 'task-1',
        title: '最重要タスク',
        importance: 'Critical',
        status: 'in_progress',
        statusLabel: '進行中',
        dueDate: null,
        highlightReasons: ['due_today'],
        highlightDetails: [{ reason: 'due_today', label: '今日締切' }],
        badge: {
          color: '',
          label: '',
          reason: null,
        },
        mentionCount: 0,
        mentions: [],
        latestMentionAt: null,
      },
    ];
    notificationService.getActionableTaskCards.and.resolveTo(actionable);

    await component.refreshActionableTasks();

    expect(notificationService.getActionableTaskCards).toHaveBeenCalled();
    expect(component.actionableTasks().length).toBe(1);
    expect(component.getImportanceLabel(component.actionableTasks()[0].importance)).toBe('至急重要');
  });

  it('重要タスクカードの「完了」「保留」操作で更新処理を実行する', async () => {
    const card = {
      projectId: 'p1',
      projectName: 'プロジェクト1',
      issueId: 'iss1',
      taskId: 'task-123',
      title: '進捗確認',
      importance: 'High' as const,
      status: 'in_progress' as const,
      statusLabel: '進行中',
      dueDate: null,
      highlightReasons: [],
      highlightDetails: [],
      badge: {
        color: '',
        label: '',
        reason: null,
      },
      mentionCount: 0,
      mentions: [],
      latestMentionAt: null,
    };
    tasksService.updateTask.and.resolveTo();
    spyOn(component, 'refreshActionableTasks').and.resolveTo();
    spyOn(component, 'refreshDashboard').and.resolveTo();
    spyOn(component, 'loadStartupNotifications').and.resolveTo();

    await component.markCompleted(card);
    expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 'iss1', 'task-123', {
      status: 'completed',
      progress: 100,
    });
    expect(component.isUpdating(card)).toBeFalse();

    await component.markOnHold(card);
    expect(tasksService.updateTask).toHaveBeenCalledWith('p1', 'iss1', 'task-123', {
      status: 'on_hold',
    });
  });

  it('重要タスクカードをクリックするとタスク詳細へ遷移する', () => {
    const card: ActionableTaskCard = {
      projectId: 'p-nav',
      projectName: 'プロジェクト',
      issueId: 'iss-nav',
      taskId: 'task-nav',
      title: 'ナビゲーション確認',
      importance: null,
      status: 'in_progress',
      statusLabel: '進行中',
      dueDate: null,
      highlightReasons: [],
      highlightDetails: [],
      badge: {
        color: '',
        label: '',
        reason: null,
      },
      mentionCount: 0,
      mentions: [],
      latestMentionAt: null,
    };

    component.goToTaskDetailWithComment(card, 'comment-1');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/projects', 'p-nav', 'issues', 'iss-nav'],
      { queryParams: { focus: 'task-nav', openDetail: 'true', commentId: 'comment-1' } },
    );
  });

  it('ボトルネックインサイトをスナップショットから参照できる', () => {
    const bottlenecks: BottleneckInsight[] = [
      {
        type: 'zero_progress_deadline',
        label: '遅延ボトルネック',
        projectId: 'p-b',
        issueId: 'iss-b',
        taskId: 'task-b',
        severity: 'danger',
      },
    ];
    component.snapshot.set({ projects: [], projectCards: [], bottlenecks });

    expect(component.bottlenecks()).toEqual(bottlenecks);
  });

  it('掲示板プレビューから掲示板画面へのリンク情報を保持する', async () => {
    boardService.listAccessiblePosts.and.resolveTo({
      posts: [
        {
          id: 'post-nav',
          title: '掲示板投稿',
          authorId: 'user1',
          authorUsername: 'bob',
          projectIds: [],
          content: '本文',
          createdAt: new Date(),
        },
      ],
      hasMore: false,
    });

    await component.loadBulletinPreview();

    expect(component.bulletinPosts()[0]).toEqual(
      jasmine.objectContaining({ href: '/board', fragment: 'post-post-nav' }),
    );
    expect(component.trackPost(0, component.bulletinPosts()[0])).toBe('post-nav');
  });

  it('再読み込みでダッシュボードと通知の両方を更新する', async () => {
    const refreshSpy = spyOn(component, 'refreshDashboard').and.resolveTo();
    const loadNotificationsSpy = spyOn(component, 'loadStartupNotifications').and.resolveTo();

    await component.reloadDashboard();

    expect(refreshSpy).toHaveBeenCalled();
    expect(loadNotificationsSpy).toHaveBeenCalled();
    expect(component.reloadLoading()).toBeFalse();
  });
});
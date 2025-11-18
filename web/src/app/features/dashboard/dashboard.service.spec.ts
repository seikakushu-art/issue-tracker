import { TestBed } from '@angular/core/testing';
import { DashboardService } from './dashboard.service';
import { ProjectsService } from '../projects/projects.service';
import { IssuesService } from '../issues/issues.service';
import { TasksService } from '../tasks/tasks.service';
import { UserProfileService } from '../../core/user-profile.service';
import { Issue, Project, Task } from '../../models/schema';

class ProjectsServiceStub {
  listMyProjects = jasmine.createSpy('listMyProjects');
}

class IssuesServiceStub {
  listIssues = jasmine.createSpy('listIssues');
}

class TasksServiceStub {
  listTasks = jasmine.createSpy('listTasks');
}

class UserProfileServiceStub {
  user = jasmine.createSpy('user');
}

describe('DashboardService', () => {
  let service: DashboardService;
  let projectsService: ProjectsServiceStub;
  let issuesService: IssuesServiceStub;
  let tasksService: TasksServiceStub;
  let userProfileService: UserProfileServiceStub;

  beforeEach(() => {
    projectsService = new ProjectsServiceStub();
    issuesService = new IssuesServiceStub();
    tasksService = new TasksServiceStub();
    userProfileService = new UserProfileServiceStub();

    TestBed.configureTestingModule({
      providers: [
        DashboardService,
        { provide: ProjectsService, useValue: projectsService },
        { provide: IssuesService, useValue: issuesService },
        { provide: TasksService, useValue: tasksService },
        { provide: UserProfileService, useValue: userProfileService },
      ],
    });

    service = TestBed.inject(DashboardService);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('loadSnapshot: プロジェクトと課題の情報を組み立て、ボトルネックを検知できる', async () => {
    const now = new Date('2024-01-10T00:00:00Z');
    jasmine.clock().install();
    jasmine.clock().mockDate(now);

    const project: Project = {
      id: 'p1',
      name: 'ダッシュボード用プロジェクト',
      archived: false,
      memberIds: ['user-123', 'user-999'],
      roles: { 'user-123': 'member', 'user-999': 'member' },
      startDate: new Date('2024-01-01T00:00:00Z'),
      endDate: new Date('2024-01-05T00:00:00Z'),
    } as Project;

    const issue: Issue = {
      id: 'i1',
      projectId: 'p1',
      name: 'UI改善',
      archived: false,
      createdAt: new Date('2023-12-15T00:00:00Z'),
    } as Issue;

    const tasks: Task[] = [
      {
        id: 't1',
        projectId: 'p1',
        issueId: 'i1',
        title: '期限間近のタスク',
        status: 'in_progress',
        progress: 0,
        endDate: new Date('2024-01-12T00:00:00Z'),
        importance: 'High',
        archived: false,
        assigneeIds: ['user-123'],
        tagIds: [],
        checklist: [],
        createdBy: 'user-123',
        createdAt: new Date('2023-12-20T00:00:00Z'),
      },
      {
        id: 't2',
        projectId: 'p1',
        issueId: 'i1',
        title: '保留タスク',
        status: 'on_hold',
        progress: 10,
        endDate: null,
        importance: 'Medium',
        archived: false,
        assigneeIds: ['user-123'],
        tagIds: [],
        checklist: [],
        createdBy: 'user-123',
        createdAt: new Date('2023-12-28T00:00:00Z'),
      },
      {
        id: 't3',
        projectId: 'p1',
        issueId: 'i1',
        title: '未割当の重要タスク',
        status: 'incomplete',
        endDate: null,
        importance: 'Critical',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'user-999',
        createdAt: new Date('2023-12-30T00:00:00Z'),
      },
    ];

    projectsService.listMyProjects.and.resolveTo([
      project,
      { ...project, id: 'archived', archived: true },
    ] as Project[]);
    issuesService.listIssues.and.callFake(async (projectId: string) => {
      return projectId === 'p1' ? [issue] : [];
    });
    tasksService.listTasks.and.callFake(async (projectId: string, issueId: string) => {
      return projectId === 'p1' && issueId === 'i1' ? tasks : [];
    });
    userProfileService.user.and.returnValue({ uid: 'user-123' });

    const snapshot = await service.loadSnapshot();

    expect(projectsService.listMyProjects).toHaveBeenCalled();
    expect(issuesService.listIssues).toHaveBeenCalledWith('p1', false);
    expect(tasksService.listTasks).toHaveBeenCalledWith('p1', 'i1', false);

    expect(snapshot.projects.length).toBe(1);
    expect(snapshot.projects[0].issues[0].tasks.length).toBe(3);
    expect(snapshot.projects[0].currentRole).toBe('guest');

    const card = snapshot.projectCards[0];
    expect(card.projectId).toBe('p1');
    expect(card.progress).toBeCloseTo(3.33, 1);
    // t1 (High, in_progress) と t3 (Critical, incomplete) の2件がカウントされる
    expect(card.highPriorityBacklog).toBe(2);
    expect(card.overdue).toBeTrue();
    expect(card.warningLevel).toBe('danger');
    expect(card.statusBars).toEqual([
      { label: '未着手', value: 1 },
      { label: '進行中', value: 1 },
      { label: '保留', value: 1 },
      { label: '完了', value: 0 },
    ]);

    const bottleneckTypes = snapshot.bottlenecks.map((item) => item.type);
    expect(bottleneckTypes).toContain('zero_progress_deadline');
    expect(bottleneckTypes).toContain('long_on_hold');
    expect(bottleneckTypes).toContain('critical_unassigned');
    expect(bottleneckTypes).toContain('stalled_issue');
  });

  it('loadSnapshot: ユーザー情報が未取得の場合はボトルネックを返さない', async () => {
    const now = new Date('2024-02-01T00:00:00Z');
    jasmine.clock().install();
    jasmine.clock().mockDate(now);

    const project: Project = {
      id: 'p2',
      name: 'ユーザー未取得プロジェクト',
      archived: false,
      memberIds: ['user-abc'],
      roles: { 'user-abc': 'member' },
    } as Project;

    const issue: Issue = {
      id: 'issue-1',
      projectId: 'p2',
      name: '未取得ユーザーの課題',
      archived: false,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    } as Issue;

    const tasks: Task[] = [
      {
        id: 'task-1',
        projectId: 'p2',
        issueId: 'issue-1',
        title: '重要タスク',
        status: 'in_progress',
        progress: 0,
        endDate: new Date('2024-02-03T00:00:00Z'),
        importance: 'High',
        archived: false,
        assigneeIds: ['user-abc'],
        tagIds: [],
        checklist: [],
        createdBy: 'user-abc',
        createdAt: new Date('2024-01-15T00:00:00Z'),
      },
    ];

    projectsService.listMyProjects.and.resolveTo([project] as Project[]);
    issuesService.listIssues.and.resolveTo([issue]);
    tasksService.listTasks.and.resolveTo(tasks);
    userProfileService.user.and.returnValue(null);

    const snapshot = await service.loadSnapshot();

    expect(snapshot.bottlenecks).toEqual([]);
    expect(snapshot.projectCards[0].warningLevel).toBe('ok');
  });

  it('loadSnapshot: プロジェクトに進捗が指定されている場合はその値を利用し、タスクが無くても棒グラフは0件で構成される', async () => {
    const now = new Date('2024-03-10T09:00:00Z');
    jasmine.clock().install();
    jasmine.clock().mockDate(now);

    const project: Project = {
      id: 'p3',
      name: '進捗指定プロジェクト',
      progress: 80,
      archived: false,
      memberIds: ['member-1', 'member-2'],
      roles: { 'member-1': 'admin', 'member-2': 'member' },
      startDate: new Date('2024-03-01T00:00:00Z'),
      endDate: new Date('2024-04-01T00:00:00Z'),
    };

    projectsService.listMyProjects.and.resolveTo([project] as Project[]);
    issuesService.listIssues.and.resolveTo([]);
    userProfileService.user.and.returnValue({ uid: 'member-1' });

    const snapshot = await service.loadSnapshot();

    expect(snapshot.projects[0].issues).toEqual([]);
    expect(snapshot.projectCards[0].progress).toBe(80);
    expect(snapshot.projectCards[0].statusBars).toEqual([
      { label: '未着手', value: 0 },
      { label: '進行中', value: 0 },
      { label: '保留', value: 0 },
      { label: '完了', value: 0 },
    ]);
    expect(tasksService.listTasks).not.toHaveBeenCalled();
    expect(snapshot.bottlenecks).toEqual([]);
  });

  it('getBulletinPlaceholder: 3件のプレースホルダーが返される', () => {
    const now = new Date('2024-05-15T09:00:00Z');
    jasmine.clock().install();
    jasmine.clock().mockDate(now);

    const items = service.getBulletinPlaceholder();

    expect(items.length).toBe(3);
    expect(items[0]).toEqual(jasmine.objectContaining({
      id: 'draft-release-note',
      title: 'バージョン2.1 リリース準備メモ',
      fragment: null,
    }));
    expect(items[1].postedAt.getTime()).toBeLessThan(now.getTime());
  });
});
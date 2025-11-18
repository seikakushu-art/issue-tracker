import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { ProgressTreeComponent } from './progress-tree.component';
import { ProjectsService } from '../projects/projects.service';
import { IssuesService } from '../issues/issues.service';
import { TasksService } from '../tasks/tasks.service';
import { UserDirectoryService } from '../../core/user-directory.service';
import { Issue, Project, Task } from '../../models/schema';

describe('ProgressTreeComponent', () => {
  let component: ProgressTreeComponent;
  let projectsService: jasmine.SpyObj<Pick<ProjectsService, 'listMyProjects'>>;
  let issuesService: jasmine.SpyObj<Pick<IssuesService, 'listIssues'>>;
  let tasksService: jasmine.SpyObj<Pick<TasksService, 'listTasksByProject'>>;
  let userDirectoryService: jasmine.SpyObj<Pick<UserDirectoryService, 'getProfiles'>>;
  let router: jasmine.SpyObj<Pick<Router, 'navigate'>>;

  const baseProject: Project = {
    id: 'project-1',
    name: 'プロジェクトA',
    archived: false,
    roles: {},
    memberIds: [],
  };

  const baseIssue: Issue = {
    id: 'issue-1',
    projectId: 'project-1',
    name: '課題A',
    archived: false,
  };

  const createTask = (
    overrides: Partial<Task> & { dependencies?: string[]; dependents?: string[] } = {},
  ): Task & { dependencies?: string[]; dependents?: string[] } => ({
    id: 'task-1',
    projectId: 'project-1',
    issueId: 'issue-1',
    title: 'タスクA',
    status: 'incomplete',
    archived: false,
    assigneeIds: [],
    tagIds: [],
    checklist: [],
    createdBy: 'creator-1',
    ...overrides,
  });

  beforeEach(() => {
    projectsService = jasmine.createSpyObj('ProjectsService', ['listMyProjects']);
    issuesService = jasmine.createSpyObj('IssuesService', ['listIssues']);
    tasksService = jasmine.createSpyObj('TasksService', ['listTasksByProject']);
    userDirectoryService = jasmine.createSpyObj('UserDirectoryService', ['getProfiles']);
    router = jasmine.createSpyObj('Router', ['navigate']);

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        { provide: IssuesService, useValue: issuesService },
        { provide: TasksService, useValue: tasksService },
        { provide: UserDirectoryService, useValue: userDirectoryService },
        { provide: Router, useValue: router },
        { provide: ChangeDetectorRef, useValue: { markForCheck: jasmine.createSpy('markForCheck') } },
      ],
    });

    router.navigate.and.resolveTo(true);
    component = TestBed.runInInjectionContext(() => new ProgressTreeComponent());
  });

  it('プロジェクトから課題・タスクまで階層化したツリーを構築する', async () => {
    const tasks: Task[] = [
      createTask({ id: 'task-1', title: '企画', assigneeIds: ['user-1'] }),
      createTask({
        id: 'task-2',
        title: '設計',
        status: 'in_progress',
        dependencies: ['task-1'],
      }),
    ];

    projectsService.listMyProjects.and.resolveTo([baseProject]);
    issuesService.listIssues.and.callFake(async (projectId) => (projectId === 'project-1' ? [baseIssue] : []));
    tasksService.listTasksByProject.and.callFake(async (projectId) => (projectId === 'project-1' ? tasks : []));
    userDirectoryService.getProfiles.and.resolveTo([
      { uid: 'user-1', username: 'taro', photoURL: null },
    ]);

    await component.loadData();

    expect(component.treeProjects.length).toBe(1);
    const project = component.treeProjects[0];
    expect(project.collapsed).toBeFalse();
    expect(project.project.name).toBe('プロジェクトA');

    expect(project.issues.length).toBe(1);
    const issue = project.issues[0];
    expect(issue.collapsed).toBeFalse();
    expect(issue.issue.name).toBe('課題A');

    expect(issue.tasks.length).toBe(2);
    expect(issue.tasks[0].task.title).toBe('企画');
    expect(issue.tasks[1].dependencies[0].label).toBe('プロジェクトA / 課題A / 企画');
    expect(component.assigneeProfiles['user-1']).toEqual({ uid: 'user-1', username: 'taro', photoURL: null });
  });

  it('プロジェクト・課題ノードの展開/折りたたみを切り替えられる', async () => {
    projectsService.listMyProjects.and.resolveTo([baseProject]);
    issuesService.listIssues.and.resolveTo([baseIssue]);
    tasksService.listTasksByProject.and.resolveTo([createTask({})]);
    userDirectoryService.getProfiles.and.resolveTo([]);

    await component.loadData();
    const [project] = component.treeProjects;
    const [issue] = project.issues;

    component.toggleProject(project);
    expect(project.collapsed).toBeTrue();
    component.toggleProject(project);
    expect(project.collapsed).toBeFalse();

    component.toggleIssue(issue);
    expect(issue.collapsed).toBeTrue();
    component.toggleIssue(issue);
    expect(issue.collapsed).toBeFalse();
  });

  it('タスク選択後に詳細画面へ遷移する', async () => {
    const task = createTask({ id: 'task-detail', title: '詳細確認' });
    projectsService.listMyProjects.and.resolveTo([baseProject]);
    issuesService.listIssues.and.resolveTo([baseIssue]);
    tasksService.listTasksByProject.and.resolveTo([task]);
    userDirectoryService.getProfiles.and.resolveTo([]);

    await component.loadData();
    const [project] = component.treeProjects;
    const [issue] = project.issues;
    const [treeTask] = issue.tasks;

    component.selectTask(project, issue, treeTask);
    component.goToTaskDetail();

    expect(router.navigate).toHaveBeenCalledWith(
      ['/projects', 'project-1', 'issues', 'issue-1'],
      { queryParams: { focus: 'task-detail' } },
    );
  });

  it('ID が欠けているノードを選択しても遷移処理は実行されない', async () => {
    const task = createTask({ id: '', title: 'IDなしタスク' });
    projectsService.listMyProjects.and.resolveTo([baseProject]);
    issuesService.listIssues.and.resolveTo([baseIssue]);
    tasksService.listTasksByProject.and.resolveTo([task]);
    userDirectoryService.getProfiles.and.resolveTo([]);

    await component.loadData();
    const [project] = component.treeProjects;
    const [issue] = project.issues;
    const [treeTask] = issue.tasks;

    component.selectTask(project, issue, treeTask);
    component.goToTaskDetail();

    expect(component.selectedTask).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('全体を開閉するとすべてのノード状態が連動して変わる', async () => {
    const secondProject: Project = { id: 'project-2', name: 'プロジェクトB', archived: false, roles: {}, memberIds: [] };
    const secondIssue: Issue = { id: 'issue-2', projectId: 'project-2', name: '課題B', archived: false };

    projectsService.listMyProjects.and.resolveTo([baseProject, secondProject]);
    issuesService.listIssues.and.callFake(async (projectId) => {
      if (projectId === 'project-1') {
        return [baseIssue];
      }
      if (projectId === 'project-2') {
        return [secondIssue];
      }
      return [];
    });
    tasksService.listTasksByProject.and.callFake(async (projectId) => [
      createTask({ id: `task-${projectId}`, projectId }),
    ]);
    userDirectoryService.getProfiles.and.resolveTo([]);

    await component.loadData();

    component.treeProjects.forEach((project) => {
      component.toggleProject(project);
      project.issues.forEach((issue) => component.toggleIssue(issue));
    });

    component.treeProjects.forEach((project) => {
      expect(project.collapsed).toBeTrue();
      project.issues.forEach((issue) => expect(issue.collapsed).toBeTrue());
    });

    component.treeProjects.forEach((project) => {
      component.toggleProject(project);
      project.issues.forEach((issue) => component.toggleIssue(issue));
    });

    component.treeProjects.forEach((project) => {
      expect(project.collapsed).toBeFalse();
      project.issues.forEach((issue) => expect(issue.collapsed).toBeFalse());
    });
  });
});


import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { GlobalSearchComponent } from './global-search.component';
import { BoardService } from '../board/board.service';
import { IssuesService } from '../issues/issues.service';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { BulletinPost, Issue, Project, Task } from '../../models/schema';

describe('GlobalSearchComponent', () => {
  let component: GlobalSearchComponent;
  let projectsService: jasmine.SpyObj<Pick<ProjectsService, 'listMyProjects'>>;
  let issuesService: jasmine.SpyObj<Pick<IssuesService, 'listIssues'>>;
  let tasksService: jasmine.SpyObj<Pick<TasksService, 'listTasksByProject'>>;
  let boardService: jasmine.SpyObj<Pick<BoardService, 'listAccessiblePosts'>>;
  let navigateSpy: jasmine.Spy;

  const activeProject: Project & { id: string } = {
    id: 'p-active',
    name: '開発プロジェクト',
    description: '開発用プロジェクト',
    goal: '品質向上',
    archived: false,
    roles: {},
    memberIds: [],
  };

  const archivedProject: Project & { id: string } = {
    ...activeProject,
    id: 'p-archived',
    name: '旧プロジェクト',
    archived: true,
  };

  const createIssue = (overrides: Partial<Issue> = {}): Issue & { id: string } => ({
    id: 'i-1',
    projectId: activeProject.id,
    name: '課題の調査',
    description: '原因調査',
    archived: false,
    ...overrides,
  });

  const createTask = (overrides: Partial<Task> = {}): Task & { id: string } => ({
    id: 't-1',
    projectId: activeProject.id,
    issueId: 'i-1',
    title: 'タスク作業',
    description: '詳細調査',
    status: 'incomplete',
    archived: false,
    assigneeIds: [],
    tagIds: [],
    checklist: [],
    createdBy: 'tester',
    ...overrides,
  });

  const createPost = (overrides: Partial<BulletinPost> = {}): BulletinPost & { id: string } => ({
    id: 'b-1',
    title: '掲示板トピック',
    content: '共有内容',
    projectIds: [activeProject.id],
    authorId: 'author',
    authorUsername: 'author',
    ...overrides,
  });

  const setupSuccessfulLoad = (): void => {
    projectsService.listMyProjects.and.resolveTo([activeProject, archivedProject]);
    issuesService.listIssues.and.callFake(async (_projectId: string, includeArchived?: boolean) => [
      createIssue({ id: includeArchived ? 'i-archived' : 'i-1', archived: Boolean(includeArchived) }),
    ]);
    tasksService.listTasksByProject.and.callFake(async (_projectId: string, includeArchived?: boolean) => [
      createTask({ id: includeArchived ? 't-archived' : 't-1', archived: Boolean(includeArchived) }),
    ]);
    boardService.listAccessiblePosts.and.resolveTo({ posts: [createPost()], hasMore: false });
  };

  beforeEach(() => {
    projectsService = jasmine.createSpyObj('ProjectsService', ['listMyProjects']);
    issuesService = jasmine.createSpyObj('IssuesService', ['listIssues']);
    tasksService = jasmine.createSpyObj('TasksService', ['listTasksByProject']);
    boardService = jasmine.createSpyObj('BoardService', ['listAccessiblePosts']);
    navigateSpy = jasmine.createSpy('navigate').and.resolveTo(true);

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        { provide: IssuesService, useValue: issuesService },
        { provide: TasksService, useValue: tasksService },
        { provide: BoardService, useValue: boardService },
        { provide: Router, useValue: { navigate: navigateSpy } },
        {
          provide: DomSanitizer,
          useValue: { bypassSecurityTrustHtml: (value: string) => value },
        },
      ],
    });

    component = TestBed.runInInjectionContext(() => new GlobalSearchComponent());
  });

  it('検索キーワード入力後に横断検索の結果を生成する', async () => {
    setupSuccessfulLoad();

    await component.loadAllData();
    component.onQueryChange('調査');

    const results = component.filteredResults();
    expect(results.map((item) => item.type)).toContain('project');
    expect(results.map((item) => item.type)).toContain('issue');
    expect(results.map((item) => item.type)).toContain('task');
    expect(results.map((item) => item.type)).toContain('board');
    expect(component.totalCount()).toBe(4);
  });

  it('タイプ別フィルターで検索結果を絞り込む', async () => {
    setupSuccessfulLoad();

    await component.loadAllData();
    component.onQueryChange('課題');
    component.onTypeFilterChange('project', false);
    component.onTypeFilterChange('issue', true);

    const results = component.filteredResults();
    expect(results.every((item) => item.type !== 'project')).toBeTrue();
    expect(component.countsByType().project).toBe(0);
    expect(component.countsByType().issue).toBe(1);
  });

  it('アーカイブ済みを含む設定で除外されていたデータも検索対象にする', async () => {
    setupSuccessfulLoad();

    await component.loadAllData();
    expect(component.filteredResults().some((item) => item.id === 'p-archived')).toBeFalse();
    expect(issuesService.listIssues).toHaveBeenCalledWith(activeProject.id, false);
    expect(tasksService.listTasksByProject).toHaveBeenCalledWith(activeProject.id, false);

    await component.onIncludeArchivedChange(true);

    expect(projectsService.listMyProjects).toHaveBeenCalledTimes(2);
    expect(issuesService.listIssues).toHaveBeenCalledWith(activeProject.id, true);
    expect(tasksService.listTasksByProject).toHaveBeenCalledWith(activeProject.id, true);
    expect(component.filteredResults().some((item) => item.id === 'p-archived')).toBeTrue();
  });

  it('検索結果をクリックすると詳細画面へ遷移する', async () => {
    setupSuccessfulLoad();
    await component.loadAllData();

    const event = { preventDefault: jasmine.createSpy('preventDefault') } as unknown as Event;
    const projectItem = component.filteredResults().find((item) => item.type === 'project');
    expect(projectItem).toBeTruthy();

    component.onResultClick(projectItem!, event);

    expect(navigateSpy).toHaveBeenCalledWith(['/projects', activeProject.id], { fragment: undefined });
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('掲示板の検索結果をクリックすると該当箇所へスクロールする', fakeAsync(() => {
    setupSuccessfulLoad();

    TestBed.runInInjectionContext(() => component.loadAllData());
    flushMicrotasks();

    const event = { preventDefault: jasmine.createSpy('preventDefault') } as unknown as Event;
    const boardItem = component.filteredResults().find((item) => item.type === 'board');
    expect(boardItem).toBeTruthy();

    const scrollElement = { scrollIntoView: jasmine.createSpy('scrollIntoView') } as unknown as HTMLElement;
    spyOn(document, 'getElementById').and.returnValue(scrollElement);

    component.onResultClick(boardItem!, event);
    flushMicrotasks();
    tick(300);

    expect(navigateSpy).toHaveBeenCalledWith(['/board'], { fragment: 'post-b-1' });
    expect(document.getElementById).toHaveBeenCalledWith('post-b-1');
    expect(scrollElement.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(event.preventDefault).toHaveBeenCalled();
  }));

  it('総件数とタイプ別件数を計算して表示用に保持する', async () => {
    setupSuccessfulLoad();

    await component.loadAllData();
    component.onQueryChange('');

    expect(component.totalCount()).toBe(4);
    expect(component.countsByType()).toEqual({
      project: 1,
      issue: 1,
      task: 1,
      board: 1,
    });
  });
});
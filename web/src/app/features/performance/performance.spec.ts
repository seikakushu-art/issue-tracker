import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { createEmptySmartFilterCriteria } from '../../shared/smart-filter/smart-filter.model';
import { ProjectsListComponent } from '../projects/projects-list.component';
import { IssuesListComponent } from '../issues/issues-list.component';
import { TasksListComponent } from '../tasks/tasks-list.component';
import { ProjectsService } from '../projects/projects.service';
import { IssuesService } from '../issues/issues.service';
import { TasksService } from '../tasks/tasks.service';
import { TagsService } from '../tags/tags.service';
import { ProjectInviteService } from '../projects/project-invite.service';
import { ProjectTemplatesService } from '../projects/project-templates.service';
import { UserDirectoryService } from '../../core/user-directory.service';
import { Router, ActivatedRoute } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Project, Issue, Task, Comment } from '../../models/schema';

class ProjectsServiceStub { togglePin = jasmine.createSpy('togglePin'); }
class IssuesServiceStub { listIssues = jasmine.createSpy('listIssues'); }
class TasksServiceStub {
  calculateProgressFromChecklist = jasmine.createSpy('calculateProgressFromChecklist').and.returnValue(0);
  listComments = jasmine.createSpy('listComments');
}
class TagsServiceStub {}
class ProjectInviteServiceStub {}
class ProjectTemplatesServiceStub {}
class UserDirectoryServiceStub {}

const activatedRouteStub = {
  params: of({}),
  queryParams: of({}),
  data: of({}),
  fragment: of(null),
  url: of([]),
  snapshot: {
    queryParamMap: {
      get: () => null,
    },
  },
};

const routerStub = {
  navigate: jasmine.createSpy('navigate'),
  root: {
    snapshot: {},
    routeConfig: null,
    firstChild: null,
    children: [],
    pathFromRoot: [],
    paramMap: new Map(),
    queryParamMap: new Map(),
  },
  url: '/',
  events: of({}),
};

function createProject(index: number): Project {
  return {
    id: `p-${index}`,
    name: `プロジェクト${index.toString().padStart(2, '0')}`,
    archived: false,
    pinnedBy: index % 10 === 0 ? ['user-1'] : [],
    memberIds: ['user-1'],
    endDate: new Date(Date.now() + index * 86400000),
  } as Project;
}

function createIssue(index: number): Issue {
  return {
    id: `i-${index}`,
    projectId: 'p-1',
    name: `課題${index}`,
    archived: false,
    pinnedBy: index % 15 === 0 ? ['user-1'] : [],
    importance: 'Medium',
  } as Issue;
}

function createTask(index: number): Task {
  return {
    id: `t-${index}`,
    projectId: 'p-1',
    issueId: 'i-1',
    title: `タスク${index}`,
    status: index % 2 === 0 ? 'incomplete' : 'in_progress',
    archived: false,
    assigneeIds: ['user-1'],
    tagIds: [],
    checklist: [],
    createdBy: 'user-1',
  } as Task;
}

function createComment(index: number): Comment {
  return {
    id: `c-${index}`,
    createdAt: new Date(Date.now() - index * 1000),
    createdBy: `commenter-${index % 5}`,
    text: `コメント${index}`,
    mentions: [],
  } as Comment;
}

describe('15. パフォーマンステスト', () => {
  let tasksServiceStub: TasksServiceStub;

  beforeEach(() => {
    tasksServiceStub = new TasksServiceStub();

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectsService, useClass: ProjectsServiceStub },
        { provide: IssuesService, useClass: IssuesServiceStub },
        { provide: TasksService, useValue: tasksServiceStub },
        { provide: TagsService, useClass: TagsServiceStub },
        { provide: ProjectInviteService, useClass: ProjectInviteServiceStub },
        { provide: ProjectTemplatesService, useClass: ProjectTemplatesServiceStub },
        { provide: UserDirectoryService, useClass: UserDirectoryServiceStub },
        { provide: Auth, useValue: {} },
        { provide: ActivatedRoute, useValue: activatedRouteStub },
        { provide: Router, useValue: routerStub },
      ],
    });
  });

  describe('15.1 大量データ', () => {
    it('プロジェクトが30件の場合の表示速度', () => {
      const component = TestBed.runInInjectionContext(() => new ProjectsListComponent());
      (component as unknown as { saveSortPreferences: () => void }).saveSortPreferences = () => undefined;
      component.currentUid = 'user-1';
      component.projects = Array.from({ length: 30 }, (_, i) => createProject(i));
      component.smartFilterCriteria = createEmptySmartFilterCriteria();
      component.showArchived = true;

      const start = performance.now();
      component.filterProjects();
      const duration = performance.now() - start;

      expect(component.filteredProjects.length).toBe(30);
      expect(duration).toBeLessThan(120);
    });

    it('課題が100件以上ある場合の表示速度', () => {
      const component = TestBed.runInInjectionContext(() => new IssuesListComponent());
      (component as unknown as { saveSortPreferences: () => void }).saveSortPreferences = () => undefined;
      (component as unknown as { loadSmartFilterOptions: () => void }).loadSmartFilterOptions = () => undefined;
      component.currentUid = 'user-1';
      component.issues = Array.from({ length: 120 }, (_, i) => createIssue(i));
      component.smartFilterCriteria = createEmptySmartFilterCriteria();
      component.showArchived = true;
      (component as unknown as { issueTasksMap: Record<string, Task[]> }).issueTasksMap = {};

      const start = performance.now();
      component.filterIssues();
      const duration = performance.now() - start;

      expect(component.filteredIssues.length).toBe(120);
      expect(duration).toBeLessThan(150);
    });

    it('課題が100件以上かつタスク紐付きの場合の表示速度', () => {
      const component = TestBed.runInInjectionContext(() => new IssuesListComponent());
      (component as unknown as { saveSortPreferences: () => void }).saveSortPreferences = () => undefined;
      (component as unknown as { loadSmartFilterOptions: () => void }).loadSmartFilterOptions = () => undefined;
      component.currentUid = 'user-1';
      component.issues = Array.from({ length: 110 }, (_, i) => createIssue(i));
      component.smartFilterCriteria = createEmptySmartFilterCriteria();
      component.showArchived = true;
      (component as unknown as { issueTasksMap: Record<string, Task[]> }).issueTasksMap = Object.fromEntries(
        component.issues.map(issue => [
          issue.id ?? '',
          Array.from({ length: 3 }, (_, taskIndex) => ({ ...createTask(taskIndex), issueId: issue.id ?? '' })),
        ]),
      );

      const start = performance.now();
      component.filterIssues();
      const duration = performance.now() - start;

      expect(component.filteredIssues.length).toBe(110);
      expect(duration).toBeLessThan(180);
    });

    it('タスクが100件以上ある場合の表示速度', () => {
      const component = TestBed.runInInjectionContext(() => new TasksListComponent());
      (component as unknown as { saveSortPreferences: () => void }).saveSortPreferences = () => undefined;
      component.currentUid = 'user-1';
      component.tasks = Array.from({ length: 150 }, (_, i) => createTask(i));
      component.smartFilterCriteria = createEmptySmartFilterCriteria();
      component.showArchived = true;
      component.statusFilter = '';
      component.importanceFilter = '';

      const start = performance.now();
      component.filterTasks();
      const duration = performance.now() - start;

      expect(component.filteredTasks.length).toBe(150);
      expect(duration).toBeLessThan(150);
    });

    it('コメントが500件ある場合の表示速度', async () => {
      const component = TestBed.runInInjectionContext(() => new TasksListComponent());
      component.projectId = 'p-1';
      component.issueId = 'i-1';
      component.projectDetails = {
        id: 'p-1',
        name: 'comment host project',
        memberIds: [],
        roles: {},
        archived: false,
      } satisfies Project;
      component.selectedTask = createTask(0);
      component.attachments = [];
      component.projectMemberProfiles = {};
      component.currentUid = 'user-1';
      component.currentUserProfile = { uid: 'user-1', username: 'user-1' } as never;

      const comments = Array.from({ length: 500 }, (_, i) => createComment(i));
      tasksServiceStub.listComments.and.resolveTo(comments as Comment[]);
      spyOn(component as unknown as { loadProjectMembers: () => Promise<void> }, 'loadProjectMembers').and.resolveTo();

      const start = performance.now();
      await (component as unknown as { loadTaskComments: (taskId: string) => Promise<void> }).loadTaskComments('t-1');
      const duration = performance.now() - start;

      expect(component.comments.length).toBe(500);
      expect(component.commentLimitReached).toBeTrue();
      expect(duration).toBeLessThan(250);
    });
  });

  describe('15.2 リアルタイム更新', () => {
    it('複数ブラウザで同時に操作した場合の同期', () => {
      const component = TestBed.runInInjectionContext(() => new TasksListComponent());
      (component as unknown as { saveSortPreferences: () => void }).saveSortPreferences = () => undefined;
      component.smartFilterCriteria = createEmptySmartFilterCriteria();
      component.showArchived = true;
      component.statusFilter = '';
      component.importanceFilter = '';

      const browserAUpdates = Array.from({ length: 80 }, (_, i) => createTask(i));
      const browserBUpdates = Array.from({ length: 80 }, (_, i) => ({ ...createTask(i), title: `B-${i}` }));

      const start = performance.now();
      component.tasks = browserAUpdates;
      component.filterTasks();
      component.tasks = browserBUpdates;
      component.filterTasks();
      const duration = performance.now() - start;

      expect(component.filteredTasks.every(task => task.title.startsWith('B-'))).toBeTrue();
      expect(duration).toBeLessThan(180);
    });

    it('データ更新の反映速度', () => {
      const component = TestBed.runInInjectionContext(() => new IssuesListComponent());
      (component as unknown as { saveSortPreferences: () => void }).saveSortPreferences = () => undefined;
      (component as unknown as { loadSmartFilterOptions: () => void }).loadSmartFilterOptions = () => undefined;
      component.smartFilterCriteria = createEmptySmartFilterCriteria();
      component.showArchived = true;
      (component as unknown as { issueTasksMap: Record<string, Task[]> }).issueTasksMap = {};

      const initialIssues = Array.from({ length: 50 }, (_, i) => createIssue(i));
      const updatedIssues = [...initialIssues, createIssue(999)];

      const start = performance.now();
      component.issues = initialIssues;
      component.filterIssues();
      component.issues = updatedIssues;
      component.filterIssues();
      const duration = performance.now() - start;

      expect(component.filteredIssues.some(issue => issue.id === 'i-999')).toBeTrue();
      expect(duration).toBeLessThan(180);
    });
  });
});

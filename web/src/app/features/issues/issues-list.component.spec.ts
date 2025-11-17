import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { IssuesListComponent } from './issues-list.component';
import { createEmptySmartFilterCriteria } from '../../shared/smart-filter/smart-filter.model';
import { IssuesService } from './issues.service';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { TagsService } from '../tags/tags.service';
import { UserDirectoryService } from '../../core/user-directory.service';
import { Issue, Tag, Task } from '../../models/schema';

// 依存サービスはすべてスタブに置き換え、AngularFire へ実アクセスしないようにする
class IssuesServiceStub {
  listIssues = jasmine
    .createSpy('listIssues')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .and.callFake((_projectId: string, _showArchived: boolean): Promise<Issue[]> => Promise.resolve([]));
  togglePin = jasmine.createSpy('togglePin');
}
class ProjectsServiceStub {
  listMyProjects = jasmine
    .createSpy('listMyProjects')
    .and.callFake((): Promise<unknown[]> => Promise.resolve([]));

  getProject = jasmine
    .createSpy('getProject')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .and.callFake((_projectId: string): Promise<null> => Promise.resolve(null));

  getSignedInUid = jasmine
    .createSpy('getSignedInUid')
    .and.callFake((): Promise<string> => Promise.resolve('test-user'));
}
class TasksServiceStub {
  // スマートフィルターのためにタスク一覧を返すが、ここでは空配列を返して最小限に抑える
  listTasks = jasmine.createSpy('listTasks').and.resolveTo([] as Task[]);
}
class TagsServiceStub {
  listTags = jasmine
    .createSpy('listTags')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .and.callFake((_projectId: string): Promise<Tag[]> => Promise.resolve([]));
}
class UserDirectoryServiceStub {
  getProfiles = jasmine.createSpy('getProfiles').and.resolveTo([]);
}

// ActivatedRoute はパラメータを流せるよう、Subject ベースで用意する（Observable を返す）
const params$ = new Subject<Record<string, string>>();
const activatedRouteStub = {
  params: params$.asObservable(),
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

describe('IssuesListComponent', () => {
  let component: IssuesListComponent;
  let fixture: ComponentFixture<IssuesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IssuesListComponent],
      providers: [
        { provide: IssuesService, useClass: IssuesServiceStub },
        { provide: ProjectsService, useClass: ProjectsServiceStub },
        { provide: TasksService, useClass: TasksServiceStub },
        { provide: TagsService, useClass: TagsServiceStub },
        { provide: UserDirectoryService, useClass: UserDirectoryServiceStub },
        { provide: ActivatedRoute, useValue: activatedRouteStub },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IssuesListComponent);
    component = fixture.componentInstance;
    // filterIssuesテストではngOnInitをスキップする（route.paramsのsubscribeを避けるため）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spyOn<any>(component, 'ngOnInit');
  });

  describe('filterIssues', () => {
    beforeEach(() => {
      // ソート処理の中で localStorage へアクセスするのを避けるため、保存処理は空振りさせる
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spyOn<any>(component, 'saveSortPreferences').and.callFake(() => undefined);
    });

    it('アーカイブされていない課題だけを残す', () => {
      // 前提：一覧にはアクティブとアーカイブ済みが混在している
      const activeIssue: Issue = {
        id: 'active',
        projectId: 'p1',
        name: '進行中の課題',
        archived: false,
        pinnedBy: [],
      };
      const archivedIssue: Issue = {
        id: 'archived',
        projectId: 'p1',
        name: 'アーカイブ済みの課題',
        archived: true,
        pinnedBy: [],
      };
      component.issues = [activeIssue, archivedIssue];
      component.showArchived = false;
      component.smartFilterCriteria = createEmptySmartFilterCriteria();
      // スマートフィルター側で参照されるタスクキャッシュも初期化しておく
      (component as unknown as { issueTasksMap: Record<string, Task[]> }).issueTasksMap = {};

      component.filterIssues();

      // 期待：アーカイブ済みは除外され、アクティブ課題だけが残る
      expect(component.filteredIssues).toEqual([activeIssue]);
    });

    it('期限のみのスマートフィルターで、タスクに一致がなくても終了日が当日なら残す', () => {
      // 今日が期限の課題と、今週内だが今日ではない課題を用意
      const today = new Date();
      const inAWeek = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
      const dueToday: Issue = {
        id: 'today',
        projectId: 'p1',
        name: '今日が期限の課題',
        archived: false,
        endDate: today,
        pinnedBy: [],
      };
      const laterThisWeek: Issue = {
        id: 'later',
        projectId: 'p1',
        name: '数日後が期限の課題',
        archived: false,
        endDate: inAWeek,
        pinnedBy: [],
      };
      component.issues = [dueToday, laterThisWeek];
      component.showArchived = true; // アーカイブ条件で除外されないようにしておく
      component.smartFilterCriteria = {
        ...createEmptySmartFilterCriteria(),
        due: 'today',
      };
      // タスクは空配列なので hasMatchingTask は false になるようにする
      (component as unknown as { issueTasksMap: Record<string, Task[]> }).issueTasksMap = {};

      component.filterIssues();

      // 期待：タスクに一致がなくても、終了日が当日の課題は due フィルターで残る
      expect(component.filteredIssues).toEqual([dueToday]);
    });
  });

  describe('sortIssues', () => {
    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spyOn<any>(component, 'saveSortPreferences').and.callFake(() => undefined);
    });

    it('ピン留めされた課題を常に先頭に並べる', () => {
      // 現在のユーザー ID を設定してピン判定を有効にする
      component.currentUid = 'u1';
      const pinned: Issue = {
        id: 'pinned',
        projectId: 'p1',
        name: '後ろに並ぶ名前だがピン付き',
        archived: false,
        pinnedBy: ['u1'],
        startDate: new Date('2024-01-10'),
      };
      const normal: Issue = {
        id: 'normal',
        projectId: 'p1',
        name: 'アルファベット順で先頭',
        archived: false,
        pinnedBy: [],
        startDate: new Date('2024-01-05'),
      };
      component.filteredIssues = [normal, pinned];
      component.sortBy = 'startDate';
      component.sortOrder = 'asc';

      component.sortIssues();

      // 期待：名前や開始日の順序に関わらず、ピン付きが先頭になる
      expect(component.filteredIssues[0]).toBe(pinned);
    });

    it('開始日が存在する課題を優先し、日付が早い順で並べる', () => {
      const withStartDate: Issue = {
        id: 'withDate',
        projectId: 'p1',
        name: '開始日あり',
        archived: false,
        startDate: new Date('2024-02-01'),
        pinnedBy: [],
      };
      const earlierStartDate: Issue = {
        id: 'earlier',
        projectId: 'p1',
        name: '開始日はさらに早い',
        archived: false,
        startDate: new Date('2024-01-15'),
        pinnedBy: [],
      };
      const withoutStartDate: Issue = {
        id: 'noDate',
        projectId: 'p1',
        name: '開始日なし',
        archived: false,
        pinnedBy: [],
      };
      component.filteredIssues = [withStartDate, withoutStartDate, earlierStartDate];
      component.sortBy = 'startDate';
      component.sortOrder = 'asc';

      component.sortIssues();

      // 期待：開始日ありのものが先に並び、その中では日付の早い順。開始日なしは最後尾。
      expect(component.filteredIssues).toEqual([earlierStartDate, withStartDate, withoutStartDate]);
    });
  });
});
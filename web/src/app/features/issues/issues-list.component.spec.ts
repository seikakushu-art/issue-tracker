import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { IssuesListComponent } from './issues-list.component';
import { SmartFilterCriteria, createEmptySmartFilterCriteria } from '../../shared/smart-filter/smart-filter.model';
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
  archiveIssue = jasmine.createSpy('archiveIssue').and.resolveTo();
  deleteIssue = jasmine.createSpy('deleteIssue').and.resolveTo();
  createIssue = jasmine.createSpy('createIssue').and.resolveTo();
  updateIssue = jasmine.createSpy('updateIssue').and.resolveTo();
  moveIssue = jasmine
    .createSpy('moveIssue')
    .and.resolveTo({ finalName: 'moved-name', removedAssignees: [], skippedTags: [], periodsReset: false } as never);
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

    it('タグ・担当者・ステータス・重要度を組み合わせたフィルターで一致する課題のみ残す', () => {
        const matchingIssue: Issue = {
          id: 'i1',
          projectId: 'p1',
          name: 'フィルター対象',
          archived: false,
          pinnedBy: [],
          importance: 'High',
          tags: ['tag1'],
        } as Issue;
        const nonMatchingIssue: Issue = {
          id: 'i2',
          projectId: 'p1',
          name: '除外対象',
          archived: false,
          pinnedBy: [],
          importance: 'Low',
          tags: ['tag2'],
        } as Issue;
        component.issues = [matchingIssue, nonMatchingIssue];
        component.showArchived = true;
        component.smartFilterCriteria = {
          ...createEmptySmartFilterCriteria(),
          tagIds: ['tag1'],
          assigneeIds: ['user-1'],
          statuses: ['in_progress'],
          importanceLevels: ['High'],
          due: 'today',
        };
        (component as unknown as { issueTasksMap: Record<string, Task[]> }).issueTasksMap = {
          i1: [
            {
              id: 't1',
              projectId: 'p1',
              issueId: 'i1',
              title: '対象タスク',
              status: 'in_progress',
              archived: false,
              assigneeIds: ['user-1'],
              tagIds: ['tag1'],
              importance: 'High',
              checklist: [],
              createdBy: 'u1',
              endDate: new Date(),
            } as Task,
          ],
          i2: [
            {
              id: 't2',
              projectId: 'p1',
              issueId: 'i2',
              title: '別タスク',
              status: 'incomplete',
              archived: false,
              assigneeIds: ['user-2'],
              tagIds: ['tag2'],
              checklist: [],
              createdBy: 'u2',
              endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
            } as Task,
          ],
        };
        // sortIssues()をスキップして、フィルタリング結果の順序を保持する
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spyOn<any>(component, 'sortIssues');
  
        component.filterIssues();
  
        expect(component.filteredIssues).toEqual([matchingIssue]);
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
    it('降順指定なら値が大きい課題を先に並べる', () => {
        const lowProgress: Issue = {
          id: 'low',
          projectId: 'p1',
          name: '進捗低',
          archived: false,
          pinnedBy: [],
          progress: 10,
        };
        const highProgress: Issue = {
          id: 'high',
          projectId: 'p1',
          name: '進捗高',
          archived: false,
          pinnedBy: [],
          progress: 80,
        };
        component.filteredIssues = [lowProgress, highProgress];
        component.sortBy = 'progress';
        component.sortOrder = 'desc';
  
        component.sortIssues();
  
        expect(component.filteredIssues[0]).toBe(highProgress);
      });
  
      it('終了日がある課題を優先し、日付の早い順に並べる', () => {
        const withEndDate: Issue = {
          id: 'with-end',
          projectId: 'p1',
          name: '終了日あり',
          archived: false,
          endDate: new Date('2024-02-10'),
          pinnedBy: [],
        };
        const earlierEndDate: Issue = {
          id: 'early-end',
          projectId: 'p1',
          name: '終了日はさらに早い',
          archived: false,
          endDate: new Date('2024-02-01'),
          pinnedBy: [],
        };
        const withoutEndDate: Issue = {
          id: 'no-end',
          projectId: 'p1',
          name: '終了日なし',
          archived: false,
          pinnedBy: [],
        };
        component.filteredIssues = [withEndDate, withoutEndDate, earlierEndDate];
        component.sortBy = 'endDate';
        component.sortOrder = 'asc';
  
        component.sortIssues();
  
        expect(component.filteredIssues).toEqual([earlierEndDate, withEndDate, withoutEndDate]);
      });
  
      it('作成日とタスク数で並び替えられる', () => {
        const older: Issue = {
          id: 'old',
          projectId: 'p1',
          name: '古い課題',
          archived: false,
          pinnedBy: [],
          createdAt: new Date('2024-01-01'),
        };
        const newer: Issue = {
          id: 'new',
          projectId: 'p1',
          name: '新しい課題',
          archived: false,
          pinnedBy: [],
          createdAt: new Date('2024-03-01'),
        };
        component.filteredIssues = [older, newer];
        (component as unknown as { taskSummaryMap: Record<string, { count: number }> }).taskSummaryMap = {
          old: { count: 5 },
          new: { count: 2 },
        };
  
        component.sortBy = 'createdAt';
        component.sortOrder = 'desc';
        component.sortIssues();
        expect(component.filteredIssues[0]).toBe(newer);
  
        component.sortBy = 'taskCount';
        component.sortOrder = 'asc';
        component.sortIssues();
        expect(component.filteredIssues).toEqual([newer, older]);
      });
    });
  
    describe('basic issue interactions', () => {
      it('アーカイブ表示をオンにするとアーカイブ済み課題も残す', () => {
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
        component.showArchived = true;
        component.smartFilterCriteria = createEmptySmartFilterCriteria();
        (component as unknown as { issueTasksMap: Record<string, Task[]> }).issueTasksMap = {};
        // sortIssues()をスキップして、フィルタリング後の順序を保持する
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spyOn<any>(component, 'sortIssues');
  
        component.filterIssues();
  
        // アーカイブ済み課題も含まれることを確認（順序は重要ではない）
        expect(component.filteredIssues.length).toBe(2);
        expect(component.filteredIssues).toContain(activeIssue);
        expect(component.filteredIssues).toContain(archivedIssue);
      });
  
      it('課題カードのクリックでタスク一覧へ遷移する', () => {
        const router = TestBed.inject(Router);
        const navigateSpy = spyOn(router, 'navigate');
        component.projectId = 'p1';
  
        component.selectIssue({ id: 'i1', projectId: 'p1', name: '課題1', archived: false, pinnedBy: [] });
  
        expect(navigateSpy).toHaveBeenCalledWith(['/projects', 'p1', 'issues', 'i1']);
      });
    });
  
    describe('issue creation and editing', () => {
      it('新規課題作成モーダルを開き、入力欄を初期化する', () => {
        component.projectId = 'p1';
        component.currentRole = 'admin';
        component.issueForm = { projectId: 'p1', name: '古い名前', description: 'desc', startDate: '2024-01-01', endDate: '2024-01-02', goal: 'goal', themeColor: '#000000' };
        component.editingIssue = { id: 'old', projectId: 'p1', name: '古い', archived: false, pinnedBy: [] };
  
        component.openCreateModal();
  
        expect(component.showModal).toBeTrue();
        expect(component.editingIssue).toBeNull();
        expect(component.issueForm).toEqual({ projectId: 'p1', name: '', description: '', startDate: '', endDate: '', goal: '', themeColor: '' });
      });
  
      it('課題編集モーダルを開くと選択した課題の情報でフォームを埋める', () => {
        component.currentRole = 'admin';
        const issue: Issue = {
          id: 'edit',
          projectId: 'p1',
          name: '編集対象',
          description: 'もともとの説明',
          startDate: new Date('2024-04-01'),
          endDate: new Date('2024-04-10'),
          goal: '達成目標',
          archived: false,
          pinnedBy: [],
          themeColor: '#ff0000',
        };
  
        component.editIssue(issue, new Event('click'));
  
        expect(component.showModal).toBeTrue();
        expect(component.editingIssue).toBe(issue);
        expect(component.issueForm.goal).toBe('達成目標');
        expect(component.issueForm.themeColor).toBe('#ff0000');
      });
  
      it('課題を作成すると一覧の再読込が呼ばれる', async () => {
        component.projectId = 'p1';
        component.currentRole = 'admin';
        component.issueForm = {
          projectId: 'p1',
          name: '新しい課題',
          description: '説明',
          startDate: '2024-01-01',
          endDate: '2024-01-02',
          goal: '目標',
          themeColor: '#00ff00'
        };
        const loadIssuesSpy = spyOn(component as unknown as { loadIssues: () => Promise<void> }, 'loadIssues').and.resolveTo();
  
        await component.saveIssue();
  
        expect(TestBed.inject(IssuesService).createIssue).toHaveBeenCalled();
        expect(loadIssuesSpy).toHaveBeenCalled();
        expect(component.showModal).toBeFalse();
      });
  
      it('課題を編集して保存すると更新APIを呼び出す', async () => {
        component.projectId = 'p1';
        component.currentRole = 'admin';
        component.editingIssue = { id: 'edit', projectId: 'p1', name: '編集前', archived: false, pinnedBy: [] };
        component.issueForm = {
          projectId: 'p1',
          name: '編集後の名前',
          description: '更新説明',
          startDate: '',
          endDate: '',
          goal: '',
          themeColor: ''
        };
        const loadIssuesSpy = spyOn(component as unknown as { loadIssues: () => Promise<void> }, 'loadIssues').and.resolveTo();
  
        await component.saveIssue();
  
        expect(TestBed.inject(IssuesService).updateIssue).toHaveBeenCalledWith('p1', 'edit', jasmine.any(Object));
        expect(loadIssuesSpy).toHaveBeenCalled();
      });
  
      it('別プロジェクトに移動保存すると moveIssue を呼び出す', async () => {
        component.projectId = 'p1';
        component.currentRole = 'admin';
        component.editingIssue = { id: 'move', projectId: 'p1', name: '移動元', archived: false, pinnedBy: [] };
        component.issueForm = {
          projectId: 'p2',
          name: '移動後の名前',
          description: '',
          startDate: '',
          endDate: '',
          goal: '',
          themeColor: ''
        };
        spyOn(window, 'alert');
        const loadIssuesSpy = spyOn(component as unknown as { loadIssues: () => Promise<void> }, 'loadIssues').and.resolveTo();
  
        await component.saveIssue();
  
        expect(TestBed.inject(IssuesService).moveIssue).toHaveBeenCalledWith('p1', 'move', 'p2', jasmine.any(Object));
        expect(loadIssuesSpy).toHaveBeenCalled();
      });
    });
  
    describe('issue archiving and deletion', () => {
      beforeEach(() => {
        spyOn(window, 'alert');
      });

      it('アーカイブ操作後に一覧を再読込する', async () => {
        spyOn(window, 'confirm').and.returnValue(true);
        component.projectId = 'p1';
        component.currentRole = 'admin';
        const issue: Issue = { id: 'arch', projectId: 'p1', name: '対象', archived: false, pinnedBy: [] };
        const loadIssuesSpy = spyOn(component as unknown as { loadIssues: () => Promise<void> }, 'loadIssues').and.resolveTo();

        await component.archiveIssue(issue, new Event('click'));

        expect(TestBed.inject(IssuesService).archiveIssue).toHaveBeenCalledWith('p1', 'arch', true);
        expect(loadIssuesSpy).toHaveBeenCalled();
      });

      it('アーカイブ時に確認ダイアログを表示する', async () => {
        const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
        component.projectId = 'p1';
        component.currentRole = 'admin';
        const issue: Issue = { id: 'arch', projectId: 'p1', name: '対象', archived: false, pinnedBy: [] };

        await component.archiveIssue(issue, new Event('click'));

        expect(confirmSpy).toHaveBeenCalled();
        expect(TestBed.inject(IssuesService).archiveIssue).not.toHaveBeenCalled();
      });

      it('削除確定後に課題を除外する', async () => {
        spyOn(window, 'confirm').and.returnValue(true);
        component.projectId = 'p1';
        component.currentRole = 'admin';
        const issue: Issue = { id: 'del', projectId: 'p1', name: '削除対象', archived: false, pinnedBy: [] };
        const loadIssuesSpy = spyOn(component as unknown as { loadIssues: () => Promise<void> }, 'loadIssues').and.resolveTo();

        await component.deleteIssue(issue, new Event('click'));

        expect(TestBed.inject(IssuesService).deleteIssue).toHaveBeenCalledWith('p1', 'del');
        expect(loadIssuesSpy).toHaveBeenCalled();
      });

      it('削除時に確認ダイアログを表示する', async () => {
        const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
        component.projectId = 'p1';
        component.currentRole = 'admin';
        const issue: Issue = { id: 'del', projectId: 'p1', name: '削除対象', archived: false, pinnedBy: [] };

        await component.deleteIssue(issue, new Event('click'));

        expect(confirmSpy).toHaveBeenCalled();
        expect(TestBed.inject(IssuesService).deleteIssue).not.toHaveBeenCalled();
      });
    });
  
    describe('smart filter panel', () => {
      it('スマートフィルターパネルの開閉をトグルする', () => {
        expect(component.smartFilterVisible).toBeFalse();
  
        component.toggleSmartFilterPanel();
  
        expect(component.smartFilterVisible).toBeTrue();
      });
  
      it('フィルター適用時に条件を保存して一覧を絞り込む', () => {
        const criteria: SmartFilterCriteria = {
          ...createEmptySmartFilterCriteria(),
          tagIds: ['t1'],
          assigneeIds: ['u1'],
        };
        const filterSpy = spyOn(component, 'filterIssues');
  
        component.onSmartFilterApply(criteria);
  
        expect(component.smartFilterCriteria).toEqual(criteria);
        expect(component.smartFilterVisible).toBeFalse();
        expect(filterSpy).toHaveBeenCalled();
      });
  });
});
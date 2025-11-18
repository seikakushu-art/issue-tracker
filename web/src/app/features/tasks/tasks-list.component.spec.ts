import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { TasksListComponent } from './tasks-list.component';
import { TasksService } from './tasks.service';
import { TagsService } from '../tags/tags.service';
import { IssuesService } from '../issues/issues.service';
import { ProjectsService } from '../projects/projects.service';
import { UserDirectoryService } from '../../core/user-directory.service';
import { Auth } from '@angular/fire/auth';
import { ActivatedRoute, Router } from '@angular/router';
import { createEmptySmartFilterCriteria } from '../../shared/smart-filter/smart-filter.model';
import { Task } from '../../models/schema';

// 依存サービスは全てテストダブルで置き換えておく（AngularFire を実動させないため）
const tasksServiceStub: {
    calculateProgressFromChecklist: jasmine.Spy;
    updateTask?: jasmine.Spy;
    updateChecklist?: jasmine.Spy;
    togglePin?: jasmine.Spy;
  } = {
  calculateProgressFromChecklist: jasmine.createSpy('calculateProgressFromChecklist')
};

const basicServiceStub = {};

const routeStub = {
  params: new Subject<Record<string, string>>(),
  queryParamMap: new Subject<Record<string, string | null>>()
};

const routerStub = {
  navigate: jasmine.createSpy('navigate')
};

// 最低限のタスクデータを作るヘルパー
function createTask(partial: Partial<Task>): Task {
  return {
    id: 't-' + Math.random().toString(36).slice(2),
    projectId: 'p1',
    issueId: 'i1',
    title: 'タイトル',
    status: 'incomplete',
    archived: false,
    assigneeIds: [],
    tagIds: [],
    checklist: [],
    createdBy: 'creator',
    ...partial,
  };
}

describe('TasksListComponent の軽量ロジック', () => {
  let component: TasksListComponent;

  beforeEach(() => {
    tasksServiceStub.calculateProgressFromChecklist.calls.reset();
    tasksServiceStub.calculateProgressFromChecklist.and.returnValue(0);
    tasksServiceStub.updateTask = jasmine.createSpy('updateTask').and.returnValue(Promise.resolve());
    tasksServiceStub.updateChecklist = jasmine.createSpy('updateChecklist').and.returnValue(Promise.resolve());
    tasksServiceStub.togglePin = jasmine.createSpy('togglePin').and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        { provide: TasksService, useValue: tasksServiceStub },
        { provide: TagsService, useValue: basicServiceStub },
        { provide: IssuesService, useValue: basicServiceStub },
        { provide: ProjectsService, useValue: basicServiceStub },
        { provide: UserDirectoryService, useValue: basicServiceStub },
        { provide: Auth, useValue: basicServiceStub },
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: Router, useValue: routerStub },
      ],
    });

    // 実際のテンプレートを描画せずにインスタンスだけを取得する
    component = TestBed.runInInjectionContext(() => new TasksListComponent());
  });

  it('フィルターでアーカイブ・ステータス・重要度を順番に絞り込む', () => {
    // アーカイブ済みと未完了のみ残るようなデータをセット
    component.tasks = [
      createTask({ id: 'active-incomplete', archived: false, status: 'incomplete', importance: 'Low', title: 'Alpha' }),
      createTask({ id: 'archived', archived: true, status: 'incomplete', importance: 'High', title: 'Beta' }),
      createTask({ id: 'active-completed', archived: false, status: 'completed', importance: 'High', title: 'Gamma' }),
    ];
    component.showArchived = false;
    component.statusFilter = 'incomplete';
    component.importanceFilter = 'Low';
    component.smartFilterCriteria = createEmptySmartFilterCriteria();

    component.filterTasks();

    // 条件に合う 1 件だけが残るはず
    expect(component.filteredTasks.map(task => task.id)).toEqual(['active-incomplete']);
  });

  it('ピン止めを優先した上で開始日順に並べ替える', () => {
    component.currentUid = 'u1';
    component.filteredTasks = [
      createTask({ id: 'unpinned-early', pinnedBy: [], startDate: new Date('2024-01-01'), title: 'Beta' }),
      createTask({ id: 'pinned-late', pinnedBy: ['u1'], startDate: new Date('2024-02-01'), title: 'Alpha' }),
      createTask({ id: 'unpinned-late', pinnedBy: [], startDate: new Date('2024-03-01'), title: 'Delta' }),
    ];
    component.sortBy = 'startDate';
    component.sortOrder = 'asc';

    component.sortTasks();

    // ピン止めが最優先、その中では開始日が早い順
    expect(component.filteredTasks[0].id).toBe('pinned-late');
    expect(component.filteredTasks.slice(1).map(task => task.id)).toEqual(['unpinned-early', 'unpinned-late']);
  });

  it('progress が未設定の場合はサービス経由で進捗を計算する', () => {
    const withProgress = createTask({ progress: 80 });
    const withoutProgress = createTask({ progress: undefined, checklist: [{ id: 'c1', text: '確認', completed: true }], status: 'in_progress' });
    tasksServiceStub.calculateProgressFromChecklist.and.returnValue(40);

    // 値が入っている場合はそのまま返す
    expect(component.getTaskProgress(withProgress)).toBe(80);

    // 未設定の場合だけサービスに委譲される
    expect(component.getTaskProgress(withoutProgress)).toBe(40);
    expect(tasksServiceStub.calculateProgressFromChecklist).toHaveBeenCalledWith(withoutProgress.checklist, withoutProgress.status);
  });
  it('アーカイブ表示設定を切り替えると該当タスクの表示が変わる', () => {
    component.tasks = [
      createTask({ id: 'visible-active', archived: false, title: 'Alpha' }),
      createTask({ id: 'visible-archived', archived: true, title: 'Beta' }),
    ];
    component.smartFilterCriteria = createEmptySmartFilterCriteria();
    component.statusFilter = '';
    component.importanceFilter = '';

    component.showArchived = false;
    component.filterTasks();
    expect(component.filteredTasks.map(task => task.id)).toEqual(['visible-active']);

    component.showArchived = true;
    component.filterTasks();
    expect(component.filteredTasks.map(task => task.id)).toEqual(['visible-active', 'visible-archived']);
  });

  it('ピン止め操作で stopPropagation しつつサービスに委譲する', async () => {
    component.projectId = 'p1';
    component.issueId = 'i1';
    component.currentUid = 'u1';
    const task = createTask({ id: 'pin-target', pinnedBy: [] });
    const mockEvent = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as Event;
    const componentWithPrivates = component as unknown as { loadData: () => Promise<void> };
    spyOn(componentWithPrivates, 'loadData').and.returnValue(Promise.resolve());

    await component.toggleTaskPin(task, mockEvent);

    expect(mockEvent.stopPropagation).toHaveBeenCalled();
    expect(tasksServiceStub.togglePin).toHaveBeenCalledWith('p1', 'i1', 'pin-target', true);
    expect(componentWithPrivates.loadData).toHaveBeenCalled();
  });

  it('ステータス変更時にチェックリスト進捗を計算して保存する', async () => {
    component.projectId = 'p1';
    component.issueId = 'i1';
    component.currentUid = 'u1';
    component.currentRole = 'admin';
    const task = createTask({
      id: 'progress-task',
      checklist: [
        { id: 'c1', text: 'one', completed: true },
        { id: 'c2', text: 'two', completed: false },
      ],
      createdBy: 'u1',
    });
    tasksServiceStub.calculateProgressFromChecklist.and.returnValue(50);
    const componentWithPrivates = component as unknown as {
      loadData: () => Promise<void>;
      refreshSelectedTask: () => void;
      updateIssueProgress: () => Promise<void>;
    };
    spyOn(componentWithPrivates, 'loadData').and.returnValue(Promise.resolve());
    spyOn(componentWithPrivates, 'refreshSelectedTask');
    spyOn(componentWithPrivates, 'updateIssueProgress').and.returnValue(Promise.resolve());

    await component.updateTaskStatus(task, 'in_progress');

    expect(tasksServiceStub.updateTask).toHaveBeenCalledWith('p1', 'i1', 'progress-task', {
      status: 'in_progress',
      progress: 50,
    });
    expect(component.statusMenuTaskId).toBeNull();
  });

  it('チェックリスト完了時に完了確認で「いいえ」を選ぶとステータスを維持したまま進捗100%で保存する', async () => {
    component.projectId = 'p1';
    component.issueId = 'i1';
    component.currentUid = 'u1';
    component.currentRole = 'admin';
    const checklist = [
      { id: 'c1', text: 'step 1', completed: true },
      { id: 'c2', text: 'step 2', completed: true },
    ];
    const task = createTask({ id: 'checklist-task', checklist, status: 'in_progress', createdBy: 'u1' });
    const componentWithPrivates = component as unknown as {
      confirmChecklistCompletion: () => boolean;
      loadData: () => Promise<void>;
      refreshSelectedTask: () => void;
      updateIssueProgress: () => Promise<void>;
      persistChecklist(task: Task, checklist: Task['checklist']): Promise<void>;
    };
    spyOn(componentWithPrivates, 'confirmChecklistCompletion').and.returnValue(false);
    spyOn(componentWithPrivates, 'loadData').and.returnValue(Promise.resolve());
    spyOn(componentWithPrivates, 'refreshSelectedTask');
    spyOn(componentWithPrivates, 'updateIssueProgress').and.returnValue(Promise.resolve());

    await componentWithPrivates.persistChecklist(task, checklist);

    expect(tasksServiceStub.updateTask).toHaveBeenCalledWith('p1', 'i1', 'checklist-task', {
      checklist,
      progress: 100,
      status: 'in_progress',
    });
    expect(tasksServiceStub.updateChecklist).not.toHaveBeenCalled();
  });

  it('並び替え順を降順に変えると結果も反転する', () => {
    component.filteredTasks = [
      createTask({ id: 'a-title', title: 'Alpha' }),
      createTask({ id: 'b-title', title: 'Beta' }),
      createTask({ id: 'c-title', title: 'Charlie' }),
    ];
    component.sortBy = 'title';

    component.sortOrder = 'asc';
    component.sortTasks();
    const ascOrder = component.filteredTasks.map(task => task.id);

    component.sortOrder = 'desc';
    component.sortTasks();
    const descOrder = component.filteredTasks.map(task => task.id);

    expect(ascOrder).toEqual(['a-title', 'b-title', 'c-title']);
    expect(descOrder).toEqual(['c-title', 'b-title', 'a-title']);
  });

  it('スマートフィルター適用でタグ指定のタスクだけを表示しパネルを閉じる', () => {
    component.tasks = [
      createTask({ id: 'has-tag', tagIds: ['t1'], title: 'Alpha' }),
      createTask({ id: 'no-tag', tagIds: ['t2'], title: 'Beta' }),
    ];
    component.showArchived = true;
    component.statusFilter = '';
    component.importanceFilter = '';
    component.smartFilterVisible = true;
    const criteria = { ...createEmptySmartFilterCriteria(), tagIds: ['t1'] };

    component.onSmartFilterApply(criteria);

    expect(component.smartFilterVisible).toBeFalse();
    expect(component.filteredTasks.map(task => task.id)).toEqual(['has-tag']);
  });
});

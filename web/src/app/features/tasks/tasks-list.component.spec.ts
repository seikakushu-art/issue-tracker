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
const tasksServiceStub = {
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
});

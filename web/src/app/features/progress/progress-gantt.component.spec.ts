import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ProgressGanttComponent } from './progress-gantt.component';
import { ProgressGanttTimelineComponent } from './progress-gantt-timeline.component';
import { ProjectsService } from '../projects/projects.service';
import { IssuesService } from '../issues/issues.service';
import { TasksService } from '../tasks/tasks.service';
import { Issue, Project, Task } from '../../models/schema';

@Component({
  selector: 'app-task-detail-panel',
  standalone: true,
  template: '',
})
class MockTaskDetailPanelComponent {
  // Input/Output をモック化する必要があればここに追加する
}

function createDate(value: string): Date {
  return new Date(value + 'T00:00:00Z');
}

describe('ProgressGanttComponent (ガントチャート)', () => {
  let fixture: ComponentFixture<ProgressGanttComponent>;
  let component: ProgressGanttComponent;

  const projectsServiceMock = jasmine.createSpyObj<ProjectsService>('ProjectsService', ['listMyProjects']);
  const issuesServiceMock = jasmine.createSpyObj<IssuesService>('IssuesService', ['listIssues']);
  const tasksServiceMock = jasmine.createSpyObj<TasksService>('TasksService', ['listTasksByProject']);
  const routerMock = jasmine.createSpyObj<Router>('Router', ['navigate']);

  const project: Project = { id: 'p1', name: 'プロジェクトA' } as Project;
  const issue: Issue = { id: 'i1', name: '課題1', projectId: 'p1' } as Issue;
  const taskA: Task = {
    id: 't1',
    title: 'タスクA',
    projectId: 'p1',
    issueId: 'i1',
    startDate: createDate('2024-01-05'),
    endDate: createDate('2024-01-10'),
    status: 'in_progress',
  } as Task;
  const taskB: Task = {
    id: 't2',
    title: 'タスクB',
    projectId: 'p1',
    issueId: 'i1',
    startDate: createDate('2024-01-12'),
    endDate: createDate('2024-01-12'),
    status: 'completed',
  } as Task;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressGanttComponent],
      providers: [
        { provide: ProjectsService, useValue: projectsServiceMock },
        { provide: IssuesService, useValue: issuesServiceMock },
        { provide: TasksService, useValue: tasksServiceMock },
        { provide: Router, useValue: routerMock },
      ],
    })
      .overrideComponent(ProgressGanttComponent, {
        set: {
          imports: [CommonModule, ProgressGanttTimelineComponent, MockTaskDetailPanelComponent],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProgressGanttComponent);
    component = fixture.componentInstance;
  });

  it('プロジェクト・課題・タスクの階層をガントチャートに表示できる', async () => {
    projectsServiceMock.listMyProjects.and.resolveTo([project]);
    issuesServiceMock.listIssues.and.resolveTo([issue]);
    tasksServiceMock.listTasksByProject.and.resolveTo([taskA, taskB]);

    await component.loadData();
    fixture.detectChanges();
    await fixture.whenStable();
    
    // プロジェクト選択ヒントを非表示にするため、プロジェクトを選択する
    // handleProjectSelectChangeを正しく動作させるため、valueプロパティを持つモックオブジェクトを使用
    const mockSelect = {
      value: 'p1'
    } as HTMLSelectElement;
    component.handleProjectSelectChange({ target: mockSelect } as unknown as Event);
    
    // selectedProjectIdが正しく設定されているか確認
    expect(component.selectedProjectId).toBe('p1');
    expect(component.availableProjects.length).toBeGreaterThan(0);
    
    // OnPushの変更検出を確実に実行するため、複数回detectChangesを呼び出す
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    
    // プロジェクト選択ヒントが非表示になっていることを確認
    expect(component.shouldShowProjectSelectionHint).toBe(false);
    expect(component.visibleGanttIssues.length).toBe(1);
    expect(component.timeline.length).toBeGreaterThan(0);
    
    const issueLabel = native.querySelector('.gantt-row__label.issue .issue-name');
    const taskLabels = native.querySelectorAll('.task-title');

    expect(issueLabel).toBeTruthy();
    expect(issueLabel?.textContent).toContain('課題1');
    expect(Array.from(taskLabels).map((el) => el.textContent?.trim())).toContain('タスクA');
    expect(Array.from(taskLabels).map((el) => el.textContent?.trim())).toContain('タスクB');

    const issueCells = native.querySelectorAll('.gantt-row-line.issue .gantt-cell');
    expect(issueCells.length).toBe(component.timeline.length);
  });

  it('タイムラインのヘッダーを日数分レンダリングする', async () => {
    projectsServiceMock.listMyProjects.and.resolveTo([project]);
    issuesServiceMock.listIssues.and.resolveTo([issue]);
    tasksServiceMock.listTasksByProject.and.resolveTo([taskA]);

    await component.loadData();
    // プロジェクト選択ヒントを非表示にするため、プロジェクトを選択する
    const selectElement = document.createElement('select');
    selectElement.value = 'p1';
    component.handleProjectSelectChange({ target: selectElement } as unknown as Event);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const native = fixture.nativeElement as HTMLElement;
    const timelineDays = native.querySelectorAll('.gantt-timeline__day');

    expect(component.timeline.length).toBeGreaterThan(0);
    expect(timelineDays.length).toBe(component.timeline.length);
    expect(component.timelineMonths.length).toBeGreaterThan(0);
  });

  it('タイムラインのスクロール操作で現在の月表示とスクロール位置を更新する', () => {
    const baseDate = createDate('2024-02-01');
    component.timeline = [
      { date: baseDate, isWeekend: false, isHoliday: false, isToday: false, dayLabel: '1', weekdayLabel: '木' },
      { date: createDate('2024-02-02'), isWeekend: false, isHoliday: false, isToday: false, dayLabel: '2', weekdayLabel: '金' },
    ];
    component.timelineMonths = [{ label: '2024年2月', span: 2 }];
    const mockNativeElement = {
      scrollLeft: 40,
      clientWidth: 40,
      scrollWidth: 80,
    } as HTMLDivElement;
    component.timelineViewport = {
      nativeElement: mockNativeElement,
    } as Partial<ProgressGanttTimelineComponent> as ProgressGanttTimelineComponent;

    component.onTimelineScroll({ target: mockNativeElement } as unknown as Event);

    expect(component.currentScrollLeft).toBe(40);
    expect(component.activeMonthLabel).toBe('2024年2月');
  });

  it('週単位の移動操作でタイムラインを横スクロールできる', () => {
    const scrollTo = jasmine.createSpy('scrollTo');
    const mockNativeElement = {
      scrollLeft: 0,
      clientWidth: 100,
      scrollWidth: 1000,
      scrollTo,
    } as unknown as HTMLDivElement;
    component.timelineViewport = {
      nativeElement: mockNativeElement,
    } as Partial<ProgressGanttTimelineComponent> as ProgressGanttTimelineComponent;

    component.scrollByWeeks(2);

    expect(scrollTo).toHaveBeenCalledWith({ left: 2 * 7 * component.dayCellWidth, behavior: 'smooth' });
  });

  it('月単位の移動操作でタイムラインの中心を基準にスクロールできる', () => {
    const scrollTo = jasmine.createSpy('scrollTo');
    const mockNativeElement = {
      scrollLeft: 56,
      clientWidth: 56,
      scrollWidth: 1000,
      scrollTo,
    } as unknown as HTMLDivElement;
    component.timelineViewport = {
      nativeElement: mockNativeElement,
    } as Partial<ProgressGanttTimelineComponent> as ProgressGanttTimelineComponent;

    const startDate = createDate('2024-01-01');
    component.timeline = Array.from({ length: 40 }, (_, i) => {
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + i);
      return {
        date,
        isWeekend: false,
        isHoliday: false,
        isToday: false,
        dayLabel: String(i + 1),
        weekdayLabel: '月',
      };
    });

    component.scrollByMonths(1);

    const februaryFirstIndex = component.timeline.findIndex(
      (day) => day.date.getUTCFullYear() === 2024 && day.date.getUTCMonth() === 1 && day.date.getUTCDate() === 1,
    );
    expect(scrollTo).toHaveBeenCalledWith({ left: februaryFirstIndex * component.dayCellWidth, behavior: 'smooth' });
  });

  it('「今日へ」ボタン操作でタイムラインの中央へスクロールできる', () => {
    const scrollTo = jasmine.createSpy('scrollTo');
    const mockNativeElement = {
      scrollLeft: 0,
      clientWidth: 56,
      scrollWidth: 200,
      scrollTo,
    } as unknown as HTMLDivElement;
    component.timelineViewport = {
      nativeElement: mockNativeElement,
    } as Partial<ProgressGanttTimelineComponent> as ProgressGanttTimelineComponent;

    const today = component['toTokyoDate'](new Date());
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    component.timeline = [
      { date: yesterday, isWeekend: false, isHoliday: false, isToday: false, dayLabel: '1', weekdayLabel: '火' },
      { date: today, isWeekend: false, isHoliday: false, isToday: true, dayLabel: '2', weekdayLabel: '水' },
      { date: tomorrow, isWeekend: false, isHoliday: false, isToday: false, dayLabel: '3', weekdayLabel: '木' },
    ];

    spyOn(component as unknown as { setScrollPosition: (position: number) => void }, 'setScrollPosition');

    component.scrollToToday();

    expect(component['setScrollPosition']).toHaveBeenCalledWith(
      1 * component.dayCellWidth - (component.timelineViewport.nativeElement?.clientWidth ?? 0) / 2 + component.dayCellWidth / 2,
    );
  });

  it('タスクの詳細遷移を実行できる', () => {
    component.selectedTask = taskA;
    component.selectedIssue = issue;
    component.selectedProject = project;

    component.goToTaskDetail();

    expect(routerMock.navigate).toHaveBeenCalledWith([
      '/projects',
      'p1',
      'issues',
      'i1',
    ], { queryParams: { focus: 't1' } });
  });

  it('タイムラインのスクロール位置を今日の日付に移動できる', () => {
    const scrollTo = jasmine.createSpy('scrollTo');
    const mockNativeElement = {
      scrollLeft: 0,
      clientWidth: 56,
      scrollWidth: 200,
      scrollTo,
    } as unknown as HTMLDivElement;
    component.timelineViewport = {
      nativeElement: mockNativeElement,
    } as Partial<ProgressGanttTimelineComponent> as ProgressGanttTimelineComponent;

    const today = component['toTokyoDate'](new Date());
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    component.timeline = [
      { date: yesterday, isWeekend: false, isHoliday: false, isToday: false, dayLabel: '1', weekdayLabel: '火' },
      { date: today, isWeekend: false, isHoliday: false, isToday: true, dayLabel: '2', weekdayLabel: '水' },
      { date: tomorrow, isWeekend: false, isHoliday: false, isToday: false, dayLabel: '3', weekdayLabel: '木' },
    ];
  });
});

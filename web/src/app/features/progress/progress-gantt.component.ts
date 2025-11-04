import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Issue, Project, Task } from '../../models/schema';
import { ProjectsService } from '../projects/projects.service';
import { IssuesService } from '../issues/issues.service';
import { TasksService } from '../tasks/tasks.service';

interface GanttIssue {
  project: Project;
  issue: Issue;
  tasks: Task[];
  collapsed: boolean;
}

interface GanttProjectIssue {
  issue: Issue;
  tasks: Task[];
}

interface GanttProjectGroup {
  project: Project;
  issues: GanttProjectIssue[];
}

interface TimelineDay {
  date: Date;
  isWeekend: boolean;
  isToday: boolean;
  dayLabel: string;
  weekdayLabel: string;
}

interface TimelineMonthSegment {
  label: string;
  span: number;
}

@Component({
  selector: 'app-progress-gantt',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progress-gantt.component.html',
  styleUrls: ['./progress-gantt.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgressGanttComponent implements OnInit, AfterViewInit {
  private projectsService = inject(ProjectsService);
  private issuesService = inject(IssuesService);
  private tasksService = inject(TasksService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild('timelineViewport') timelineViewport?: ElementRef<HTMLDivElement>;

  loading = false;
  loadError: string | null = null;

  ganttIssues: GanttIssue[] = [];
  timeline: TimelineDay[] = [];
  timelineMonths: TimelineMonthSegment[] = [];
  totalDays = 0;
  timelineStart!: Date;
  timelineEnd!: Date;
  timelineWidth = 0;
  activeMonthLabel = '';
  currentScrollLeft = 0;

  selectedTask: Task | null = null;
  selectedIssue: Issue | null = null;
  selectedProject: Project | null = null;

  readonly tokyoTimezone = 'Asia/Tokyo';
  readonly dayCellWidth = 48;
  readonly labelColumnWidth = 280;

  projectHierarchy: GanttProjectGroup[] = [];

  private readonly monthFormatter = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    timeZone: this.tokyoTimezone,
  });

  private readonly weekdayFormatter = new Intl.DateTimeFormat('ja-JP', {
    weekday: 'short',
    timeZone: this.tokyoTimezone,
  });

  private readonly dayFormatter = new Intl.DateTimeFormat('ja-JP', {
    day: '2-digit',
    timeZone: this.tokyoTimezone,
  });

  private viewInitialized = false;
  private pendingScrollToToday = false;

  ngOnInit(): void {
    void this.loadData();
  }

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    if (this.pendingScrollToToday) {
      this.pendingScrollToToday = false;
      setTimeout(() => this.scrollToToday(), 0);
    }
  }

  async loadData(): Promise<void> {
    this.loading = true;
    this.loadError = null;
    try {
      const projects = (await this.projectsService.listMyProjects()).filter((project): project is Project & { id: string } => Boolean(project.id));
      const issueResults = await Promise.all(
        projects.map(async (project) => {
          const issues = await this.issuesService.listIssues(project.id!, false);
          return { project, issues };
        }),
      );

      const ganttIssues: GanttIssue[] = [];
      const allTaskDates: Date[] = [];

      for (const { project, issues } of issueResults) {
        for (const issue of issues) {
          if (!issue.id) {
            continue;
          }
          const tasks = await this.tasksService.listTasks(project.id!, issue.id, false);
          const hydratedTasks = tasks.map((task) => this.normalizeTaskDates(task));
          for (const task of hydratedTasks) {
            const start = task.startDate;
            const end = task.endDate;
            if (start) {
              allTaskDates.push(start);
            }
            if (end) {
              allTaskDates.push(end);
            }
          }
          ganttIssues.push({ project, issue, tasks: hydratedTasks, collapsed: false });
        }
      }

      this.ganttIssues = ganttIssues;
      this.buildProjectHierarchy(ganttIssues);
      this.buildTimeline(allTaskDates);
      this.cdr.markForCheck();
    } catch (error) {
      console.error('ガントチャートのデータ読み込みに失敗しました:', error);
      this.loadError = 'リアルデータの取得に失敗したため、サンプルデータを表示しています。';
      this.applySampleData();
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  toggleIssue(issue: GanttIssue): void {
    issue.collapsed = !issue.collapsed;
  }

  getGridTemplate(): string {
    return this.timeline.length > 0 ? `repeat(${this.timeline.length}, var(--day-width))` : '';
  }

  onTimelineScroll(event: Event): void {
    const element = event.target as HTMLElement;
    this.currentScrollLeft = element.scrollLeft;
    this.updateActiveMonthLabel(element);
  }

  selectTask(issue: GanttIssue, task: Task): void {
    this.selectedTask = task;
    this.selectedIssue = issue.issue;
    this.selectedProject = issue.project;
  }

  onSidebarTaskSelect(projectId: string | undefined, issueId: string | undefined, task: Task): void {
    if (!projectId || !issueId) {
      return;
    }
    const group = this.ganttIssues.find(
      (item) => item.project.id === projectId && item.issue.id === issueId,
    );
    if (!group) {
      return;
    }
    this.selectTask(group, task);
    this.focusTaskOnTimeline(task);
  }

  closeDetailPanel(): void {
    this.selectedTask = null;
    this.selectedIssue = null;
    this.selectedProject = null;
  }

  goToTaskDetail(): void {
    if (!this.selectedTask || !this.selectedTask.id || !this.selectedIssue?.id || !this.selectedProject?.id) {
      return;
    }
    void this.router.navigate([
      '/projects',
      this.selectedProject.id,
      'issues',
      this.selectedIssue.id,
    ], {
      queryParams: { focus: this.selectedTask.id },
    });
  }

  scrollByWeeks(weeks: number): void {
    if (!this.timelineViewport) {
      return;
    }
    const element = this.timelineViewport.nativeElement;
    const target = element.scrollLeft + weeks * 7 * this.dayCellWidth;
    this.setScrollPosition(target);
  }

  scrollToToday(): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (!this.timelineViewport) {
      this.pendingScrollToToday = true;
      return;
    }
    if (this.timeline.length === 0) {
      return;
    }
    const today = this.toTokyoDate(new Date());
    const index = this.timeline.findIndex((day) => this.isSameDay(day.date, today));
    const fallbackIndex = index >= 0 ? index : Math.floor(this.timeline.length / 2);
    const element = this.timelineViewport.nativeElement;
    const target = fallbackIndex * this.dayCellWidth - element.clientWidth / 2 + this.dayCellWidth / 2;
    this.setScrollPosition(target);
  }


  getTaskOffset(task: Task): string {
    if (!this.timelineStart) {
      return '0%';
    }
    const start = this.getEffectiveStart(task);
    if (!start) {
      return '0%';
    }
    const diff = this.diffInDays(start, this.timelineStart);
    const offset = Math.min(Math.max(0, diff), Math.max(0, this.totalDays - 1));
    const percent = this.totalDays > 0 ? (offset / this.totalDays) * 100 : 0;
    return `${percent}%`;
  }

  getTaskWidth(task: Task): string {
    const start = this.getEffectiveStart(task);
    const end = this.getEffectiveEnd(task);
    if (!start || !end) {
      return '0%';
    }
    const duration = this.diffInDays(end, start) + 1;
    const rawOffset = this.diffInDays(start, this.timelineStart);
    const offsetDays = Math.min(Math.max(0, rawOffset), Math.max(0, this.totalDays - 1));
    const maxDuration = Math.max(1, this.totalDays - offsetDays);
    const clampedDuration = Math.min(Math.max(1, duration), maxDuration);
    const width = this.totalDays > 0 ? (clampedDuration / this.totalDays) * 100 : 0;
    const minWidth = this.totalDays > 0 ? (1 / this.totalDays) * 100 : 0;
    return `${Math.max(width, minWidth)}%`;
  }

  getIssueTheme(issue: Issue): string {
    return issue.themeColor && issue.themeColor.trim().length > 0 ? issue.themeColor : '#475569';
  }

  getTaskStatusLabel(task: Task): string {
    switch (task.status) {
      case 'in_progress':
        return '進行中';
      case 'completed':
        return '完了';
      case 'on_hold':
        return '保留';
      case 'discarded':
        return '破棄';
      default:
        return '未完了';
    }
  }

  getImportanceLabel(task: Task): string {
    switch (task.importance) {
      case 'Critical':
        return '至急重要';
      case 'High':
        return '至急';
      case 'Medium':
        return '重要';
      case 'Low':
      default:
        return '普通';
    }
  }

  getTimelineLabel(day: TimelineDay): string {
    return `${this.dayFormatter.format(day.date)} (${this.weekdayFormatter.format(day.date)})`;
  }

  private buildTimeline(allDates: Date[]): void {
    const today = this.toTokyoDate(new Date());
    const baseStart = this.startOfWeek(this.addYears(today, -5));
    const baseEnd = this.endOfWeek(this.addYears(today, 5));
    if (allDates.length === 0) {
      this.timelineStart = baseStart;
      this.timelineEnd = baseEnd;
    } else {
      const sorted = allDates.map((d) => this.toTokyoDate(d)).sort((a, b) => a.getTime() - b.getTime());
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const computedStart = this.startOfWeek(min);
      const computedEnd = this.endOfWeek(max);
      this.timelineStart = computedStart.getTime() < baseStart.getTime() ? computedStart : baseStart;
      this.timelineEnd = computedEnd.getTime() > baseEnd.getTime() ? computedEnd : baseEnd;
    }

    const days: TimelineDay[] = [];
    const cursor = new Date(this.timelineStart);
    while (cursor.getTime() <= this.timelineEnd.getTime()) {
      const date = new Date(cursor);
      days.push({
        date,
        isWeekend: cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6,
        isToday: this.isSameDay(date, today),
        dayLabel: this.dayFormatter.format(date),
        weekdayLabel: this.weekdayFormatter.format(date),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    this.timeline = days;
    this.totalDays = Math.max(1, days.length);
    this.timelineMonths = this.buildMonthSegments(days);
    this.timelineWidth = this.totalDays * this.dayCellWidth;
    this.activeMonthLabel = this.timelineMonths[0]?.label ?? '';

    if (this.viewInitialized) {
      setTimeout(() => this.scrollToToday(), 0);
      this.updateActiveMonthLabel();
    } else {
      this.pendingScrollToToday = true;
    }
  }

  private buildProjectHierarchy(groups: GanttIssue[]): void {
    const projectMap = new Map<string, GanttProjectGroup>();
    for (const group of groups) {
      const projectId = group.project.id;
      const issueId = group.issue.id;
      if (!projectId || !issueId) {
        continue;
      }
      let projectGroup = projectMap.get(projectId);
      if (!projectGroup) {
        projectGroup = { project: group.project, issues: [] };
        projectMap.set(projectId, projectGroup);
      }
      projectGroup.issues.push({ issue: group.issue, tasks: group.tasks });
    }
    this.projectHierarchy = Array.from(projectMap.values());
  }

  private normalizeTaskDates(task: Task): Task {
    const clone: Task = { ...task };
    if (clone.startDate instanceof Date) {
      clone.startDate = Number.isNaN(clone.startDate.getTime()) ? null : this.toTokyoDate(clone.startDate);
    } else if (typeof clone.startDate === 'string') {
      const parsed = new Date(clone.startDate);
      clone.startDate = Number.isNaN(parsed.getTime()) ? null : this.toTokyoDate(parsed);
    }
    if (clone.endDate instanceof Date) {
      clone.endDate = Number.isNaN(clone.endDate.getTime()) ? null : this.toTokyoDate(clone.endDate);
    } else if (typeof clone.endDate === 'string') {
      const parsed = new Date(clone.endDate);
      clone.endDate = Number.isNaN(parsed.getTime()) ? null : this.toTokyoDate(parsed);
    }
    return clone;
  }

  private startOfWeek(date: Date): Date {
    const result = new Date(date);
    const day = (result.getUTCDay() + 6) % 7;
    result.setUTCDate(result.getUTCDate() - day);
    return result;
  }

  private endOfWeek(date: Date): Date {
    const result = new Date(date);
    const day = result.getUTCDay();
    const diff = (7 - day) % 7;
    result.setUTCDate(result.getUTCDate() + diff);
    return result;
  }

  private diffInDays(later: Date, earlier: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    const start = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
    const end = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
    return Math.floor((start - end) / msPerDay);
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate()
    );
  }

  private getEffectiveStart(task: Task): Date | null {
    if (task.startDate instanceof Date) {
      return task.startDate;
    }
    if (task.endDate instanceof Date) {
      return task.endDate;
    }
    return null;
  }

  private getEffectiveEnd(task: Task): Date | null {
    if (task.endDate instanceof Date) {
      return task.endDate;
    }
    if (task.startDate instanceof Date) {
      return task.startDate;
    }
    return null;
  }

  private toTokyoDate(date: Date): Date {
    if (Number.isNaN(date.getTime())) {
      return date;
    }
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    return new Date(Date.UTC(year, month, day));
  }

  private addYears(date: Date, years: number): Date {
    const result = new Date(date);
    result.setUTCFullYear(result.getUTCFullYear() + years);
    return result;
  }

  private buildMonthSegments(days: TimelineDay[]): TimelineMonthSegment[] {
    const segments: TimelineMonthSegment[] = [];
    let current: TimelineMonthSegment | null = null;
    let currentKey = '';
    for (const day of days) {
      const key = `${day.date.getUTCFullYear()}-${day.date.getUTCMonth()}`;
      if (key !== currentKey) {
        if (current) {
          segments.push(current);
        }
        currentKey = key;
        current = {
          label: this.monthFormatter.format(day.date),
          span: 1,
        };
      } else if (current) {
        current.span += 1;
      }
    }
    if (current) {
      segments.push(current);
    }
    return segments;
  }

  private setScrollPosition(target: number): void {
    if (typeof window === 'undefined') {
      return;
    }
    const viewport = this.timelineViewport?.nativeElement;
    if (!viewport) {
      return;
    }
    const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const next = Math.min(Math.max(0, target), maxScroll);
    if (typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({ left: next, behavior: 'smooth' });
    } else {
      viewport.scrollLeft = next;
    }
    this.currentScrollLeft = next;
    this.updateActiveMonthLabel(viewport);
  }

  private focusTaskOnTimeline(task: Task): void {
    if (!this.timelineViewport || !this.timelineStart) {
      return;
    }
    const start = this.getEffectiveStart(task);
    if (!start) {
      return;
    }
    const index = Math.max(0, Math.min(this.timeline.length - 1, this.diffInDays(start, this.timelineStart)));
    const element = this.timelineViewport.nativeElement;
    const target = index * this.dayCellWidth - element.clientWidth / 3;
    this.setScrollPosition(target);
  }

  private updateActiveMonthLabel(source?: HTMLElement): void {
    const viewport = source ?? this.timelineViewport?.nativeElement;
    if (!viewport || this.timeline.length === 0) {
      this.activeMonthLabel = this.timelineMonths[0]?.label ?? '';
      return;
    }
    const center = viewport.scrollLeft + viewport.clientWidth / 2;
    const index = Math.max(0, Math.min(this.timeline.length - 1, Math.round(center / this.dayCellWidth)));
    const day = this.timeline[index];
    const label = this.monthFormatter.format(day.date);
    if (this.activeMonthLabel !== label) {
      this.activeMonthLabel = label;
      this.cdr.markForCheck();
    }
  }


  private createSampleDate(base: Date, offset: number): Date {
    const result = new Date(base);
    result.setUTCDate(result.getUTCDate() + offset);
    return result;
  }

  private applySampleData(): void {
    const base = this.toTokyoDate(new Date());
    const project: Project = {
      id: 'sample-project',
      name: 'サンプルプロジェクト',
      description: 'デモ用のプロジェクト',
      memberIds: [],
      roles: {},
      archived: false,
      progress: 45,
    };

    const issue: Issue = {
      id: 'sample-issue',
      projectId: project.id!,
      name: 'UI改善イニシアチブ',
      description: '主要画面のUIを段階的に改善します。',
      startDate: this.createSampleDate(base, -14),
      endDate: this.createSampleDate(base, 14),
      goal: '第1四半期中に主要画面の改善を完了する',
      themeColor: '#2563eb',
      archived: false,
      progress: 60,
    };

    const rawTasks: Task[] = [
      {
        id: 'sample-task-1',
        projectId: project.id!,
        issueId: issue.id!,
        title: '画面レイアウト策定',
        description: 'ワイヤーフレームを作成し、関係者レビューを通過。',
        startDate: this.createSampleDate(base, -12),
        endDate: this.createSampleDate(base, -6),
        goal: 'レビュー合格',
        importance: 'High',
        status: 'completed',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
      },
      {
        id: 'sample-task-2',
        projectId: project.id!,
        issueId: issue.id!,
        title: 'コンポーネント設計',
        description: '再利用可能なUIコンポーネントの仕様を整理。',
        startDate: this.createSampleDate(base, -5),
        endDate: this.createSampleDate(base, 4),
        goal: '主要部品の設計完了',
        importance: 'Critical',
        status: 'in_progress',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
      },
      {
        id: 'sample-task-3',
        projectId: project.id!,
        issueId: issue.id!,
        title: 'ユーザーテスト準備',
        description: '想定シナリオとテスト環境を準備。',
        startDate: this.createSampleDate(base, 3),
        endDate: this.createSampleDate(base, 12),
        goal: 'テスト計画の承認',
        importance: 'Medium',
        status: 'incomplete',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
      },
    ];

    const normalizedTasks = rawTasks.map((task) => this.normalizeTaskDates(task));
    this.ganttIssues = [
      {
        project,
        issue,
        tasks: normalizedTasks,
        collapsed: false,
      },
    ];

    this.buildProjectHierarchy(this.ganttIssues);

    const sampleDates = normalizedTasks.flatMap((task) => {
      const dates: Date[] = [];
      if (task.startDate instanceof Date) {
        dates.push(task.startDate);
      }
      if (task.endDate instanceof Date) {
        dates.push(task.endDate);
      }
      return dates;
    });
    this.buildTimeline(sampleDates);
    this.cdr.markForCheck();
  }
}
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
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
import { ProgressGanttTimelineComponent } from './progress-gantt-timeline.component';
import { isJapaneseHoliday } from './japanese-holidays';
import { resolveIssueThemeColor } from '../../shared/issue-theme';

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

export interface GanttProjectGroup {
  project: Project;
  issues: GanttProjectIssue[];
}

export interface TimelineDay {
  date: Date;
  isWeekend: boolean;
  isHoliday: boolean;
  isToday: boolean;
  dayLabel: string;
  weekdayLabel: string;
}

export interface TimelineMonthSegment {
  label: string;
  span: number;
}

@Component({
  selector: 'app-progress-gantt',
  standalone: true,
  imports: [CommonModule, ProgressGanttTimelineComponent],
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

  @ViewChild(ProgressGanttTimelineComponent) timelineViewport?: ProgressGanttTimelineComponent;


  loading = false;
  loadError: string | null = null;

  ganttIssues: GanttIssue[] = [];
  visibleGanttIssues: GanttIssue[] = [];
  timeline: TimelineDay[] = [];
  timelineMonths: TimelineMonthSegment[] = [];
  totalDays = 0;
  timelineStart!: Date;
  timelineEnd!: Date;
  timelineWidth = 0;
  activeMonthLabel = '';
  currentScrollLeft = 0;
  hoveredDayIndex: number | null = null;
  hoveredTaskRange: Readonly<[number, number]> | null = null;
  hoveredTask: Task | null = null;

  selectedTask: Task | null = null;
  selectedIssue: Issue | null = null;
  selectedProject: Project | null = null;

  readonly tokyoTimezone = 'Asia/Tokyo';
  readonly dayCellWidth = 30;
  readonly labelColumnWidth = 280;

  projectHierarchy: GanttProjectGroup[] = [];
  availableProjects: Project[] = [];
  private selectedProjectIds = new Set<string>();

  private readonly monthFormatter = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    timeZone: this.tokyoTimezone,
  });

  private readonly weekdayFormatter = new Intl.DateTimeFormat('ja-JP', {
    weekday: 'short',
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

      for (const { project, issues } of issueResults) {
        for (const issue of issues) {
          if (!issue.id) {
            continue;
          }
          const tasks = await this.tasksService.listTasks(project.id!, issue.id, false);
          const hydratedTasks = tasks.map((task) => this.normalizeTaskDates(task));
          ganttIssues.push({ project, issue, tasks: hydratedTasks, collapsed: false });
        }
      }

      this.ganttIssues = ganttIssues;
      this.buildProjectHierarchy(ganttIssues);
      this.initializeProjectSelection(projects);
      this.applyProjectFilters();
      this.cdr.markForCheck();
    } catch (error) {
      console.error('ガントチャートのデータ読み込みに失敗しました:', error);
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

  handleTimelineDayHover(index: number | null): void {
    this.hoveredDayIndex = index;
    if (index !== null) {
      this.hoveredTask = null;
      this.hoveredTaskRange = null;
    }
  }

  handleTimelineCellHover(index: number | null): void {
    this.hoveredDayIndex = index;
    if (index !== null) {
      this.hoveredTask = null;
      this.hoveredTaskRange = null;
    }
  }

  handleTaskHover(task: Task | null): void {
    this.hoveredTask = task;
    this.hoveredTaskRange = task ? this.getTaskDayRange(task) : null;
  }

  selectTask(issue: GanttIssue, task: Task): void {
    this.selectedTask = task;
    this.selectedIssue = issue.issue;
    this.selectedProject = issue.project;
    this.cdr.markForCheck();
    this.goToTaskDetail(task, issue.issue, issue.project);
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

  isProjectSelected(projectId: string | undefined): boolean {
    if (!projectId) {
      return false;
    }
    return this.selectedProjectIds.has(projectId);
  }

  areAllProjectsSelected(): boolean {
    return (
      this.availableProjects.length > 0 &&
      this.availableProjects.every((project) => project.id && this.selectedProjectIds.has(project.id))
    );
  }

  onProjectSelectionChange(projectId: string | undefined, checked: boolean): void {
    if (!projectId) {
      return;
    }
    if (checked) {
      this.selectedProjectIds.add(projectId);
    } else {
      this.selectedProjectIds.delete(projectId);
    }
    this.applyProjectFilters();
  }

  toggleAllProjects(checked: boolean): void {
    if (checked) {
      for (const project of this.availableProjects) {
        if (project.id) {
          this.selectedProjectIds.add(project.id);
        }
      }
    } else {
      this.selectedProjectIds.clear();
    }
    this.applyProjectFilters();
  }

  trackByProjectId(_: number, project: Project): string | undefined {
    return project.id ?? project.name;
  }

  handleProjectSelectAll(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.toggleAllProjects(Boolean(input?.checked));
  }

  handleProjectFilterChange(projectId: string | undefined, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.onProjectSelectionChange(projectId, Boolean(input?.checked));
  }

  closeDetailPanel(): void {
    this.selectedTask = null;
    this.selectedIssue = null;
    this.selectedProject = null;
  }

  goToTaskDetail(
    task: Task | null = this.selectedTask,
    issue: Issue | null = this.selectedIssue,
    project: Project | null = this.selectedProject,
  ): void {
    const taskId = task?.id;
    const issueId = issue?.id;
    const projectId = project?.id;
    if (!taskId || !issueId || !projectId) {
      return;
    }
    void this.router.navigate([
      '/projects',
      projectId,
      'issues',
      issueId,
    ], {
      queryParams: { focus: taskId },
    });
  }

  scrollByWeeks(weeks: number): void {
    if (!this.timelineViewport) {
      return;
    }
    const element = this.timelineViewport.nativeElement;
    if (!element) {
      return;
    }
    const target = element.scrollLeft + weeks * 7 * this.dayCellWidth;
    this.setScrollPosition(target);
  }

  scrollByMonths(months: number): void {
    if (!this.timelineViewport || this.timeline.length === 0) {
      return;
    }
    const viewport = this.timelineViewport?.nativeElement;
    if (!viewport) {
      return;
    }
    const centerPosition = viewport.scrollLeft + viewport.clientWidth / 2;
    const centerIndex = Math.max(
      0,
      Math.min(this.timeline.length - 1, Math.round(centerPosition / this.dayCellWidth)),
    );
    const referenceDay = this.timeline[centerIndex] ?? this.timeline[0];
    const targetMonthStart = this.startOfMonth(this.addMonths(referenceDay.date, months));
    let targetIndex = this.timeline.findIndex(
      (day) =>
        day.date.getUTCFullYear() === targetMonthStart.getUTCFullYear() &&
        day.date.getUTCMonth() === targetMonthStart.getUTCMonth() &&
        day.date.getUTCDate() === targetMonthStart.getUTCDate(),
    );

    if (targetIndex < 0) {
      targetIndex = this.timeline.findIndex(
        (day) =>
          day.date.getUTCFullYear() === targetMonthStart.getUTCFullYear() &&
          day.date.getUTCMonth() === targetMonthStart.getUTCMonth(),
      );
    }

    if (targetIndex < 0) {
      targetIndex = months < 0 ? 0 : this.timeline.length - 1;
    }

    const target = targetIndex * this.dayCellWidth;
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
    const element = this.timelineViewport?.nativeElement;
    if (!element) {
      return;
    }
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

  isDayHighlighted(index: number): boolean {
    if (this.hoveredDayIndex === index) {
      return true;
    }
    if (this.hoveredTaskRange) {
      const [start, end] = this.hoveredTaskRange;
      return index >= start && index <= end;
    }
    return false;
  }

  isTaskHighlighted(task: Task): boolean {
    return this.isTaskHovered(task) || this.isTaskInHoveredDay(task);
  }

  private isTaskHovered(task: Task): boolean {
    return this.hoveredTask === task;
  }

  private isTaskInHoveredDay(task: Task): boolean {
    if (this.hoveredDayIndex === null) {
      return false;
    }
    const range = this.getTaskDayRange(task);
    if (!range) {
      return false;
    }
    const [start, end] = range;
    return this.hoveredDayIndex >= start && this.hoveredDayIndex <= end;
  }

  getIssueTheme(issue: Issue): string {
    const fallbackKey = issue.id ?? issue.projectId ?? issue.name ?? null;
    return resolveIssueThemeColor(issue.themeColor ?? null, fallbackKey);
  }

  getTaskTheme(task: Task, issue: Issue): string {
    const candidate = typeof task.themeColor === 'string' ? task.themeColor.trim() : '';
    if (candidate.length > 0) {
      return candidate;
    }
    return this.getIssueTheme(issue);
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
    return `${this.formatDayNumber(day.date)} (${this.weekdayFormatter.format(day.date)})`;
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
        isHoliday: isJapaneseHoliday(date),
        isToday: this.isSameDay(date, today),
        dayLabel: this.formatDayNumber(date),
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

  private initializeProjectSelection(projects: (Project & { id: string })[]): void {
    this.availableProjects = projects;
    this.selectedProjectIds = new Set(projects.map((project) => project.id));
  }

  private applyProjectFilters(): void {
    const activeIds = this.selectedProjectIds;
    const treatAsAll = activeIds.size === 0 && this.availableProjects.length === 0;
    const visible = this.ganttIssues.filter((group) => {
      const projectId = group.project.id;
      if (!projectId) {
        return treatAsAll;
      }
      if (treatAsAll) {
        return true;
      }
      if (activeIds.size === 0) {
        return false;
      }
      return activeIds.has(projectId);
    });

    this.visibleGanttIssues = visible;
    this.ensureSelectionVisibility(visible);

    const taskDates = visible.flatMap((group) =>
      group.tasks.flatMap((task) => {
        const dates: Date[] = [];
        if (task.startDate instanceof Date) {
          dates.push(task.startDate);
        }
        if (task.endDate instanceof Date) {
          dates.push(task.endDate);
        }
        return dates;
      }),
    );

    this.buildTimeline(taskDates);
    this.cdr.markForCheck();
  }

  private ensureSelectionVisibility(groups: GanttIssue[]): void {
    if (!this.selectedTask || !this.selectedTask.id) {
      return;
    }

    const isVisible = groups.some((group) => {
      if (!group.project.id || !group.issue.id) {
        return false;
      }
      if (group.project.id !== this.selectedProject?.id || group.issue.id !== this.selectedIssue?.id) {
        return false;
      }
      return group.tasks.some((task) => task.id === this.selectedTask?.id);
    });

    if (!isVisible) {
      this.closeDetailPanel();
    }
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

  private getTaskDayRange(task: Task): Readonly<[number, number]> | null {
    if (!this.timelineStart || this.timeline.length === 0) {
      return null;
    }
    const start = this.getEffectiveStart(task);
    const end = this.getEffectiveEnd(task);
    if (!start || !end) {
      return null;
    }
    const startIndex = Math.max(0, Math.min(this.timeline.length - 1, this.diffInDays(start, this.timelineStart)));
    const endIndex = Math.max(startIndex, Math.min(this.timeline.length - 1, this.diffInDays(end, this.timelineStart)));
    return [startIndex, endIndex];
  }

  private formatDayNumber(date: Date): string {
    const day = date.getUTCDate();
    return day.toString().padStart(2, '0');
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

  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setUTCMonth(result.getUTCMonth() + months);
    return result;
  }

  private startOfMonth(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
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
    if (!element) {
      return;
    }
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
}
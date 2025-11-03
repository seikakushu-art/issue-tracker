import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
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

interface TimelineDay {
  date: Date;
  isWeekend: boolean;
}

@Component({
  selector: 'app-progress-gantt',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progress-gantt.component.html',
  styleUrls: ['./progress-gantt.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgressGanttComponent implements OnInit {
  private projectsService = inject(ProjectsService);
  private issuesService = inject(IssuesService);
  private tasksService = inject(TasksService);
  private router = inject(Router);

  loading = false;
  loadError: string | null = null;

  ganttIssues: GanttIssue[] = [];
  timeline: TimelineDay[] = [];
  totalDays = 0;
  timelineStart!: Date;
  timelineEnd!: Date;

  selectedTask: Task | null = null;
  selectedIssue: Issue | null = null;
  selectedProject: Project | null = null;

  readonly tokyoTimezone = 'Asia/Tokyo';

  ngOnInit(): void {
    void this.loadData();
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
      this.buildTimeline(allTaskDates);
    } catch (error) {
      console.error('ガントチャートのデータ読み込みに失敗しました:', error);
      this.loadError = 'リアルデータの取得に失敗したため、サンプルデータを表示しています。';
      this.applySampleData();
    } finally {
      this.loading = false;
    }
  }

  toggleIssue(issue: GanttIssue): void {
    issue.collapsed = !issue.collapsed;
  }

  getGridTemplate(): string {
    return this.timeline.length > 0 ? `repeat(${this.timeline.length}, minmax(56px, 1fr))` : '';
  }

  selectTask(issue: GanttIssue, task: Task): void {
    this.selectedTask = task;
    this.selectedIssue = issue.issue;
    this.selectedProject = issue.project;
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
    return new Intl.DateTimeFormat('ja-JP', {
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      timeZone: this.tokyoTimezone,
    }).format(day.date);
  }

  private buildTimeline(allDates: Date[]): void {
    if (allDates.length === 0) {
      const today = this.toTokyoDate(new Date());
      this.timelineStart = this.startOfWeek(today);
      this.timelineEnd = this.endOfWeek(today);
    } else {
      const sorted = allDates.map((d) => this.toTokyoDate(d)).sort((a, b) => a.getTime() - b.getTime());
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      this.timelineStart = this.startOfWeek(min);
      this.timelineEnd = this.endOfWeek(max);
    }

    const days: TimelineDay[] = [];
    const cursor = new Date(this.timelineStart);
    while (cursor.getTime() <= this.timelineEnd.getTime()) {
      days.push({
        date: new Date(cursor),
        isWeekend: cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    this.timeline = days;
    this.totalDays = Math.max(1, days.length);
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
  }
}
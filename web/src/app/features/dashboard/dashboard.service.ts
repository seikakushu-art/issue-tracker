import { Injectable, inject } from '@angular/core';
import { ProjectsService } from '../projects/projects.service';
import { IssuesService } from '../issues/issues.service';
import { TasksService } from '../tasks/tasks.service';
import { Issue, Project, Role, Task } from '../../models/schema';
import { UserProfileService } from '../../core/user-profile.service';

/**
 * 課題に紐づくタスク配列を含めた拡張型
 */
export interface IssueWithTasks extends Issue {
  tasks: Task[];
}

/**
 * プロジェクトに課題とタスクのツリーを紐づけた拡張型
 */
export type ProjectSnapshot = Project & {
  issues: IssueWithTasks[];
  /** クライアント側で参照しやすいようroleを必須化 */
  currentRole: Role;
};

/**
 * プロジェクトカード向けのメトリクス
 */
export interface ProjectCardMetric {
  projectId: string;
  name: string;
  progress: number;
  issueCount: number;
  memberCount: number;
  highPriorityBacklog: number;
  overdue: boolean;
  warningLevel: 'ok' | 'warning' | 'danger';
  elapsedRatio: number | null;
  startDate: Date | null | undefined;
  endDate: Date | null | undefined;
  donutChart: {
    completed: number;
    remaining: number;
  };
  statusBars: { label: string; value: number }[];
}

/**
 * ボトルネック検知結果
 */
export interface BottleneckInsight {
  type: 'zero_progress_deadline' | 'long_on_hold' | 'critical_unassigned' | 'stalled_issue';
  label: string;
  projectId: string;
  issueId?: string;
  taskId?: string;
  severity: 'info' | 'warning' | 'danger';
}

/**
 * ダッシュボード全体の取得結果
 */
export interface DashboardSnapshot {
  projects: ProjectSnapshot[];
  projectCards: ProjectCardMetric[];
  bottlenecks: BottleneckInsight[];
}

/**
 * 掲示板プレビュー用の投稿スケルトン
 */
export interface BulletinPreviewItem {
  id: string;
  title: string;
  authorId: string;
  authorUsername: string;
  authorPhotoUrl: string | null;
  author: string;
  postedAt: Date;
  excerpt: string;
  href: string;
  fragment?: string | null;
}

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly projectsService = inject(ProjectsService);
  private readonly issuesService = inject(IssuesService);
  private readonly tasksService = inject(TasksService);
  private readonly userProfileService = inject(UserProfileService);

  /** 期限間近扱いとする閾値（日単位） */
  private static readonly DEADLINE_ALERT_THRESHOLD_DAYS = 3;
  /** 保留状態が長期化とみなす日数 */
  private static readonly ON_HOLD_ALERT_DAYS = 7;
  /** 課題停滞を判定する日数 */
  private static readonly ISSUE_STALLED_DAYS = 14;

  /**
   * ログインユーザーがアクセス可能なプロジェクトを横断的に取得する
   */
  async loadSnapshot(): Promise<DashboardSnapshot> {
    const projects = await this.projectsService.listMyProjects();
    // currentRole がオプションのため、未設定時は読み替える
    const resolvedRoleProjects = projects
      .filter((project): project is Project & { id: string } => Boolean(project.id))
      .map((project) => ({
        ...project,
        currentRole: project.currentRole ?? 'guest',
      }));

    const projectsWithRelations: ProjectSnapshot[] = await Promise.all(
      resolvedRoleProjects.map(async (project) => {
        const issues = await this.issuesService.listIssues(project.id!, false);
        const issueWithTasks = await Promise.all(
          issues
            .filter((issue): issue is Issue & { id: string } => Boolean(issue.id))
            .map(async (issue) => {
              const tasks = await this.tasksService.listTasks(project.id!, issue.id!);
              return { ...issue, tasks } as IssueWithTasks;
            }),
        );
        return {
          ...project,
          issues: issueWithTasks,
        };
      }),
    );

    const projectCards = this.buildProjectCards(projectsWithRelations);
    const currentUserId = this.userProfileService.user()?.uid ?? null;
    const bottlenecks = this.detectBottlenecks(projectsWithRelations, currentUserId);

    return {
      projects: projectsWithRelations,
      projectCards,
      bottlenecks,
    };
  }

  /**
   * プロジェクトカードの表示用情報を組み立てる
   */
  private buildProjectCards(projects: ProjectSnapshot[]): ProjectCardMetric[] {
    const now = new Date();
    return projects.map((project) => {
      const issueCount = project.issues.length;
      const memberCount = (project.memberIds ?? []).length;

      const allTasks = project.issues.flatMap((issue) => issue.tasks);
      const progress = typeof project.progress === 'number'
        ? project.progress
        : this.calculateAverageProgress(allTasks);

      const highPriorityBacklog = allTasks.filter((task) =>
        (task.importance === 'Critical' || task.importance === 'High') &&
        task.status !== 'completed' &&
        task.status !== 'discarded',
      ).length;

      const overdue = Boolean(
        project.endDate &&
        this.normalizeDate(project.endDate) &&
        this.normalizeToEndOfDay(this.normalizeDate(project.endDate)!) < now &&
        progress < 100
      );

      const elapsedRatio = this.calculateElapsedRatio(project.startDate ?? null, project.endDate ?? null, now);
      const warningLevel = this.resolveWarningLevel(progress, elapsedRatio);

      const statusBars = this.buildStatusBars(allTasks);

      return {
        projectId: project.id!,
        name: project.name,
        progress,
        issueCount,
        memberCount,
        highPriorityBacklog,
        overdue,
        warningLevel,
        elapsedRatio,
        startDate: project.startDate ?? null,
        endDate: project.endDate ?? null,
        donutChart: {
          completed: Math.round(progress),
          remaining: Math.max(0, 100 - Math.round(progress)),
        },
        statusBars,
      };
    });
  }

  /**
   * ボトルネック検知ロジック
   * 現在のユーザーが担当しているタスクのみを対象とする
   */
  private detectBottlenecks(projects: ProjectSnapshot[], currentUserId: string | null): BottleneckInsight[] {
    const now = new Date();
    const insights: BottleneckInsight[] = [];

    // ユーザーIDが取得できない場合は空配列を返す
    if (!currentUserId) {
      return insights;
    }

    for (const project of projects) {
      for (const issue of project.issues) {
        const issueUpdatedAt = issue.createdAt ? this.normalizeDate(issue.createdAt) : null;
        for (const task of issue.tasks) {
          // 現在のユーザーが担当しているタスクのみを対象とする
          if (!task.assigneeIds || !task.assigneeIds.includes(currentUserId)) {
            continue;
          }

          const endDate = task.endDate ? this.normalizeDate(task.endDate) : null;
          const createdAt = task.createdAt ? this.normalizeDate(task.createdAt) : null;

          if (
            task.status !== 'completed' &&
            task.status !== 'discarded' &&
            (task.progress ?? 0) === 0 &&
            endDate
          ) {
            const daysUntil = this.daysUntilDeadline(now, endDate);
            if (daysUntil >= 0 && daysUntil <= DashboardService.DEADLINE_ALERT_THRESHOLD_DAYS) {
              insights.push({
                type: 'zero_progress_deadline',
                label: '進捗0%で期限間近',
                projectId: project.id!,
                issueId: issue.id!,
                taskId: task.id!,
                severity: 'danger',
              });
            }
          }

          if (
            task.status === 'on_hold' &&
            createdAt &&
            this.diffInDays(now, createdAt) >= DashboardService.ON_HOLD_ALERT_DAYS
          ) {
            insights.push({
              type: 'long_on_hold',
              label: '保留状態が7日以上継続',
              projectId: project.id!,
              issueId: issue.id!,
              taskId: task.id!,
              severity: 'warning',
            });
          }
        }

        // 進捗が停滞している課題の判定は、現在のユーザーが担当しているタスクを含む課題のみを対象とする
        const userTasks = issue.tasks.filter((task) => 
          task.assigneeIds && task.assigneeIds.includes(currentUserId)
        );
        
        if (
          userTasks.length > 0 &&
          (issue.progress ?? this.calculateAverageProgress(userTasks)) <= 25
        ) {
          const referenceDate = issueUpdatedAt ?? userTasks
            .map((task) => task.createdAt ? this.normalizeDate(task.createdAt) : null)
            .filter((date): date is Date => Boolean(date))
            .sort((a, b) => b.getTime() - a.getTime())[0];

          if (referenceDate && this.diffInDays(now, referenceDate) >= DashboardService.ISSUE_STALLED_DAYS) {
            insights.push({
              type: 'stalled_issue',
              label: '進捗が停滞している課題',
              projectId: project.id!,
              issueId: issue.id!,
              severity: 'info',
            });
          }
        }
      }
    }

    return insights;
  }

  /**
   * 掲示板プレビュー向けのプレースホルダー投稿を返す
   */
  getBulletinPlaceholder(): BulletinPreviewItem[] {
    const now = new Date();
    return [
      {
        id: 'draft-release-note',
        title: 'バージョン2.1 リリース準備メモ',
        authorId: 'placeholder-owner',
        authorUsername: 'プロダクトオーナー',
        authorPhotoUrl: null,
        author: 'プロダクトオーナー',
        postedAt: new Date(now.getTime() - 1000 * 60 * 60 * 4),
        excerpt: 'UIの最終確認とQA結果の共有をお願いします。',
        href: '#',
        fragment: null,
      },
      {
        id: 'security-training',
        title: '来週のセキュリティ研修について',
        authorId: 'placeholder-security',
        authorUsername: '情シスチーム',
        authorPhotoUrl: null,
        author: '情シスチーム',
        postedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24),
        excerpt: '参加登録フォームと事前資料のリンクを共有します。',
        href: '#',
        fragment: null,
      },
      {
        id: 'customer-voice',
        title: '顧客ヒアリング抜粋',
        authorId: 'placeholder-cs',
        authorUsername: 'CS担当',
        authorPhotoUrl: null,
        author: 'CS担当',
        postedAt: new Date(now.getTime() - 1000 * 60 * 60 * 36),
        excerpt: '運用フローの改善要求が増えています。',
        href: '#',
        fragment: null,
      },
    ];
  }

  /** 日時をDate型へ正規化する簡易ヘルパー */
  private normalizeDate(value: Date | string): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** 課題・タスク配下の平均進捗を算出する */
  private calculateAverageProgress(tasks: Task[]): number {
    if (!tasks.length) {
      return 0;
    }
    const sum = tasks.reduce((acc, task) => acc + (task.progress ?? (task.status === 'completed' ? 100 : 0)), 0);
    return sum / tasks.length;
  }

  /** 経過日数比を算出する（0〜1に正規化） */
  private calculateElapsedRatio(start: Date | null | undefined, end: Date | null | undefined, reference: Date): number | null {
    const startDate = start ? this.normalizeDate(start) : null;
    const endDate = end ? this.normalizeDate(end) : null;
    if (!startDate || !endDate || endDate <= startDate) {
      return null;
    }
    const total = endDate.getTime() - startDate.getTime();
    const elapsed = Math.min(Math.max(reference.getTime() - startDate.getTime(), 0), total);
    return total === 0 ? null : elapsed / total;
  }

  /** 進捗と経過比から警告レベルを算定する */
  private resolveWarningLevel(progress: number, elapsedRatio: number | null): 'ok' | 'warning' | 'danger' {
    if (elapsedRatio === null) {
      return 'ok';
    }
    const progressRatio = progress / 100;
    const delta = elapsedRatio - progressRatio;
    if (delta >= 0.25) {
      return 'danger';
    }
    if (delta >= 0.1) {
      return 'warning';
    }
    return 'ok';
  }

  /** 状態別棒グラフ用データを作成する */
  private buildStatusBars(tasks: Task[]): { label: string; value: number }[] {
    if (!tasks.length) {
      return [
        { label: '未着手', value: 0 },
        { label: '進行中', value: 0 },
        { label: '保留', value: 0 },
        { label: '完了', value: 0 },
      ];
    }
    const counts = tasks.reduce(
      (acc, task) => {
        if (task.status === 'completed') {
          acc.done += 1;
        } else if (task.status === 'in_progress') {
          acc.active += 1;
        } else if (task.status === 'on_hold') {
          acc.onHold += 1;
        } else {
          acc.todo += 1;
        }
        return acc;
      },
      { todo: 0, active: 0, done: 0, onHold: 0 },
    );
    return [
      { label: '未着手', value: counts.todo },
      { label: '進行中', value: counts.active },
      { label: '保留', value: counts.onHold },
      { label: '完了', value: counts.done },
    ];
  }

  /** 2つの日付の差分を日数で返す（絶対値） */
  private diffInDays(a: Date, b: Date): number {
    const diff = a.getTime() - b.getTime();
    return Math.abs(Math.floor(diff / (1000 * 60 * 60 * 24)));
  }

  private readonly tokyoTimezone = 'Asia/Tokyo';

  /** 東京時間での日付部分を取得するヘルパー */
  private getTokyoDateParts(date: Date): { year: number; month: number; day: number } {
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: this.tokyoTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    return {
      year: parseInt(parts.find((p) => p.type === 'year')!.value, 10),
      month: parseInt(parts.find((p) => p.type === 'month')!.value, 10) - 1, // 0-indexed
      day: parseInt(parts.find((p) => p.type === 'day')!.value, 10),
    };
  }

  /** 締切日を当日の終了時刻（23:59:59.999）に正規化する */
  private normalizeToEndOfDay(date: Date): Date {
    const { year, month, day } = this.getTokyoDateParts(date);
    return new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  }

  /** 現在日時から期限までの日数を計算する（期限が過去の場合は負の値、東京時間ベース） */
  private daysUntilDeadline(now: Date, deadline: Date): number {
    // 日付のみを比較するため、時刻を00:00:00に設定（東京時間ベース）
    const nowParts = this.getTokyoDateParts(now);
    const deadlineParts = this.getTokyoDateParts(deadline);
    const nowDate = new Date(Date.UTC(nowParts.year, nowParts.month, nowParts.day));
    const deadlineDate = new Date(Date.UTC(deadlineParts.year, deadlineParts.month, deadlineParts.day));
    const diff = deadlineDate.getTime() - nowDate.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }
}
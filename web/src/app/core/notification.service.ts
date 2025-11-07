import { Injectable, inject } from '@angular/core';
import {
  DocumentData,
  Firestore,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';

import { Timestamp } from '@angular/fire/firestore';
import { Importance, Project, Task, TaskStatus } from '../models/schema';

/**
 * 重要タスクカードで利用するメンション要約
 */
export interface MentionSummary {
  id: string;
  text: string;
  createdBy: string;
  createdAt: Date;
}

/**
 * カードに表示するハイライト理由の種類
 */
export type HighlightReason =
  | 'due_today'
  | 'overdue'
  | 'on_hold'
  | 'no_progress'
  | 'mentioned';

/**
 * ダッシュボード上で扱うタスクカードDTO
 */
export interface ActionableTaskCard {
  taskId: string;
  projectId: string;
  issueId: string;
  title: string;
  importance: Importance | null;
  status: TaskStatus;
  statusLabel: string;
  dueDate: Date | null;
  projectName: string;
  highlightReasons: HighlightReason[];
  highlightDetails: { reason: HighlightReason; label: string }[];
  badge: {
    color: string;
    label: string;
    reason: HighlightReason | null;
  };
  mentionCount: number;
  mentions: MentionSummary[];
  latestMentionAt: Date | null;
}

/**
 * 当日終了タスクの通知情報
 */
export interface DueTodayNotification {
  taskId: string;
  projectId: string;
  issueId: string;
  projectName: string;
  issueName: string | null;
  title: string;
  importance: Importance | null;
  dueDate: Date | null;
  assigneeIds: string[];
}

/**
 * メンション通知のDTO
 */
export interface MentionNotification {
  id: string;
  projectId: string;
  issueId: string;
  taskId: string;
  projectName: string;
  issueName: string | null;
  taskTitle: string;
  commentText: string;
  createdAt: Date | null;
  createdBy: string;
}

interface MentionEntry {
  id: string;
  projectId: string;
  issueId: string;
  taskId: string;
  commentText: string;
  createdBy: string;
  createdAt: Date | null;
  projectName: string;
  issueName: string | null;
}

/**
 * アプリ起動時にまとめて表示する通知セット
 */
export interface StartupNotifications {
  dueTodayTasks: DueTodayNotification[];
  mentions: MentionNotification[];
}


/**
 * 通知/ダッシュボード用のタスク抽出を行うサービス
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private db = inject(Firestore);
  private auth = inject(Auth);
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

  /** 東京時間での本日の開始時刻（00:00:00）を取得 */
  private getStartOfToday(now: Date): Date {
    const { year, month, day } = this.getTokyoDateParts(now);
    return new Date(Date.UTC(year, month, day));
  }

  /** 東京時間での本日の終了時刻（23:59:59.999）を取得 */
  private getEndOfToday(now: Date): Date {
    const { year, month, day } = this.getTokyoDateParts(now);
    return new Date(Date.UTC(year, month, day, 23, 59, 59, 999));
  }

  /** 日付を東京時間での日付部分のみに正規化（時間部分を00:00:00にリセット） */
  private normalizeToTokyoDate(date: Date): Date {
    const { year, month, day } = this.getTokyoDateParts(date);
    return new Date(Date.UTC(year, month, day));
  }

  /**
   * Firestoreから取得した日時をDate型へ統一する
   */
  private normalizeDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (value instanceof Timestamp) {
      const converted = value.toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      'toDate' in value &&
      typeof (value as { toDate: () => Date }).toDate === 'function'
    ) {
      const converted = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(converted.getTime()) ? null : converted;
    }

    const parsed = new Date(value as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * ステータスに対応するラベルを日本語で返却する
   */
  private getStatusLabel(status: TaskStatus): string {
    const labels: Record<TaskStatus, string> = {
      incomplete: '未完了',
      in_progress: '進行中',
      completed: '完了',
      on_hold: '保留',
      discarded: '破棄',
    };
    return labels[status];
  }

  /**
   * ハイライト理由ごとの表示ラベル
   */
  private readonly highlightLabels: Record<HighlightReason, string> = {
    due_today: '本日締切',
    overdue: '期限超過',
    on_hold: '保留継続',
    no_progress: '進捗0%',
    mentioned: 'メンションあり',
  };

  /**
   * ハイライト理由ごとのバッジ色
   */
  private readonly highlightColors: Record<HighlightReason, string> = {
    overdue: '#dc2626',
    due_today: '#f97316',
    on_hold: '#7c3aed',
    no_progress: '#4b5563',
    mentioned: '#2563eb',
  };

  /**
   * メンションコメントを最新順で取得する
   */
  private async fetchRecentMentions(
    projectId: string,
    issueId: string,
    taskId: string,
    uid: string,
    take: number
  ): Promise<MentionSummary[]> {
    const commentRef = collection(
      this.db,
      `projects/${projectId}/issues/${issueId}/tasks/${taskId}/comments`
    );
    const q = query(
      commentRef,
      where('mentions', 'array-contains', uid),
      orderBy('createdAt', 'desc'),
      limit(take)
    );
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;
      const createdAt = this.normalizeDate(data['createdAt']);
      return {
        id: docSnap.id,
        text: (data['text'] as string) ?? '',
        createdBy: (data['createdBy'] as string) ?? '',
        createdAt: createdAt ?? new Date(0),
      } satisfies MentionSummary;
    });
  }

  /**
   * ハイライト優先度の定義（前方ほど優先度が高い）
   */
  private readonly highlightPriority: HighlightReason[] = [
    'overdue',
    'due_today',
    'on_hold',
    'no_progress',
    'mentioned',
  ];

  /**
   * 重要度のソート優先度
   */
  private readonly importanceRank: Record<Importance, number> = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
  } as const;

  /**
   * 指定ユーザー向けのアクション可能タスクカードをまとめて取得する
   */
  async getActionableTaskCards(options: { limit?: number; mentionTake?: number } = {}): Promise<ActionableTaskCard[]> {
    const uid = this.auth.currentUser?.uid;
    if (!uid) {
      return [];
    }

    const take = options.limit ?? 30;
    const mentionTake = options.mentionTake ?? 3;
    const now = new Date();
    const startOfToday = this.getStartOfToday(now);

    const tasksRef = collectionGroup(this.db, 'tasks');
    const taskQuery = query(
      tasksRef,
      where('assigneeIds', 'array-contains', uid),
      where('archived', '==', false),
      where('status', 'in', ['incomplete', 'in_progress', 'on_hold'])
    );
    const snapshot = await getDocs(taskQuery);

    const candidates = snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Task;
        const dueDate = this.normalizeDate((data as unknown as Record<string, unknown>)['endDate']);
        const progress = typeof data.progress === 'number' ? data.progress : 0;
        const highlightReasons: HighlightReason[] = [];

        if (dueDate) {
          // 東京時間での日付部分のみを比較
          const dueDateNormalized = this.normalizeToTokyoDate(dueDate);
          const startOfTodayNormalized = this.normalizeToTokyoDate(startOfToday);
          
          if (dueDateNormalized < startOfTodayNormalized) {
            highlightReasons.push('overdue');
          } else if (dueDateNormalized.getTime() === startOfTodayNormalized.getTime()) {
            highlightReasons.push('due_today');
          }
        }

        if (data.status === 'on_hold') {
          highlightReasons.push('on_hold');
        }

        if (progress <= 0) {
          highlightReasons.push('no_progress');
        }

        return {
          docSnap,
          data,
          dueDate,
          progress,
          highlightReasons,
        };
      })
      .filter((entry) => entry.data.projectId && entry.data.issueId);

    const projectIds = new Set<string>();

    // メンションを取得しつつ、最終的に表示対象のみを残す
    const enriched = (
      await Promise.all(
        candidates.map(async (candidate) => {
          const { data, dueDate, docSnap } = candidate;
          const mentions = await this.fetchRecentMentions(
            data.projectId,
            data.issueId,
            docSnap.id,
            uid,
            mentionTake
          );
          const reasons = new Set<HighlightReason>(candidate.highlightReasons);
          if (mentions.length > 0) {
            reasons.add('mentioned');
          }

          if (reasons.size === 0) {
            return null;
          }

          projectIds.add(data.projectId);
          return {
            docId: docSnap.id,
            task: data,
            dueDate,
            highlightReasons: Array.from(reasons),
            mentions,
          };
        })
      )
    ).filter((value): value is {
      docId: string;
      task: Task;
      dueDate: Date | null;
      highlightReasons: HighlightReason[];
      mentions: MentionSummary[];
    } => value !== null);

    if (enriched.length === 0) {
      return [];
    }

    const projectMap = new Map<string, Project>();
    await Promise.all(
      Array.from(projectIds).map(async (projectId) => {
        const projectSnap = await getDoc(doc(this.db, 'projects', projectId));
        if (projectSnap.exists()) {
          projectMap.set(projectId, projectSnap.data() as Project);
        }
      })
    );

    const cards: ActionableTaskCard[] = enriched.map((item) => {
      const project = projectMap.get(item.task.projectId);
      const projectName = project?.name ?? '不明なプロジェクト';
      const primaryReason = this.highlightPriority.find((reason) =>
        item.highlightReasons.includes(reason)
      );

      const latestMentionAt = item.mentions[0]?.createdAt ?? null;

      return {
        taskId: item.docId,
        projectId: item.task.projectId,
        issueId: item.task.issueId,
        title: item.task.title,
        importance: item.task.importance ?? null,
        status: item.task.status,
        statusLabel: this.getStatusLabel(item.task.status),
        dueDate: item.dueDate,
        projectName,
        highlightReasons: item.highlightReasons,
        highlightDetails: item.highlightReasons.map((reason) => ({
          reason,
          label: this.highlightLabels[reason],
        })),
        badge: {
          color: primaryReason ? this.highlightColors[primaryReason] : '#6b7280',
          label: primaryReason ? this.highlightLabels[primaryReason] : '注目',
          reason: primaryReason ?? null,
        },
        mentionCount: item.mentions.length,
        mentions: item.mentions,
        latestMentionAt,
      } satisfies ActionableTaskCard;
    });

    cards.sort((a, b) => {
      const importanceA = a.importance ? this.importanceRank[a.importance] : Number.MAX_SAFE_INTEGER;
      const importanceB = b.importance ? this.importanceRank[b.importance] : Number.MAX_SAFE_INTEGER;
      if (importanceA !== importanceB) {
        return importanceA - importanceB;
      }

      const dueA = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
      const dueB = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
      if (dueA !== dueB) {
        return dueA - dueB;
      }

      const mentionA = a.latestMentionAt ? a.latestMentionAt.getTime() : 0;
      const mentionB = b.latestMentionAt ? b.latestMentionAt.getTime() : 0;
      if (mentionA !== mentionB) {
        return mentionB - mentionA;
      }

      return a.title.localeCompare(b.title);
    });

    return cards.slice(0, take);
  }

  /**
   * アプリ起動時に提示する通知群を取得する
   */
  async getStartupNotifications(options: { dueLimit?: number; mentionLimit?: number } = {}): Promise<StartupNotifications> {
    const dueLimit = options.dueLimit ?? 50;
    const mentionLimit = options.mentionLimit ?? 20;

    // 当日終了タスクの抽出
    const dueTodayTasks = await this.fetchDueTodayNotifications(dueLimit);

    // メンション通知はログインユーザーが存在する場合のみ取得する
    const uid = this.auth.currentUser?.uid;
    const mentionNotifications = uid
      ? await this.fetchMentionNotifications(uid, mentionLimit)
      : [];

    return {
      dueTodayTasks,
      mentions: mentionNotifications,
    } satisfies StartupNotifications;
  }

  /**
   * 当日終了タスクを抽出し通知形式に整形する
   */
  private async fetchDueTodayNotifications(limitSize: number): Promise<DueTodayNotification[]> {
    const tasksRef = collectionGroup(this.db, 'tasks');
    const snapshot = await getDocs(
      query(
        tasksRef,
        where('archived', '==', false),
        where('status', 'in', ['incomplete', 'in_progress', 'on_hold'])
      ),
    );

    const now = new Date();
    const startOfToday = this.getStartOfToday(now);
    const endOfToday = this.getEndOfToday(now);
    
    console.log('[通知デバッグ] 検索条件:', {
      now: now.toISOString(),
      startOfToday: startOfToday.toISOString(),
      endOfToday: endOfToday.toISOString(),
      totalTasks: snapshot.docs.length,
    });

    const candidateTasks = snapshot.docs
      .map((docSnap) => ({
        id: docSnap.id,
        data: docSnap.data() as Task,
      }))
      .filter((entry) => {
        const data = entry.data;
        const dueDateRaw = this.normalizeDate((data as unknown as Record<string, unknown>)['endDate']);
        if (!dueDateRaw) {
          return false;
        }
        // 東京時間での日付部分のみを比較
        const dueDateNormalized = this.normalizeToTokyoDate(dueDateRaw);
        const startOfTodayNormalized = this.normalizeToTokyoDate(startOfToday);
        
        // デバッグログ
        console.log('[通知デバッグ] タスク:', {
          title: data.title,
          endDateRaw: dueDateRaw.toISOString(),
          endDateNormalized: dueDateNormalized.toISOString(),
          startOfTodayNormalized: startOfTodayNormalized.toISOString(),
          isMatch: dueDateNormalized.getTime() === startOfTodayNormalized.getTime(),
          projectId: data.projectId,
          issueId: data.issueId,
          status: data.status,
          archived: data.archived,
        });
        
        return (
          Boolean(data.projectId) &&
          Boolean(data.issueId) &&
          dueDateNormalized.getTime() === startOfTodayNormalized.getTime()
        );
      });

    if (candidateTasks.length === 0) {
      console.log('[通知デバッグ] 本日終了タスクが見つかりませんでした');
      return [];
    }
    
    console.log('[通知デバッグ] 本日終了タスク候補:', candidateTasks.length, '件');

    const projectIds = new Set<string>();
    const issueRefs = new Map<string, { projectId: string; issueId: string }>();

    const tasks: DueTodayNotification[] = candidateTasks.map((entry) => {
      const task = entry.data;
      const dueDate = this.normalizeDate((task as unknown as Record<string, unknown>)['endDate']);
      const projectId = task.projectId;
      const issueId = task.issueId;
      projectIds.add(projectId);
      issueRefs.set(`${projectId}/${issueId}`, { projectId, issueId });
      return {
        taskId: entry.id,
        projectId,
        issueId,
        projectName: 'loading',
        issueName: null,
        title: task.title,
        importance: task.importance ?? null,
        dueDate: dueDate ?? endOfToday,
        assigneeIds: Array.isArray(task.assigneeIds) ? task.assigneeIds : [],
      } satisfies DueTodayNotification;
    });

    const projectMap = await this.fetchProjectNames(projectIds);
    const issueMap = await this.fetchIssueNames(issueRefs);
    for (const task of tasks) {
      task.projectName = projectMap.get(task.projectId) ?? '不明なプロジェクト';
      task.issueName = issueMap.get(`${task.projectId}/${task.issueId}`) ?? null;
    }

    tasks.sort((a, b) => {
      const importanceA = a.importance ? this.importanceRank[a.importance] : Number.MAX_SAFE_INTEGER;
      const importanceB = b.importance ? this.importanceRank[b.importance] : Number.MAX_SAFE_INTEGER;
      if (importanceA !== importanceB) {
        return importanceA - importanceB;
      }
      const dueA = a.dueDate ? a.dueDate.getTime() : Number.POSITIVE_INFINITY;
      const dueB = b.dueDate ? b.dueDate.getTime() : Number.POSITIVE_INFINITY;
      if (dueA !== dueB) {
        return dueA - dueB;
      }
      return a.title.localeCompare(b.title);
    });

    return tasks.slice(0, limitSize);
  }

  /**
   * メンション通知を抽出して整形する
   */
  private async fetchMentionNotifications(uid: string, limitSize: number): Promise<MentionNotification[]> {
    const commentsRef = collectionGroup(this.db, 'comments');
    const commentQuery = query(
      commentsRef,
      where('mentions', 'array-contains', uid),
      orderBy('createdAt', 'desc'),
      limit(limitSize),
    );
    const snapshot = await getDocs(commentQuery);

    if (snapshot.empty) {
      return [];
    }

    const projectIds = new Set<string>();
    const issueRefs = new Map<string, { projectId: string; issueId: string }>();
    const taskRefs = new Map<string, { projectId: string; issueId: string; taskId: string }>();

    const commentEntries: MentionEntry[] = [];
    for (const docSnap of snapshot.docs) {
      const pathSegments = docSnap.ref.path.split('/');
      if (pathSegments.length < 8) {
        continue;
      }
      const projectId = pathSegments[1];
      const issueId = pathSegments[3];
      const taskId = pathSegments[5];
      projectIds.add(projectId);
      issueRefs.set(`${projectId}/${issueId}`, { projectId, issueId });
      taskRefs.set(`${projectId}/${issueId}/${taskId}`, { projectId, issueId, taskId });
      const data = docSnap.data() as Record<string, unknown>;
      commentEntries.push({
        id: docSnap.id,
        projectId,
        issueId,
        taskId,
        commentText: typeof data['text'] === 'string' ? data['text'] : '',
        createdBy: typeof data['createdBy'] === 'string' ? data['createdBy'] : '',
        createdAt: this.normalizeDate(data['createdAt']),
        projectName: 'loading',
        issueName: null,
      });
    }

    if (commentEntries.length === 0) {
      return [];
    }

    const taskDetails = await this.fetchTaskSnapshots(taskRefs);
    const projectMap = await this.fetchProjectNames(projectIds);
    const issueMap = await this.fetchIssueNames(issueRefs);

    for (const entry of commentEntries) {
      entry.projectName = projectMap.get(entry.projectId) ?? '不明なプロジェクト';
      entry.issueName = issueMap.get(`${entry.projectId}/${entry.issueId}`) ?? null;
    }

    return commentEntries
      .map((entry) => {
        const taskKey = `${entry.projectId}/${entry.issueId}/${entry.taskId}`;
        const task = taskDetails.get(taskKey);
        const title = task?.title ?? '不明なタスク';
        return {
          id: entry.id,
          projectId: entry.projectId,
          issueId: entry.issueId,
          taskId: entry.taskId,
          taskTitle: title,
          projectName: entry.projectName,
          issueName: entry.issueName,
          commentText: entry.commentText,
          createdAt: entry.createdAt ?? null,
          createdBy: entry.createdBy,
        } satisfies MentionNotification;
      })
      .sort((a, b) => {
        const timeA = a.createdAt ? a.createdAt.getTime() : 0;
        const timeB = b.createdAt ? b.createdAt.getTime() : 0;
        return timeB - timeA;
      });
  }

  /**
   * タスクのスナップショットを取得する
   */
  private async fetchTaskSnapshots(
    taskRefs: Map<string, { projectId: string; issueId: string; taskId: string }>,
  ): Promise<Map<string, Task & { title: string }>> {
    const entries = Array.from(taskRefs.values());
    if (entries.length === 0) {
      return new Map();
    }

    const results = await Promise.all(
      entries.map(async ({ projectId, issueId, taskId }) => {
        try {
          const taskDoc = await getDoc(
            doc(this.db, `projects/${projectId}/issues/${issueId}/tasks/${taskId}`),
          );
          if (!taskDoc.exists()) {
            return null;
          }
          return {
            key: `${projectId}/${issueId}/${taskId}`,
            data: taskDoc.data() as Task,
          };
        } catch (error) {
          console.error('Failed to fetch task snapshot for notification:', { projectId, issueId, taskId }, error);
          return null;
        }
      }),
    );

    const map = new Map<string, Task & { title: string }>();
    for (const result of results) {
      if (!result) {
        continue;
      }
      map.set(result.key, result.data as Task & { title: string });
    }
    return map;
  }

  /**
   * プロジェクト名をまとめて取得する
   */
  private async fetchProjectNames(projectIds: Set<string>): Promise<Map<string, string>> {
    const ids = Array.from(projectIds);
    if (ids.length === 0) {
      return new Map();
    }

    const entries = await Promise.all(
      ids.map(async (projectId) => {
        try {
          const snapshot = await getDoc(doc(this.db, 'projects', projectId));
          if (!snapshot.exists()) {
            return null;
          }
          const data = snapshot.data() as Project;
          const name = typeof data.name === 'string' && data.name.trim().length > 0
            ? data.name.trim()
            : '名称未設定プロジェクト';
          return { projectId, name };
        } catch (error) {
          console.error('Failed to fetch project name for notification:', projectId, error);
          return null;
        }
      }),
    );

    const map = new Map<string, string>();
    for (const entry of entries) {
      if (entry) {
        map.set(entry.projectId, entry.name);
      }
    }
    return map;
  }

  /**
   * 課題名をまとめて取得する
   */
  private async fetchIssueNames(
    issueRefs: Map<string, { projectId: string; issueId: string }>,
  ): Promise<Map<string, string | null>> {
    const entries = Array.from(issueRefs.values());
    if (entries.length === 0) {
      return new Map();
    }

    const results = await Promise.all(
      entries.map(async ({ projectId, issueId }) => {
        try {
          const snapshot = await getDoc(doc(this.db, `projects/${projectId}/issues/${issueId}`));
          if (!snapshot.exists()) {
            return null;
          }
          const data = snapshot.data() as DocumentData;
          const rawName = typeof data['name'] === 'string' ? data['name'].trim() : '';
          const name = rawName.length > 0 ? rawName : null;
          return { projectId, issueId, name };
        } catch (error) {
          console.error('Failed to fetch issue name for notification:', { projectId, issueId }, error);
          return null;
        }
      }),
    );

    const map = new Map<string, string | null>();
    for (const result of results) {
      if (!result) {
        continue;
      }
      map.set(`${result.projectId}/${result.issueId}`, result.name ?? null);
    }
    return map;
  }
}

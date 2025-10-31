import { Injectable, inject } from '@angular/core';
import {
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
 * 通知/ダッシュボード用のタスク抽出を行うサービス
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private db = inject(Firestore);
  private auth = inject(Auth);

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
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

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
          if (dueDate < startOfToday) {
            highlightReasons.push('overdue');
          } else if (dueDate >= startOfToday && dueDate <= endOfToday) {
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
}

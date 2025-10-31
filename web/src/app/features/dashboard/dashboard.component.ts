import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  ActionableTaskCard,
  HighlightReason,
  NotificationService,
} from '../../core/notification.service';
import { TasksService } from '../tasks/tasks.service';
import { Importance } from '../../models/schema';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit {
  private readonly notificationService = inject(NotificationService);
  private readonly tasksService = inject(TasksService);
  /** ダッシュボード上部で使う期間フィルター候補（現状はダミー） */
  readonly periodFilters = ['今週', '今月', '四半期'];

  /**
   * ウィジェット①: 重要指標の要約（表示順の指定に利用）
   * 実データは未接続のためサンプル値を設定
   */
  readonly summaryStats = [
    { label: '進行中のプロジェクト', value: 8, trend: '+2件' },
    { label: '今週の完了タスク', value: 42, trend: '+18%' },
    { label: 'ブロッカー', value: 3, trend: '要対応' },
  ];

  /** ウィジェット②: 現在注目すべきプロジェクト一覧（プレースホルダー） */
  readonly projectHighlights = [
    { name: 'モバイルアプリ刷新', status: '進行中', link: '/projects/alpha' },
    {
      name: 'バックエンドAPI統合',
      status: 'レビュー中',
      link: '/projects/beta',
    },
  ];

  /** ウィジェット③: チームからの最新更新メモ（プレースホルダー） */
  readonly activityFeed = [
    {
      title: 'タスク #123 を完了',
      detail: '高橋がチェックリストを更新しました',
      time: '2時間前',
    },
    {
      title: '課題 #456 を作成',
      detail: '佐藤がバグレポートを登録',
      time: '昨日',
    },
  ];

  /** ウィジェット⑤: その他ナレッジ・リソースへの導線（仮） */
  readonly resources = [
    {
      label: 'リリースノート',
      description: '最新の改善点をチェック',
      href: '#',
    },
    { label: '運用ガイド', description: 'オンボーディング資料', href: '#' },
  ];
  /** アラート対象タスクのリスト */
  readonly actionableTasks = signal<ActionableTaskCard[]>([]);
  /** フェッチ状態 */
  readonly actionableLoading = signal(false);
  /** エラーメッセージ */
  readonly actionableError = signal<string | null>(null);
  /** 更新中タスクID集合 */
  private readonly updatingTaskIds = signal<Set<string>>(new Set());

  ngOnInit(): void {
    void this.refreshActionableTasks();
  }

  /** 重要タスクリストを再取得する */
  async refreshActionableTasks(): Promise<void> {
    this.actionableLoading.set(true);
    this.actionableError.set(null);
    try {
      const cards = await this.notificationService.getActionableTaskCards();
      this.actionableTasks.set(cards);
    } catch (error) {
      console.error('Failed to load actionable tasks', error);
      this.actionableError.set(
        'タスクリストの読み込みに失敗しました。時間をおいて再度お試しください。',
      );
    } finally {
      this.actionableLoading.set(false);
    }
  }

  /** トラック関数 */
  trackTask(_: number, card: ActionableTaskCard): string {
    return card.taskId;
  }

  /** 重要度の表示ラベル */
  getImportanceLabel(importance: Importance | null): string {
    const labels: Record<Importance, string> = {
      Critical: '最重要',
      High: '高',
      Medium: '中',
      Low: '低',
    };
    return importance ? labels[importance] : '未設定';
  }

  /** 重要度に応じたクラス名 */
  getImportanceClass(importance: Importance | null): string {
    switch (importance) {
      case 'Critical':
        return 'importance-critical';
      case 'High':
        return 'importance-high';
      case 'Medium':
        return 'importance-medium';
      case 'Low':
        return 'importance-low';
      default:
        return 'importance-unknown';
    }
  }

  /** 指定カードが更新中か判定 */
  isUpdating(card: ActionableTaskCard): boolean {
    return this.updatingTaskIds().has(card.taskId);
  }

  /** 完了ボタン押下 */
  async markCompleted(card: ActionableTaskCard): Promise<void> {
    await this.executeTaskUpdate(card, { status: 'completed', progress: 100 });
  }

  /** 保留ボタン押下 */
  async markOnHold(card: ActionableTaskCard): Promise<void> {
    await this.executeTaskUpdate(card, { status: 'on_hold' });
  }

  /**
   * タスク更新処理の共通化
   */
  private async executeTaskUpdate(
    card: ActionableTaskCard,
    updates: Parameters<TasksService['updateTask']>[3],
  ): Promise<void> {
    this.mutateUpdatingSet('add', card.taskId);
    try {
      await this.tasksService.updateTask(
        card.projectId,
        card.issueId,
        card.taskId,
        updates,
      );
      await this.refreshActionableTasks();
    } catch (error) {
      console.error('Failed to update task from dashboard shortcut', error);
      this.actionableError.set(
        'タスク更新に失敗しました。権限やネットワークをご確認ください。',
      );
    } finally {
      this.mutateUpdatingSet('delete', card.taskId);
    }
  }

  /** 更新中集合のミューテーション */
  private mutateUpdatingSet(action: 'add' | 'delete', taskId: string): void {
    this.updatingTaskIds.update((current) => {
      const next = new Set(current);
      if (action === 'add') {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  }

  /** ハイライト理由を表示順に整形 */
  getHighlightLabels(card: ActionableTaskCard): string[] {
    const priority: HighlightReason[] = [
      'overdue',
      'due_today',
      'on_hold',
      'no_progress',
      'mentioned',
    ];
    const ordered = [...card.highlightDetails].sort(
      (a, b) => priority.indexOf(a.reason) - priority.indexOf(b.reason),
    );
    return ordered.map((detail) => detail.label);
  }
}

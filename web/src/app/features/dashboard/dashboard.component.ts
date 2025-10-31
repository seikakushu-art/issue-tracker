import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent {
  /** ダッシュボード上部で使う期間フィルター候補（現状はダミー） */
  readonly periodFilters = ['今週', '今月', '四半期'];

  /**
   * ウィジェット①: 重要指標の要約（表示順の指定に利用）
   * 実データは未接続のためサンプル値を設定
   */
  readonly summaryStats = [
    { label: '進行中のプロジェクト', value: 8, trend: '+2件' },
    { label: '今週の完了タスク', value: 42, trend: '+18%' },
    { label: 'ブロッカー', value: 3, trend: '要対応' }
  ];

  /** ウィジェット②: 現在注目すべきプロジェクト一覧（プレースホルダー） */
  readonly projectHighlights = [
    { name: 'モバイルアプリ刷新', status: '進行中', link: '/projects/alpha' },
    { name: 'バックエンドAPI統合', status: 'レビュー中', link: '/projects/beta' }
  ];

  /** ウィジェット③: チームからの最新更新メモ（プレースホルダー） */
  readonly activityFeed = [
    { title: 'タスク #123 を完了', detail: '高橋がチェックリストを更新しました', time: '2時間前' },
    { title: '課題 #456 を作成', detail: '佐藤がバグレポートを登録', time: '昨日' }
  ];

  /** ウィジェット④: 期限が近いタスクの仮データ */
  readonly upcomingDeadlines = [
    { task: 'UIデザインの承認', project: 'Webポータル', due: '3日後' },
    { task: 'セキュリティレビュー', project: 'モバイルアプリ刷新', due: '5日後' }
  ];

  /** ウィジェット⑤: その他ナレッジ・リソースへの導線（仮） */
  readonly resources = [
    { label: 'リリースノート', description: '最新の改善点をチェック', href: '#' },
    { label: '運用ガイド', description: 'オンボーディング資料', href: '#' }
  ];
}

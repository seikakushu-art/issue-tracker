import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { BulletinPreviewItem } from '../../dashboard.service';

@Component({
  selector: 'app-board-preview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './board-preview.component.html',
  styleUrls: ['./board-preview.component.scss'],
})
export class BoardPreviewComponent {
  /** 掲示板の投稿一覧（最大5件まで表示） */
  @Input({ required: true }) posts: BulletinPreviewItem[] = [];
  /** 詳細ページへ遷移するリンク */
  @Input() moreLink = '#';

  /** 表示対象に制限した投稿配列を返す */
  get visiblePosts(): BulletinPreviewItem[] {
    return this.posts.slice(0, 5);
  }

  /** 投稿が存在しない場合のプレースホルダーを判定 */
  get hasNoPosts(): boolean {
    return this.posts.length === 0;
  }
}
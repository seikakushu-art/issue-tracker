import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { BulletinPreviewItem } from '../../dashboard.service';
import { getAvatarColor, getAvatarInitial } from '../../../../shared/avatar-utils';

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
  /** 埋め込み表示かどうか */
  @Input() embedded = false;

  getAvatarInitial(author: BulletinPreviewItem): string {
    return getAvatarInitial(author.authorUsername || author.authorId, '?');
  }

  getAvatarColor(author: BulletinPreviewItem): string {
    return getAvatarColor(author.authorId || author.authorUsername);
  }

  /** 表示対象に制限した投稿配列を返す */
  get visiblePosts(): BulletinPreviewItem[] {
    return this.posts.slice(0, 5);
  }

  /** 投稿が存在しない場合のプレースホルダーを判定 */
  get hasNoPosts(): boolean {
    return this.posts.length === 0;
  }

  /** 投稿が12時間以内かどうかを判定 */
  isNewPost(post: BulletinPreviewItem): boolean {
    const now = new Date();
    const postedAt = post.postedAt;
    const diffInHours = (now.getTime() - postedAt.getTime()) / (1000 * 60 * 60);
    return diffInHours <= 12;
  }
}
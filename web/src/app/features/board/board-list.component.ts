import { CommonModule } from '@angular/common';
import { AfterViewChecked, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { BulletinPost, Project, Role } from '../../models/schema';
import { BoardService, ListAccessiblePostsResult } from './board.service';
import { ProjectsService } from '../projects/projects.service';
import { getAvatarColor, getAvatarInitial } from '../../shared/avatar-utils';

interface BoardPostView extends BulletinPost {
  projectNames: string[];
}

@Component({
  selector: 'app-board-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './board-list.component.html',
  styleUrls: ['./board-list.component.scss'],
})
export class BoardListComponent implements OnInit, AfterViewChecked {
  private readonly boardService = inject(BoardService);
  private readonly projectsService = inject(ProjectsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly allPosts = signal<BoardPostView[]>([]); // 全投稿（ページング用）
  readonly posts = signal<BoardPostView[]>([]); // 現在のページの投稿
  readonly loadingPosts = signal(false);
  readonly postsError = signal<string | null>(null);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(20);
  readonly hasMorePosts = signal<boolean>(false); // 500件を超えているか
  readonly totalPages = computed(() => {
    const total = this.allPosts().length;
    const size = this.pageSize();
    return total > 0 ? Math.ceil(total / size) : 1;
  });

  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  private readonly deletingPostIds = signal<Set<string>>(new Set());

  readonly accessibleProjects = signal<Project[]>([]);
  private readonly currentUid = signal<string | null>(null);
  private readonly expandedPosts = signal<Set<string>>(new Set());
  private readonly postsNeedingExpansion = signal<Set<string>>(new Set()); // 実際に切り詰められている投稿のID
  private lastCheckedPostsLength = 0; // チェック済みの投稿数を追跡

  postForm: { title: string; content: string; projectIds: string[] } = {
    title: '',
    content: '',
    projectIds: [],
  };

  readonly postableProjects = computed(() =>
    this.accessibleProjects().filter((project): project is Project & { id: string } => {
      if (!project.id) {
        return false;
      }
      const role = this.resolveRole(project);
      return role === 'admin' || role === 'member';
    }),
  );

  readonly hasPostPermission = computed(() => this.postableProjects().length > 0);

  ngOnInit(): void {
    void this.initializeBoard();
    // fragmentが指定されている場合は該当投稿までスクロール
    this.route.fragment.subscribe((fragment) => {
      if (fragment) {
        setTimeout(() => {
          this.scrollToPost(fragment);
        }, 300); // 投稿読み込みを待つ
      }
    });
  }

  /** 指定された投稿IDまでスクロールする */
  private scrollToPost(postId: string | null): void {
    if (!postId) {
      return;
    }
    // フラグメントが "post-{id}" 形式の場合は検索結果からの遷移（ハイライト適用）
    // そうでない場合は「もっと見る」からの遷移（ハイライトなし）
    const isFromSearch = postId.startsWith('post-');
    const actualPostId = isFromSearch ? postId.substring(5) : postId;
    const element = document.getElementById(actualPostId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 検索結果からの遷移の場合のみハイライト効果を適用（2秒間）
      if (isFromSearch) {
        element.classList.add('post-highlight');
        setTimeout(() => {
          element.classList.remove('post-highlight');
        }, 2000);
      }
    } else {
      // 投稿が現在のページにない場合は、該当投稿を含むページを探して移動
      const allPosts = this.allPosts();
      const targetPost = allPosts.find((post) => post.id === actualPostId);
      if (targetPost) {
        const postIndex = allPosts.indexOf(targetPost);
        const targetPage = Math.floor(postIndex / this.pageSize()) + 1;
        if (targetPage !== this.currentPage()) {
          this.goToPage(targetPage);
          // ページ移動後に再度スクロールを試みる
          setTimeout(() => {
            this.scrollToPost(postId);
          }, 500);
        }
      }
    }
  }

  async initializeBoard(): Promise<void> {
    await this.loadProjects();
    await this.loadPosts();
  }

  private async loadProjects(): Promise<void> {
    try {
      const uid = await this.projectsService.getSignedInUid();
      this.currentUid.set(uid);
    } catch (error) {
      console.warn('Failed to resolve signed-in user for board feature', error);
      this.currentUid.set(null);
    }

    try {
      const projects = await this.projectsService.listMyProjects();
      // アーカイブされていないプロジェクトのみを表示対象とする
      this.accessibleProjects.set(projects.filter(p => !p.archived));
    } catch (error) {
      console.error('Failed to load projects for board', error);
      this.accessibleProjects.set([]);
    }
  }

  private getProjectDisplayName(projectId: string, allProjects: Project[]): string {
    const project = allProjects.find(p => p.id === projectId);
    if (!project) {
      return '閲覧できないプロジェクト';
    }
    if (project.archived) {
      return 'アーカイブされたプロジェクト';
    }
    return project.name;
  }

  private async loadPosts(): Promise<void> {
    this.loadingPosts.set(true);
    this.postsError.set(null);
    this.hasMorePosts.set(false);
    try {
      // 最大500件まで閲覧可能
      const result: ListAccessiblePostsResult = await this.boardService.listAccessiblePosts({ limit: 500 });
      // 全てのプロジェクト（アーカイブ含む）を取得してプロジェクト名を解決
      const allProjects = await this.projectsService.listMyProjects();
      const enriched = result.posts.map((post) => ({
        ...post,
        projectNames: post.projectIds.map((projectId) => this.getProjectDisplayName(projectId, allProjects)),
      }));
      this.allPosts.set(enriched);
      this.hasMorePosts.set(result.hasMore);
      this.updateCurrentPagePosts();
    } catch (error) {
      console.error('Failed to load bulletin posts', error);
      this.postsError.set('掲示板の投稿を取得できませんでした。時間をおいて再度お試しください。');
      this.allPosts.set([]);
      this.posts.set([]);
      this.hasMorePosts.set(false);
    } finally {
      this.loadingPosts.set(false);
    }
  }

  private updateCurrentPagePosts(): void {
    const all = this.allPosts();
    const page = this.currentPage();
    const size = this.pageSize();
    const startIndex = (page - 1) * size;
    const endIndex = startIndex + size;
    this.posts.set(all.slice(startIndex, endIndex));
  }

  goToPage(page: number): void {
    const total = this.totalPages();
    if (page < 1 || page > total) {
      return;
    }
    this.currentPage.set(page);
    this.updateCurrentPagePosts();
    // 「最新の投稿」セクションにスクロール
    setTimeout(() => {
      const element = document.getElementById('board-posts-section');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  }

  nextPage(): void {
    const current = this.currentPage();
    const total = this.totalPages();
    if (current < total) {
      this.goToPage(current + 1);
    }
  }

  previousPage(): void {
    const current = this.currentPage();
    if (current > 1) {
      this.goToPage(current - 1);
    }
  }

  getAvatarInitial(value: string): string {
    return getAvatarInitial(value, '?');
  }

  getAvatarColor(value: string): string {
    return getAvatarColor(value);
  }

  isProjectSelected(projectId: string): boolean {
    return this.postForm.projectIds.includes(projectId);
  }

  toggleProjectSelection(projectId: string, selected: boolean): void {
    const current = this.postForm.projectIds;
    const next = new Set(current);
    if (selected) {
      if (next.size >= 5 && !next.has(projectId)) {
        this.formError.set('プロジェクトは最大5件まで選択できます');
        return;
      }
      next.add(projectId);
    } else {
      next.delete(projectId);
    }
    this.postForm = {
      ...this.postForm,
      projectIds: Array.from(next),
    };
    if (this.formError()) {
      this.formError.set(null);
    }
  }

  onProjectCheckboxChange(projectId: string, event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const checked = target?.checked ?? false;
    this.toggleProjectSelection(projectId, checked);
  }

  canSubmit(): boolean {
    const form = this.postForm;
    return (
      !this.submitting() &&
      form.title.trim().length > 0 &&
      form.title.trim().length <= 120 &&
      form.content.trim().length > 0 &&
      form.content.trim().length <= 20000 &&
      form.projectIds.length > 0 &&
      form.projectIds.length <= 5
    );
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) {
      const form = this.postForm;
      if (form.title.trim().length > 120) {
        this.formError.set('タイトルは120文字以内で入力してください');
        return;
      }
      if (form.content.trim().length > 20000) {
        this.formError.set('内容は20000文字以内で入力してください');
        return;
      }
      this.formError.set('必要な項目を入力してください');
      return;
    }

    this.submitting.set(true);
    this.formError.set(null);
    this.successMessage.set(null);

    const form = this.postForm;

    try {
      await this.boardService.createPost({
        title: form.title,
        content: form.content,
        projectIds: form.projectIds,
      });
      this.successMessage.set('掲示板に投稿しました');
      this.postForm = { title: '', content: '', projectIds: [] };
      this.currentPage.set(1); // 新規投稿後は1ページ目に戻る
      await this.loadPosts();
    } catch (error) {
      console.error('Failed to create bulletin post', error);
      const message =
        error instanceof Error ? error.message : '投稿処理でエラーが発生しました。';
      this.formError.set(message);
    } finally {
      this.submitting.set(false);
    }
  }

  trackByPostId(_: number, post: BoardPostView): string {
    return post.id ?? `${post.title}-${post.createdAt?.toISOString() ?? ''}`;
  }

  isPostExpanded(postId: string | undefined): boolean {
    if (!postId) {
      return false;
    }
    return this.expandedPosts().has(postId);
  }

  ngAfterViewChecked(): void {
    // 投稿が変更された場合のみチェック（パフォーマンス最適化）
    const currentPosts = this.posts();
    if (currentPosts.length !== this.lastCheckedPostsLength) {
      this.checkPostsNeedingExpansion();
      this.lastCheckedPostsLength = currentPosts.length;
    }
  }

  /**
   * 各投稿の実際の要素の高さをチェックし、切り詰められている投稿を特定
   */
  private checkPostsNeedingExpansion(): void {
    const posts = this.posts();
    const needingExpansion = new Set<string>();

    for (const post of posts) {
      if (!post.id || !post.content || post.content.length <= 200) {
        continue;
      }

      const element = document.querySelector(`[data-post-content-id="${post.id}"]`) as HTMLElement;
      if (element && element.scrollHeight > element.clientHeight) {
        needingExpansion.add(post.id);
      }
    }

    this.postsNeedingExpansion.set(needingExpansion);
  }

  /**
   * 投稿が実際に切り詰められているか（全文表示ボタンが必要か）を判定
   */
  needsExpansionButton(postId: string | undefined, content: string | null | undefined): boolean {
    if (!postId || !content) {
      return false;
    }
    // まず、文字数で簡易チェック（200文字未満なら確実に不要）
    if (content.length <= 200) {
      return false;
    }
    // 実際に切り詰められている投稿のセットを確認
    return this.postsNeedingExpansion().has(postId);
  }

  togglePostExpansion(postId: string | undefined): void {
    if (!postId) {
      return;
    }
    const current = this.expandedPosts();
    const next = new Set(current);
    if (next.has(postId)) {
      next.delete(postId);
    } else {
      next.add(postId);
    }
    this.expandedPosts.set(next);
  }

  isMyPost(post: BoardPostView): boolean {
    const uid = this.currentUid();
    return uid !== null && post.authorId === uid;
  }

  isDeletingPost(postId: string | undefined): boolean {
    if (!postId) {
      return false;
    }
    return this.deletingPostIds().has(postId);
  }

  async deletePost(postId: string | undefined): Promise<void> {
    if (!postId) {
      return;
    }

    if (!confirm('この投稿を削除してもよろしいですか？')) {
      return;
    }

    const current = this.deletingPostIds();
    const next = new Set(current);
    next.add(postId);
    this.deletingPostIds.set(next);

    try {
      await this.boardService.deletePost(postId);
      const currentPageBeforeDelete = this.currentPage();
      await this.loadPosts();
      // 削除後に現在のページが空になった場合は前のページに移動
      if (this.posts().length === 0 && currentPageBeforeDelete > 1) {
        this.goToPage(currentPageBeforeDelete - 1);
      }
      this.successMessage.set('投稿を削除しました');
    } catch (error) {
      console.error('Failed to delete bulletin post', error);
      const message =
        error instanceof Error ? error.message : '投稿の削除に失敗しました。';
      this.formError.set(message);
    } finally {
      const final = this.deletingPostIds();
      const finalNext = new Set(final);
      finalNext.delete(postId);
      this.deletingPostIds.set(finalNext);
    }
  }

  private resolveRole(project: Project): Role | null {
    const explicit = project.currentRole ?? null;
    if (explicit) {
      return explicit;
    }
    const uid = this.currentUid();
    if (!uid) {
      return null;
    }
    const roles = project.roles ?? {};
    return roles[uid] ?? null;
  }
}
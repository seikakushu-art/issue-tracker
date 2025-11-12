import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BulletinPost, Project, Role } from '../../models/schema';
import { BoardService } from './board.service';
import { ProjectsService } from '../projects/projects.service';
import { getAvatarColor, getAvatarInitial } from '../../shared/avatar-utils';

interface BoardPostView extends BulletinPost {
  projectNames: string[];
}

@Component({
  selector: 'app-board-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './board-list.component.html',
  styleUrls: ['./board-list.component.scss'],
})
export class BoardListComponent implements OnInit {
  private readonly boardService = inject(BoardService);
  private readonly projectsService = inject(ProjectsService);

  readonly allPosts = signal<BoardPostView[]>([]); // 全投稿（ページング用）
  readonly posts = signal<BoardPostView[]>([]); // 現在のページの投稿
  readonly loadingPosts = signal(false);
  readonly postsError = signal<string | null>(null);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(20);
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
    try {
      // 最大500件まで閲覧可能
      const posts = await this.boardService.listAccessiblePosts({ limit: 500 });
      // 全てのプロジェクト（アーカイブ含む）を取得してプロジェクト名を解決
      const allProjects = await this.projectsService.listMyProjects();
      const enriched = posts.map((post) => ({
        ...post,
        projectNames: post.projectIds.map((projectId) => this.getProjectDisplayName(projectId, allProjects)),
      }));
      this.allPosts.set(enriched);
      this.updateCurrentPagePosts();
    } catch (error) {
      console.error('Failed to load bulletin posts', error);
      this.postsError.set('掲示板の投稿を取得できませんでした。時間をおいて再度お試しください。');
      this.allPosts.set([]);
      this.posts.set([]);
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
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { BoardListComponent } from './board-list.component';
import { BoardService, ListAccessiblePostsResult } from './board.service';
import { ProjectsService } from '../projects/projects.service';
import { BulletinPost, Project } from '../../models/schema';
import { WritableSignal } from '@angular/core';

interface PrivateBoardListComponent {
  loadPosts: () => Promise<void>;
  initializeBoard: () => Promise<void>;
}

describe('BoardListComponent', () => {
  let component: BoardListComponent;
  let boardService: jasmine.SpyObj<Pick<BoardService, 'listAccessiblePosts' | 'createPost' | 'deletePost'>>;
  let projectsService: jasmine.SpyObj<Pick<ProjectsService, 'listMyProjects' | 'getSignedInUid'>>;
  let routeStub: { fragment: Subject<string | null> };

  const sampleProjects: Project[] = [
    { id: 'p1', name: 'Alpha', archived: false, roles: {}, memberIds: [] },
    { id: 'p2', name: 'Beta', archived: false, roles: {}, memberIds: [] },
  ];

  const createPost = (id: string, overrides: Partial<BulletinPost> = {}): BulletinPost => ({
    id,
    title: `title-${id}`,
    content: `content-${id}`,
    projectIds: ['p1'],
    authorId: 'author-1',
    authorUsername: 'tester',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    boardService = jasmine.createSpyObj('BoardService', ['listAccessiblePosts', 'createPost', 'deletePost']);
    projectsService = jasmine.createSpyObj('ProjectsService', ['listMyProjects', 'getSignedInUid']);
    routeStub = { fragment: new Subject<string | null>() };

    TestBed.configureTestingModule({
      providers: [
        { provide: BoardService, useValue: boardService },
        { provide: ProjectsService, useValue: projectsService },
        { provide: ActivatedRoute, useValue: routeStub },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });

    component = TestBed.runInInjectionContext(() => new BoardListComponent());
  });

  it('掲示板投稿一覧の取得に成功した場合、プロジェクト名付きで20件まで表示に採用する', async () => {
    const posts: BulletinPost[] = Array.from({ length: 25 }).map((_, index) =>
      createPost(`post-${index + 1}`, { projectIds: ['p1', 'p2'] }),
    );
    const result: ListAccessiblePostsResult = { posts, hasMore: false };
    boardService.listAccessiblePosts.and.resolveTo(result);
    projectsService.listMyProjects.and.resolveTo(sampleProjects);

    const componentWithPrivates = component as unknown as PrivateBoardListComponent;
    await componentWithPrivates.loadPosts();

    expect(boardService.listAccessiblePosts).toHaveBeenCalledWith({ limit: 500 });
    expect(component.posts().length).toBe(20);
    expect(component.totalPages()).toBe(2);
    expect(component.posts()[0].projectNames).toEqual(['Alpha', 'Beta']);
  });

  it('ページ遷移で20件ずつ投稿を切り替える', async () => {
    const posts: BulletinPost[] = Array.from({ length: 25 }).map((_, index) =>
      createPost(`page-post-${index + 1}`, { projectIds: ['p1'] }),
    );
    boardService.listAccessiblePosts.and.resolveTo({ posts, hasMore: true });
    projectsService.listMyProjects.and.resolveTo(sampleProjects);
    const componentWithPrivates = component as unknown as PrivateBoardListComponent;

    await componentWithPrivates.loadPosts();
    expect(component.currentPage()).toBe(1);
    expect(component.posts().map((post) => post.id)).toContain('page-post-1');
    expect(component.posts().length).toBe(20);

    component.goToPage(2);
    expect(component.currentPage()).toBe(2);
    expect(component.posts().length).toBe(5);

    component.goToPage(3);
    expect(component.currentPage()).toBe(2);
  });

  it('長文投稿のみ全文表示ボタンを出し、開閉状態を切り替える', () => {
    const longContent = '長文'.repeat(120);
    const postId = 'long-1';
    const { postsNeedingExpansion } = component as unknown as {
      postsNeedingExpansion: WritableSignal<Set<string>>;
    };
    postsNeedingExpansion.set(new Set([postId]));

    expect(component.needsExpansionButton(postId, longContent)).toBeTrue();
    expect(component.isPostExpanded(postId)).toBeFalse();

    component.togglePostExpansion(postId);
    expect(component.isPostExpanded(postId)).toBeTrue();

    component.togglePostExpansion(postId);
    expect(component.isPostExpanded(postId)).toBeFalse();
  });

  it('アーカイブを除外したプロジェクト情報を読み込み、投稿可能プロジェクトを算出する', async () => {
    projectsService.getSignedInUid.and.resolveTo('author-1');
    projectsService.listMyProjects.and.resolveTo([
      { id: 'p1', name: 'Active', archived: false, roles: { 'author-1': 'admin' }, memberIds: [] },
      { id: 'p2', name: 'Archived', archived: true, roles: { 'author-1': 'member' }, memberIds: [] },
    ]);
    const componentWithPrivates = component as unknown as PrivateBoardListComponent & {
      initializeBoard: () => Promise<void>;
      loadPosts: () => Promise<void>;
    };
    spyOn(componentWithPrivates, 'loadPosts').and.resolveTo();

    await componentWithPrivates.initializeBoard();

    expect(projectsService.getSignedInUid).toHaveBeenCalled();
    expect(component.accessibleProjects().map((p) => p.id)).toEqual(['p1']);
    expect(component.postableProjects().map((p) => p.id)).toEqual(['p1']);
    expect(component.hasPostPermission()).toBeTrue();
  });

  it('プロジェクト選択は最大5件までで、解除時にエラーを解消する', () => {
    component.postForm = { title: '', content: '', projectIds: ['p1', 'p2', 'p3', 'p4', 'p5'] };

    component.toggleProjectSelection('p6', true);
    expect(component.formError()).toBe('プロジェクトは最大5件まで選択できます');
    expect(component.postForm.projectIds).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);

    component.toggleProjectSelection('p1', false);
    expect(component.postForm.projectIds).toEqual(['p2', 'p3', 'p4', 'p5']);
    expect(component.formError()).toBeNull();
  });

  it('入力が揃ったら投稿を送信し、フォームを初期化して一覧を再取得する', async () => {
    component.postForm = { title: '題名', content: '本文', projectIds: ['p1'] };
    boardService.createPost.and.resolveTo('new-id');
    projectsService.listMyProjects.and.resolveTo(sampleProjects);
    boardService.listAccessiblePosts.and.resolveTo({ posts: [], hasMore: false });

    const componentWithPrivates = component as unknown as PrivateBoardListComponent & {
      loadPosts: () => Promise<void>;
    };
    const loadPostsSpy = spyOn(componentWithPrivates, 'loadPosts').and.callThrough();

    await component.submit();

    expect(boardService.createPost).toHaveBeenCalledWith({
      title: '題名',
      content: '本文',
      projectIds: ['p1'],
    });
    expect(loadPostsSpy).toHaveBeenCalled();
    expect(component.successMessage()).toBe('掲示板に投稿しました');
    expect(component.postForm).toEqual({ title: '', content: '', projectIds: [] });
    expect(component.currentPage()).toBe(1);
  });

  it('投稿削除を確認後にサービスへ委譲し、削除完了メッセージを出す', async () => {
    const postId = 'delete-1';
    boardService.deletePost.and.resolveTo();
    projectsService.listMyProjects.and.resolveTo(sampleProjects);
    boardService.listAccessiblePosts.and.resolveTo({ posts: [], hasMore: false });
    const componentWithPrivates = component as unknown as PrivateBoardListComponent & {
      loadPosts: () => Promise<void>;
    };
    spyOn(componentWithPrivates, 'loadPosts').and.resolveTo();
    spyOn(component, 'goToPage').and.stub();

    spyOn(window, 'confirm').and.returnValue(true);

    await component.deletePost(postId);

    expect(boardService.deletePost).toHaveBeenCalledWith(postId);
    expect(component.successMessage()).toBe('投稿を削除しました');
    expect(component.isDeletingPost(postId)).toBeFalse();
  });

  it('削除後に投稿がなくなったページでは前のページへ戻る', async () => {
    const componentWithPrivates = component as unknown as PrivateBoardListComponent & {
      loadPosts: () => Promise<void>;
      updateCurrentPagePosts: () => void;
    };
    component.pageSize.set(1);
    component.allPosts.set([
      { ...createPost('page-1'), projectNames: ['Alpha'] },
      { ...createPost('page-2'), projectNames: ['Alpha'] },
    ]);
    componentWithPrivates.updateCurrentPagePosts();
    component.goToPage(2);
    boardService.deletePost.and.resolveTo();

    const goToPageSpy = spyOn(component, 'goToPage').and.callThrough();
    spyOn(window, 'confirm').and.returnValue(true);
    spyOn(componentWithPrivates, 'loadPosts').and.callFake(async () => {
      component.allPosts.set([]);
      component.posts.set([]);
    });

    await component.deletePost('page-2');

    expect(goToPageSpy).toHaveBeenCalledWith(1);
  });

  it('削除確認をキャンセルした場合はAPIを呼び出さない', async () => {
    spyOn(window, 'confirm').and.returnValue(false);

    await component.deletePost('cancel-1');

    expect(boardService.deletePost).not.toHaveBeenCalled();
  });

  it('投稿一覧取得に失敗した場合はエラーを表示し一覧を空にする', async () => {
    boardService.listAccessiblePosts.and.rejectWith(new Error('network'));
    projectsService.listMyProjects.and.resolveTo(sampleProjects);
    const componentWithPrivates = component as unknown as PrivateBoardListComponent;

    await componentWithPrivates.loadPosts();

    expect(component.postsError()).toBe('掲示板の投稿を取得できませんでした。時間をおいて再度お試しください。');
    expect(component.posts()).toEqual([]);
    expect(component.allPosts()).toEqual([]);
  });

  it('プロジェクト名の解決では未閲覧・アーカイブを特別表示する', async () => {
    const posts: BulletinPost[] = [
      createPost('known', { projectIds: ['p1'] }),
      createPost('archived', { projectIds: ['p2'] }),
      createPost('unknown', { projectIds: ['p3'] }),
    ];
    boardService.listAccessiblePosts.and.resolveTo({ posts, hasMore: false });
    projectsService.listMyProjects.and.resolveTo([
      { id: 'p1', name: 'Alpha', archived: false, roles: {}, memberIds: [] },
      { id: 'p2', name: 'Beta', archived: true, roles: {}, memberIds: [] },
    ]);
    const componentWithPrivates = component as unknown as PrivateBoardListComponent;

    await componentWithPrivates.loadPosts();

    expect(component.posts().map((p) => p.projectNames[0])).toEqual([
      'Alpha',
      'アーカイブされたプロジェクト',
      '閲覧できないプロジェクト',
    ]);
  });
});
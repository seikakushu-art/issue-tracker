import { TestBed } from '@angular/core/testing';
import { Auth, User } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { BoardService } from './board.service';
import { ProjectsService } from '../projects/projects.service';
import { Project, BulletinPost } from '../../models/schema';

describe('BoardService', () => {
  let service: BoardService;
  let projectsService: jasmine.SpyObj<ProjectsService>;

  const authStub = {
    currentUser: null,
    authStateReady: () => Promise.resolve(),
  } satisfies Partial<Auth>;

  beforeEach(() => {
    projectsService = jasmine.createSpyObj<ProjectsService>('ProjectsService', ['listMyProjects']);

    TestBed.configureTestingModule({
      providers: [
        BoardService,
        { provide: ProjectsService, useValue: projectsService },
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: authStub },
      ],
    });

    service = TestBed.inject(BoardService);
  });

  describe('createPost', () => {
    const stubUser = { uid: 'user-1' };

    it('タイトル未入力の場合はエラーになる', async () => {
      spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser as User);

      await expectAsync(
        service.createPost({ title: '', content: '本文', projectIds: ['project-1'] }),
      ).toBeRejectedWithError('タイトルを入力してください');
    });

    it('投稿権限のないプロジェクトが含まれている場合は拒否される', async () => {
      spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser as User);
      const accessibleProject: Project = {
        id: 'project-1',
        archived: false,
        name: 'プロジェクト',
        memberIds: ['user-1'],
        roles: { 'user-1': 'member' },
        createdAt: null,
        currentRole: 'member',
      } as Project;
      projectsService.listMyProjects.and.resolveTo([accessibleProject]);

      await expectAsync(
        service.createPost({
          title: 'タイトル',
          content: '本文',
          projectIds: ['project-1', 'project-unknown'],
        }),
      ).toBeRejectedWithError('所属していない、または投稿権限のないプロジェクトが含まれています');
    });

    it('タイトルが長すぎる場合はエラーになる', async () => {
      spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser as User);

      await expectAsync(
        service.createPost({
          title: 'あ'.repeat(121),
          content: '本文',
          projectIds: ['project-1'],
        }),
      ).toBeRejectedWithError('タイトルは120文字以内で入力してください');
    });

    it('内容未入力の場合はエラーになる', async () => {
      spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser as User);

      await expectAsync(
        service.createPost({ title: 'タイトル', content: '', projectIds: ['project-1'] }),
      ).toBeRejectedWithError('内容を入力してください');
    });

    it('内容が長すぎる場合はエラーになる', async () => {
      spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser as User);

      await expectAsync(
        service.createPost({
          title: 'タイトル',
          content: 'あ'.repeat(20001),
          projectIds: ['project-1'],
        }),
      ).toBeRejectedWithError('内容は20000文字以内で入力してください');
    });

    it('プロジェクト未選択の場合はエラーになる', async () => {
      spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser as User);

      await expectAsync(
        service.createPost({ title: 'タイトル', content: '本文', projectIds: [] }),
      ).toBeRejectedWithError('少なくとも1つのプロジェクトを選択してください');
    });

    it('選択プロジェクトが多すぎる場合はエラーになる', async () => {
      spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser as User);

      await expectAsync(
        service.createPost({
          title: 'タイトル',
          content: '本文',
          projectIds: ['1', '2', '3', '4', '5', '6'],
        }),
      ).toBeRejectedWithError('プロジェクトは最大5件まで選択できます');
    });

    it('アーカイブ済みプロジェクトのみが選択された場合はエラーになる', async () => {
      spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser as User);
      const archivedProject: Project = {
        id: 'archived-1',
        archived: true,
        name: 'アーカイブ済み',
        memberIds: ['user-1'],
        roles: { 'user-1': 'admin' },
        createdAt: null,
        currentRole: 'admin',
      } as Project;
      projectsService.listMyProjects.and.resolveTo([archivedProject]);

      await expectAsync(
        service.createPost({
          title: 'タイトル',
          content: '本文',
          projectIds: ['archived-1'],
        }),
      ).toBeRejectedWithError('所属していない、または投稿権限のないプロジェクトが含まれています');
    });

    it('権限がviewerの場合は投稿できない', async () => {
      spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser as User);
      const viewerProject = {
        id: 'project-view',
        archived: false,
        name: '閲覧のみ',
        memberIds: ['user-1'],
        roles: { 'user-1': 'viewer' },
        createdAt: null,
        currentRole: 'viewer',
      } as unknown as Project;
      projectsService.listMyProjects.and.resolveTo([viewerProject]);

      await expectAsync(
        service.createPost({
          title: 'タイトル',
          content: '本文',
          projectIds: ['project-view'],
        }),
      ).toBeRejectedWithError('所属していない、または投稿権限のないプロジェクトが含まれています');
    });
  });

  describe('listAccessiblePosts', () => {
    it('参照可能なプロジェクトがない場合は空配列を返す', async () => {
      projectsService.listMyProjects.and.resolveTo([]);

      const result = await service.listAccessiblePosts();

      expect(result.posts).toEqual([]);
      expect(result.hasMore).toBeFalse();
    });
  });

  describe('ユーティリティ', () => {
    it('chunkProjectIdsは指定サイズで分割する', () => {
      const chunked = (service as unknown as { chunkProjectIds: (projectIds: string[], chunkSize?: number) => string[][] }).chunkProjectIds(['1', '2', '3', '4', '5'], 2);

      expect(chunked).toEqual([
        ['1', '2'],
        ['3', '4'],
        ['5'],
      ]);
    });

    it('hydratePostはauthorUsernameを補完する', () => {
      const hydrated = (service as unknown as { hydratePost: (id: string, data: BulletinPost) => BulletinPost }).hydratePost('post-1', {
        id: undefined,
        title: 'タイトル',
        content: '本文',
        projectIds: ['project-1'],
        authorId: 'missing-name',
        authorUsername: '',
        authorPhotoUrl: null,
        createdAt: null,
        updatedAt: null,
      });

      expect(hydrated.authorUsername).toBe('missing-name');
      expect(hydrated.id).toBe('post-1');
    });
  });
});
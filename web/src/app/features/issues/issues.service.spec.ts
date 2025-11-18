import { TestBed } from '@angular/core/testing';
import { Auth, User } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { IssuesService } from './issues.service';
import { ProjectsService } from '../projects/projects.service';
import { ProgressService } from '../projects/progress.service';
import { TagsService } from '../tags/tags.service';

// IssuesService のユニットテスト
describe('IssuesService', () => {
  let service: IssuesService;
  let projectsService: jasmine.SpyObj<ProjectsService>;
  let progressService: jasmine.SpyObj<ProgressService>;
  let tagsService: jasmine.SpyObj<TagsService>;

  const firestoreStub = {} as Firestore;
  const authStub = { currentUser: null } satisfies Partial<Auth>;
  const storageStub = {} as Storage;

  beforeEach(() => {
    projectsService = jasmine.createSpyObj<ProjectsService>('ProjectsService', ['ensureProjectRole']);
    progressService = jasmine.createSpyObj<ProgressService>('ProgressService', []);
    tagsService = jasmine.createSpyObj<TagsService>('TagsService', []);

    TestBed.configureTestingModule({
      providers: [
        IssuesService,
        { provide: ProjectsService, useValue: projectsService },
        { provide: ProgressService, useValue: progressService },
        { provide: TagsService, useValue: tagsService },
        { provide: Firestore, useValue: firestoreStub },
        { provide: Auth, useValue: authStub },
        { provide: Storage, useValue: storageStub },
      ],
    });

    service = TestBed.inject(IssuesService);
  });

  describe('createIssue', () => {
    const stubUser: User = { uid: 'user-1' } as User;
    let requireUserSpy: jasmine.Spy;
    let validateWithinProjectPeriodSpy: jasmine.Spy;
    let checkNameUniquenessSpy: jasmine.Spy;

    beforeEach(() => {
      requireUserSpy = spyOn(service as unknown as { requireUser: () => Promise<User> }, 'requireUser').and.resolveTo(stubUser);
      validateWithinProjectPeriodSpy = spyOn(
        service as unknown as { validateWithinProjectPeriod: () => Promise<void> },
        'validateWithinProjectPeriod'
      ).and.resolveTo();
      checkNameUniquenessSpy = spyOn(
        service as unknown as { checkNameUniqueness: () => Promise<void> },
        'checkNameUniqueness'
      ).and.resolveTo();
    });

    it('アクティブ課題の上限を超えている場合はエラーになる', async () => {
      projectsService.ensureProjectRole.and.resolveTo();
      spyOn(service as unknown as { countActiveIssues: () => Promise<number> }, 'countActiveIssues').and.resolveTo(50);

      await expectAsync(
        service.createIssue('project-1', { name: 'overflow issue' }),
      ).toBeRejectedWithError(/アクティブな課題の上限.*アーカイブするか削除してください。/);
    });

    it('開始日が終了日より後の場合は拒否される', async () => {
      projectsService.ensureProjectRole.and.resolveTo();
      spyOn(service as unknown as { countActiveIssues: () => Promise<number> }, 'countActiveIssues').and.resolveTo(0);

      await expectAsync(
        service.createIssue('project-1', {
          name: 'invalid period',
          startDate: new Date('2024-02-02'),
          endDate: new Date('2024-02-01'),
        }),
      ).toBeRejectedWithError('開始日は終了日以前である必要があります');
    });

    it('課題作成時にプロジェクト権限を確認する', async () => {
      projectsService.ensureProjectRole.and.resolveTo();
      spyOn(service as unknown as { countActiveIssues: () => Promise<number> }, 'countActiveIssues').and.resolveTo(0);

      await service.createIssue('project-1', { name: 'new issue' });

      expect(projectsService.ensureProjectRole).toHaveBeenCalledWith('project-1', ['admin', 'member']);
      expect(requireUserSpy).toHaveBeenCalled();
    });

    it('プロジェクト期間チェックと名称重複チェックが呼ばれる', async () => {
      projectsService.ensureProjectRole.and.resolveTo();
      spyOn(service as unknown as { countActiveIssues: () => Promise<number> }, 'countActiveIssues').and.resolveTo(0);

      await service.createIssue('project-1', { name: 'period issue', startDate: undefined, endDate: undefined });

      expect(validateWithinProjectPeriodSpy).toHaveBeenCalledWith('project-1', null, null);
      expect(checkNameUniquenessSpy).toHaveBeenCalledWith('project-1', 'period issue', undefined);
    });
  });

  describe('listIssues', () => {
    it('未ログインの場合は空配列を返す', async () => {
      spyOn(service as unknown as { waitForUser: () => Promise<null> }, 'waitForUser').and.resolveTo(null);

      await expectAsync(service.listIssues('project-1')).toBeResolvedTo([]);
    });
  });

  describe('countIssues', () => {
    it('未ログインの場合は0件を返す', async () => {
      spyOn(service as unknown as { waitForUser: () => Promise<null> }, 'waitForUser').and.resolveTo(null);

      await expectAsync(service.countIssues('project-1')).toBeResolvedTo(0);
    });
  });
});
import { TestBed } from '@angular/core/testing';
import { ProjectsService } from './projects.service';
import { Firestore } from '@angular/fire/firestore';
import { Auth, User } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import { provideRouter } from '@angular/router';

describe('ProjectsService (プロジェクト機能)', () => {
  let service: ProjectsService;

  /** テスト用のダミーユーザー */
  const signedInUser: User = {
    uid: 'user-1',
    email: 'user@example.com',
  } as User;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ProjectsService,
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser: null } },
        { provide: Storage, useValue: {} },
        provideRouter([]),
      ],
    });

    service = TestBed.inject(ProjectsService);
  });

  it('createProject: プロジェクト名未入力でエラーを投げる', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spyOn<any>(service, 'requireUser').and.resolveTo(signedInUser);

    await expectAsync(service.createProject({ name: '' })).toBeRejectedWithError(
      'プロジェクト名を入力してください',
    );
  });

  it('createProject: アクティブ上限超過で例外を投げる', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spyOn<any>(service, 'requireUser').and.resolveTo(signedInUser);
    spyOn(service, 'countActiveProjects').and.resolveTo(30);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uniquenessSpy = spyOn<any>(service, 'checkNameUniqueness').and.resolveTo(undefined);

    await expectAsync(service.createProject({ name: '超過' })).toBeRejectedWithError(
      'アクティブなプロジェクトの上限（30件）に達しています。新しいプロジェクトを作成するには、既存のプロジェクトをアーカイブするか削除してください。',
    );

    expect(uniquenessSpy).not.toHaveBeenCalled();
  });
});

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { ProjectInviteComponent } from './project-invite.component';
import { ProjectInviteService } from './project-invite.service';
import { InviteStatus, Role } from '../../models/schema';

describe('ProjectInviteComponent', () => {
  let router: jasmine.SpyObj<Router>;
  let inviteService: jasmine.SpyObj<ProjectInviteService>;
  const activatedRouteStub = {
    snapshot: {
      paramMap: {
        get: () => 'invite-token',
        getAll: () => ['invite-token'],
        has: () => true,
        keys: ['token'],
      },
    },
    params: of({ token: 'invite-token' }),
    queryParams: of({}),
    fragment: of(null),
    data: of({}),
    url: of([]),
  } as unknown as ActivatedRoute;

  beforeEach(async () => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    inviteService = jasmine.createSpyObj('ProjectInviteService', [
      'previewInvite',
      'acceptInvite',
    ]);

    await TestBed.configureTestingModule({
      imports: [ProjectInviteComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: activatedRouteStub },
        { provide: ProjectInviteService, useValue: inviteService },
        { provide: Auth, useValue: {} },
      ],
    }).compileComponents();
  });

  it('有効な招待トークンでプロジェクト参加確認を表示する', fakeAsync(async () => {
    const fixture = TestBed.createComponent(ProjectInviteComponent);
    const component = fixture.componentInstance as unknown as { observeAuth: () => void };
    spyOn(component, 'observeAuth').and.callFake(() => {
      (fixture.componentInstance as ProjectInviteComponent).authenticated = true;
    });

    inviteService.previewInvite.and.resolveTo({
      invite: {
        id: 'invite-token',
        projectId: 'p1',
        token: 'invite-token',
        role: 'member' as Role,
        status: 'active' as InviteStatus,
        createdBy: 'u1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        maxUses: null,
        useCount: 0,
        usedBy: null,
        usedAt: null,
        revokedBy: null,
        revokedAt: null,
      },
      project: { id: 'p1', name: 'Test Project', description: 'desc' },
    });

    fixture.detectChanges();
    tick();

    expect(fixture.componentInstance.projectName).toBe('Test Project');
    expect(fixture.componentInstance.inviteStatus).toBe('active');
    expect(fixture.componentInstance.inviteRole).toBe('member');
    expect(fixture.componentInstance.error).toBe('');
  }));

  it('無効な招待トークンの場合はエラーメッセージを表示する', fakeAsync(async () => {
    inviteService.previewInvite.and.rejectWith(new Error('招待リンクが無効です'));

    const fixture = TestBed.createComponent(ProjectInviteComponent);
    const component = fixture.componentInstance as unknown as { observeAuth: () => void };
    spyOn(component, 'observeAuth').and.callFake(() => { /* mock observeAuth - no-op */ });

    fixture.detectChanges();
    tick();

    expect(fixture.componentInstance.error).toBe('招待リンクが無効です');
    expect(fixture.componentInstance.loading).toBeFalse();
  }));
});

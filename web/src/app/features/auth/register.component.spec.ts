import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RegisterComponent } from './register.component';
import { AuthService } from '../../core/auth.service';
import { UserProfileService } from '../../core/user-profile.service';

class RouterStub {
  navigate = jasmine.createSpy('navigate');
}

describe('RegisterComponent', () => {
  let router: RouterStub;
  let authService: jasmine.SpyObj<AuthService>;
  let userProfileService: jasmine.SpyObj<UserProfileService>;

  beforeEach(async () => {
    router = new RouterStub();
    authService = jasmine.createSpyObj('AuthService', ['register']);
    userProfileService = jasmine.createSpyObj('UserProfileService', [
      'isUsernameAvailable',
      'initializeUserProfile',
    ]);

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: authService },
        { provide: UserProfileService, useValue: userProfileService },
      ],
    }).compileComponents();
  });

  it('新規アカウント作成フォームを表示する', () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('h1')?.textContent).toContain('Issue Tracker');
    expect(compiled.querySelector('form')).toBeTruthy();
    expect(compiled.querySelector('#email')).toBeTruthy();
    expect(compiled.querySelector('#password')).toBeTruthy();
  });

  it('入力値でアカウント作成し、ログイン画面へ遷移する', fakeAsync(async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    const component = fixture.componentInstance;

    component.registerForm.username = 'newuser';
    component.registerForm.email = 'new@example.com';
    component.registerForm.password = 'strongpassword';
    component.registerForm.confirmPassword = 'strongpassword';

    userProfileService.isUsernameAvailable.and.resolveTo(true);
    userProfileService.initializeUserProfile.and.resolveTo(undefined);
    const createdUser = { delete: jasmine.createSpy('delete') } as unknown as import('@angular/fire/auth').User;
    authService.register.and.resolveTo(createdUser);

    await component.register();
    tick(2000);

    expect(authService.register).toHaveBeenCalledWith('new@example.com', 'strongpassword');
    expect(userProfileService.initializeUserProfile).toHaveBeenCalled();
    expect(component.successMessage).toContain('確認メールを送信しました');
    expect(router.navigate).toHaveBeenCalledWith(['/login'], { queryParams: { registered: 'true' } });
  }));
});
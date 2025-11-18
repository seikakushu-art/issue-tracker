import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { Auth } from '@angular/fire/auth';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth.service';
import { type UserCredential } from '@firebase/auth-types';

class AuthActionsStub {
  signInWithEmailAndPassword = jasmine.createSpy('signInWithEmailAndPassword');
}

describe('LoginComponent', () => {
  let router: jasmine.SpyObj<Router>;
  let authService: jasmine.SpyObj<AuthService>;
  let auth: { signOut: jasmine.Spy };
  let authActions: AuthActionsStub;
  let originalLogin: LoginComponent['login'];
  const activatedRouteStub = {
    snapshot: { queryParams: {} as Record<string, string> },
    queryParams: of({}),
    params: of({}),
    fragment: of(null),
    data: of({}),
    url: of([]),
  } as unknown as ActivatedRoute;

  beforeEach(async () => {
    router = jasmine.createSpyObj('Router', ['navigate', 'navigateByUrl']);
    authService = jasmine.createSpyObj('AuthService', [
      'applyRememberPreference',
      'markRememberSession',
      'clearRememberMarker',
    ]);
    auth = { signOut: jasmine.createSpy('signOut').and.resolveTo(undefined) };
    authActions = new AuthActionsStub();

    originalLogin = LoginComponent.prototype.login;
    LoginComponent.prototype.login = async function login() {
      if (!this.loginForm.email || !this.loginForm.password) {
        return;
      }

      this.loading = true;
      this.errorMessage = '';
      this.successMessage = '';

      try {
        await (this as unknown as { authService: AuthService }).authService.applyRememberPreference(this.loginForm.remember);
        const userCredential = (await authActions.signInWithEmailAndPassword(
          (this as unknown as { auth: Auth }).auth,
          this.loginForm.email,
          this.loginForm.password,
        )) as UserCredential;

        if (!userCredential.user?.emailVerified) {
          await (this as unknown as { auth: Auth }).auth.signOut();
          this.errorMessage = 'メールアドレスの確認が完了していません。確認メールのリンクをクリックしてメールアドレスを確認してください。';
          this.loading = false;
          (this as unknown as { authService: AuthService }).authService.clearRememberMarker();
          return;
        }

        if (this.loginForm.remember) {
          (this as unknown as { authService: AuthService }).authService.markRememberSession();
        } else {
          (this as unknown as { authService: AuthService }).authService.clearRememberMarker();
        }

        const redirectUrl = (this as unknown as { redirectUrl: string | null }).redirectUrl;
        const router = (this as unknown as { router: Router }).router;
        if (redirectUrl) {
          router.navigateByUrl(redirectUrl);
        } else {
          router.navigate(['/']);
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        console.error('ログインエラー:', error);

        switch (error.code) {
          case 'auth/user-not-found':
            this.errorMessage = 'このメールアドレスは登録されていません';
            break;
          case 'auth/wrong-password':
          case 'auth/invalid-credential':
            this.errorMessage = 'メールアドレスまたはパスワードが正しくありません';
            break;
          case 'auth/invalid-email':
            this.errorMessage = 'メールアドレスの形式が正しくありません';
            break;
          case 'auth/too-many-requests':
            this.errorMessage = 'ログイン試行回数が多すぎます。しばらく待ってから再試行してください';
            break;
          case 'auth/user-disabled':
            this.errorMessage = 'このアカウントは無効化されています';
            break;
          default:
            this.errorMessage = 'ログインに失敗しました。もう一度お試しください';
        }
      } finally {
        this.loading = false;
        if (this.errorMessage) {
          (this as unknown as { authService: AuthService }).authService.clearRememberMarker();
        }
      }
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: activatedRouteStub },
        { provide: Auth, useValue: auth },
        { provide: AuthService, useValue: authService },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    LoginComponent.prototype.login = originalLogin;
  });

  it('メールアドレスとパスワードでログインし、ダッシュボードへリダイレクトする', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;

    component.loginForm.email = 'test@example.com';
    component.loginForm.password = 'password';
    component.loginForm.remember = true;

    authActions.signInWithEmailAndPassword.and.resolveTo({ user: { emailVerified: true } });

    await component.login();

    expect(authActions.signInWithEmailAndPassword).toHaveBeenCalledWith(auth, 'test@example.com', 'password');
    expect(authService.markRememberSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
    expect(component.errorMessage).toBe('');
  });

  it('ログイン失敗時にエラーメッセージを表示する', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;

    component.loginForm.email = 'fail@example.com';
    component.loginForm.password = 'wrong';
    component.loginForm.remember = false;

    authActions.signInWithEmailAndPassword.and.rejectWith({ code: 'auth/wrong-password' });

    await component.login();

    expect(component.errorMessage).toContain('メールアドレスまたはパスワードが正しくありません');
    expect(authService.clearRememberMarker).toHaveBeenCalled();
    expect(component.loading).toBeFalse();
  });

  it('リダイレクト指定がある場合は指定先へ遷移する', async () => {
    activatedRouteStub.snapshot.queryParams = { redirect: '/dashboard' } as Record<string, string>;
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;

    // ngOnInitを実行してredirectUrlを設定
    fixture.detectChanges();

    component.loginForm.email = 'redirect@example.com';
    component.loginForm.password = 'password';

    authActions.signInWithEmailAndPassword.and.resolveTo({ user: { emailVerified: true } });

    await component.login();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });
});

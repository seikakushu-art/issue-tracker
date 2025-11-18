import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { Auth } from '@angular/fire/auth';

class AuthApiStub {
  registerUser = jasmine.createSpy('registerUser');
  sendEmailVerification = jasmine.createSpy('sendEmailVerification');
  signInWithEmailAndPassword = jasmine.createSpy('signInWithEmailAndPassword');
}

class AuthServiceWithStubbedApi extends AuthService {
  constructor(private api: AuthApiStub) {
    super();
  }

  override async register(email: string, password: string) {
    const auth = (this as unknown as { auth: Auth }).auth;
    const cred = await this.api.registerUser(
      auth,
      email,
      password,
    );
    await cred.user.reload();
    await this.api.sendEmailVerification(
      cred.user,
      (this as unknown as { verificationSettings: () => unknown }).verificationSettings(),
    );
    return cred.user;
  }

  override login(email: string, password: string) {
    const auth = (this as unknown as { auth: Auth }).auth;
    return this.api.signInWithEmailAndPassword(auth, email, password);
  }
}

describe('AuthService', () => {
  let authStub: Auth;
  let apiStub: AuthApiStub;

  beforeEach(() => {
    authStub = {} as Auth;
    apiStub = new AuthApiStub();

    TestBed.configureTestingModule({
      providers: [
        { provide: Auth, useValue: authStub },
      ],
    });
  });

  it('アカウント作成後に同じ認証情報でログインできることを確認する', async () => {
    const service = TestBed.runInInjectionContext(() => {
      return new AuthServiceWithStubbedApi(apiStub);
    });
    
    const createdUser = { reload: jasmine.createSpy('reload') } as unknown as { reload: () => Promise<void> };

    apiStub.registerUser.and.resolveTo({ user: createdUser });
    apiStub.sendEmailVerification.and.resolveTo(undefined);
    apiStub.signInWithEmailAndPassword.and.resolveTo({ user: { uid: 'login-user' } });

    const user = await service.register('new@example.com', 'password123');

    expect(apiStub.registerUser).toHaveBeenCalledWith(authStub, 'new@example.com', 'password123');
    expect(apiStub.sendEmailVerification).toHaveBeenCalledWith(createdUser, jasmine.any(Object));
    expect(user).toBe(createdUser);

    const loginResult = await service.login('new@example.com', 'password123');

    expect(apiStub.signInWithEmailAndPassword).toHaveBeenCalledWith(authStub, 'new@example.com', 'password123');
    expect(loginResult).toEqual(jasmine.objectContaining({ user: { uid: 'login-user' } }));
  });
});
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { UserSettingsComponent } from './user-settings.component';
import { UserProfileService } from '../../core/user-profile.service';
import { AuthService } from '../../core/auth.service';

interface RouterStub {
  navigate: jasmine.Spy<jasmine.Func>;
}

class UserProfileServiceStub {
  readonly user = signal({
    uid: 'user-1',
    displayName: 'Display Name',
    photoURL: 'https://example.com/photo.png',
  } as unknown as { uid: string; displayName: string; photoURL: string | null } | null);

  readonly directoryProfile = signal<{ username: string; photoURL: string | null } | null>({
    username: 'example_user',
    photoURL: 'https://example.com/photo.png',
  });

  updateUserAvatar = jasmine.createSpy('updateUserAvatar').and.resolveTo();
}

class AuthServiceStub {
  logout = jasmine.createSpy('logout').and.resolveTo();
  clearRememberMarker = jasmine.createSpy('clearRememberMarker');
}

describe('UserSettingsComponent', () => {
  let fixture: ComponentFixture<UserSettingsComponent>;
  let component: UserSettingsComponent;
  let userProfileService: UserProfileServiceStub;
  let router: RouterStub;
  let authService: AuthServiceStub;

  beforeEach(async () => {
    userProfileService = new UserProfileServiceStub();
    authService = new AuthServiceStub();
    router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };

    await TestBed.configureTestingModule({
      imports: [UserSettingsComponent],
      providers: [
        { provide: UserProfileService, useValue: userProfileService },
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('ユーザー設定画面を表示できる', () => {
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('h1')?.textContent).toContain('プロフィール');
    expect(compiled.querySelector('form.settings__form')).not.toBeNull();
    expect(compiled.querySelector('button[type="submit"]')?.textContent).toContain('変更を保存');
  });

  it('現在のユーザー情報を表示する', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    
    const compiled = fixture.nativeElement as HTMLElement;
    const usernameInput = compiled.querySelector<HTMLInputElement>('input#username');
    const iconImg = compiled.querySelector<HTMLImageElement>('.icon-preview img');

    expect(usernameInput?.value).toBe('example_user');
    expect(iconImg?.src).toContain('https://example.com/photo.png');
  });

  it('ユーザー名の変化をフォームに反映する', () => {
    userProfileService.directoryProfile.set({ username: 'next_user', photoURL: 'https://example.com/next.png' });
    fixture.detectChanges();

    const usernameInput = fixture.nativeElement.querySelector('input#username') as HTMLInputElement | null;
    expect(usernameInput?.value).toBe('next_user');
  });

  it('プロフィール画像を選択したときプレビューを更新する', () => {
    const createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:preview-url');

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    const fileInput = document.createElement('input');
    Object.defineProperty(fileInput, 'files', {
      value: [file],
    });

    component.onIconSelected({ target: fileInput } as unknown as Event);
    fixture.detectChanges();

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(component.selectedIconFile).toBe(file);
    const iconImg = fixture.nativeElement.querySelector('.icon-preview img') as HTMLImageElement | null;
    expect(iconImg?.src).toContain('blob:preview-url');
  });

  it('設定を保存するとプロフィール更新を試行し成功メッセージを表示する', async () => {
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    component.selectedIconFile = file;

    await component.save();
    fixture.detectChanges();

    expect(userProfileService.updateUserAvatar).toHaveBeenCalledWith({ photoFile: file });
    const success = fixture.nativeElement.querySelector('.alert--success');
    expect(success?.textContent).toContain('プロフィールを更新しました。');
  });

  it('画像以外のファイルが選ばれたらエラーメッセージを表示し元のプレビューに戻す', () => {
    const file = new File(['text'], 'text.txt', { type: 'text/plain' });
    const fileInput = document.createElement('input');
    Object.defineProperty(fileInput, 'files', { value: [file] });

    component.onIconSelected({ target: fileInput } as unknown as Event);
    fixture.detectChanges();

    expect(component.selectedIconFile).toBeNull();
    expect(component.iconPreviewUrl).toBe('https://example.com/photo.png');
    expect(component['iconInputElement']?.value).toBe('');
    const error = fixture.nativeElement.querySelector('.alert--error');
    expect(error?.textContent).toContain('画像ファイルを選択してください。');
  });

  it('2MB を超える画像が選択された場合エラーを表示し選択を無効化する', () => {
    const file = new File(['a'.repeat(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' });
    const fileInput = document.createElement('input');
    Object.defineProperty(fileInput, 'files', { value: [file] });

    component.onIconSelected({ target: fileInput } as unknown as Event);
    fixture.detectChanges();

    expect(component.selectedIconFile).toBeNull();
    expect(component.iconPreviewUrl).toBe('https://example.com/photo.png');
    expect(component['iconInputElement']?.value).toBe('');
    const error = fixture.nativeElement.querySelector('.alert--error');
    expect(error?.textContent).toContain('アイコン画像は 2MB 以下のファイルを選択してください。');
  });

  it('入力をリセットすると元のプロフィール画像に戻り一時ファイルを破棄する', () => {
    const createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:temp');
    const revokeObjectURLSpy = spyOn(URL, 'revokeObjectURL');

    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' });
    const fileInput = document.createElement('input');
    Object.defineProperty(fileInput, 'files', { value: [file] });

    component.onIconSelected({ target: fileInput } as unknown as Event);
    fixture.detectChanges();

    component.resetForm();
    fixture.detectChanges();

    expect(createObjectURLSpy).toHaveBeenCalledWith(file);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:temp');
    expect(component.selectedIconFile).toBeNull();
    expect(component.iconPreviewUrl).toBe('https://example.com/photo.png');
    expect(component['iconInputElement']?.value).toBe('');
    const error = fixture.nativeElement.querySelector('.alert--error');
    expect(error).toBeNull();
    const success = fixture.nativeElement.querySelector('.alert--success');
    expect(success).toBeNull();
  });

  it('保存処理が失敗したらエラーメッセージを表示し loading を解除する', async () => {
    const updateSpy = userProfileService.updateUserAvatar.and.rejectWith(new Error('network error'));

    await component.save();
    fixture.detectChanges();

    expect(updateSpy).toHaveBeenCalled();
    expect(component.loading).toBeFalse();
    const error = fixture.nativeElement.querySelector('.alert--error');
    expect(error?.textContent).toContain('プロフィールの保存に失敗しました。');
    expect(component.successMessage).toBe('');
  });

  it('ダッシュボードへ戻るボタンでナビゲーションを実行する', () => {
    component.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('ログアウトでセッションを終了しログイン画面へ遷移する', async () => {
    await component.logout();
    fixture.detectChanges();

    expect(authService.logout).toHaveBeenCalled();
    expect(authService.clearRememberMarker).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
    expect(component.loading).toBeFalse();
  });
});
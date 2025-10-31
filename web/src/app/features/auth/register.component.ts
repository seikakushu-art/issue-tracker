import { Component, OnDestroy ,inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { UserProfileService } from '../../core/user-profile.service';

/**
 * アカウント作成画面コンポーネント
 * メールアドレスとパスワードでアカウント作成
 */
@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <h1 class="auth-title">
            <i class="icon-folder"></i>
            Issue Tracker
          </h1>
          <p class="auth-subtitle">アカウント作成</p>
        </div>

        <form class="auth-form" (ngSubmit)="register()">
          <div class="form-group">
            <label for="displayName">表示名</label>
            <input 
              id="displayName"
              type="text" 
              [(ngModel)]="registerForm.displayName" 
              name="displayName"
              required
              placeholder="表示名を入力"
              [disabled]="loading"
            >
          </div>
          <div class="form-group form-group--file">
            <label for="icon">プロフィールアイコン</label>
            <div class="file-input__wrapper">
              <input
                id="icon"
                type="file"
                accept="image/*"
                (change)="onIconSelected($event)"
                [disabled]="loading"
              >
              <small class="file-input__hint">2MB 以下の画像ファイルを選択してください</small>
            </div>
            <div class="icon-preview" *ngIf="iconPreviewUrl">
              <img [src]="iconPreviewUrl" alt="選択中のアイコン">
              <button
                type="button"
                class="btn btn-tertiary"
                (click)="clearIconSelection()"
                [disabled]="loading"
              >
                選択をクリア
              </button>
            </div>
          </div>

          <div class="form-group">
            <label for="email">メールアドレス</label>
            <input 
              id="email"
              type="email" 
              [(ngModel)]="registerForm.email" 
              name="email"
              required
              placeholder="メールアドレスを入力"
              [disabled]="loading"
            >
          </div>
          
          <div class="form-group">
            <label for="password">パスワード</label>
            <input 
              id="password"
              type="password" 
              [(ngModel)]="registerForm.password" 
              name="password"
              required
              placeholder="パスワードを入力（6文字以上）"
              [disabled]="loading"
            >
          </div>

          <div class="form-group">
            <label for="confirmPassword">パスワード確認</label>
            <input 
              id="confirmPassword"
              type="password" 
              [(ngModel)]="registerForm.confirmPassword" 
              name="confirmPassword"
              required
              placeholder="パスワードを再入力"
              [disabled]="loading"
            >
          </div>

          <div class="form-actions">
            <button 
              type="submit" 
              class="btn btn-primary btn-full"
              [disabled]="!isFormValid() || loading"
            >
              {{ loading ? '作成中...' : 'アカウント作成' }}
            </button>
          </div>

          <div class="auth-footer">
            <p>既にアカウントをお持ちの方は</p>
            <button 
              type="button" 
              class="btn btn-link" 
              (click)="goToLogin()"
              [disabled]="loading"
            >
              ログイン
            </button>
          </div>
        </form>

        <!-- エラーメッセージ -->
        <div *ngIf="errorMessage" class="error-message">
          <i class="icon-error"></i>
          {{ errorMessage }}
        </div>

        <!-- 成功メッセージ -->
        <div *ngIf="successMessage" class="success-message">
          <i class="icon-success"></i>
          {{ successMessage }}
        </div>
      </div>
    </div>
  `,
  styles: [`
    .auth-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
    }

    .auth-card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.1);
      width: 100%;
      max-width: 400px;
      padding: 40px;
    }

    .auth-header {
      text-align: center;
      margin-bottom: 32px;
    }

    .auth-title {
      margin: 0 0 8px 0;
      color: #333;
      font-size: 24px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .auth-subtitle {
      margin: 0;
      color: #666;
      font-size: 16px;
    }

    .auth-form {
      margin-bottom: 24px;
    }

    .form-group {
      margin-bottom: 20px;
    }
    .form-group--file input[type="file"] {
      display: block;
      width: 100%;
    }

    .file-input__wrapper {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .file-input__hint {
      color: #666;
      font-size: 12px;
    }

    .icon-preview {
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .icon-preview img {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #e1e5e9;
    }


    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
      color: #333;
      font-size: 14px;
    }

    .form-group input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e1e5e9;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.2s ease;
      box-sizing: border-box;
    }

    .form-group input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .form-group input:disabled {
      background: #f8f9fa;
      cursor: not-allowed;
    }

    .form-actions {
      margin-bottom: 24px;
    }

    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 500;
      font-size: 16px;
      transition: all 0.2s ease;
      text-decoration: none;
      display: inline-block;
      text-align: center;
    }

    .btn-primary {
      background: #667eea;
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      background: #5a6fd8;
      transform: translateY(-1px);
    }

    .btn-link {
      background: none;
      color: #667eea;
      padding: 0;
      font-size: 14px;
      text-decoration: underline;
    }

    .btn-tertiary {
      background: #f1f5f9;
      color: #334155;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
    }

    .btn-tertiary:hover:not(:disabled) {
      background: #e2e8f0;
    }

    .btn-link:hover:not(:disabled) {
      color: #5a6fd8;
    }

    .btn-full {
      width: 100%;
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .auth-footer {
      text-align: center;
      padding-top: 20px;
      border-top: 1px solid #e1e5e9;
    }

    .auth-footer p {
      margin: 0 0 8px 0;
      color: #666;
      font-size: 14px;
    }

    .error-message {
      background: #fee;
      border: 1px solid #fcc;
      border-radius: 8px;
      padding: 12px 16px;
      color: #c33;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .success-message {
      background: #efe;
      border: 1px solid #cfc;
      border-radius: 8px;
      padding: 12px 16px;
      color: #3c3;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* アイコンフォント用のスタイル */
    .icon-folder::before { content: '📁'; }
    .icon-error::before { content: '⚠️'; }
    .icon-success::before { content: '✅'; }
  `]
})
export class RegisterComponent implements OnDestroy {
  private authService = inject(AuthService);
  private router = inject(Router);
  private userProfileService = inject(UserProfileService);

  loading = false;
  errorMessage = '';
  successMessage = '';

  /** 選択中のアイコン画像を一時的に保持 */
  selectedIconFile: File | null = null;
  /** プレビュー表示用の Object URL */
  iconPreviewUrl: string | null = null;
  /** DOM の file input を再利用して値リセットに使う */
  private iconInputElement: HTMLInputElement | null = null;
  /** Object URL をクリーンアップするための保持 */
  private iconObjectUrl: string | null = null;

  registerForm = {
    displayName: '',
    email: '',
    password: '',
    confirmPassword: ''
  };

  ngOnDestroy(): void {
    // 画面遷移時に Object URL を解放
    this.revokeIconPreview();
  }

  /**
   * フォームの有効性をチェック
   */
  isFormValid(): boolean {
    return !!(
      this.registerForm.displayName &&
      this.registerForm.email &&
      this.registerForm.password &&
      this.registerForm.confirmPassword &&
      this.registerForm.password === this.registerForm.confirmPassword &&
      this.registerForm.password.length >= 6
    );
  }

  /**
   * アカウント作成処理
   */
  async register() {
    if (!this.isFormValid()) {
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      // パスワード確認
      if (this.registerForm.password !== this.registerForm.confirmPassword) {
        this.errorMessage = 'パスワードが一致しません';
        this.loading = false;
        return;
      }

      if (this.registerForm.password.length < 6) {
        this.errorMessage = 'パスワードは6文字以上で入力してください';
        this.loading = false;
        return;
      }

      // メールアドレスの形式チェック
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(this.registerForm.email)) {
        this.errorMessage = 'メールアドレスの形式が正しくありません';
        this.loading = false;
        return;
      }

      // AuthServiceを使用してアカウント作成（メール認証送信含む）
      await this.authService.register(
        this.registerForm.email,
        this.registerForm.password,
        this.registerForm.displayName
      );
      if (this.selectedIconFile) {
        try {
          await this.userProfileService.updateUserProfile({
            displayName: this.registerForm.displayName,
            photoFile: this.selectedIconFile,
          });
        } catch (error) {
          console.error('プロフィール画像の更新に失敗しました', error);
          this.errorMessage = 'プロフィール画像のアップロードに失敗しました。ログイン後にユーザー設定から再度お試しください。';
        }
      }


      this.successMessage = '確認メールを送信しました。メールのリンクを開いてからログインしてください。';
      
      // ログイン画面に遷移（メール認証が完了するまでログインできない）
      setTimeout(() => {
        this.router.navigate(['/login'], { 
          queryParams: { registered: 'true' } 
        });
      }, 2000);

    } catch (error: unknown) {
      console.error('アカウント作成エラー:', error);
      
      // エラーメッセージを設定
      if (error instanceof Error && 'code' in error) {
        const firebaseError = error as { code: string; message?: string };
        switch (firebaseError.code) {
          case 'auth/email-already-in-use':
            this.errorMessage = 'このメールアドレスは既に使用されています';
            break;
          case 'auth/invalid-email':
            this.errorMessage = 'メールアドレスの形式が正しくありません';
            break;
          case 'auth/weak-password':
            this.errorMessage = 'パスワードが弱すぎます。より強力なパスワードを設定してください';
            break;
          case 'auth/operation-not-allowed':
            this.errorMessage = 'アカウント作成が無効になっています';
            break;
          case 'auth/invalid-password':
            this.errorMessage = 'パスワードは6文字以上で入力してください';
            break;
          default:
            this.errorMessage = firebaseError.message || 'アカウント作成に失敗しました。もう一度お試しください';
        }
      } else {
        this.errorMessage = 'アカウント作成に失敗しました。もう一度お試しください';
      }
    } finally {
      this.loading = false;
    }
  }

  /**
   * ログイン画面に遷移
   */
  goToLogin() {
    this.router.navigate(['/login']);
  }
  /**
   * プロフィールアイコンの選択時にバリデーションとプレビュー生成を行う
   */
  onIconSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    this.iconInputElement = input;

    const file = input.files?.[0];
    if (!file) {
      this.clearIconSelection();
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.errorMessage = '画像ファイルを選択してください';
      input.value = '';
      this.clearIconSelection();
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.errorMessage = 'アイコン画像は 2MB 以下のファイルを選択してください';
      input.value = '';
      this.clearIconSelection();
      return;
    }

    this.errorMessage = '';
    this.selectedIconFile = file;
    this.updateIconPreview(file);
  }

  /**
   * アイコン選択をリセットしてプレビューを消去
   */
  clearIconSelection() {
    this.selectedIconFile = null;
    this.revokeIconPreview();
    this.iconPreviewUrl = null;
    if (this.iconInputElement) {
      this.iconInputElement.value = '';
    }
  }

  /**
   * Object URL を生成してプレビューへ反映
   */
  private updateIconPreview(file: File) {
    this.revokeIconPreview();
    this.iconObjectUrl = URL.createObjectURL(file);
    this.iconPreviewUrl = this.iconObjectUrl;
  }

  /**
   * Object URL を解放してメモリリークを防ぐ
   */
  private revokeIconPreview() {
    if (this.iconObjectUrl) {
      URL.revokeObjectURL(this.iconObjectUrl);
      this.iconObjectUrl = null;
    }
  }
}
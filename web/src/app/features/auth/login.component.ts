import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Auth, signInWithEmailAndPassword, sendPasswordResetEmail } from '@angular/fire/auth';
import { AuthService } from '../../core/auth.service';

/**
 * ログイン画面コンポーネント
 * メールアドレスとパスワードでログイン
 */
@Component({
  selector: 'app-login',
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
          <p class="auth-subtitle">ログイン</p>
        </div>

        <form class="auth-form" (ngSubmit)="login()">
          <!-- エラーメッセージ -->
          <div *ngIf="errorMessage" class="error-message">
            <i class="icon-error"></i>
            {{ errorMessage }}
          </div>

          <div class="form-group">
            <label for="email">メールアドレス</label>
            <input 
              id="email"
              type="email" 
              [(ngModel)]="loginForm.email" 
              name="email"
              required
              placeholder="メールアドレスを入力"
              [disabled]="loading"
            >
          </div>
          
          <div class="form-group">
            <label for="password">パスワード</label>
            <div class="password-input-wrapper">
              <input 
                id="password"
                [type]="showPassword ? 'text' : 'password'" 
                [(ngModel)]="loginForm.password" 
                name="password"
                required
                placeholder="パスワードを入力"
                [disabled]="loading"
              >
              <button
                type="button"
                class="password-toggle-btn"
                (click)="showPassword = !showPassword"
                [disabled]="loading"
                [attr.aria-label]="showPassword ? 'パスワードを非表示' : 'パスワードを表示'"
              >
                <span class="password-toggle-icon">{{ showPassword ? '👁️' : '👁️‍🗨️' }}</span>
              </button>
            </div>
          </div>

          <div class="form-group remember-group">
            <label class="remember-label">
            <span class="remember-text">ログイン状態を維持します</span>
              <input
                type="checkbox"
                [(ngModel)]="loginForm.remember"
                name="remember"
                [disabled]="loading"
              >
            </label>
            <p class="remember-note">チェックすると30日間ログイン状態を維持します。</p>
          </div>

          <div class="form-actions">
            <button 
              type="submit" 
              class="btn btn-primary btn-full"
              [disabled]="!loginForm.email || !loginForm.password || loading"
            >
              {{ loading ? 'ログイン中...' : 'ログイン' }}
            </button>
          </div>

          <div class="form-secondary-actions">
            <button
              type="button"
              class="btn btn-secondary btn-full"
              (click)="sendPasswordReset()"
              [disabled]="!loginForm.email || loading || sendingReset"
            >
              {{ sendingReset ? '送信中...' : 'パスワードをお忘れの方はこちら' }}
            </button>
            <p class="secondary-note">入力されたメール宛に15分間有効なリセットリンクを送信します。</p>
          </div>

          <div class="auth-footer">
            <p>アカウントをお持ちでない方は</p>
            <button 
              type="button" 
              class="btn btn-link" 
              (click)="goToRegister()"
              [disabled]="loading"
            >
              アカウント作成
            </button>
          </div>
        </form>

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

    .form-group label:not(.remember-label) {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
      color: #333;
      font-size: 14px;
    }

    .remember-group {
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .remember-label{
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #333;
      font-size: 14px;
      white-space: nowrap;
    }

    .remember-label input {
      width: 18px;
      height: 18px;
      margin: 0 2px 0 0;
    }

    .remember-text {
      font-weight: 500;
      padding: 2px 12px 2px 8px;
      border-radius: 4px; 
    }

    .remember-note {
      margin: 0;
      color: #666;
      font-size: 12px;
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

    .password-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .password-input-wrapper input {
      padding-right: 48px;
    }

    .password-toggle-btn {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background-color 0.2s ease;
    }

    .password-toggle-btn:hover:not(:disabled) {
      background-color: #f1f5f9;
    }

    .password-toggle-btn:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .password-toggle-icon {
      font-size: 18px;
      line-height: 1;
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

    .form-secondary-actions {
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
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

    .btn-secondary {
      background: #eef2ff;
      color: #4c51bf;
    }

    .btn-secondary:hover:not(:disabled) {
      background: #e0e7ff;
      color: #3730a3;
    }


    .btn-link {
      background: none;
      color: #667eea;
      padding: 0;
      font-size: 14px;
      text-decoration: underline;
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

    .secondary-note {
      margin: 0;
      color: #666;
      font-size: 12px;
      line-height: 1.6;
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
      margin-bottom: 20px;
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
export class LoginComponent implements OnInit {
  private auth = inject(Auth);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);

  loading = false;
  errorMessage = '';
  successMessage = '';
  private redirectUrl: string | null = null;
  sendingReset = false;
  showPassword = false;

  loginForm = {
    email: '',
    password: '',
    remember: false,
  };

  ngOnInit() {
    // アカウント作成後のメッセージを表示
    const registered = this.route.snapshot.queryParams['registered'];
    if (registered === 'true') {
      this.successMessage = 'アカウントが作成されました。確認メールを確認してからログインしてください。';
    }
    this.redirectUrl = this.route.snapshot.queryParams['redirect'] ?? null;
  }

  /**
   * ログイン処理
   */
  async login() {
    if (!this.loginForm.email || !this.loginForm.password) {
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.authService.applyRememberPreference(this.loginForm.remember);
      const userCredential = await signInWithEmailAndPassword(
        this.auth,
        this.loginForm.email,
        this.loginForm.password
      );
      
      // メール認証が完了しているかチェック
      if (!userCredential.user.emailVerified) {
        // ログアウトして、認証が完了していないことを通知
        await this.auth.signOut();
        this.errorMessage = 'メールアドレスの確認が完了していません。確認メールのリンクをクリックしてメールアドレスを確認してください。';
        this.loading = false;
        this.authService.clearRememberMarker();
        return;
      }

      if (this.loginForm.remember) {
        this.authService.markRememberSession();
      } else {
        this.authService.clearRememberMarker();
      }
      
      // ログイン成功時は指定のリダイレクト先があれば遷移
      if (this.redirectUrl) {
        this.router.navigateByUrl(this.redirectUrl);
      } else {
        this.router.navigate(['/']);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('ログインエラー:', error);
      
      // エラーメッセージを設定
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
        this.authService.clearRememberMarker();
      }
    }
  }

  /**
   * アカウント作成画面に遷移
   */
  goToRegister() {
    this.router.navigate(['/register']);
  }
  /**
   * パスワードリセットメールを送信
   */
  async sendPasswordReset() {
    // メールが空の場合は入力を促して処理を中断
    if (!this.loginForm.email) {
      this.errorMessage = 'パスワードリセットにはメールアドレスの入力が必要です';
      this.successMessage = '';
      return;
    }

    this.sendingReset = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      // 15分有効である旨をメール受信者に伝えるための案内文を用意
      const actionCodeSettings = {
        url: `${this.getAppOrigin()}/login`,
        handleCodeInApp: false,
      };

      await sendPasswordResetEmail(this.auth, this.loginForm.email, actionCodeSettings);
      this.successMessage = 'パスワードリセットメールを送信しました。メール内リンクは15分間有効です。';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('パスワードリセットエラー:', error);

      switch (error.code) {
        case 'auth/user-not-found':
          this.errorMessage = '入力されたメールアドレスは登録されていません';
          break;
        case 'auth/invalid-email':
          this.errorMessage = 'メールアドレスの形式が正しくありません';
          break;
        case 'auth/missing-email':
          this.errorMessage = 'メールアドレスを入力してください';
          break;
        case 'auth/too-many-requests':
          this.errorMessage = 'リクエストが多すぎます。しばらく時間を空けて再度お試しください';
          break;
        default:
          this.errorMessage = 'パスワードリセットメールの送信に失敗しました。時間を空けて再試行してください';
      }
    } finally {
      this.sendingReset = false;
    }
  }

  /**
   * アプリのベースURLを取得
   */
  private getAppOrigin(): string {
    if (typeof window !== 'undefined' && window.location) {
      return window.location.origin;
    }

    return `https://${this.auth.app.options.authDomain ?? 'localhost'}`;
  }
}
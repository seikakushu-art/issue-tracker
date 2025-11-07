import { CommonModule } from '@angular/common';
import { Component, OnDestroy, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { UserProfileService } from '../../core/user-profile.service';
import { AuthService } from '../../core/auth.service';

/**
 * ユーザー設定画面
 * 表示名とアイコン画像の更新を行える
 */
@Component({
  selector: 'app-user-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="settings">
      <div class="settings__card">
        <header class="settings__header">
          <h1>ユーザー設定</h1>
          <p>プロフィール情報を編集し、ダッシュボードに反映します。</p>
        </header>

        <form class="settings__form" (ngSubmit)="save()">
          <div class="form-group">
          <label for="username">ユーザー名</label>
            <input
              id="username"
              type="text"
              [value]="username"
              name="username"
              readonly
              aria-readonly="true"
              [disabled]="loading"
              placeholder="ユーザー名"
            >
            <small class="form-group__hint">ユーザー名は登録後に変更できません。</small>
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
              <small class="file-input__hint">2MB 以下の画像ファイルに対応しています。</small>
            </div>

            <div class="icon-preview" *ngIf="iconPreviewUrl; else noIcon">
              <img [src]="iconPreviewUrl" alt="現在のアイコン">
            </div>
            <ng-template #noIcon>
              <p class="icon-preview__placeholder">現在アイコンは設定されていません。</p>
            </ng-template>

            <div class="form-group__actions">
              <button type="button" class="btn btn-tertiary" (click)="clearIconSelection()" [disabled]="loading">
                アイコンをリセット
              </button>
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary" [disabled]="loading">
              {{ loading ? '保存中...' : '変更を保存' }}
            </button>
            <button type="button" class="btn btn-secondary" (click)="resetForm()" [disabled]="loading">
              変更を取り消す
            </button>
          </div>
        </form>

        <div *ngIf="errorMessage" class="alert alert--error">
          {{ errorMessage }}
        </div>
        <div *ngIf="successMessage" class="alert alert--success">
          {{ successMessage }}
        </div>

        <footer class="settings__footer">
           <!-- ユーザーがすぐに戻れるよう、ダッシュボードへ戻る導線を配置 -->
          <button type="button" class="btn btn-link" (click)="goBack()" [disabled]="loading">
            ダッシュボードへ戻る
          </button>
          <!-- アカウントから離脱するためのログアウトボタンを追加 -->
          <button
            type="button"
            class="btn btn-danger"
            (click)="logout()"
            [disabled]="loading"
          >
            ログアウト
          </button>
        </footer>
      </div>
    </section>
  `,
  styles: [`
    .settings {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 24px;
    }

    .settings__card {
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.12);
      width: 100%;
      max-width: 520px;
      padding: 32px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .settings__header h1 {
      margin: 0 0 8px;
      font-size: 24px;
      font-weight: 700;
      color: #1e293b;
    }

    .settings__header p {
      margin: 0;
      color: #475569;
    }

    .settings__form {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .form-group__hint {
      margin-top: -4px;
      color: #64748b;
      font-size: 12px;
    }


    .form-group label {
      font-weight: 600;
      color: #1e293b;
    }

    .form-group input[type="text"] {
      padding: 12px 16px;
      border-radius: 8px;
      border: 2px solid #e2e8f0;
      font-size: 16px;
      transition: border-color 0.2s ease;
    }

    .form-group input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .form-group--file input[type="file"] {
      display: block;
    }

    .file-input__wrapper {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .file-input__hint {
      font-size: 12px;
      color: #64748b;
    }

    .icon-preview {
      margin-top: 12px;
    }

    .icon-preview img {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid #e2e8f0;
    }

    .icon-preview__placeholder {
      margin-top: 12px;
      color: #94a3b8;
      font-size: 14px;
    }

    .form-group__actions {
      margin-top: 12px;
      display: flex;
      gap: 12px;
    }

    .form-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn {
      border: none;
      border-radius: 8px;
      padding: 12px 20px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s ease, background-color 0.2s ease;
    }

    .btn-primary {
      background: #667eea;
      color: #ffffff;
    }

    .btn-primary:hover:not(:disabled) {
      transform: translateY(-1px);
      background: #5a6fd8;
    }

    .btn-secondary {
      background: #e2e8f0;
      color: #334155;
    }

    .btn-secondary:hover:not(:disabled) {
      transform: translateY(-1px);
      background: #cbd5f5;
    }

    .btn-tertiary {
      background: #f8fafc;
      color: #0f172a;
      padding: 10px 16px;
    }

    .btn-tertiary:hover:not(:disabled) {
      background: #e2e8f0;
    }

    .btn-link {
      background: none;
      color: #667eea;
      text-decoration: underline;
      padding: 0;
      align-self: flex-start;
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-danger {
      background: #ef4444; /* 直感的に危険操作と分かる赤色を採用 */
      color: #ffffff;
    }

    .btn-danger:hover:not(:disabled) {
      transform: translateY(-1px);
      background: #dc2626;
    }

    .alert {
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
    }

    .alert--error {
      background: #fee2e2;
      color: #b91c1c;
    }

    .alert--success {
      background: #dcfce7;
      color: #166534;
    }

    .settings__footer {
      display: flex;
      justify-content: flex-start;
      gap: 12px; /* ボタン同士が詰まらないよう適度な余白を確保 */
      flex-wrap: wrap; /* 狭い画面でもボタンが折り返せるようにする */
    }

    @media (max-width: 600px) {
      .settings__card {
        padding: 24px;
      }

      .form-actions {
        flex-direction: column;
        align-items: stretch;
      }

      .btn-link {
        align-self: center;
      }
    }
  `],
})
export class UserSettingsComponent implements OnDestroy {
  private readonly userProfileService = inject(UserProfileService);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService); // 認証処理を担当するサービスを注入

  username = '';
  iconPreviewUrl: string | null = null;
  private originalPhotoUrl: string | null = null;
  private iconObjectUrl: string | null = null;
  private iconInputElement: HTMLInputElement | null = null;
  selectedIconFile: File | null = null;

  loading = false;
  errorMessage = '';
  successMessage = '';

  private readonly profileEffect = effect(() => this.applyUserProfile());

  ngOnDestroy(): void {
    this.revokeIconPreview();
    this.profileEffect.destroy();
  }

  /**
   * 現在のユーザー情報をフォームへ反映
   */
  private applyUserProfile(): void {
    const authUser = this.userProfileService.user();
    const directoryProfile = this.userProfileService.directoryProfile();

    if (!authUser) {
      this.username = '';
      this.iconPreviewUrl = null;
      this.originalPhotoUrl = null;
      return;
    }

    const resolvedUsername = directoryProfile?.username
    ?? authUser.displayName
    ?? authUser.uid
    ?? '';
  const resolvedPhotoUrl = directoryProfile?.photoURL ?? authUser.photoURL ?? null;

  this.username = resolvedUsername;
  this.originalPhotoUrl = resolvedPhotoUrl;
    if (!this.selectedIconFile) {
      this.iconPreviewUrl = resolvedPhotoUrl;
    }
  }

  /**
   * プロフィールを保存する
   */
  async save(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.userProfileService.updateUserAvatar({
        photoFile: this.selectedIconFile ?? undefined,
      });

      this.successMessage = 'プロフィールを更新しました。';
      this.selectedIconFile = null;
      this.revokeIconPreview();
      this.iconPreviewUrl = null;
      this.applyUserProfile();
      if (this.iconInputElement) {
        this.iconInputElement.value = '';
      }
    } catch (error) {
      console.error('プロフィール更新に失敗しました', error);
      this.errorMessage = 'プロフィールの保存に失敗しました。時間をおいて再度お試しください。';
    } finally {
      this.loading = false;
    }
  }

  /**
   * ダッシュボードへ戻る
   */
  goBack(): void {
    void this.router.navigate(['/dashboard']);
  }

  /**
   * Firebase からサインアウトし、ログイン画面へ誘導する
   */
  async logout(): Promise<void> {
    if (this.loading) {
      return; // 他の処理でビジー状態なら何もしない
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.authService.logout(); // Firebase 側のセッションを終了
      this.authService.clearRememberMarker(); // 「ログイン状態を保持」を解除し次回は確実にログインを要求
      void this.router.navigate(['/login']); // ログインページへ移動
    } catch (error) {
      console.error('ログアウトに失敗しました', error);
      this.errorMessage = 'ログアウトに失敗しました。時間をおいて再度お試しください。';
      this.loading = false;
    }
  }

  /**
   * 入力内容を現在のユーザー情報へ戻す
   */
  resetForm(): void {
    this.errorMessage = '';
    this.successMessage = '';
    this.selectedIconFile = null;
    this.revokeIconPreview();
    this.iconPreviewUrl = null;
    if (this.iconInputElement) {
      this.iconInputElement.value = '';
    }
    this.applyUserProfile();
  }

  /**
   * 新しいアイコン選択時のバリデーションとプレビュー生成
   */
  onIconSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.iconInputElement = input;

    const file = input.files?.[0];
    if (!file) {
      this.clearIconSelection();
      return;
    }

    if (!file.type.startsWith('image/')) {
      this.errorMessage = '画像ファイルを選択してください。';
      input.value = '';
      this.clearIconSelection();
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.errorMessage = 'アイコン画像は 2MB 以下のファイルを選択してください。';
      input.value = '';
      this.clearIconSelection();
      return;
    }

    this.errorMessage = '';
    this.selectedIconFile = file;
    this.updateIconPreview(file);
  }

  /**
   * アイコン選択をリセットして既存画像へ戻す
   */
  clearIconSelection(): void {
    this.selectedIconFile = null;
    this.revokeIconPreview();
    this.iconPreviewUrl = this.originalPhotoUrl;
    if (this.iconInputElement) {
      this.iconInputElement.value = '';
    }
  }

  private updateIconPreview(file: File): void {
    this.revokeIconPreview();
    this.iconObjectUrl = URL.createObjectURL(file);
    this.iconPreviewUrl = this.iconObjectUrl;
  }

  private revokeIconPreview(): void {
    if (this.iconObjectUrl) {
      URL.revokeObjectURL(this.iconObjectUrl);
      this.iconObjectUrl = null;
    }
  }
}
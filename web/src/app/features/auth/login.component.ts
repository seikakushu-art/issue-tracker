import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
//ログイン画面
@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="max-w-sm mx-auto p-4">
      <h1 class="text-xl font-bold mb-4">ログイン</h1>
      <form (ngSubmit)="onSubmit()" #f="ngForm" class="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          [(ngModel)]="email"
          placeholder="メール"
          required
          class="border p-2 rounded"
        />
        <input
          name="password"
          type="password"
          [(ngModel)]="password"
          placeholder="パスワード"
          required
          class="border p-2 rounded"
        />
        <label class="text-sm flex items-center gap-2">
          <input type="checkbox" [(ngModel)]="remember" name="remember" />
          ログイン状態を保持（30日）
        </label>

        <button class="border rounded px-3 py-2" [disabled]="loading()">
          ログイン
        </button>
        <button
          type="button"
          class="text-sm underline text-left"
          (click)="onReset($event)"
        >
          パスワードをお忘れですか？
        </button>

        <a class="text-sm underline" routerLink="/register">新規登録へ</a>
        <p class="text-red-600 text-sm" *ngIf="error()">{{ error() }}</p>
      </form>
    </div>
  `,
})
export class LoginComponent {
  private router = inject(Router);
  private auth = inject(AuthService);

  email = '';
  password = '';
  remember = true;
  loading = signal(false);
  error = signal('');

  async onSubmit() {
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.setRemember(this.remember);
      await this.auth.login(this.email, this.password);
      this.router.navigateByUrl('/projects');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'ログインに失敗しました');
    } finally {
      this.loading.set(false);
    }
  }

  async onReset(ev?: Event) {
    ev?.preventDefault(); // aタグ使用時のページ遷移防止
    if (!this.email) {
      this.error.set('メールを入力してください');
      return;
    }
    try {
      await this.auth.resetPassword(this.email);
      alert('パスワードリセットメールを送信しました');
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : '送信に失敗しました');
    }
  }
}

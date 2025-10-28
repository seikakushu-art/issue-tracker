import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
//新規登録画面
@Component({
  standalone: true,
  selector: 'app-register',
  imports: [CommonModule, FormsModule],
  template: ` <div class="max-w-sm mx-auto p-4">
    <h1 class="text-xl font-bold mb-4">新規登録</h1>
    <form (ngSubmit)="onSubmit()" #f="ngForm" class="flex flex-col gap-3">
      <input
        name="displayName"
        [(ngModel)]="displayName"
        placeholder="表示名"
        required
        class="border p-2 rounded"
      />
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
        placeholder="パスワード（8文字以上推奨）"
        required
        class="border p-2 rounded"
      />
      <button class="border rounded px-3 py-2" [disabled]="loading()">
        登録
      </button>
      <a class="text-sm underline" routerLink="/login">ログインへ戻る</a>
      <p class="text-red-600 text-sm" *ngIf="error()">{{ error() }}</p>
    </form>
  </div>`,
})
export class RegisterComponent {
  private router = inject(Router);
  private auth = inject(AuthService);

  displayName = '';
  email = '';
  password = '';
  loading = signal(false);
  error = signal('');

  async onSubmit() {
    this.loading.set(true);
    this.error.set('');
    try {
      await this.auth.register(this.email, this.password, this.displayName);
      alert(
        '確認メールを送信しました。メールのリンクを開いてからログインしてください。',
      );
      this.router.navigateByUrl('/login');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '登録に失敗しました';
      this.error.set(message);
    } finally {
      this.loading.set(false);
    }
  }
}

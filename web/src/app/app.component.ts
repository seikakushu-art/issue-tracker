import { Component, inject, OnInit, OnDestroy, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NgIf } from '@angular/common';
import { Auth, onAuthStateChanged, User, Unsubscribe } from '@angular/fire/auth';
import { NotificationService } from './core/notification.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgIf],
  template: `
    <header class="px-4 py-2 border-b flex items-center gap-3">
      <strong>Issue Tracker</strong>
      <span class="ml-auto text-sm opacity-70" *ngIf="user() as u">{{ u.email }}</span>
    </header>
    <router-outlet />
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  private auth = inject(Auth);
  private notif = inject(NotificationService);
  user = signal<User | null>(null);
  private offAuth?: Unsubscribe;

  ngOnInit() {
    this.offAuth = onAuthStateChanged(this.auth, async (u) => {
      this.user.set(u);
      if (!u) return;

      try {
        const due = await this.notif.tasksDueToday(); // まずは one-shot 取得にする（次項）
        if (due.length) {
          alert(`本日期限のタスク: \n- ${due.map((t) => t.title).join('\n- ')}`);
        }
      } catch (e) {
        console.error('tasksDueToday でエラー:', e);
      }
    });
  }

  ngOnDestroy() {
    this.offAuth?.();
  }
}


import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NgIf } from '@angular/common';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { NotificationService } from './core/notification.service';
//シェル（ヘッダー + router-outlet）
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgIf],
  template: `
    <header class="px-4 py-2 border-b flex items-center gap-3">
      <strong>Issue Tracker</strong>
      <span class="ml-auto text-sm opacity-70" *ngIf="user() as u">{{
        u.email
      }}</span>
    </header>
    <router-outlet />
  `,
})
export class AppComponent implements OnInit {
  private auth = inject(Auth);
  private notif = inject(NotificationService);
  user = signal<User | null>(null);

  async ngOnInit() {
    //アプリ起動時にダイアログ表示（簡易版アラート）
    onAuthStateChanged(this.auth, async (u) => {
      this.user.set(u);
      if (u) {
        const due = await this.notif.tasksDueToday();
        if (due.length)
          alert(
            `本日期限のタスク: \n- ${due.map((t) => t.title).join('\n- ')}`,
          );
      }
    });
  }
}

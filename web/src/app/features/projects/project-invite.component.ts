import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import { ProjectInviteService } from './project-invite.service';
import { InviteStatus, ProjectInvite, Role } from '../../models/schema';

@Component({
  selector: 'app-project-invite',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="invite-container" *ngIf="!loading">
      <ng-container *ngIf="!error; else errorBlock">
        <div class="invite-card">
          <h1>プロジェクト招待</h1>

          <section class="invite-summary" *ngIf="projectName">
            <h2>{{ projectName }}</h2>
            <p class="invite-meta">
              権限: <span class="role-chip" [class]="'role-' + inviteRole">{{ translateRole(inviteRole) }}</span>
            </p>
            <p class="invite-meta">期限: {{ expiresAt | date:'yyyy/MM/dd HH:mm' }}</p>
            <p class="invite-status" [class]="'status-' + inviteStatus">{{ translateStatus(inviteStatus) }}</p>
          </section>

          <ng-container [ngSwitch]="inviteStatus">
            <div *ngSwitchCase="'active'">
              <ng-container *ngIf="authenticated; else loginPrompt">
                <button class="btn btn-primary" (click)="accept()" [disabled]="accepting">
                  {{ accepting ? '参加処理中...' : 'プロジェクトに参加する' }}
                </button>
              </ng-container>
            </div>
            <div *ngSwitchDefault>
              <p class="info-message">この招待リンクは無効です。</p>
              <button class="btn btn-secondary" routerLink="/">トップへ戻る</button>
            </div>
          </ng-container>

          <ng-template #loginPrompt>
            <p class="info-message">参加するにはログインしてください。</p>
            <p class="info-message">アカウントをお持ちでない場合は<a href="https://kensyu10115.web.app/register">こちら</a>から新規登録してください。</p>
            <button class="btn btn-primary" (click)="goToLogin()">ログイン画面へ</button>
          </ng-template>

          <p *ngIf="successMessage" class="success-message">{{ successMessage }}</p>
          <p *ngIf="actionError" class="error-message">{{ actionError }}</p>
        </div>
      </ng-container>
    </div>

    <ng-template #errorBlock>
      <div class="invite-container">
        <div class="invite-card">
          <h1>招待が確認できません</h1>
          <p class="error-message">{{ error }}</p>
          <button class="btn btn-secondary" routerLink="/">トップへ戻る</button>
        </div>
      </div>
    </ng-template>

    <div class="invite-container" *ngIf="loading">
      <div class="invite-card">
        <h1>読み込み中...</h1>
      </div>
    </div>
  `,
  styles: [`
    .invite-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%);
      padding: 24px;
      box-sizing: border-box;
    }

    .invite-card {
      background: #fff;
      border-radius: 16px;
      max-width: 480px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 20px 45px rgba(0, 0, 0, 0.15);
      text-align: center;
    }

    h1 {
      margin: 0 0 16px;
      font-size: 24px;
      color: #1f2933;
    }

    h2 {
      margin: 0 0 12px;
      font-size: 20px;
      color: #1f2933;
      word-break: break-word;
      overflow-wrap: break-word;
    }

    .invite-summary {
      margin-bottom: 24px;
    }

    .invite-meta {
      margin: 4px 0;
      color: #4b5563;
      font-size: 14px;
    }

    .role-chip {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 12px;
      color: #fff;
    }

    .role-admin { background: #f97316; }
    .role-member { background: #2563eb; }
    .role-guest { background: #6b7280; }

    .invite-status {
      margin-top: 12px;
      font-weight: 600;
    }

    .status-active { color: #16a34a; }
    .status-used { color: #4b5563; }
    .status-expired { color: #ef4444; }
    .status-revoked { color: #ef4444; }

    .btn {
      padding: 12px 20px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 15px;
      font-weight: 600;
      margin-top: 12px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .btn-primary {
      background: #2563eb;
      color: #fff;
      width: 100%;
    }

    .btn-secondary {
      background: #e5e7eb;
      color: #111827;
      width: 100%;
    }

    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 20px rgba(37, 99, 235, 0.15);
    }

    .error-message {
      margin-top: 16px;
      color: #b91c1c;
      font-size: 14px;
    }

    .success-message {
      margin-top: 16px;
      color: #0f766e;
      font-size: 14px;
    }

    .info-message {
      margin-top: 16px;
      color: #374151;
      font-size: 14px;
    }
  `],
})
export class ProjectInviteComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(Auth);
  private inviteService = inject(ProjectInviteService);

  loading = true;
  accepting = false;
  authenticated = false;
  error = '';
  actionError = '';
  successMessage = '';

  projectName: string | null = null;
  inviteStatus: InviteStatus = 'active';
  inviteRole: Role = 'member';
  expiresAt: Date = new Date();
  currentInvite: ProjectInvite | null = null;

  private token = '';
  private authSub: Subscription | null = null;

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.error = '招待リンクが無効です。';
      this.loading = false;
      return;
    }

    this.observeAuth();
    void this.loadInvite();
  }

  ngOnDestroy(): void {
    this.authSub?.unsubscribe();
  }

  private observeAuth() {
    this.authSub = new Subscription();
    const sub = onAuthStateChanged(this.auth, (user) => {
      this.authenticated = Boolean(user);
    });
    this.authSub.add({ unsubscribe: () => sub() });
  }

  private async loadInvite(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const { invite, project } = await this.inviteService.previewInvite(this.token);
      this.currentInvite = invite;
      this.projectName = project?.name ?? null;
      this.inviteStatus = invite.status;
      this.inviteRole = invite.role;
      this.expiresAt = invite.expiresAt;
    } catch (err) {
      console.error('Failed to load invite:', err);
      this.error = err instanceof Error ? err.message : '招待リンクが確認できませんでした。';
    } finally {
      this.loading = false;
    }
  }

  translateRole(role: Role): string {
    switch (role) {
      case 'admin': return '管理者';
      case 'member': return 'メンバー';
      case 'guest': return 'ゲスト';
      default: return role;
    }
  }

  translateStatus(status: InviteStatus): string {
    switch (status) {
      case 'active': return '有効な招待リンクです';
      case 'used': return '使用済みの招待リンクです';
      case 'expired': return '期限切れの招待リンクです';
      case 'revoked': return '取り消された招待リンクです';
      default: return status;
    }
  }

  goToLogin() {
    this.router.navigate(['/login'], { queryParams: { redirect: this.router.url } });
  }

  async accept(): Promise<void> {
    if (!this.currentInvite) {
      this.actionError = '招待情報が取得できませんでした。';
      return;
    }

    this.accepting = true;
    this.actionError = '';
    try {
      const result = await this.inviteService.acceptInvite(this.currentInvite.token);
      this.successMessage = 'プロジェクトに参加しました。';
      this.inviteStatus = 'used';
      setTimeout(() => {
        this.router.navigate(['/projects', result.projectId]);
      }, 1200);
    } catch (err) {
      console.error('Failed to accept invite:', err);
      this.actionError = err instanceof Error ? err.message : '参加に失敗しました。';
      void this.loadInvite();
    } finally {
      this.accepting = false;
    }
  }
}


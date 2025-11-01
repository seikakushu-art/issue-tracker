import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, Router, ActivatedRoute,NavigationEnd,RouterLink, RouterLinkActive} from '@angular/router';
import { Subject, takeUntil,filter, startWith} from 'rxjs';
import { ProjectsService } from './features/projects/projects.service';
import { IssuesService } from './features/issues/issues.service';
import { TasksService } from './features/tasks/tasks.service';
import { Project, Issue, Task } from './models/schema';

/**
 * メインアプリケーションコンポーネント
 * ナビゲーション、パンくずリスト、階層データの管理を担当
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="app-container">
      <!-- ヘッダー -->
      <header class="app-header">
        <div class="header-content">
          <h1 class="app-title" (click)="goHome()" (keydown.enter)="goHome()" role="button" tabindex="0">
            <i class="icon-folder"></i>
            Issue Tracker
          </h1>
          
          <!-- パンくずリスト -->
          <nav class="breadcrumb" *ngIf="breadcrumbs.length > 0">
            <span 
              *ngFor="let crumb of breadcrumbs; let last = last" 
              class="breadcrumb-item"
              [class.active]="last"
              (click)="navigateToCrumb(crumb)" (keydown.enter)="navigateToCrumb(crumb)" role="button" tabindex="0"
            >
              {{ crumb.label }}
              <i *ngIf="!last" class="icon-chevron-right"></i>
            </span>
          </nav>
        </div>
        <nav class="primary-nav" aria-label="主要ナビゲーション">
          <a routerLink="/dashboard" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">ダッシュボード</a>
          <a routerLink="/projects" routerLinkActive="active">プロジェクト一覧</a>
          <a routerLink="/board" routerLinkActive="active">掲示板</a>
        </nav>
    </header>

      <!-- メインコンテンツ -->
      <main class="app-main">
        <router-outlet></router-outlet>
      </main>

      <!-- フッター -->
      <footer class="app-footer">
        <div class="footer-content">
          <p>&copy; 2024 Issue Tracker. All rights reserved.</p>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    .app-container {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .app-header {
      background: #fff;
      border-bottom: 1px solid #e1e5e9;
      padding: 0 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .header-content {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 60px;
    }

    .primary-nav {
      max-width: 1200px;
      margin: 0 auto 12px;
      display: flex;
      gap: 16px;
    }

    .primary-nav a {
      text-decoration: none;
      color: #475569;
      font-weight: 600;
      padding-bottom: 4px;
      border-bottom: 3px solid transparent;
      transition: color 0.2s ease, border-color 0.2s ease;
    }

    .primary-nav a:hover {
      color: #2563eb;
    }

    .primary-nav a.active {
      color: #2563eb;
      border-color: #2563eb;
    }

    .app-title {
      margin: 0;
      color: #333;
      font-size: 20px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .app-title:hover {
      color: #007bff;
    }

    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .breadcrumb-item {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #666;
      font-size: 14px;
      cursor: pointer;
      transition: color 0.2s ease;
    }

    .breadcrumb-item:hover {
      color: #007bff;
    }

    .breadcrumb-item.active {
      color: #333;
      font-weight: 500;
      cursor: default;
    }

    .breadcrumb-item.active:hover {
      color: #333;
    }

    .app-main {
      flex: 1;
      background: #f8f9fa;
    }

    .app-footer {
      background: #fff;
      border-top: 1px solid #e1e5e9;
      padding: 20px;
    }

    .footer-content {
      max-width: 1200px;
      margin: 0 auto;
      text-align: center;
    }

    .footer-content p {
      margin: 0;
      color: #666;
      font-size: 14px;
    }

    /* アイコンフォント用のスタイル（実際のアイコンフォントに置き換え） */
    .icon-folder::before { content: '📁'; }
    .icon-chevron-right::before { content: '›'; }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private projectsService = inject(ProjectsService);
  private issuesService = inject(IssuesService);
  private tasksService = inject(TasksService);
  private destroy$ = new Subject<void>();

  breadcrumbs: { label: string; path: string }[] = [];
  currentProject: Project | null = null;
  currentIssue: Issue | null = null;
  currentTask: Task | null = null;

  ngOnInit() {
    this.router.events
      .pipe(
        filter(event => event instanceof NavigationEnd), // ナビゲーション完了時だけ
        startWith(null),                                  // 初回ロード時にも実行
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.updateBreadcrumbs();
      });
  }
  

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * パンくずリストを更新
   */
  private async updateBreadcrumbs() {
    const url = this.router.url;
    this.breadcrumbs = [];

    if (url === '/') {
      return; // ホームページではパンくずリストを表示しない
    }

    // プロジェクト一覧
    this.breadcrumbs.push({
      label: 'プロジェクト一覧',
      path: '/'
    });

    // URLからパラメータを抽出
    const urlParts = url.split('/').filter(part => part);
    
    if (urlParts.length >= 2 && urlParts[0] === 'projects') {
      const projectId = urlParts[1];
      
      try {
        // プロジェクト情報を取得
        this.currentProject = await this.getProjectById(projectId);
        if (this.currentProject) {
          this.breadcrumbs.push({
            label: this.currentProject.name,
            path: `/projects/${projectId}`
          });
        }
      } catch (error) {
        console.error('プロジェクトの取得に失敗:', error);
      }

      if (urlParts.length >= 4 && urlParts[2] === 'issues') {
        const issueId = urlParts[3];
        
        try {
          // 課題情報を取得
          this.currentIssue = await this.getIssueById(projectId, issueId);
          if (this.currentIssue) {
            this.breadcrumbs.push({
              label: this.currentIssue.name,
              path: `/projects/${projectId}/issues/${issueId}`
            });
          }
        } catch (error) {
          console.error('課題の取得に失敗:', error);
        }

        if (urlParts.length >= 6 && urlParts[4] === 'tasks') {
          const taskId = urlParts[5];
          
          try {
            // タスク情報を取得
            this.currentTask = await this.getTaskById(projectId, issueId, taskId);
            if (this.currentTask) {
              this.breadcrumbs.push({
                label: this.currentTask.title,
                path: `/projects/${projectId}/issues/${issueId}/tasks/${taskId}`
              });
            }
          } catch (error) {
            console.error('タスクの取得に失敗:', error);
          }
        }
      }
    }
  }

  /**
   * ホームに戻る
   */
  goHome() {
    this.router.navigate(['/']);
  }

  /**
   * パンくずリストの項目をクリックしてナビゲート
   */
  navigateToCrumb(crumb: { label: string; path: string }) {
    this.router.navigate([crumb.path]);
  }

  /**
   * プロジェクトIDでプロジェクトを取得
   */
  private async getProjectById(projectId: string): Promise<Project | null> {
    try {
      const projects = await this.projectsService.listMyProjects();
      return projects.find(p => p.id === projectId) || null;
    } catch (error) {
      console.error('プロジェクトの取得に失敗:', error);
      return null;
    }
  }

  /**
   * プロジェクトIDと課題IDで課題を取得
   */
  private async getIssueById(projectId: string, issueId: string): Promise<Issue | null> {
    try {
      return await this.issuesService.getIssue(projectId, issueId);
    } catch (error) {
      console.error('課題の取得に失敗:', error);
      return null;
    }
  }

  /**
   * プロジェクトID、課題ID、タスクIDでタスクを取得
   */
  private async getTaskById(projectId: string, issueId: string, taskId: string): Promise<Task | null> {
    try {
      return await this.tasksService.getTask(projectId, issueId, taskId);
    } catch (error) {
      console.error('タスクの取得に失敗:', error);
      return null;
    }
  }
}
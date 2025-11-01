import { Routes } from '@angular/router';
import { ProjectsListComponent } from './features/projects/projects-list.component';
import { IssuesListComponent } from './features/issues/issues-list.component';
import { TasksListComponent } from './features/tasks/tasks-list.component';
import { LoginComponent } from './features/auth/login.component';
import { RegisterComponent } from './features/auth/register.component';
import { ProjectInviteComponent } from './features/projects/project-invite.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { UserSettingsComponent } from './features/user-settings/user-settings.component';
import { BoardListComponent } from './features/board/board-list.component';
import { AttachmentsListComponent } from './features/attachments/attachments-list.component';
/**
 * アプリケーションのルート設定
 * プロジェクト → 課題 → タスクの階層構造に対応
 */
export const routes: Routes = [
  // 認証画面
  {
    path: 'login',
    component: LoginComponent,
    title: 'ログイン'
  },
  {
    path: 'register',
    component: RegisterComponent,
    title: 'アカウント作成'
  },
  {
    path: 'invite/:token',
    component: ProjectInviteComponent,
    title: 'プロジェクト招待'
  },
  {
    path: 'settings',
    component: UserSettingsComponent,
    title: 'ユーザー設定'
  },

  {
    path: 'board',
    component: BoardListComponent,
    title: '掲示板'
  },
  {
    path: 'attachments',
    component: AttachmentsListComponent,
    title: '添付ファイル一覧'
  },
  // ダッシュボード: トップと明示的な /dashboard の両方で表示
  {
    path: '',
    component: DashboardComponent,
    title: 'ダッシュボード'
  },
  {
    path: 'dashboard',
    component: DashboardComponent,
    title: 'ダッシュボード'
  },

  // プロジェクト一覧（既存画面への導線確保）
  {
    path: 'projects',
    component: ProjectsListComponent,
    title: 'プロジェクト一覧'
  },
  
  // プロジェクト詳細（課題一覧）
  {
    path: 'projects/:projectId',
    component: IssuesListComponent,
    title: '課題一覧'
  },
  
  // 課題詳細（タスク一覧）
  {
    path: 'projects/:projectId/issues/:issueId',
    component: TasksListComponent,
    title: 'タスク一覧'
  },
  
  // 404ページ
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
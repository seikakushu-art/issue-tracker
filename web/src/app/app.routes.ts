import { Routes } from '@angular/router';
import { ProjectsListComponent } from './features/projects/projects-list.component';
import { IssuesListComponent } from './features/issues/issues-list.component';
import { TasksListComponent } from './features/tasks/tasks-list.component';
import { LoginComponent } from './features/auth/login.component';
import { RegisterComponent } from './features/auth/register.component';

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

  // プロジェクト一覧（ルート）
  {
    path: '',
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
  
  // タスク詳細（実装予定）
  // {
  //   path: 'projects/:projectId/issues/:issueId/tasks/:taskId',
  //   loadComponent: () => import('./features/tasks/task-detail.component').then(m => m.TaskDetailComponent),
  //   title: 'タスク詳細'
  // },
  
  // 404ページ
  {
    path: '**',
    redirectTo: ''
  }
];
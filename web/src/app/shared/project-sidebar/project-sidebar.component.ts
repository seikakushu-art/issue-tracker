import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ProjectsService } from '../../features/projects/projects.service';
import { Project } from '../../models/schema';

/**
 * プロジェクトを一覧表示するサイドバー。
 * 左側に固定表示し、課題・タスク画面共通で利用する。
 */
@Component({
  selector: 'app-project-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './project-sidebar.component.html',
  styleUrls: ['./project-sidebar.component.scss'],
})
export class ProjectSidebarComponent implements OnInit {
  private projectsService = inject(ProjectsService);
  private router = inject(Router);

  /** 現在選択中のプロジェクトID。アクティブ表示に利用する。 */
  @Input() currentProjectId: string | null = null;

  /** 一覧表示用のプロジェクト配列。 */
  projects: Project[] = [];

  /** ロード状態のフラグ。 */
  loading = false;

  /** エラー発生時のメッセージを控える。 */
  loadError = '';

  async ngOnInit(): Promise<void> {
    await this.loadProjects();
  }

  /**
   * Firestoreからプロジェクト一覧を取得し、名称昇順で並べる。
   */
  private async loadProjects(): Promise<void> {
    this.loading = true;
    this.loadError = '';
    try {
      const projects = await this.projectsService.listMyProjects();
      this.projects = [...projects].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB, 'ja');
      });
    } catch (error) {
      console.error('プロジェクト一覧の取得に失敗しました:', error);
      this.projects = [];
      this.loadError = 'プロジェクト一覧を読み込めませんでした';
    } finally {
      this.loading = false;
    }
  }

  /** ループのtrackByでIDを利用して再描画負荷を抑える。 */
  trackByProjectId(_: number, project: Project): string | number {
    return project.id ?? _;
  }

  /**
   * プロジェクト作成導線。既存の一覧画面へ遷移し、作成モーダルを開ける。
   */
  async openCreateProject(): Promise<void> {
    await this.router.navigate(['/projects'], { queryParams: { create: 'true' } });
  }
}
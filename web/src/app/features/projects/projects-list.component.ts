import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { ProjectsService } from './projects.service';
import { Project } from '../../models/schema';
import { IssuesService } from '../issues/issues.service';
import { FirebaseError } from '@angular/fire/app';

/**
 * プロジェクト一覧コンポーネント
 * プロジェクトの一覧表示、作成、編集、アーカイブ機能を提供
 */
@Component({
  selector: 'app-projects-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="projects-container">
      <!-- ヘッダー -->
      <div class="header">
        <h1>プロジェクト一覧</h1>
        <button class="btn btn-primary" (click)="openCreateModal()">
          <i class="icon-plus"></i> 新規プロジェクト
        </button>
      </div>

      <!-- フィルター・並び替え -->
      <div class="filters">
        <div class="filter-group">
          <span>並び替え:</span>
          <select [(ngModel)]="sortBy" (change)="sortProjects()">
            <option value="name">名称</option>
            <option value="startDate">開始日</option>
            <option value="endDate">終了日</option>
            <option value="progress">進捗</option>
            <option value="createdAt">作成日</option>
            <option value="period">期間</option>
            <option value="issueCount">課題数</option>
            <option value="memberCount">メンバー数</option>
          </select>
          <select [(ngModel)]="sortOrder" (change)="sortProjects()">
            <option value="asc">昇順</option>
            <option value="desc">降順</option>
          </select>
        </div>
        <div class="filter-group">
          <label>
            <input type="checkbox" [(ngModel)]="showArchived" (change)="loadProjects()">
            アーカイブ済みも表示
          </label>
        </div>
      </div>

      <!-- プロジェクト一覧 -->
      <div class="projects-grid">
        <div 
          *ngFor="let project of filteredProjects" 
          class="project-card"
          [class.archived]="project.archived"
          role="button"
          tabindex="0"
          (click)="selectProject(project)"
          (keydown.enter)="selectProject(project)"
        >
          <div class="project-header">
            <h3>{{ project.name }}</h3>
            <div class="project-actions">
            <button class="btn-action" (click)="editProject(project, $event)" title="編集">
                <i class="icon-edit" aria-hidden="true"></i>
                <span class="action-label">編集</span>
              </button>
              <button class="btn-action" (click)="archiveProject(project, $event)" title="アーカイブ">
                <i class="icon-archive" aria-hidden="true"></i>
                <span class="action-label">{{ project.archived ? '復元' : 'アーカイブ' }}</span>
              </button>
            </div>
          </div>
          
          <div class="project-content">
            <p class="description" *ngIf="project.description">{{ project.description }}</p>
            
            <div class="project-meta">
              <div class="meta-item" *ngIf="project.startDate">
                <i class="icon-calendar"></i>
                {{ project.startDate | date:'yyyy/MM/dd' }}
              </div>
              <div class="meta-item" *ngIf="project.endDate">
                <i class="icon-calendar"></i>
                {{ project.endDate | date:'yyyy/MM/dd' }}
              </div>
              <div class="meta-item">
                <i class="icon-users"></i>
                {{ project.memberIds.length }}人
              </div>
            </div>

            <div class="progress-section">
              <div class="progress-label">
                <span>進捗</span>
                <span class="progress-value">{{ project.progress || 0 }}%</span>
              </div>
              <div class="progress-bar">
                <div 
                  class="progress-fill" 
                  [style.width.%]="project.progress || 0"
                ></div>
              </div>
            </div>

            <div class="project-stats">
              <div class="stat-item">
                <span class="stat-label">課題数</span>
                <span class="stat-value">{{ getIssueCount(project.id!) }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">タスク数</span>
                <span class="stat-value">{{ getTaskCount(project.id!) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状態 -->
      <div *ngIf="projects.length === 0" class="empty-state">
        <i class="icon-folder"></i>
        <h3>プロジェクトがありません</h3>
        <p>新しいプロジェクトを作成して始めましょう</p>
        <button class="btn btn-primary" (click)="openCreateModal()">
          プロジェクトを作成
        </button>
      </div>
    </div>

    <!-- beauP t作成・編集モーダル -->
    <div *ngIf="showModal" class="modal-overlay" (click)="closeModal()" role="button" tabindex="-1">
      <div class="modal" (click)="$event.stopPropagation()" role="button" tabindex="-1">
        <div class="modal-header">
          <h2>{{ editingProject ? 'プロジェクト編集' : '新規プロジェクト' }}</h2>
          <button class="btn-icon" (click)="closeModal()" (keydown.enter)="closeModal()">
            <i class="icon-close"></i>
          </button>
        </div>
        
        <form class="modal-body" (ngSubmit)="saveProject()">
          <div class="form-group">
            <label for="name">プロジェクト名 *</label>
        <input
              id="name"
              type="text" 
              [(ngModel)]="projectForm.name" 
          name="name"
          required
              placeholder="プロジェクト名を入力"
            >
          </div>
          
          <div class="form-group">
            <label for="description">説明</label>
            <textarea 
              id="description"
              [(ngModel)]="projectForm.description" 
              name="description"
              placeholder="プロジェクトの説明を入力"
              rows="3"
            ></textarea>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label for="startDate">開始日</label>
              <input 
                id="startDate"
                type="date" 
                [(ngModel)]="projectForm.startDate" 
                name="startDate"
              >
            </div>
            <div class="form-group">
              <label for="endDate">終了日</label>
        <input
                id="endDate"
                type="date" 
                [(ngModel)]="projectForm.endDate" 
                name="endDate"
              >
            </div>
          </div>
          
          <div class="form-group">
            <label for="goal">達成目標</label>
            <textarea 
              id="goal"
              [(ngModel)]="projectForm.goal" 
          name="goal"
              placeholder="プロジェクトの達成目標を入力"
              rows="2"
        ></textarea>
          </div>
          
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" (click)="closeModal()">
              キャンセル
            </button>
            <button type="submit" class="btn btn-primary" [disabled]="!projectForm.name || saving">
              {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </form>
          </div>
    </div>
  `,
  styles: [`
    .projects-container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .header h1 {
      margin: 0;
      color: #333;
    }

    .filters {
      display: flex;
      gap: 24px;
      margin-bottom: 24px;
      padding: 16px;
      background: #f8f9fa;
      border-radius: 8px;
    }

    .filter-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .filter-group label {
      font-weight: 500;
      color: #555;
    }

    .filter-group select {
      padding: 4px 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
    }

    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 350px));
      gap: 20px;
      justify-content: center;
    }

    .project-card {
      background: white;
      border: 1px solid #e1e5e9;
      border-radius: 8px;
      padding: 20px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .project-card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transform: translateY(-2px);
    }

    .project-card.archived {
      opacity: 0.6;
      background: #f8f9fa;
    }

    .project-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }

    .project-header h3 {
      margin: 0;
      color: #333;
      font-size: 18px;
      font-weight: 600;
    }

    .project-actions {
      display: flex;
      gap: 8px;
    }

    .btn-action {
      background: none;
      border: none;
      padding: 4px;
      cursor: pointer;
      color: #666;
      border-radius: 4px;
    }

    .btn-action:hover {
      background: #f0f0f0;
      color: #333;
    }

    .description {
      color: #666;
      margin-bottom: 16px;
      line-height: 1.5;
    }

    .project-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #666;
      font-size: 14px;
    }

    .progress-section {
      margin-bottom: 16px;
    }

    .progress-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 14px;
    }

    .progress-value {
      font-weight: 600;
      color: #333;
    }

    .progress-bar {
      height: 8px;
      background: #e9ecef;
      border-radius: 4px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #28a745, #20c997);
      transition: width 0.3s ease;
    }

    .project-stats {
      display: flex;
      gap: 16px;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .stat-label {
      font-size: 12px;
      color: #666;
    }

    .stat-value {
      font-size: 18px;
      font-weight: 600;
      color: #333;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }

    .empty-state i {
      font-size: 48px;
      margin-bottom: 16px;
      color: #ccc;
    }

    .empty-state h3 {
      margin: 0 0 8px 0;
      color: #333;
    }

    .empty-state p {
      margin: 0 0 24px 0;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s ease;
    }

    .btn-primary {
      background: #007bff;
      color: white;
    }

    .btn-primary:hover {
      background: #0056b3;
    }

    .btn-secondary {
      background: #6c757d;
      color: white;
    }

    .btn-secondary:hover {
      background: #545b62;
    }

    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal {
      background: white;
      border-radius: 8px;
      width: 90%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px;
      border-bottom: 1px solid #e1e5e9;
    }

    .modal-header h2 {
      margin: 0;
      color: #333;
    }

    .modal-body {
      padding: 20px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-row {
      display: flex;
      gap: 16px;
    }

    .form-row .form-group {
      flex: 1;
    }

    .form-group label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
      color: #333;
    }

    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #007bff;
      box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding: 20px;
      border-top: 1px solid #e1e5e9;
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `]
})
export class ProjectsListComponent implements OnInit, OnDestroy {
  private projectsService = inject(ProjectsService);
  private issuesService = inject(IssuesService);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  projects: Project[] = [];
  filteredProjects: Project[] = [];
  showModal = false;
  editingProject: Project | null = null;
  saving = false;
  showArchived = false;

  // 並び替え設定
  sortBy: 'name' | 'startDate' | 'endDate' | 'progress' | 'createdAt' | 'period' | 'issueCount' | 'memberCount' = 'name';
  sortOrder: 'asc' | 'desc' = 'asc';

  // フォームデータ
  projectForm = {
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    goal: ''
  };

   /** 課題数のキャッシュ（一覧表示・並び替え用） */
   private issueCountMap: Record<string, number> = {};


  ngOnInit() {
    this.loadProjects();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * プロジェクト一覧を読み込む
   */
  async loadProjects() {
    try {
      this.projects = await this.projectsService.listMyProjects();
      await this.loadIssueCounts();
      this.filterProjects();
    } catch (error) {
      console.error('プロジェクトの読み込みに失敗しました:', error);
    }
  }

  /**
   * プロジェクトをフィルタリング
   */
  filterProjects() {
    this.filteredProjects = this.projects.filter(project => 
      this.showArchived || !project.archived
    );
    this.sortProjects();
  }

  /**
   * プロジェクトを並び替え
   */
  sortProjects() {
    this.filteredProjects.sort((a, b) => {
      let aValue: string | number | Date;
      let bValue: string | number | Date;

      switch (this.sortBy) {
        case 'name':
          aValue = a.name;
          bValue = b.name;
          break;
        case 'startDate':
          aValue = this.normalizeToDate(a.startDate) ?? new Date(0);
          bValue = this.normalizeToDate(b.startDate) ?? new Date(0);
          break;
        case 'endDate':
          aValue = this.normalizeToDate(a.endDate) ?? new Date(0);
          bValue = this.normalizeToDate(b.endDate) ?? new Date(0);
          break;
        case 'progress':
          aValue = a.progress || 0;
          bValue = b.progress || 0;
          break;
        case 'createdAt':
          aValue = this.normalizeToDate(a.createdAt) ?? new Date(0);
          bValue = this.normalizeToDate(b.createdAt) ?? new Date(0);
          break;
        case 'period':
          aValue = this.getProjectDuration(a);
          bValue = this.getProjectDuration(b);
          break;
        case 'issueCount':
          aValue = this.getIssueCount(a.id!);
          bValue = this.getIssueCount(b.id!);
          break;
        case 'memberCount':
          aValue = a.memberIds.length;
          bValue = b.memberIds.length;
          break;
        default:
          aValue = 0;
          bValue = 0;
      }

      if (aValue < bValue) {
        return this.sortOrder === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return this.sortOrder === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }

  /**
   * プロジェクトを選択（詳細表示）
   */
  selectProject(project: Project) {
    this.router.navigate(['/projects', project.id]);
  }

  /**
   * 新規プロジェクト作成モーダルを開く
   */
  openCreateModal() {
    this.editingProject = null;
    this.projectForm = {
      name: '',
      description: '',
      startDate: '',
      endDate: '',
      goal: ''
    };
    this.showModal = true;
  }

  /**
   * プロジェクト編集モーダルを開く
   */
  editProject(project: Project, event: Event) {
    event.stopPropagation();
    this.editingProject = project;
    this.projectForm = {
      name: project.name,
      description: project.description || '',
      startDate: project.startDate ? this.formatDateForInput(project.startDate) : '',
      endDate: project.endDate ? this.formatDateForInput(project.endDate) : '',
      goal: project.goal || ''
    };
    this.showModal = true;
  }

  /**
   * プロジェクトをアーカイブ
   */
  async archiveProject(project: Project, event: Event) {
    event.stopPropagation();
    const actionLabel = project.archived ? '復元' : 'アーカイブ';
    if (confirm(`プロジェクト「${project.name}」を${actionLabel}しますか？`)) {
      try {
        await this.projectsService.archive(project.id!, !project.archived);
        await this.loadProjects();
    } catch (error) {
        console.error('アーカイブに失敗しました:', error);
        alert(`${actionLabel}に失敗しました`);
      }
    }
  }

  /**
   * プロジェクトを保存
   */
  async saveProject() {
    if (!this.projectForm.name.trim()) {
      alert('プロジェクト名を入力してください');
      return;
    }

    this.saving = true;
    try {
      const projectData = {
        name: this.projectForm.name.trim(),
        description: this.projectForm.description.trim() || undefined,
        startDate: this.projectForm.startDate ? new Date(this.projectForm.startDate) : undefined,
        endDate: this.projectForm.endDate ? new Date(this.projectForm.endDate) : undefined,
        goal: this.projectForm.goal.trim() || undefined
      };

      if (this.editingProject) {
        await this.projectsService.updateProject(this.editingProject.id!, {
          name: projectData.name,
          description: projectData.description ?? null,
          startDate: projectData.startDate ?? null,
          endDate: projectData.endDate ?? null,
          goal: projectData.goal ?? null,
        });
      } else {
        await this.projectsService.createProject(projectData);
      }

      this.closeModal();
      await this.loadProjects();
    } catch (error) {
      console.error('プロジェクトの保存に失敗しました:', error);
      alert(this.buildProjectSaveErrorMessage(error));
    } finally {
      this.saving = false;
    }
  }
  /**
   * Firestoreエラーを人間にわかりやすいメッセージへ変換する
   * バージョン衝突（FAILED_PRECONDITION/ABORTED）を検出して案内を表示
   */
  private buildProjectSaveErrorMessage(error: unknown): string {
    // FirebaseErrorかどうかを判定し、バージョン違反コードを優先的に扱う
    if (error instanceof FirebaseError) {
      const conflictCodes = ['aborted', 'failed-precondition'];
      if (conflictCodes.includes(error.code) || error.message.includes('FAILED_PRECONDITION')) {
        return '最新の情報と競合したため保存できませんでした。画面を再読み込みしてからもう一度お試しください。';
      }
      if (error.message) {
        return error.message;
      }
    }

    // 通常のErrorであればメッセージを返却し、その他は汎用文を表示
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return '予期しないエラーが発生しました。時間をおいて再度お試しください。';
  }

  /**
   * モーダルを閉じる
   */
  closeModal() {
    this.showModal = false;
    this.editingProject = null;
    this.saving = false;
  }

  /**
   * 日付をinput用にフォーマット
   */
  private formatDateForInput(date: Date | null | undefined): string {
    const normalized = this.normalizeToDate(date ?? null);
    return normalized ? normalized.toISOString().split('T')[0] : '';
  }

  /**
   * 課題数を取得（非同期で取得したキャッシュを参照）
   */
  getIssueCount(projectId: string): number {
    return this.issueCountMap[projectId] ?? 0;
  }

  /**
   * タスク数を取得（実装予定）
   */
  getTaskCount(projectId: string): number {
    return this.issueCountMap[projectId] ?? 0;
  }

  /** プロジェクト期間（日数）を算出する（開始・終了がそろっていない場合は0） */
  private getProjectDuration(project: Project): number {
    const startDate = this.normalizeToDate(project.startDate);
    const endDate = this.normalizeToDate(project.endDate);
    if (!startDate || !endDate) {
      return 0;
    }
    const start = startDate.getTime();
    const end = endDate.getTime();
    const diff = end - start;
    return diff > 0 ? Math.round(diff / (1000 * 60 * 60 * 24)) : 0;
  }

  /** 任意の値をDate型へ正規化する（Timestamp互換にも対応） */
  private normalizeToDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return value;
    }
    if (typeof value === 'object' && 'toDate' in (value as Record<string, unknown>)) {
      const candidate = value as { toDate?: () => Date };
      if (typeof candidate.toDate === 'function') {
        return candidate.toDate();
      }
    }
    const parsed = new Date(value as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** Firestoreから課題数を取得してキャッシュする */
  private async loadIssueCounts(): Promise<void> {
    const results = await Promise.all(this.projects.map(async (project) => {
      if (!project.id) {
        return { id: '', count: 0 };
      }
      const count = await this.issuesService.countIssues(project.id, this.showArchived);
      return { id: project.id, count };
    }));

    this.issueCountMap = results.reduce<Record<string, number>>((acc, item) => {
      if (item.id) {
        acc[item.id] = item.count;
      }
      return acc;
    }, {});
  }
}
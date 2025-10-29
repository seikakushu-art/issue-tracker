import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { IssuesService } from '../issues/issues.service';
import { Issue } from '../../models/schema';
import { FirebaseError } from 'firebase/app';

/**
 * 課題一覧コンポーネント
 * プロジェクト配下の課題一覧表示、作成、編集、アーカイブ機能を提供
 */
@Component({
  selector: 'app-issues-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="issues-container">
      <!-- ヘッダー -->
      <div class="header">
        <h2>課題一覧</h2>
        <button class="btn btn-primary" (click)="openCreateModal()">
          <i class="icon-plus"></i> 新規課題
        </button>
      </div>

      <!-- フィルター・並び替え -->
      <div class="filters">
        <div class="filter-group">
          <span>並び替え:</span>
          <select [(ngModel)]="sortBy" (change)="sortIssues()">
            <option value="name">名称</option>
            <option value="startDate">開始日</option>
            <option value="endDate">終了日</option>
            <option value="progress">進捗</option>
            <option value="createdAt">作成日</option>
          </select>
          <select [(ngModel)]="sortOrder" (change)="sortIssues()">
            <option value="asc">昇順</option>
            <option value="desc">降順</option>
          </select>
        </div>
        <div class="filter-group">
          <label>
            <input type="checkbox" [(ngModel)]="showArchived" (change)="loadIssues()">
            アーカイブ済みも表示
          </label>
        </div>
      </div>

      <!-- 課題一覧 -->
      <div class="issues-grid">
        <div 
          *ngFor="let issue of filteredIssues" 
          class="issue-card"
          [class.archived]="issue.archived"
          (click)="selectIssue(issue)"
          (keydown.enter)="selectIssue(issue)"
          role="button"
          tabindex="0"
        >
          <div class="issue-header">
            <div class="issue-title">
              <div 
                class="theme-color-badge" 
                [style.background-color]="issue.themeColor || getRandomColor(issue.id!)"
              ></div>
              <h3>{{ issue.name }}</h3>
            </div>
            <div class="issue-actions">
              <button class="btn-icon" (click)="editIssue(issue, $event)" title="編集">
                <i class="icon-edit"></i>
              </button>
              <button class="btn-icon" (click)="archiveIssue(issue, $event)" title="アーカイブ">
                <i class="icon-archive"></i>
              </button>
            </div>
          </div>
          
          <div class="issue-content">
            <p class="description" *ngIf="issue.description">{{ issue.description }}</p>
            
            <div class="issue-meta">
              <div class="meta-item" *ngIf="issue.startDate">
                <i class="icon-calendar"></i>
                {{ issue.startDate | date:'yyyy/MM/dd' }}
              </div>
              <div class="meta-item" *ngIf="issue.endDate">
                <i class="icon-calendar"></i>
                {{ issue.endDate | date:'yyyy/MM/dd' }}
              </div>
            </div>

            <div class="progress-section">
              <div class="progress-label">
                <span>進捗</span>
                <span class="progress-value">{{ issue.progress || 0 }}%</span>
              </div>
              <div class="progress-bar">
                <div 
                  class="progress-fill" 
                  [style.width.%]="issue.progress || 0"
                  [style.background-color]="issue.themeColor || getRandomColor(issue.id!)"
                ></div>
              </div>
            </div>

            <div class="issue-stats">
              <div class="stat-item">
                <span class="stat-label">タスク数</span>
                <span class="stat-value">{{ getTaskCount(issue.id!) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状態 -->
      <div *ngIf="issues.length === 0" class="empty-state">
        <i class="icon-folder"></i>
        <h3>課題がありません</h3>
        <p>新しい課題を作成して始めましょう</p>
        <button class="btn btn-primary" (click)="openCreateModal()">
          課題を作成
        </button>
      </div>
    </div>

    <!-- 課題作成・編集モーダル -->
    <div *ngIf="showModal" class="modal-overlay" (click)="closeModal()" role="button" tabindex="-1">
      <div class="modal" (click)="$event.stopPropagation()" role="button" tabindex="-1">
        <div class="modal-header">
          <h2>{{ editingIssue ? '課題編集' : '新規課題' }}</h2>
          <button class="btn-icon" (click)="closeModal()">
            <i class="icon-close"></i>
          </button>
        </div>
        
        <form class="modal-body" (ngSubmit)="saveIssue()">
          <div class="form-group">
            <label for="name">課題名 *</label>
            <input 
              id="name"
              type="text" 
              [(ngModel)]="issueForm.name" 
              name="name"
              required
              placeholder="課題名を入力"
            >
          </div>
          
          <div class="form-group">
            <label for="description">説明</label>
            <textarea 
              id="description"
              [(ngModel)]="issueForm.description" 
              name="description"
              placeholder="課題の説明を入力"
              rows="3"
            ></textarea>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label for="startDate">開始日</label>
              <input 
                id="startDate"
                type="date" 
                [(ngModel)]="issueForm.startDate" 
                name="startDate"
              >
            </div>
            <div class="form-group">
              <label for="endDate">終了日</label>
              <input 
                id="endDate"
                type="date" 
                [(ngModel)]="issueForm.endDate" 
                name="endDate"
              >
            </div>
          </div>
          
          <div class="form-group">
            <label for="goal">達成目標</label>
            <textarea 
              id="goal"
              [(ngModel)]="issueForm.goal" 
              name="goal"
              placeholder="課題の達成目標を入力"
              rows="2"
            ></textarea>
          </div>

          <div class="form-group">
            <label for="themeColor">テーマカラー</label>
            <div class="color-picker">
              <input 
                id="themeColor"
                type="color" 
                [(ngModel)]="issueForm.themeColor" 
                name="themeColor"
                class="color-input"
              >
              <span class="color-label">カラーを選択</span>
            </div>
          </div>
          
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" (click)="closeModal()">
              キャンセル
            </button>
            <button type="submit" class="btn btn-primary" [disabled]="!issueForm.name || saving">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .issues-container {
      padding: 20px;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .header h2 {
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

    .issues-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 320px));
      justify-content: center;
      gap: 16px;
    }

    .issue-card {
      background: white;
      border: 1px solid #e1e5e9;
      border-radius: 8px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .issue-card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transform: translateY(-2px);
    }

    .issue-card.archived {
      opacity: 0.6;
      background: #f8f9fa;
    }

    .issue-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .issue-title {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .theme-color-badge {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .issue-title h3 {
      margin: 0;
      color: #333;
      font-size: 16px;
      font-weight: 600;
    }

    .issue-actions {
      display: flex;
      gap: 4px;
    }

    .btn-icon {
      background: none;
      border: none;
      padding: 4px;
      cursor: pointer;
      color: #666;
      border-radius: 4px;
    }

    .btn-icon:hover {
      background: #f0f0f0;
      color: #333;
    }

    .description {
      color: #666;
      margin-bottom: 12px;
      line-height: 1.5;
      font-size: 14px;
    }

    .issue-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 12px;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #666;
      font-size: 13px;
    }

    .progress-section {
      margin-bottom: 12px;
    }

    .progress-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
      font-size: 13px;
    }

    .progress-value {
      font-weight: 600;
      color: #333;
    }

    .progress-bar {
      height: 6px;
      background: #e9ecef;
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      transition: width 0.3s ease;
    }

    .issue-stats {
      display: flex;
      gap: 16px;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .stat-label {
      font-size: 11px;
      color: #666;
    }

    .stat-value {
      font-size: 16px;
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

    .color-picker {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .color-input {
      width: 40px !important;
      height: 40px;
      padding: 0 !important;
      border: none !important;
      border-radius: 4px;
      cursor: pointer;
    }

    .color-label {
      font-size: 14px;
      color: #666;
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
export class IssuesListComponent implements OnInit, OnDestroy {
  private issuesService = inject(IssuesService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy$ = new Subject<void>();

  projectId!: string;

  issues: Issue[] = [];
  filteredIssues: Issue[] = [];
  showModal = false;
  editingIssue: Issue | null = null;
  saving = false;
  showArchived = false;

  // 並び替え設定
  sortBy: 'name' | 'startDate' | 'endDate' | 'progress' | 'createdAt' = 'name';
  sortOrder: 'asc' | 'desc' = 'asc';

  // フォームデータ
  issueForm = {
    name: '',
    description: '',
    startDate: '',
    endDate: '',
    goal: '',
    themeColor: ''
  };

  // ランダムカラー生成用
  private colorPalette = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ];

  ngOnInit() {
    // ルートパラメータからprojectIdを取得
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.projectId = params['projectId'];
      if (this.projectId) {
        this.loadIssues();
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * 課題一覧を読み込む
   */
  async loadIssues() {
    if (!this.projectId) return;
    
    try {
      this.issues = await this.issuesService.listIssues(this.projectId);
      this.filterIssues();
    } catch (error) {
      console.error('課題の読み込みに失敗しました:', error);
    }
  }

  /**
   * 課題をフィルタリング
   */
  filterIssues() {
    this.filteredIssues = this.issues.filter(issue => 
      this.showArchived || !issue.archived
    );
    this.sortIssues();
  }

  /**
   * 課題を並び替え
   */
  sortIssues() {
    this.filteredIssues.sort((a, b) => {
      let aValue: unknown;
      let bValue: unknown;

      switch (this.sortBy) {
        case 'name':
          aValue = a.name;
          bValue = b.name;
          break;
        case 'startDate':
          aValue = a.startDate || new Date(0);
          bValue = b.startDate || new Date(0);
          break;
        case 'endDate':
          aValue = a.endDate || new Date(0);
          bValue = b.endDate || new Date(0);
          break;
        case 'progress':
          aValue = a.progress || 0;
          bValue = b.progress || 0;
          break;
        case 'createdAt':
          aValue = a.createdAt || new Date(0);
          bValue = b.createdAt || new Date(0);
          break;
        default:
          return 0;
      }

      if ((aValue as string | number | Date) < (bValue as string | number | Date)) return this.sortOrder === 'asc' ? -1 : 1;
      if ((aValue as string | number | Date) > (bValue as string | number | Date)) return this.sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }

  /**
   * 課題を選択（詳細表示）
   */
  selectIssue(issue: Issue) {
    this.router.navigate(['/projects', this.projectId, 'issues', issue.id]);
  }

  /**
   * 新規課題作成モーダルを開く
   */
  openCreateModal() {
    this.editingIssue = null;
    this.issueForm = {
      name: '',
      description: '',
      startDate: '',
      endDate: '',
      goal: '',
      themeColor: ''
    };
    this.showModal = true;
  }

  /**
   * 課題編集モーダルを開く
   */
  editIssue(issue: Issue, event: Event) {
    event.stopPropagation();
    this.editingIssue = issue;
    this.issueForm = {
      name: issue.name,
      description: issue.description || '',
      startDate: issue.startDate ? this.formatDateForInput(issue.startDate) : '',
      endDate: issue.endDate ? this.formatDateForInput(issue.endDate) : '',
      goal: issue.goal || '',
      themeColor: issue.themeColor || ''
    };
    this.showModal = true;
  }

  /**
   * 課題をアーカイブ
   */
  async archiveIssue(issue: Issue, event: Event) {
    event.stopPropagation();
    if (confirm(`課題「${issue.name}」をアーカイブしますか？`)) {
      try {
        await this.issuesService.archiveIssue(this.projectId, issue.id!, !issue.archived);
        await this.loadIssues();
      } catch (error) {
        console.error('アーカイブに失敗しました:', error);
        alert('アーカイブに失敗しました');
      }
    }
  }

  /**
   * 課題を保存
   */
  async saveIssue() {
    if (!this.issueForm.name.trim()) {
      alert('課題名を入力してください');
      return;
    }

    this.saving = true;
    try {
      const issueData = {
        name: this.issueForm.name.trim(),
        description: this.issueForm.description.trim() || undefined,
        startDate: this.issueForm.startDate ? new Date(this.issueForm.startDate) : undefined,
        endDate: this.issueForm.endDate ? new Date(this.issueForm.endDate) : undefined,
        goal: this.issueForm.goal.trim() || undefined,
        themeColor: this.issueForm.themeColor || undefined
      };

      if (this.editingIssue) {
        await this.issuesService.updateIssue(this.projectId, this.editingIssue.id!, {
          name: issueData.name,
          description: issueData.description ?? null,
          startDate: issueData.startDate ?? null,
          endDate: issueData.endDate ?? null,
          goal: issueData.goal ?? null,
          themeColor: issueData.themeColor ?? null,
        });
      } else {
        await this.issuesService.createIssue(this.projectId, issueData);
      }

      this.closeModal();
      await this.loadIssues();
    } catch (error) {
      console.error('課題の保存に失敗しました:', error);
       // Firestoreのバージョン衝突（楽観的ロック違反）を検出して、再読み込みを案内
       if (
        error instanceof FirebaseError &&
        (error.code === 'failed-precondition' || /version/i.test(error.message))
      ) {
        alert('データのバージョンが古いため課題を保存できませんでした。画面を再読み込みしてから再度お試しください。');
      } else {
        alert('課題の保存に失敗しました');
      }
    } finally {
      this.saving = false;
    }
  }

  /**
   * モーダルを閉じる
   */
  closeModal() {
    this.showModal = false;
    this.editingIssue = null;
    this.saving = false;
  }

  /**
   * 日付をinput用にフォーマット
   */
  private formatDateForInput(date: Date): string {
    return new Date(date).toISOString().split('T')[0];
  }

  /**
   * ランダムカラーを取得
   */
  getRandomColor(issueId: string): string {
    const hash = issueId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    return this.colorPalette[Math.abs(hash) % this.colorPalette.length];
  }

  /**
   * タスク数を取得（実装予定）
   */
  getTaskCount(issueId: string): number {
    void issueId; // TODO: TasksServiceから取得
    return 0;
  }
}

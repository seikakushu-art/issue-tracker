import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { TasksService } from '../tasks/tasks.service';
import { TagsService } from '../tags/tags.service';
import { IssuesService } from '../issues/issues.service';
import { Task, TaskStatus, Importance, Tag, Issue } from '../../models/schema';

/**
 * タスク一覧コンポーネント
 * 課題配下のタスク一覧表示、作成、編集、削除機能を提供
 */
@Component({
  selector: 'app-tasks-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="tasks-container">
      <!-- ヘッダー -->
      <div class="header">
        <h2>タスク一覧</h2>
        <button class="btn btn-primary" (click)="openCreateModal()">
          <i class="icon-plus"></i> 新規タスク
        </button>
      </div>

      <!-- 課題のサマリーパネル -->
      <section *ngIf="issueDetails" class="issue-summary">
        <div class="summary-header">
          <div class="summary-title">
            <span
              class="summary-color"
              [style.background-color]="issueDetails.themeColor || getFallbackColor(issueDetails.id!)"
            ></span>
            <div class="summary-text">
              <h3>{{ issueDetails.name }}</h3>
              <p class="summary-goal" *ngIf="issueDetails.goal">{{ issueDetails.goal }}</p>
            </div>
          </div>
          <div class="summary-deadline">
            <span *ngIf="issueDetails.startDate">開始: {{ issueDetails.startDate | date:'yyyy/MM/dd' }}</span>
            <span *ngIf="issueDetails.endDate">期限: {{ issueDetails.endDate | date:'yyyy/MM/dd' }}</span>
          </div>
        </div>

        <p class="summary-description" *ngIf="issueDetails.description">{{ issueDetails.description }}</p>

        <div class="summary-progress">
          <span class="label">進捗</span>
          <div class="progress-bar">
            <div
              class="progress-fill"
              [style.width.%]="issueProgress"
              [style.background-color]="issueDetails.themeColor || getFallbackColor(issueDetails.id!)"
            ></div>
          </div>
          <span class="value">{{ issueProgress | number:'1.0-1' }}%</span>
        </div>

        <div class="summary-tasks" *ngIf="taskPreview.length > 0; else noTaskPreview">
          <h4>代表タスク</h4>
          <ul>
            <li *ngFor="let previewTask of taskPreview">
              <span class="task-title">{{ previewTask.title }}</span>
              <span class="task-progress">{{ (previewTask.progress || 0) | number:'1.0-0' }}%</span>
              <span class="task-status" [class]="'status-' + previewTask.status">
                {{ getStatusLabel(previewTask.status) }}
              </span>
            </li>
          </ul>
        </div>
        <ng-template #noTaskPreview>
          <p class="summary-empty">まだタスクが登録されていません。</p>
        </ng-template>
      </section>

      <!-- フィルター・並び替え -->
      <div class="filters">
        <div class="filter-group">
          <span>ステータス:</span>
          <select [(ngModel)]="statusFilter" (change)="filterTasks()">
            <option value="">すべて</option>
            <option value="incomplete">未完了</option>
            <option value="in_progress">進行中</option>
            <option value="completed">完了</option>
            <option value="on_hold">保留</option>
            <option value="discarded">破棄</option>
          </select>
        </div>
        <div class="filter-group">
          <span>重要度:</span>
          <select [(ngModel)]="importanceFilter" (change)="filterTasks()">
            <option value="">すべて</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
        <div class="filter-group">
          <span>並び替え:</span>
          <select [(ngModel)]="sortBy" (change)="sortTasks()">
            <option value="title">タイトル</option>
            <option value="startDate">開始日</option>
            <option value="endDate">終了日</option>
            <option value="progress">進捗</option>
            <option value="importance">重要度</option>
            <option value="createdAt">作成日</option>
          </select>
          <select [(ngModel)]="sortOrder" (change)="sortTasks()">
            <option value="asc">昇順</option>
            <option value="desc">降順</option>
          </select>
        </div>
      </div>

      <!-- タスク一覧 -->
      <div class="tasks-grid">
        <div 
          *ngFor="let task of filteredTasks" 
          class="task-card"
          [class.completed]="task.status === 'completed'"
          [class.discarded]="task.status === 'discarded'"
          (click)="selectTask(task)"
          (keydown.enter)="selectTask(task)"
          role="button"
          tabindex="0"
        >
          <div class="task-header">
            <div class="task-title">
              <div 
                class="importance-badge" 
                [class]="'importance-' + (task.importance || 'Low').toLowerCase()"
              ></div>
              <h3>{{ task.title }}</h3>
            </div>
            <div class="task-actions">
              <button class="btn-icon" (click)="editTask(task, $event)" title="編集">
                <i class="icon-edit"></i>
              </button>
              <button class="btn-icon" (click)="deleteTask(task, $event)" title="削除">
                <i class="icon-delete"></i>
              </button>
            </div>
          </div>
          
          <div class="task-content">
            <p class="description" *ngIf="task.description">{{ task.description }}</p>
            
            <div class="task-meta">
              <div class="meta-item" *ngIf="task.startDate">
                <i class="icon-calendar"></i>
                {{ task.startDate | date:'yyyy/MM/dd' }}
              </div>
              <div class="meta-item" *ngIf="task.endDate">
                <i class="icon-calendar"></i>
                {{ task.endDate | date:'yyyy/MM/dd' }}
              </div>
              <div class="meta-item">
                <span class="status-badge" [class]="'status-' + task.status">
                  {{ getStatusLabel(task.status) }}
                </span>
              </div>
            </div>

            <div class="progress-section">
              <div class="progress-label">
                <span>進捗</span>
                <span class="progress-value">{{ task.progress || 0 }}%</span>
              </div>
              <div class="progress-bar">
                <div 
                  class="progress-fill" 
                  [style.width.%]="task.progress || 0"
                ></div>
              </div>
            </div>

            <div class="task-tags" *ngIf="task.tagIds.length > 0">
              <span 
                *ngFor="let tagId of task.tagIds" 
                class="tag"
                [style.background-color]="getTagColor(tagId)"
              >
                {{ getTagName(tagId) }}
              </span>
            </div>

            <div class="task-stats">
              <div class="stat-item">
                <span class="stat-label">チェックリスト</span>
                <span class="stat-value">{{ task.checklist.length }}項目</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">完了</span>
                <span class="stat-value">{{ getCompletedChecklistCount(task) }}項目</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 空状態 -->
      <div *ngIf="tasks.length === 0" class="empty-state">
        <i class="icon-folder"></i>
        <h3>タスクがありません</h3>
        <p>新しいタスクを作成して始めましょう</p>
        <button class="btn btn-primary" (click)="openCreateModal()">
          タスクを作成
        </button>
      </div>
    </div>

    <!-- タスク作成・編集モーダル -->
    <div *ngIf="showModal" class="modal-overlay" (click)="closeModal()" role="button" tabindex="-1">
      <div class="modal" (click)="$event.stopPropagation()" role="button" tabindex="-1">
        <div class="modal-header">
          <h2>{{ editingTask ? 'タスク編集' : '新規タスク' }}</h2>
          <button class="btn-icon" (click)="closeModal()">
            <i class="icon-close"></i>
          </button>
        </div>
        
        <form class="modal-body" (ngSubmit)="saveTask()">
          <div class="form-group">
            <label for="title">タイトル *</label>
            <input 
              id="title"
              type="text" 
              [(ngModel)]="taskForm.title" 
              name="title"
              required
              placeholder="タスクのタイトルを入力"
            >
          </div>
          
          <div class="form-group">
            <label for="description">説明</label>
            <textarea 
              id="description"
              [(ngModel)]="taskForm.description" 
              name="description"
              placeholder="タスクの説明を入力"
              rows="3"
            ></textarea>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label for="startDate">開始日</label>
              <input 
                id="startDate"
                type="date" 
                [(ngModel)]="taskForm.startDate" 
                name="startDate"
              >
            </div>
            <div class="form-group">
              <label for="endDate">終了日</label>
              <input 
                id="endDate"
                type="date" 
                [(ngModel)]="taskForm.endDate" 
                name="endDate"
              >
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="importance">重要度</label>
              <select id="importance" [(ngModel)]="taskForm.importance" name="importance">
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>
            <div class="form-group">
              <label for="status">ステータス</label>
              <select id="status" [(ngModel)]="taskForm.status" name="status">
                <option value="incomplete">未完了</option>
                <option value="in_progress">進行中</option>
                <option value="completed">完了</option>
                <option value="on_hold">保留</option>
                <option value="discarded">破棄</option>
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label for="goal">達成目標</label>
            <textarea 
              id="goal"
              [(ngModel)]="taskForm.goal" 
              name="goal"
              placeholder="タスクの達成目標を入力"
              rows="2"
            ></textarea>
          </div>

          <div class="form-group">
            <span>タグ</span>
            <div class="tag-selector">
              <div 
                *ngFor="let tag of availableTags" 
                class="tag-option"
                [class.selected]="taskForm.tagIds.includes(tag.id!)"
                (click)="toggleTag(tag.id!)"
                (keydown.enter)="toggleTag(tag.id!)"
                role="button"
                tabindex="0"
              >
                <span 
                  class="tag-color" 
                  [style.background-color]="tag.color || '#ccc'"
                ></span>
                {{ tag.name }}
              </div>
            </div>
          </div>

          <div class="form-group">
            <span>チェックリスト</span>
            <div class="checklist-editor">
              <div 
                *ngFor="let item of taskForm.checklist; let i = index" 
                class="checklist-item"
              >
                <input 
                  type="checkbox" 
                  [(ngModel)]="item.completed"
                  [name]="'checklist-' + i"
                >
                <input 
                  type="text" 
                  [(ngModel)]="item.text"
                  [name]="'checklist-text-' + i"
                  placeholder="チェック項目を入力"
                  class="checklist-input"
                >
                <button 
                  type="button" 
                  class="btn-icon" 
                  (click)="removeChecklistItem(i)"
                  title="削除"
                >
                  <i class="icon-delete"></i>
                </button>
              </div>
              <button 
                type="button" 
                class="btn btn-secondary btn-sm" 
                (click)="addChecklistItem()"
              >
                <i class="icon-plus"></i> 項目を追加
              </button>
            </div>
          </div>
          
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" (click)="closeModal()">
              キャンセル
            </button>
            <button type="submit" class="btn btn-primary" [disabled]="!taskForm.title || saving">
              {{ saving ? '保存中...' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .tasks-container {
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
    .issue-summary {
      margin: 16px 0 24px;
      padding: 16px;
      background: #f8f9fb;
      border: 1px solid #e1e5e9;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .summary-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }

    .summary-title {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
    }

    .summary-color {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .summary-text h3 {
      margin: 0;
      font-size: 18px;
      color: #333;
    }

    .summary-goal {
      margin: 4px 0 0;
      color: #666;
      font-size: 13px;
    }

    .summary-deadline {
      display: flex;
      gap: 12px;
      color: #555;
      font-size: 13px;
      flex-wrap: wrap;
    }

    .summary-description {
      margin: 0;
      color: #555;
      line-height: 1.6;
      font-size: 14px;
    }

    .summary-progress {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .summary-progress .label {
      font-weight: 600;
      color: #333;
    }

    .summary-progress .progress-bar {
      flex: 1;
      height: 8px;
    }

    .summary-progress .value {
      min-width: 48px;
      text-align: right;
      font-weight: 600;
      color: #333;
    }

    .summary-tasks h4 {
      margin: 0;
      font-size: 14px;
      color: #333;
    }

    .summary-tasks ul {
      list-style: none;
      margin: 8px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .summary-tasks li {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #555;
    }

    .summary-tasks .task-title {
      flex: 1;
      font-weight: 500;
      color: #333;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .summary-tasks .task-progress {
      width: 48px;
      text-align: right;
      color: #007bff;
    }

    .summary-tasks .task-status {
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
    }

    .summary-empty {
      margin: 0;
      color: #777;
      font-size: 13px;
    }


    .filters {
      display: flex;
      gap: 24px;
      margin-bottom: 24px;
      padding: 16px;
      background: #f8f9fa;
      border-radius: 8px;
      flex-wrap: wrap;
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

    .tasks-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 300px));
      gap: 16px;
      justify-content: center;
    }

    .task-card {
      background: white;
      border: 1px solid #e1e5e9;
      border-radius: 8px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .task-card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transform: translateY(-2px);
    }

    .task-card.completed {
      opacity: 0.7;
      background: #f8f9fa;
    }

    .task-card.discarded {
      opacity: 0.5;
      background: #f8f9fa;
      text-decoration: line-through;
    }

    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .task-title {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .importance-badge {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .importance-critical { background: #dc3545; }
    .importance-high { background: #fd7e14; }
    .importance-medium { background: #ffc107; }
    .importance-low { background: #28a745; }

    .task-title h3 {
      margin: 0;
      color: #333;
      font-size: 16px;
      font-weight: 600;
    }

    .task-actions {
      display: flex;
      gap: 4px;
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
      margin-bottom: 12px;
      line-height: 1.5;
      font-size: 14px;
    }

    .task-meta {
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

    .status-badge {
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
    }

    .status-incomplete { background: #e9ecef; color: #495057; }
    .status-in_progress { background: #cce5ff; color: #0066cc; }
    .status-completed { background: #d4edda; color: #155724; }
    .status-on_hold { background: #fff3cd; color: #856404; }
    .status-discarded { background: #f8d7da; color: #721c24; }

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
      background: linear-gradient(90deg, #28a745, #20c997);
      transition: width 0.3s ease;
    }

    .task-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 12px;
    }

    .tag {
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      color: white;
      font-weight: 500;
    }

    .task-stats {
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
      font-size: 14px;
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

    .btn-sm {
      padding: 4px 8px;
      font-size: 12px;
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
      max-width: 600px;
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
    .form-group textarea,
    .form-group select {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .form-group input:focus,
    .form-group textarea:focus,
    .form-group select:focus {
      outline: none;
      border-color: #007bff;
      box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
    }

    .tag-selector {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .tag-option {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border: 1px solid #ddd;
      border-radius: 16px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .tag-option:hover {
      background: #f8f9fa;
    }

    .tag-option.selected {
      background: #007bff;
      color: white;
      border-color: #007bff;
    }

    .tag-color {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }

    .checklist-editor {
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 12px;
    }

    .checklist-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .checklist-input {
      flex: 1;
      margin: 0;
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
export class TasksListComponent implements OnInit, OnDestroy {
  private tasksService = inject(TasksService);
  private tagsService = inject(TagsService);
  private issuesService = inject(IssuesService)
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroy$ = new Subject<void>();

  projectId!: string;
  issueId!: string;

  issueDetails: Issue | null = null;
  issueProgress = 0;
  taskPreview: Task[] = [];
  tasks: Task[] = [];
  filteredTasks: Task[] = [];
  availableTags: Tag[] = [];
  showModal = false;
  editingTask: Task | null = null;
  saving = false;

  // フィルター設定
  statusFilter: TaskStatus | '' = '';
  importanceFilter: Importance | '' = '';

  // 並び替え設定
  sortBy: 'title' | 'startDate' | 'endDate' | 'progress' | 'importance' | 'createdAt' = 'title';
  sortOrder: 'asc' | 'desc' = 'asc';

  // フォームデータ
  taskForm = {
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    goal: '',
    importance: 'Low' as Importance,
    status: 'incomplete' as TaskStatus,
    tagIds: [] as string[],
    checklist: [] as { id: string; text: string; completed: boolean }[]
  };
  // 課題カラーのフォールバック用パレット
  private colorPalette = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ];

  

  ngOnInit() {
    // ルートパラメータからprojectIdとissueIdを取得
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.projectId = params['projectId'];
      this.issueId = params['issueId'];
      if (this.projectId && this.issueId) {
        this.loadTasks();
        this.loadTags();
        this.loadIssueDetails();
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * タスク一覧を読み込む
   */
  async loadTasks() {
    if (!this.projectId || !this.issueId) return;
    
    try {
      this.tasks = await this.tasksService.listTasks(this.projectId, this.issueId);
      this.filterTasks();
      this.updateIssueSummaryFromTasks();
    } catch (error) {
      console.error('タスクの読み込みに失敗しました:', error);
    }
  }
 /**
   * 課題の基本情報を読み込む
   */
 async loadIssueDetails() {
  if (!this.projectId || !this.issueId) return;

  try {
    this.issueDetails = await this.issuesService.getIssue(this.projectId, this.issueId);
    this.issueProgress = this.issueDetails?.progress ?? 0;
    this.updateIssueSummaryFromTasks();
  } catch (error) {
    console.error('課題情報の読み込みに失敗しました:', error);
    this.issueDetails = null;
    this.issueProgress = 0;
    this.taskPreview = [];
  }
}
  /**
   * タグ一覧を読み込む
   */
  async loadTags() {
    try {
      this.availableTags = await this.tagsService.listTags();
    } catch (error) {
      console.error('タグの読み込みに失敗しました:', error);
    }
  }

  /**
   * タスクをフィルタリング
   */
  filterTasks() {
    this.filteredTasks = this.tasks.filter(task => {
      if (this.statusFilter && task.status !== this.statusFilter) {
        return false;
      }
      if (this.importanceFilter && task.importance !== this.importanceFilter) {
        return false;
      }
      return true;
    });
    this.sortTasks();
  }

  /**
   * タスクを並び替え
   */
  sortTasks() {
    this.filteredTasks.sort((a, b) => {
      let aValue: unknown;
      let bValue: unknown;

      switch (this.sortBy) {
        case 'title':
          aValue = a.title;
          bValue = b.title;
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
        case 'importance': {
          const importanceOrder: Record<Importance, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
          aValue = importanceOrder[a.importance || 'Low'];
          bValue = importanceOrder[b.importance || 'Low'];
          break;
        }
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
   * タスクを選択（詳細表示）
   */
  selectTask(task: Task) {
    this.router.navigate(['/projects', this.projectId, 'issues', this.issueId, 'tasks', task.id]);
  }

  /**
   * 新規タスク作成モーダルを開く
   */
  openCreateModal() {
    this.editingTask = null;
    this.taskForm = {
      title: '',
      description: '',
      startDate: '',
      endDate: '',
      goal: '',
      importance: 'Low',
      status: 'incomplete',
      tagIds: [],
      checklist: []
    };
    this.showModal = true;
  }

  /**
   * タスク編集モーダルを開く
   */
  editTask(task: Task, event: Event) {
    event.stopPropagation();
    this.editingTask = task;
    this.taskForm = {
      title: task.title,
      description: task.description || '',
      startDate: task.startDate ? this.formatDateForInput(task.startDate) : '',
      endDate: task.endDate ? this.formatDateForInput(task.endDate) : '',
      goal: task.goal || '',
      importance: task.importance || 'Low',
      status: task.status,
      tagIds: [...task.tagIds],
      checklist: task.checklist.map(item => ({ ...item }))
    };
    this.showModal = true;
  }

  /**
   * タスクを削除
   */
  async deleteTask(task: Task, event: Event) {
    event.stopPropagation();
    if (confirm(`タスク「${task.title}」を削除しますか？`)) {
      try {
        await this.tasksService.deleteTask(this.projectId, this.issueId, task.id!);
        await this.loadTasks();
      } catch (error) {
        console.error('削除に失敗しました:', error);
        alert('削除に失敗しました');
      }
    }
  }

  /**
   * タスクを保存
   */
  async saveTask() {
    if (!this.taskForm.title.trim()) {
      alert('タイトルを入力してください');
      return;
    }

    this.saving = true;
    try {
      const taskData = {
        title: this.taskForm.title.trim(),
        description: this.taskForm.description.trim() || undefined,
        startDate: this.taskForm.startDate ? new Date(this.taskForm.startDate) : undefined,
        endDate: this.taskForm.endDate ? new Date(this.taskForm.endDate) : undefined,
        goal: this.taskForm.goal.trim() || undefined,
        importance: this.taskForm.importance,
        status: this.taskForm.status,
        assigneeIds: [], // TODO: 担当者選択機能
        tagIds: this.taskForm.tagIds,
        checklist: this.taskForm.checklist
      };

      if (this.editingTask) {
        // 編集（実装予定）
        console.log('タスク編集機能は実装予定です');
      } else {
        await this.tasksService.createTask(this.projectId, this.issueId, taskData);
      }

      this.closeModal();
      await this.loadTasks();
    } catch (error) {
      console.error('タスクの保存に失敗しました:', error);
      alert('タスクの保存に失敗しました');
    } finally {
      this.saving = false;
    }
  }

  /**
   * タグをトグル
   */
  toggleTag(tagId: string) {
    const index = this.taskForm.tagIds.indexOf(tagId);
    if (index > -1) {
      this.taskForm.tagIds.splice(index, 1);
    } else {
      if (this.taskForm.tagIds.length < 10) {
        this.taskForm.tagIds.push(tagId);
      } else {
        alert('タグは最大10個まで選択できます');
      }
    }
  }

  /**
   * チェックリスト項目を追加
   */
  addChecklistItem() {
    if (this.taskForm.checklist.length < 200) {
      this.taskForm.checklist.push({
        id: this.generateId(),
        text: '',
        completed: false
      });
    } else {
      alert('チェックリスト項目は最大200個までです');
    }
  }

  /**
   * チェックリスト項目を削除
   */
  removeChecklistItem(index: number) {
    this.taskForm.checklist.splice(index, 1);
  }

  /**
   * モーダルを閉じる
   */
  closeModal() {
    this.showModal = false;
    this.editingTask = null;
    this.saving = false;
  }

  /**
   * 日付をinput用にフォーマット
   */
  private formatDateForInput(date: Date): string {
    return new Date(date).toISOString().split('T')[0];
  }

  /**
   * 一意IDを生成
   */
  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }
/**
   * 課題サマリー表示用に進捗・タスクプレビューを更新
   */
private updateIssueSummaryFromTasks(): void {
  if (!this.issueDetails) {
    this.issueProgress = 0;
    this.taskPreview = [];
    return;
  }

  const activeTasks = this.tasks.filter(task => task.status !== 'discarded');

  if (activeTasks.length === 0) {
    this.issueProgress = this.issueDetails.progress ?? 0;
    this.taskPreview = [];
    return;
  }

  let totalProgressWeight = 0;
  let totalWeight = 0;

  for (const task of activeTasks) {
    const weight = this.getImportanceWeight(task.importance);
    const progress = typeof task.progress === 'number'
      ? task.progress
      : this.tasksService.calculateProgressFromChecklist(task.checklist, task.status);
    totalProgressWeight += progress * weight;
    totalWeight += weight;
  }

  const computedProgress = totalWeight === 0
    ? 0
    : Math.round((totalProgressWeight / totalWeight) * 10) / 10;
  this.issueProgress = Math.min(100, Math.max(0, computedProgress));

  const sortedTasks = [...activeTasks].sort((a, b) => {
    const weightDiff = this.getImportanceWeight(b.importance) - this.getImportanceWeight(a.importance);
    if (weightDiff !== 0) {
      return weightDiff;
    }
    const endA = this.normalizeDate(a.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const endB = this.normalizeDate(b.endDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return endA - endB;
  });

  this.taskPreview = sortedTasks.slice(0, 3);
}

/**
 * 重要度を重み（1-4）に変換
 */
private getImportanceWeight(importance?: Importance): number {
  switch (importance) {
    case 'Critical':
      return 4;
    case 'High':
      return 3;
    case 'Medium':
      return 2;
    default:
      return 1;
  }
}

/**
 * Firestoreの日時表現をDate型に統一
 */
private normalizeDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    const converted = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(converted.getTime()) ? null : converted;
  }

  return null;
}

/**
 * テーマカラー未設定時のフォールバックカラー
 */
getFallbackColor(issueId: string): string {
  const hash = issueId.split('').reduce((acc, char) => {
    acc = ((acc << 5) - acc) + char.charCodeAt(0);
    return acc & acc;
  }, 0);
  return this.colorPalette[Math.abs(hash) % this.colorPalette.length];
}

  /**
   * ステータスラベルを取得
   */
  getStatusLabel(status: TaskStatus): string {
    const labels = {
      incomplete: '未完了',
      in_progress: '進行中',
      completed: '完了',
      on_hold: '保留',
      discarded: '破棄'
    };
    return labels[status];
  }

  /**
   * タグ名を取得
   */
  getTagName(tagId: string): string {
    const tag = this.availableTags.find(t => t.id === tagId);
    return tag ? tag.name : tagId;
  }

  /**
   * タグカラーを取得
   */
  getTagColor(tagId: string): string {
    const tag = this.availableTags.find(t => t.id === tagId);
    return tag?.color || '#ccc';
  }

  /**
   * 完了したチェックリスト項目数を取得
   */
  getCompletedChecklistCount(task: Task): number {
    return task.checklist.filter(item => item.completed).length;
  }
}

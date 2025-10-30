import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { TasksService } from '../tasks/tasks.service';
import { TagsService } from '../tags/tags.service';
import { IssuesService } from '../issues/issues.service';
import { Task, TaskStatus, Importance, Tag, Issue, ChecklistItem} from '../../models/schema';

/**
 * タスク一覧コンポーネント
 * 課題配下のタスク一覧表示、作成、編集、削除機能を提供
 */
@Component({
  selector: 'app-tasks-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tasks-list.component.html',
  styleUrls: ['./tasks-list.component.scss']
})
export class TasksListComponent implements OnInit, OnDestroy {
  private tasksService = inject(TasksService);
  private tagsService = inject(TagsService);
  private issuesService = inject(IssuesService);
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
  newTagName = ''; // カスタムタグ名の入力値
  newTagColor = '#4c6ef5'; // カスタムタグ用の既定カラー
  creatingTag = false; // タグ作成処理の二重実行防止
  showArchived = false;
  selectedTaskId: string | null = null;
  selectedTask: Task | null = null;
  newChecklistText = '';

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
    checklist: [] as ChecklistItem[]
  };

  // カラーパレット（課題テーマカラー用）
  private colorPalette = [
    '#007bff', '#20c997', '#ffc107', '#dc3545', '#6f42c1',
    '#e83e8c', '#fd7e14', '#28a745', '#17a2b8', '#6c757d'
  ];

  // 重要度表示用
  private importanceDisplay: Record<Importance, { label: string; weight: number }> = {
    Critical: { label: '至急重要', weight: 4 },
    High: { label: '至急', weight: 3 },
    Medium: { label: '重要', weight: 2 },
    Low: { label: '普通', weight: 1 }
  };

  ngOnInit() {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.projectId = params['projectId'];
      this.issueId = params['issueId'];
      this.loadData();
    });

    this.loadTags();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** データ読み込み */
  private async loadData() {
    if (!this.projectId || !this.issueId) return;

    try {
      const [tasks, issue] = await Promise.all([
        this.tasksService.listTasks(this.projectId, this.issueId),
        this.issuesService.getIssue(this.projectId, this.issueId)
      ]);

      this.issueDetails = issue;
      this.tasks = tasks;
      this.filterTasks();
      this.updateIssueProgress();
    } catch (error) {
      console.error('データの読み込みに失敗しました:', error);
    }
  }

  /** タグ一覧読み込み */
  private async loadTags() {
    try {
      this.availableTags = await this.tagsService.listTags();
    } catch (error) {
      console.error('タグの読み込みに失敗しました:', error);
    }
  }

  /** フィルタリング */
  filterTasks() {
    let filtered = [...this.tasks];

    // アーカイブフィルター
    if (!this.showArchived) {
      filtered = filtered.filter(task => !task.archived);
    }

    // ステータスフィルター
    if (this.statusFilter) {
      filtered = filtered.filter(task => task.status === this.statusFilter);
    }

    // 重要度フィルター
    if (this.importanceFilter) {
      filtered = filtered.filter(task => task.importance === this.importanceFilter);
    }

    this.filteredTasks = filtered;
    this.sortTasks();
  }

  /** 並び替え */
  sortTasks() {
    const sorted = [...this.filteredTasks].sort((a, b) => {
      let aValue: unknown;
      let bValue: unknown;

      switch (this.sortBy) {
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case 'startDate':
          aValue = this.normalizeDate(a.startDate)?.getTime() || 0;
          bValue = this.normalizeDate(b.startDate)?.getTime() || 0;
          break;
        case 'endDate':
          aValue = this.normalizeDate(a.endDate)?.getTime() || 0;
          bValue = this.normalizeDate(b.endDate)?.getTime() || 0;
          break;
        case 'progress':
          aValue = this.getTaskProgress(a);
          bValue = this.getTaskProgress(b);
          break;
        case 'importance':
          aValue = this.getImportanceWeight(a.importance);
          bValue = this.getImportanceWeight(b.importance);
          break;
        case 'createdAt':
          aValue = this.normalizeDate(a.createdAt)?.getTime() || 0;
          bValue = this.normalizeDate(b.createdAt)?.getTime() || 0;
          break;
        default:
          return 0;
      }

      // 型を統一して比較
      const comparison = (aValue as string | number | Date) > (bValue as string | number | Date)
        ? 1
        : (aValue as string | number | Date) < (bValue as string | number | Date)
        ? -1
        : 0;

      return this.sortOrder === 'asc' ? comparison : -comparison;
    });

    this.filteredTasks = sorted;
  }

  /** 日付を正規化 */
  private toDate(date: Date | string | null | undefined): Date | null {
    if (!date) return null;
    if (date instanceof Date) return date;
    if (typeof date === 'string') {
      const parsed = new Date(date);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  /** 重要度の重みを取得 */
  private getImportanceWeight(importance?: Importance): number {
    return this.importanceDisplay[importance ?? 'Low'].weight;
  }

  /** タスク選択 */
  selectTask(task: Task) {
    if (task.id) {
      this.selectedTaskId = task.id;
      this.selectedTask = task;
    }
  }

  /** 詳細パネルを閉じる */
  closeDetailPanel() {
    this.selectedTaskId = null;
    this.selectedTask = null;
    this.newChecklistText = '';
  }

  /** 新規作成モーダルを開く */
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

  /** 編集モーダルを開く */
  editTask(task: Task, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    this.editingTask = task;
    this.taskForm = {
      title: task.title,
      description: task.description || '',
      startDate: task.startDate ? this.formatDateForInput(task.startDate) : '',
      endDate: task.endDate ? this.formatDateForInput(task.endDate) : '',
      goal: task.goal || '',
      importance: task.importance || 'Low',
      status: task.status || 'incomplete',
      tagIds: [...task.tagIds],
      checklist: task.checklist.map(item => ({ ...item }))
    };
    this.showModal = true;
  }

  /** 日付を入力用フォーマットに変換 */
  private formatDateForInput(date: Date | string): string {
    const d = this.normalizeDate(date);
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /** タスク保存 */
  async saveTask() {
    if (!this.taskForm.title || this.saving) return;

    this.saving = true;
    try {
      const taskData = {
        title: this.taskForm.title,
        description: this.taskForm.description || null,
        startDate: this.taskForm.startDate ? this.normalizeDate(this.taskForm.startDate) : null,
        endDate: this.taskForm.endDate ? this.normalizeDate(this.taskForm.endDate) : null,
        goal: this.taskForm.goal || null,
        importance: this.taskForm.importance,
        status: this.taskForm.status,
        tagIds: this.taskForm.tagIds,
        checklist: this.taskForm.checklist.filter(item => item.text.trim() !== '')
      };

      if (this.editingTask?.id) {
        await this.tasksService.updateTask(
          this.projectId,
          this.issueId,
          this.editingTask.id,
          taskData
        );
      } else {
        await this.tasksService.createTask(this.projectId, this.issueId, {
          ...taskData,
          description: taskData.description || undefined,
          startDate: taskData.startDate || undefined,
          endDate: taskData.endDate || undefined,
          goal: taskData.goal || undefined
        });
      }

      this.closeModal();
      await this.loadData();
      this.refreshSelectedTask();
    } catch (error) {
      console.error('タスクの保存に失敗しました:', error);
      alert('タスクの保存に失敗しました');
    } finally {
      this.saving = false;
    }
  }

  /** モーダルを閉じる */
  closeModal() {
    this.showModal = false;
    this.editingTask = null;
    this.saving = false;
  }

  /** タスク削除 */
  async deleteTask(task: Task, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    if (!task.id) return;
    if (!confirm(`タスク「${task.title}」を削除しますか？`)) return;

    try {
      await this.tasksService.deleteTask(this.projectId, this.issueId, task.id);
      await this.loadData();

      if (this.selectedTaskId === task.id) {
        this.closeDetailPanel();
      } else {
        this.refreshSelectedTask();
      }
    } catch (error) {
      console.error('タスクの削除に失敗しました:', error);
      alert('タスクの削除に失敗しました');
    }
  }

  /** アーカイブ切替 */
  async archiveTask(task: Task, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    if (!task.id) return;

    try {
      await this.tasksService.updateTask(this.projectId, this.issueId, task.id, {
        archived: !task.archived
      });
      await this.loadData();
      this.refreshSelectedTask();
    } catch (error) {
      console.error('アーカイブの切替に失敗しました:', error);
      alert('アーカイブの切替に失敗しました');
    }
  }

  /** ステータスラベル取得 */
  getStatusLabel(status: TaskStatus): string {
    const labels: Record<TaskStatus, string> = {
      incomplete: '未完了',
      in_progress: '進行中',
      completed: '完了',
      on_hold: '保留',
      discarded: '破棄'
    };
    return labels[status];
  }

  /** ClecklistItem追加 */
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

  /** ChecklistItem削除 */
  removeChecklistItem(index: number) {
    this.taskForm.checklist.splice(index, 1);
  }

  /** ID生成 */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /** タグ選択切替 */
  toggleTag(tagId: string) {
    const index = this.taskForm.tagIds.indexOf(tagId);
    if (index >= 0) {
      this.taskForm.tagIds.splice(index, 1);
    } else {
      if (this.taskForm.tagIds.length < 10) {
        this.taskForm.tagIds.push(tagId);
      } else {
        alert('タグは最大10個まで選択できます');
      }
    }
  }

   /** カスタムタグを即時作成し、一覧とフォームへ反映する */
   async createCustomTag() {
    const name = this.newTagName.trim(); // 前後の空白を除去
    if (!name) {
      alert('タグ名を入力してください');
      return;
    }

    if (this.creatingTag) {
      return; // 二重クリックによる多重送信を防止
    }

    this.creatingTag = true;
    try {
      const color = this.newTagColor?.trim() || undefined; // 空文字列は未指定扱い
      const tagId = await this.tagsService.createTag({ name, color }); // Firestoreへタグを保存
      const newTag: Tag = { id: tagId, name, color }; // 表示用にタグ情報を構築
      this.availableTags = [...this.availableTags, newTag]; // Change Detectionを確実に発火

      if (!this.taskForm.tagIds.includes(tagId) && this.taskForm.tagIds.length < 10) {
        this.taskForm.tagIds.push(tagId); // 作成したタグを自動的に選択
      }

      this.newTagName = ''; // 入力欄をクリア
      this.newTagColor = '#4c6ef5'; // 次回作成時の初期色に戻す
    } catch (error) {
      console.error('カスタムタグの作成に失敗しました:', error);
      alert('タグの作成に失敗しました。時間を置いて再度お試しください。');
    } finally {
      this.creatingTag = false; // ローディング状態を解除
    }
  }
  /** 課題進捗更新 */
  private async updateIssueProgress() {
    if (!this.issueDetails?.id) return;

    const activeTasks = this.tasks.filter(t => !t.archived);
    if (activeTasks.length === 0) {
      this.issueProgress = 0;
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

  /** 選択中タスクを最新情報に更新 */
  private refreshSelectedTask(): void {
    if (!this.selectedTaskId) {
      this.selectedTask = null;
      return;
    }

    const updated = this.tasks.find(task => task.id === this.selectedTaskId);
    if (updated) {
      this.selectedTask = updated;
    } else {
      this.selectedTaskId = null;
      this.selectedTask = null;
    }
  }
   /**
   * 課題サマリーに適用するCSSカスタムプロパティを生成
   * テンプレート側でテーマカラーを強調表示するために使用
   */
   getIssueSummaryStyles(): Record<string, string> {
    const baseColor = this.getIssueThemeColor();
    return {
      '--issue-color': baseColor,
      '--issue-color-soft': this.getIssueThemeTint(0.16),
      '--issue-color-glow': this.getIssueThemeTint(0.22)
    };
  }

  /** 課題のテーマカラーを取得 */
  getIssueThemeColor(): string {
    if (this.issueDetails?.themeColor) {
      return this.issueDetails.themeColor;
    }
    if (this.issueDetails?.id) {
      return this.getFallbackColor(this.issueDetails.id);
    }
    return this.colorPalette[0];
  }
  /**
   * テーマカラーを透過色に変換
   * CSS変数で柔らかな背景や影を作るための補助関数
   */
  private getIssueThemeTint(alpha: number): string {
    const base = this.getIssueThemeColor();
    const rgb = this.parseColor(base);
    const normalizedAlpha = Math.min(Math.max(alpha, 0), 1);
    if (rgb) {
      return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${normalizedAlpha})`;
    }
    // 変換できなかった場合はブランドカラーにフォールバック
    return `rgba(0, 123, 255, ${normalizedAlpha})`;
  }

  /**
   * カラーコードをRGB値に変換
   * #RGB / #RRGGBB / rgb(r,g,b) の表記に対応
   */
  private parseColor(color: string): { r: number; g: number; b: number } | null {
    const trimmed = color.trim();

    // rgb() 形式にも対応
    const rgbMatch = trimmed.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
    if (rgbMatch) {
      return {
        r: Number(rgbMatch[1]),
        g: Number(rgbMatch[2]),
        b: Number(rgbMatch[3])
      };
    }

    const hexMatch = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hexMatch) {
      return null;
    }

    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map(char => char + char).join('');
    }

    const value = parseInt(hex, 16);
    return {
      r: (value >> 16) & 0xff,
      g: (value >> 8) & 0xff,
      b: value & 0xff
    };
  }

  /** フォールバックカラーを取得 */
  getFallbackColor(id: string): string {
    const index = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return this.colorPalette[index % this.colorPalette.length];
  }

  /** 重要度のラベルを日本語で取得 */
  getImportanceLabel(importance?: Importance): string {
    const key = importance ?? 'Low';
    return this.importanceDisplay[key].label;
  }

  /** 重要度バッジ用のクラス名を返す */
  getImportanceClass(importance?: Importance): string {
    const key = (importance ?? 'Low').toLowerCase() as Lowercase<Importance>;
    return `importance-${key}`;
  }

  /** 選択中タスクの進捗率を取得 */
  getTaskProgress(task: Task): number {
    if (typeof task.progress === 'number') {
      return task.progress;
    }
    return this.tasksService.calculateProgressFromChecklist(task.checklist, task.status);
  }

  /** 詳細パネルからチェックリストの完了状態を切り替える */
  async toggleChecklistItem(task: Task, itemId: string, completed: boolean) {
    const updatedChecklist = task.checklist.map(item =>
      item.id === itemId ? { ...item, completed } : item
    );
    await this.persistChecklist(task, updatedChecklist);
  }

  /** 詳細パネルからチェックリスト項目を追加 */
  async addChecklistItemFromDetail() {
    const text = this.newChecklistText.trim();
    if (!text || !this.selectedTask) {
      return;
    }

    const updatedChecklist = [
      ...this.selectedTask.checklist,
      { id: this.generateId(), text, completed: false }
    ];

    await this.persistChecklist(this.selectedTask, updatedChecklist);
    this.newChecklistText = '';
  }

  /** 詳細パネルからチェックリスト項目を削除 */
  async removeChecklistItemFromDetail(itemId: string) {
    if (!this.selectedTask) {
      return;
    }

    const updatedChecklist = this.selectedTask.checklist.filter(item => item.id !== itemId);
    await this.persistChecklist(this.selectedTask, updatedChecklist);
  }

  /** チェックリスト更新をFirestoreに反映 */
  private async persistChecklist(task: Task, checklist: ChecklistItem[]): Promise<void> {
    if (!task.id) {
      return;
    }

    try {
      // チェックリストからステータスを決定
      let status = task.status;
      if (checklist.length > 0) {
        const allCompleted = checklist.every(item => item.completed);
        const someCompleted = checklist.some(item => item.completed);
        if (allCompleted) {
          status = 'completed';
        } else if (someCompleted && status !== 'on_hold' && status !== 'discarded') {
          status = 'in_progress';
        } else if (!someCompleted && status !== 'on_hold' && status !== 'discarded') {
          status = 'incomplete';
        }
      }
      const progress = this.tasksService.calculateProgressFromChecklist(checklist, status);
      await this.tasksService.updateTask(this.projectId, this.issueId, task.id, {
        checklist,
        status,
        progress
      });

      await this.loadData();
      this.refreshSelectedTask();
      await this.updateIssueProgress();
    } catch (error) {
      console.error('チェックリストの更新に失敗しました:', error);
      alert('チェックリストの更新に失敗しました');
    }
  }

  /** タグ名を取得 */
  getTagName(tagId: string): string {
    const tag = this.availableTags.find(t => t.id === tagId);
    return tag ? tag.name : tagId;
  }

  /** タグカラーを取得 */
  getTagColor(tagId: string): string {
    const tag = this.availableTags.find(t => t.id === tagId);
    return tag?.color || '#ccc';
  }

  /** 完了したチェックリスト項目数を取得 */
  getCompletedChecklistCount(task: Task): number {
    return task.checklist.filter(item => item.completed).length;
  }

  /** 日付をDateオブジェクトに正規化 */
  private normalizeDate(date: Date | string | null | undefined): Date | null {
    return this.toDate(date);
  }
}

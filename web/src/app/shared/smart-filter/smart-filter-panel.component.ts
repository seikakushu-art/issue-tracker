import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  SMART_FILTER_DUE_OPTIONS,
  SMART_FILTER_IMPORTANCE_OPTIONS,
  SMART_FILTER_STATUS_OPTIONS,
  SmartFilterAssigneeOption,
  SmartFilterCriteria,
  SmartFilterOption,
  SmartFilterPreset,
  SmartFilterTagOption,
  createEmptySmartFilterCriteria,
} from './smart-filter.model';
import { SmartFilterService } from './smart-filter.service';
import { Importance, TaskStatus } from '../../models/schema';

/**
 * 画面共通のスマートフィルターパネル
 * 条件の選択とプリセットの管理をまとめて提供する
 */
@Component({
  selector: 'app-smart-filter-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './smart-filter-panel.component.html',
  styleUrls: ['./smart-filter-panel.component.scss'],
})
export class SmartFilterPanelComponent implements OnInit, OnChanges {
  /** フィルター適用範囲を示すスコープ（projects/issues/tasksなど） */
  @Input() scope = 'default';
  /** 親コンポーネントから渡される現在の条件 */
  @Input() criteria: SmartFilterCriteria = createEmptySmartFilterCriteria();
  /** タグの選択肢 */
  @Input() tags: SmartFilterTagOption[] = [];
  /** タグセクションを非表示にするかどうか */
  @Input() hideTags = false;
  /** 担当者の選択肢 */
  @Input() assignees: SmartFilterAssigneeOption[] = [];
  /** ステータスの選択肢（タスクに準拠） */
  @Input() statusOptions: SmartFilterOption<TaskStatus>[] = SMART_FILTER_STATUS_OPTIONS;
  /** 重要度の選択肢 */
  @Input() importanceOptions: SmartFilterOption<Importance>[] = SMART_FILTER_IMPORTANCE_OPTIONS;
  /** 期限の選択肢 */
  dueOptions = SMART_FILTER_DUE_OPTIONS;

  /** 選択中の条件（UI操作用に独自に保持） */
  localCriteria: SmartFilterCriteria = createEmptySmartFilterCriteria();
  /** 保存済みのプリセット一覧 */
  presets: SmartFilterPreset[] = [];
  /** 新規プリセット保存時の名称入力 */
  newPresetName = '';
  /** 編集中のプリセットID */
  editingPresetId: string | null = null;
  /** 編集フォームの入力値 */
  editingName = '';

  private smartFilterService = inject(SmartFilterService);

  async ngOnInit(): Promise<void> {
    await this.loadPresets();
    this.syncLocalCriteria();
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    if (changes['criteria'] && !changes['criteria'].firstChange) {
      this.syncLocalCriteria();
    }
    if (changes['scope'] && !changes['scope'].firstChange) {
      await this.loadPresets();
    }
  }

  /**
   * プリセット一覧を読み込む
   */
  private async loadPresets(): Promise<void> {
    try {
      this.presets = await this.smartFilterService.getPresets(this.scope);
    } catch (error) {
      console.warn('プリセットの読み込みに失敗しました', error);
      this.presets = [];
    }
  }

  /**
   * 親から受け取った条件をローカルコピーへ同期
   */
  private syncLocalCriteria(): void {
    this.localCriteria = {
      tagIds: [...(this.criteria.tagIds ?? [])],
      assigneeIds: [...(this.criteria.assigneeIds ?? [])],
      importanceLevels: [...(this.criteria.importanceLevels ?? [])],
      statuses: [...(this.criteria.statuses ?? [])],
      due: this.criteria.due ?? '',
    };
  }

  /**
   * タグのチェック状態を反転させる
   */
  toggleTag(tagId: string, checked: boolean): void {
    if (checked) {
      if (!this.localCriteria.tagIds.includes(tagId)) {
        this.localCriteria.tagIds = [...this.localCriteria.tagIds, tagId];
      }
    } else {
      this.localCriteria.tagIds = this.localCriteria.tagIds.filter((id) => id !== tagId);
    }
  }

  /**
   * 担当者のチェック状態を反転
   */
  toggleAssignee(assigneeId: string, checked: boolean): void {
    if (checked) {
      if (!this.localCriteria.assigneeIds.includes(assigneeId)) {
        this.localCriteria.assigneeIds = [...this.localCriteria.assigneeIds, assigneeId];
      }
    } else {
      this.localCriteria.assigneeIds = this.localCriteria.assigneeIds.filter((id) => id !== assigneeId);
    }
  }

  /**
   * 重要度のチェック状態を反転
   */
  toggleImportance(value: Importance, checked: boolean): void {
    if (checked) {
      if (!this.localCriteria.importanceLevels.includes(value)) {
        this.localCriteria.importanceLevels = [...this.localCriteria.importanceLevels, value];
      }
    } else {
      this.localCriteria.importanceLevels = this.localCriteria.importanceLevels.filter((item) => item !== value);
    }
  }

  /**
   * ステータスのチェック状態を反転
   */
  toggleStatus(value: TaskStatus, checked: boolean): void {
    if (checked) {
      if (!this.localCriteria.statuses.includes(value)) {
        this.localCriteria.statuses = [...this.localCriteria.statuses, value];
      }
    } else {
      this.localCriteria.statuses = this.localCriteria.statuses.filter((item) => item !== value);
    }
  }

  /**
   * 重要度チェックボックスの選択状態を判定
   */
  isImportanceSelected(value: Importance): boolean {
    return this.localCriteria.importanceLevels.includes(value);
  }

  /**
   * ステータスチェックボックスの選択状態を判定
   */
  isStatusSelected(value: TaskStatus): boolean {
    return this.localCriteria.statuses.includes(value);
  }

  /**
   * 期限条件を更新（単一選択）
   */
  updateDue(value: string): void {
    this.localCriteria = {
      ...this.localCriteria,
      due: (value as SmartFilterCriteria['due']) ?? '',
    };
  }

  /**
   * 条件を初期状態へ戻す
   */
  reset(): void {
    this.localCriteria = createEmptySmartFilterCriteria();
    this.apply();
  }

  /**
   * 条件を親へ通知し、そのまま適用
   */
  apply(): void {
    this.applyCriteria.emit({
      tagIds: [...this.localCriteria.tagIds],
      assigneeIds: [...this.localCriteria.assigneeIds],
      importanceLevels: [...this.localCriteria.importanceLevels],
      statuses: [...this.localCriteria.statuses],
      due: this.localCriteria.due,
    });
  }

  /**
   * パネルを閉じる
   */
  closePanel(): void {
    this.panelClosed.emit();
  }

  /** フィルター適用イベント */
  @Output() applyCriteria = new EventEmitter<SmartFilterCriteria>();
  /** パネル閉じるイベント */
  @Output() panelClosed = new EventEmitter<void>();

  /**
   * 現在の条件をプリセットとして保存
   */
  async savePreset(): Promise<void> {
    const trimmedName = this.newPresetName.trim();
    
    // スマートフィルター名の文字数上限チェック（50文字）
    const MAX_PRESET_NAME_LENGTH = 50;
    if (trimmedName.length > MAX_PRESET_NAME_LENGTH) {
      alert(`フィルター名は最大${MAX_PRESET_NAME_LENGTH}文字までです`);
      return;
    }
    
    try {
      await this.smartFilterService.createPreset(this.scope, trimmedName, this.localCriteria);
      this.presets = await this.smartFilterService.getPresets(this.scope);
      this.newPresetName = '';
    } catch (error) {
      if (error instanceof Error) {
        alert(error.message);
      } else {
        alert('フィルターの保存に失敗しました');
      }
    }
  }

  /**
   * プリセットの名称編集開始
   */
  startEditPreset(preset: SmartFilterPreset): void {
    this.editingPresetId = preset.id;
    this.editingName = preset.name;
  }

  /**
   * プリセット名称の更新確定
   */
  async submitPresetName(preset: SmartFilterPreset): Promise<void> {
    const trimmedName = this.editingName.trim();
    
    // スマートフィルター名の文字数上限チェック（50文字）
    const MAX_PRESET_NAME_LENGTH = 50;
    if (trimmedName.length > MAX_PRESET_NAME_LENGTH) {
      alert(`フィルター名は最大${MAX_PRESET_NAME_LENGTH}文字までです`);
      return;
    }
    
    try {
      this.presets = await this.smartFilterService.renamePreset(this.scope, preset.id, trimmedName);
      this.editingPresetId = null;
      this.editingName = '';
    } catch (error) {
      if (error instanceof Error) {
        alert(error.message);
      } else {
        alert('フィルター名の変更に失敗しました');
      }
    }
  }

  /**
   * プリセットを削除
   */
  async deletePreset(preset: SmartFilterPreset): Promise<void> {
    try {
      this.presets = await this.smartFilterService.deletePreset(this.scope, preset.id);
      if (this.editingPresetId === preset.id) {
        this.editingPresetId = null;
        this.editingName = '';
      }
    } catch (error) {
      console.error('プリセットの削除に失敗しました', error);
      alert('フィルターの削除に失敗しました');
    }
  }

  /**
   * プリセットを適用
   */
  applyPreset(preset: SmartFilterPreset): void {
    this.localCriteria = {
      tagIds: [...preset.criteria.tagIds],
      assigneeIds: [...preset.criteria.assigneeIds],
      importanceLevels: [...preset.criteria.importanceLevels],
      statuses: [...preset.criteria.statuses],
      due: preset.criteria.due,
    };
    this.apply();
  }
}
import { Injectable } from '@angular/core';
import { SmartFilterCriteria, SmartFilterPreset } from './smart-filter.model';

/**
 * スマートフィルターを永続化するサービス
 * ローカルストレージが利用できない環境（SSRなど）ではメモリ上に保存する
 */
@Injectable({ providedIn: 'root' })
export class SmartFilterService {
  /** SSR等でlocalStorageが無い場合に備えてメモリキャッシュを保持 */
  private memoryStore = new Map<string, SmartFilterPreset[]>();

  /**
   * プリセット一覧を取得する
   */
  getPresets(scope: string): SmartFilterPreset[] {
    const stored = this.readFromStorage(scope);
    return stored ?? [];
  }

  /**
   * プリセットを新規作成し、保存後に返す
   */
  createPreset(scope: string, name: string, criteria: SmartFilterCriteria): SmartFilterPreset {
    const trimmedName = name.trim();
    
    // スマートフィルター名の文字数上限チェック（50文字）
    const MAX_PRESET_NAME_LENGTH = 50;
    if (trimmedName.length > MAX_PRESET_NAME_LENGTH) {
      throw new Error(`フィルター名は最大${MAX_PRESET_NAME_LENGTH}文字までです`);
    }
    
    const preset: SmartFilterPreset = {
      id: this.generateId(),
      name: trimmedName.length > 0 ? trimmedName : '名称未設定',
      criteria: {
        tagIds: [...criteria.tagIds],
        assigneeIds: [...criteria.assigneeIds],
        importanceLevels: [...criteria.importanceLevels],
        statuses: [...criteria.statuses],
        due: criteria.due,
      },
    };

    const next = [...this.getPresets(scope), preset];
    this.writeToStorage(scope, next);
    return preset;
  }

  /**
   * 既存プリセットの名称を変更する
   */
  renamePreset(scope: string, presetId: string, nextName: string): SmartFilterPreset[] {
    const trimmed = nextName.trim();
    
    // スマートフィルター名の文字数上限チェック（50文字）
    const MAX_PRESET_NAME_LENGTH = 50;
    if (trimmed.length > MAX_PRESET_NAME_LENGTH) {
      throw new Error(`フィルター名は最大${MAX_PRESET_NAME_LENGTH}文字までです`);
    }
    
    const finalName = trimmed.length > 0 ? trimmed : '名称未設定';
    const updated = this.getPresets(scope).map((preset) =>
      preset.id === presetId
        ? {
            ...preset,
            name: finalName,
          }
        : preset
    );
    this.writeToStorage(scope, updated);
    return updated;
  }

  /**
   * 指定したプリセットを削除する
   */
  deletePreset(scope: string, presetId: string): SmartFilterPreset[] {
    const filtered = this.getPresets(scope).filter((preset) => preset.id !== presetId);
    this.writeToStorage(scope, filtered);
    return filtered;
  }

  /**
   * localStorageからプリセットを読み込む（なければメモリストア）
   */
  private readFromStorage(scope: string): SmartFilterPreset[] | null {
    if (typeof window === 'undefined' || !window?.localStorage) {
      return this.memoryStore.get(scope) ?? null;
    }

    try {
      const raw = window.localStorage.getItem(this.buildKey(scope));
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as SmartFilterPreset[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('スマートフィルターの読み込みに失敗しました', error);
      return [];
    }
  }

  /**
   * プリセット一覧をlocalStorageまたはメモリに保存する
   */
  private writeToStorage(scope: string, presets: SmartFilterPreset[]): void {
    if (typeof window === 'undefined' || !window?.localStorage) {
      this.memoryStore.set(scope, presets);
      return;
    }

    try {
      window.localStorage.setItem(this.buildKey(scope), JSON.stringify(presets));
    } catch (error) {
      console.warn('スマートフィルターの保存に失敗しました', error);
    }
  }

  /**
   * スコープに紐づくストレージキーを生成
   */
  private buildKey(scope: string): string {
    return `smart-filter::${scope}`;
  }

  /**
   * UUIDを生成する（ブラウザ対応がない場合は乱数フォールバック）
   */
  private generateId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // 乱数でフォールバック（十分な一意性を確保するため桁数を多めに確保）
    return `sf_${Math.random().toString(36).slice(2, 11)}${Date.now().toString(36)}`;
  }
}
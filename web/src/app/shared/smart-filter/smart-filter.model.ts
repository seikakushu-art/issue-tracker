import { Importance, Task, TaskStatus } from '../../models/schema';

/**
 * スマートフィルターの期限条件
 * - ''        : 未選択
 * - 'today'   : 本日が期限のもの
 * - 'week'    : 今週が期限のもの
 */
export type SmartFilterDue = '' | 'today' | 'week';

/**
 * スマートフィルターで利用する絞り込み条件
 * タグ・担当者・重要度・ステータス・期限を一括管理する
 */
export interface SmartFilterCriteria {
  tagIds: string[];
  assigneeIds: string[];
  importanceLevels: Importance[];
  statuses: TaskStatus[];
  due: SmartFilterDue;
}

/**
 * スマートフィルターのプリセット（保存済み条件）
 */
export interface SmartFilterPreset {
  id: string;
  name: string;
  criteria: SmartFilterCriteria;
}

/**
 * スマートフィルターで表示するタグ情報
 */
export interface SmartFilterTagOption {
  id: string;
  name: string;
  color?: string | null;
}

/**
 * スマートフィルターで表示する担当者情報
 */
export interface SmartFilterAssigneeOption {
  id: string;
  displayName: string;
  photoUrl?: string | null;
}

/**
 * セレクトボックス等で利用する共通のオプション型
 */
export interface SmartFilterOption<T extends string> {
  value: T;
  label: string;
}

/**
 * 重要度の定義済みオプション
 */
export const SMART_FILTER_IMPORTANCE_OPTIONS: SmartFilterOption<Importance>[] = [
  { value: 'Critical', label: '至急重要' },
  { value: 'High', label: '至急' },
  { value: 'Medium', label: '重要' },
  { value: 'Low', label: '普通' },
];

/**
 * ステータスの定義済みオプション
 */
export const SMART_FILTER_STATUS_OPTIONS: SmartFilterOption<TaskStatus>[] = [
  { value: 'incomplete', label: '未完了' },
  { value: 'in_progress', label: '進行中' },
  { value: 'completed', label: '完了' },
  { value: 'on_hold', label: '保留' },
  { value: 'discarded', label: '破棄' },
];

/**
 * 期限の定義済みオプション
 */
export const SMART_FILTER_DUE_OPTIONS: SmartFilterOption<Exclude<SmartFilterDue, ''>>[] = [
  { value: 'today', label: '期限: 本日' },
  { value: 'week', label: '期限: 今週' },
];

/**
 * スマートフィルターの空オブジェクトを生成する
 */
export function createEmptySmartFilterCriteria(): SmartFilterCriteria {
  return {
    tagIds: [],
    assigneeIds: [],
    importanceLevels: [],
    statuses: [],
    due: '',
  };
}

/**
 * スマートフィルターが全て空（無効）かどうかを判定する
 */
export function isSmartFilterEmpty(criteria: SmartFilterCriteria): boolean {
  return (
    criteria.tagIds.length === 0 &&
    criteria.assigneeIds.length === 0 &&
    criteria.importanceLevels.length === 0 &&
    criteria.statuses.length === 0 &&
    criteria.due === ''
  );
}

/**
 * タスクがスマートフィルター条件を満たすかどうかを判定
 * すべての条件が揃ったタスクのみtrueを返す
 */
export function matchesSmartFilterTask(task: Task, criteria: SmartFilterCriteria): boolean {
  // 1. タグが指定されている場合、少なくとも1つ一致するかを判定
  if (criteria.tagIds.length > 0) {
    const taskTagIds = task.tagIds ?? [];
    const hasMatchedTag = criteria.tagIds.some(tagId => taskTagIds.includes(tagId));
    if (!hasMatchedTag) {
      return false;
    }
  }

  // 2. 担当者が指定されている場合、どれかが一致するかを判定
  if (criteria.assigneeIds.length > 0) {
    const taskAssigneeIds = task.assigneeIds ?? [];
    const hasMatchedAssignee = criteria.assigneeIds.some(uid => taskAssigneeIds.includes(uid));
    if (!hasMatchedAssignee) {
      return false;
    }
  }

  // 3. 重要度での絞り込み
  if (criteria.importanceLevels.length > 0) {
    if (!task.importance || !criteria.importanceLevels.includes(task.importance)) {
      return false;
    }
  }

  // 4. ステータスでの絞り込み
  if (criteria.statuses.length > 0) {
    if (!criteria.statuses.includes(task.status)) {
      return false;
    }
  }

  // 5. 期限での絞り込み
  if (criteria.due !== '' && !doesDateMatchDue(task.endDate ?? null, criteria.due)) {
    return false;
  }

  return true;
}

/**
 * 任意の日付が指定された期限条件に合致するか判定
 */
export function doesDateMatchDue(value: unknown, due: SmartFilterDue): boolean {
  if (due === '') {
    return true;
  }
  const date = normalizeDate(value);
  if (!date) {
    return false;
  }
  if (due === 'today') {
    return isDueToday(date);
  }
  if (due === 'week') {
    return isDueThisWeek(date);
  }
  return false;
}

/**
 * 任意の値をDate型に揃える
 */
function normalizeDate(value: unknown): Date | null {
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
 * 本日中に期限が訪れるかをチェックする
 */
function isDueToday(date: Date): boolean {
  const start = startOfDay(new Date());
  const end = endOfDay(start);
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

/**
 * 今週（日本のビジネス習慣に合わせて月曜始まり）に期限が収まるか判定
 */
function isDueThisWeek(date: Date): boolean {
  const start = startOfWeek(new Date());
  const end = endOfWeek(start);
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

/**
 * 00:00:00.000 に揃えた日付を取得
 */
function startOfDay(base: Date): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate());
}

/**
 * 23:59:59.999 に揃えた日付を取得
 */
function endOfDay(start: Date): Date {
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
}

/**
 * 週の開始日（月曜日）を算出
 */
function startOfWeek(base: Date): Date {
  const start = startOfDay(base);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day; // 日曜は-6、月曜は0
  start.setDate(start.getDate() + diff);
  return start;
}

/**
 * 週の最終日（日曜日）を算出
 */
function endOfWeek(start: Date): Date {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}
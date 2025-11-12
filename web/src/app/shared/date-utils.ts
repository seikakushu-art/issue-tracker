import { Timestamp } from '@angular/fire/firestore';

/**
 * Firestoreから受け取った日付相当の値をDate型へ統一するユーティリティ
 * Timestamp/Date/stringのいずれが来ても安全にDateへ変換し、解釈できない値はnullを返す
 * 
 * @param value 変換対象の値（Date、Timestamp、string、null、undefinedなど）
 * @returns Date型に変換された値、またはnull（変換できない場合）
 */
export function normalizeDate(value: unknown): Date | null {
  // null、undefined、空文字列などの場合はnullを返す
  if (!value) {
    return null;
  }

  // Dateインスタンスの場合はそのまま返す（無効な日付の場合はnull）
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  // Firestore Timestampの場合はtoDate()で変換
  if (value instanceof Timestamp) {
    const converted = value.toDate();
    return Number.isNaN(converted.getTime()) ? null : converted;
  }

  // toDate()メソッドを持つオブジェクト（他のTimestamp実装など）をチェック
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    const converted = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(converted.getTime()) ? null : converted;
  }

  // 文字列の場合はDateコンストラクタでパース
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // その他の型の場合はnullを返す
  return null;
}


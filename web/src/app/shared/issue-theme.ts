/**
 * 課題テーマカラー関連のユーティリティ
 * タスク側と課題側で同一ロジックを使い回して色ぶれを防ぐ
 */
export const ISSUE_THEME_PALETTE: readonly string[] = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ];
  
  /**
   * 課題IDから決定論的にテーマカラーを引く
   * ランダム関数を使わずハッシュの結果で安定させる
   */
  export function pickIssueThemeColor(issueId: string): string {
    const normalized = issueId.trim();
    if (!normalized) {
      return ISSUE_THEME_PALETTE[0]; // IDが無い場合は先頭色にフォールバック
    }
  
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + charCode; // 32bitの擬似ハッシュ
      hash |= 0; // bitwise演算で32bitに収める
    }
  
    const index = Math.abs(hash) % ISSUE_THEME_PALETTE.length;
    return ISSUE_THEME_PALETTE[index];
  }
  
  /**
   * 明示テーマカラーとIDから最終的な表示色を決定
   * タスク・課題の双方で完全一致する色を返す
   */
  export function resolveIssueThemeColor(
    explicitColor: string | null | undefined,
    fallbackId: string | null | undefined,
  ): string {
    const normalized = typeof explicitColor === 'string' ? explicitColor.trim() : '';
    if (normalized) {
      return normalized; // 手動設定があればそれを最優先
    }
    const candidateId = typeof fallbackId === 'string' ? fallbackId.trim() : '';
    return pickIssueThemeColor(candidateId);
  }
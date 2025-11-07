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

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseHexColor(input: string): RgbColor | null {
  const match = input.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!match) {
    return null;
  }

  let hex = match[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .slice(0, 3)
      .map((value) => value + value)
      .join('');
  }

  if (hex.length < 6) {
    return null;
  }

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }

  return { r, g, b };
}

function formatRgb(color: RgbColor): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function mixWithWhite(color: RgbColor, ratio: number): RgbColor {
  const clamped = clamp(ratio, 0, 1);
  return {
    r: Math.round(color.r + (255 - color.r) * clamped),
    g: Math.round(color.g + (255 - color.g) * clamped),
    b: Math.round(color.b + (255 - color.b) * clamped),
  };
}

/**
 * 指定色を白とブレンドし、淡いトーンを生成する
 */
export function tintIssueThemeColor(color: string, ratio = 0.75): string {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return color;
  }
  return formatRgb(mixWithWhite(rgb, ratio));
}

/**
 * 指定色の透過色（RGBA）を生成する
 */
export function transparentizeIssueThemeColor(color: string, alpha = 0.16): string {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return color;
  }
  const clampedAlpha = clamp(alpha, 0, 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampedAlpha})`;
}
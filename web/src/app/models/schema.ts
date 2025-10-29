/**
 * ユーザーの役割
 */
export type Role = 'admin' | 'member' | 'guest';

/**
 * タスクの重要度（4段階）
 */
export type Importance = 'Critical' | 'High' | 'Medium' | 'Low';

/**
 * タスクのステータス
 * - incomplete: 未完了
 * - in_progress: 進行中
 * - completed: 完了
 * - on_hold: 保留
 * - discarded: 破棄
 */
export type TaskStatus = 'incomplete' | 'in_progress' | 'completed' | 'on_hold' | 'discarded';

/**
 * プロジェクト（最上位階層）
 * プロジェクトの枠組み・期間・目標・参加者を定義し、配下課題の統括単位とする
 */
export interface Project {
  id?: string;
  name: string;  // 必須
  description?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  goal?: string | null;
  memberIds: string[];  // 参加メンバーのユーザーID配列
  roles: Record<string, Role>;  // ユーザーID → 役割のマッピング
  archived: boolean;  // アーカイブ状態
  progress?: number;  // 進捗率（0-100、配下課題の加重平均から自動集計）
  createdAt?: Date | null;
}

/**
 * 課題（プロジェクト配下）
 * プロジェクトを達成可能な業務単位に分割し、担当や進捗を管理する
 */
export interface Issue {
  id?: string;
  projectId: string;  // 所属プロジェクトID
  name: string;  // 必須
  description?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  goal?: string | null;
  themeColor?: string | null;  // テーマカラー（未選択時はランダム割り当て）
  archived: boolean;  // アーカイブ状態
  progress?: number;  // 進捗率（0-100、配下タスクの加重平均から自動集計）
  createdAt?: Date | null;
}

/**
 * チェックリスト項目（タスク配下）
 */
export interface ChecklistItem {
  id: string;  // クライアント側で生成される一意ID
  text: string;  // チェック項目のテキスト
  completed: boolean;  // 完了状態
}

/**
 * 添付ファイル（タスク配下）
 */
export interface Attachment {
  id: string;  // クライアント側で生成される一意ID
  fileName: string;  // ファイル名
  fileUrl: string;  // ストレージURL
  fileSize: number;  // ファイルサイズ（バイト）
  uploadedBy: string;  // アップロード者のユーザーID
  uploadedAt: Date;  // アップロード日時
}

/**
 * コメント（タスク配下）
 */
export interface Comment {
  id: string;  // クライアント側で生成される一意ID
  text: string;  // コメント本文（最大5000字）
  createdBy: string;  // 作成者のユーザーID
  createdAt: Date;  // 作成日時
  mentions?: string[];  // メンションされたユーザーID配列
}

/**
 * タグ（ワークスペース全体で共有）
 */
export interface Tag {
  id?: string;
  name: string;  // 必須、ワークスペースで一意
  color?: string;  // タグのカラー
  createdAt?: Date | null;
}

/**
 * タスク（課題配下）
 * 実行者が迷わず着手できるレベルまで作業を定義し、進捗を的確に把握する
 */
export interface Task {
  id?: string;
  projectId: string;  // 所属プロジェクトID
  issueId: string;  // 所属課題ID
  title: string;  // 必須
  description?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  goal?: string | null;
  importance?: Importance;  // 重要度（Critical/High/Medium/Low）
  status: TaskStatus;  // ステータス（未完了/進行中/完了/破棄/保留）
  assigneeIds: string[];  // 担当者のユーザーID配列（複数可）
  tagIds: string[];  // タグID配列（最大10個）
  checklist: ChecklistItem[];  // チェックリスト項目
  progress?: number;  // 進捗率（0-100、チェックリストから自動集計）
  createdBy: string;  // 作成者のユーザーID
  createdAt?: Date | null;
  // サブコレクションとして管理されるもの：
  // - comments（コメント、最大500件）
  // - attachments（添付ファイル、最大20件、合計500MB）
}

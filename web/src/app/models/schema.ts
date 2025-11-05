/**
 * ユーザーの役割
 */
export type Role = 'admin' | 'member' | 'guest';

/**
 * 招待リンクの状態
 */
export type InviteStatus = 'active' | 'used' | 'expired' | 'revoked';

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
  /** 現在ログイン中ユーザーの役割（クライアント用） */
  currentRole?: Role;
}

/**
 * プロジェクトテンプレート
 * 既存プロジェクトを再利用する際に、共通のメタ情報だけを保持する
 */
export interface ProjectTemplate {
  id?: string;
  name: string;  // テンプレート表示名
  description?: string | null;
  goal?: string | null;
  sourceProjectId?: string | null;  // 元になったプロジェクトIDを記録（任意）
  createdBy: string;  // 作成者UID
  createdAt?: Date | null;
}

/**
 * プロジェクトの招待情報
 */
export interface ProjectInvite {
  id?: string;
  projectId: string;
  token: string;
  role: Role;
  status: InviteStatus;
  createdBy: string;
  createdAt?: Date | null;
  expiresAt: Date;
  usedBy?: string | null;
  usedAt?: Date | null;
  revokedBy?: string | null;
  revokedAt?: Date | null;
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
  representativeTaskId?: string | null;  // 課題カードに表示する代表タスクID
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
  uploadedAt: Date | null;  // アップロード日時
  storagePath?: string;  // Firebase Storage 上の実ファイルパス
  projectId?: string;  // 所属プロジェクトID（一覧表示用）
  projectName?: string | null;  // 所属プロジェクト名（スナップショット）
  issueId?: string;  // 所属課題ID
  issueName?: string | null;  // 所属課題名（スナップショット）
  taskId?: string;  // 所属タスクID
  taskTitle?: string | null;  // 添付時点のタスク名
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
  authorUsername?: string | null;  // 表示に使うユーザー名
  authorPhotoUrl?: string | null;  // アイコン画像URL
}

/**
 * タグ（ワークスペース全体で共有）
 */
export interface Tag {
  id?: string;
  name: string;  // 必須、ワークスペースで一意
  color?: string;  // タグのカラー
  createdAt?: Date | null;
  createdBy?: string | null;  // 作成ユーザーID
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
  archived: boolean;  // アーカイブ状態（課題一覧の表示制御に使用）
  assigneeIds: string[];  // 担当者のユーザーID配列（複数可）
  tagIds: string[];  // タグID配列（最大10個）
  checklist: ChecklistItem[];  // チェックリスト項目
  progress?: number;  // 進捗率（0-100、チェックリストから自動集計）
  createdBy: string;  // 作成者のユーザーID
  createdAt?: Date | null;
  // サブコレクションとして管理されるもの：
  // - comments（コメント、最大500件）
  // - attachments（添付ファイル、最大20件、合計500MB）
}/**
 * 掲示板の投稿
 */
export interface BulletinPost {
  id?: string;
  title: string;
  content: string;
  projectIds: string[];
  authorId: string;
  authorUsername: string;
  authorPhotoUrl?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}
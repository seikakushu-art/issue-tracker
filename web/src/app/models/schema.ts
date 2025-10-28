export type Role = 'admin' | 'member' | 'guest';

export interface Project {
  id?: string;
  name: string;
  description?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  goal?: string | null;
  memberIds: string[];
  roles: Record<string, Role>;
  archived?: boolean;
  createdAt?: Date | null;
}

export interface Issue {
  id?: string;
  projectId: string;
  name: string;
  description?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  goal?: string | null;
  themeColor?: string | null;
}

export type TaskStatus = 'todo' | 'doing' | 'done' | 'on_hold' | 'discarded';

export interface Task {
  id?: string;
  projectId: string;
  issueId: string;
  title: string;
  description?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  importance?: 'Critical' | 'High' | 'Medium' | 'Low';
  assigneeIds: string[];
  tags: string[];
  status: TaskStatus;
  checklistTotal?: number;
  checklistDone?: number;
  createdBy: string;
  createdAt?: Date | null;
}

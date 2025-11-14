import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  where,
  deleteDoc,
  doc,
  getDoc,
} from '@angular/fire/firestore';
import {
  ChecklistItem,
  Importance,
  ProjectTemplate,
  ProjectTemplateIssue,
  ProjectTemplateTask,
} from '../../models/schema';
import { ProjectsService } from './projects.service';
import { normalizeDate } from '../../shared/date-utils';

/**
 * プロジェクトテンプレートを管理するサービス
 * - 既存プロジェクトからテンプレートを生成
 * - テンプレート一覧を取得
 */
@Injectable({ providedIn: 'root' })
export class ProjectTemplatesService {
  private db = inject(Firestore);
  private projectsService = inject(ProjectsService);

  /** FirestoreドキュメントをUIで扱いやすいProjectTemplateへ整形 */
  private hydrateTemplate(id: string, data: ProjectTemplate): ProjectTemplate {
    const record = data as unknown as Record<string, unknown>;
    return {
      ...data,
      id,
      name: (record['name'] as string) ?? '',
      description: (record['description'] as string | null | undefined) ?? null,
      goal: (record['goal'] as string | null | undefined) ?? null,
      sourceProjectId: (record['sourceProjectId'] as string | null | undefined) ?? null,
      createdBy: (record['createdBy'] as string) ?? '',
      createdAt: normalizeDate(record['createdAt']),
      issues: this.normalizeTemplateIssues(record['issues']),
    };
  }

  /** テンプレート内の課題配列を安全に整形 */
  private normalizeTemplateIssues(value: unknown): ProjectTemplateIssue[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((issue) => this.normalizeTemplateIssue(issue))
      .filter((issue): issue is ProjectTemplateIssue => issue !== null);
  }

  /** テンプレート内の課題1件を安全に整形 */
  private normalizeTemplateIssue(value: unknown): ProjectTemplateIssue | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const record = value as Record<string, unknown>;
    const name = this.normalizeRequiredString(record['name']);
    if (!name) {
      return null;
    }
    return {
      name,
      description: this.normalizeNullableString(record['description']),
      goal: this.normalizeNullableString(record['goal']),
      themeColor: this.normalizeNullableString(record['themeColor']),
      tasks: this.normalizeTemplateTasks(record['tasks']),
    };
  }

  /** テンプレート内のタスク配列を安全に整形 */
  private normalizeTemplateTasks(value: unknown): ProjectTemplateTask[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((task) => this.normalizeTemplateTask(task))
      .filter((task): task is ProjectTemplateTask => task !== null);
  }

  /** テンプレート内のタスク1件を安全に整形 */
  private normalizeTemplateTask(value: unknown): ProjectTemplateTask | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const record = value as Record<string, unknown>;
    const title = this.normalizeRequiredString(record['title']);
    if (!title) {
      return null;
    }
    return {
      title,
      description: this.normalizeNullableString(record['description']),
      goal: this.normalizeNullableString(record['goal']),
      themeColor: this.normalizeNullableString(record['themeColor']),
      importance: this.normalizeImportance(record['importance']),
      checklist: this.normalizeChecklist(record['checklist']),
      tagIds: this.normalizeStringArray(record['tagIds']),
    };
  }

  /** 必須の文字列を正規化（空文字の場合は空文字を返す） */
  private normalizeRequiredString(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }

  /** 任意の文字列を正規化（空文字の場合はnull） */
  private normalizeNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /** タグIDなどの文字列配列を正規化 */
  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  /** 重要度を正規化 */
  private normalizeImportance(value: unknown): Importance | null {
    const allowed: Importance[] = ['Critical', 'High', 'Medium', 'Low'];
    if (typeof value === 'string' && allowed.includes(value as Importance)) {
      return value as Importance;
    }
    return null;
  }

  /** チェックリスト配列を正規化 */
  private normalizeChecklist(value: unknown): ChecklistItem[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.normalizeChecklistItem(item))
      .filter((item): item is ChecklistItem => item !== null);
  }

  /** チェックリスト項目を正規化 */
  private normalizeChecklistItem(value: unknown): ChecklistItem | null {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const record = value as Record<string, unknown>;
    const id = typeof record['id'] === 'string' ? record['id'].trim() : '';
    const text = typeof record['text'] === 'string' ? record['text'].trim() : '';
    if (!id || !text) {
      return null;
    }
    const completed = typeof record['completed'] === 'boolean' ? record['completed'] : false;
    return { id, text, completed };
  }

  /**
   * テンプレート一覧を取得（作成日の新しい順）
   * 現在のユーザーが作成したテンプレートのみを取得
   */
  async listTemplates(): Promise<ProjectTemplate[]> {
    const uid = await this.projectsService.getSignedInUid();
    const templatesRef = collection(this.db, 'projectTemplates');
    const templatesQuery = query(
      templatesRef,
      where('createdBy', '==', uid),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(templatesQuery);
    return snapshot.docs.map((doc) => this.hydrateTemplate(doc.id, doc.data() as ProjectTemplate));
  }

  /**
   * テンプレート数をカウントする
   * @returns テンプレート数
   */
  private async countTemplates(): Promise<number> {
    const templates = await this.listTemplates();
    return templates.length;
  }

  /**
   * 指定したプロジェクトからテンプレートを生成
   * 期間・担当者・進捗など、個別プロジェクトに紐づく情報は保存しない
   */
  async saveFromProject(projectId: string, templateName?: string): Promise<string> {
    const { project, uid } = await this.projectsService.ensureProjectRole(projectId, ['admin']);
    
    // テンプレート数の上限チェック（20件）
    const templateCount = await this.countTemplates();
    const MAX_TEMPLATES = 20;
    if (templateCount >= MAX_TEMPLATES) {
      throw new Error(`プロジェクトテンプレートの上限（${MAX_TEMPLATES}件）に達しています。新しいテンプレートを作成するには、既存のテンプレートを削除してください。`);
    }
    
    // プロンプトなどで入力されたテンプレート名を優先し、なければプロジェクト名を利用
    const normalizedName = templateName?.trim() ? templateName.trim() : project.name;
    
    // テンプレート名の文字数上限チェック（80文字）
    const MAX_TEMPLATE_NAME_LENGTH = 80;
    if (normalizedName.length > MAX_TEMPLATE_NAME_LENGTH) {
      throw new Error(`テンプレート名は最大${MAX_TEMPLATE_NAME_LENGTH}文字までです`);
    }
    
    // テンプレート名の重複チェック
    await this.checkNameUniqueness(normalizedName);
    
    const issuesSnapshot = await getDocs(collection(this.db, `projects/${projectId}/issues`));
    const issues = await this.buildTemplateIssues(projectId, issuesSnapshot.docs);
    const payload: Record<string, unknown> = {
      // Firestore上に保存するテンプレート名
      name: normalizedName,
      description: project.description ?? null,
      goal: project.goal ?? null,
      sourceProjectId: projectId,
      createdBy: uid,
      createdAt: serverTimestamp(),
      issues,
    };

    const ref = await addDoc(collection(this.db, 'projectTemplates'), payload);
    return ref.id;
  }

  /**
   * テンプレート名の重複をチェックする
   * 同じユーザーが同じ名前のテンプレートを作成している場合、エラーをスローする
   * @param name テンプレート名
   */
  private async checkNameUniqueness(name: string): Promise<void> {
    const templates = await this.listTemplates();
    const duplicate = templates.find(template => template.name === name);
    if (duplicate) {
      throw new Error(`テンプレート名 "${name}" は既に使用されています`);
    }
  }
  /**
   * 課題とタスクをテンプレート用に整形
   */
  private async buildTemplateIssues(
    projectId: string,
    issueDocs: { id: string; data(): unknown }[],
  ): Promise<ProjectTemplateIssue[]> {
    const results: ProjectTemplateIssue[] = [];
    for (const issueDoc of issueDocs) {
      const issueRecord = issueDoc.data() as Record<string, unknown>;
      if (typeof issueRecord['archived'] === 'boolean' && issueRecord['archived']) {
        continue;
      }

      const tasksSnapshot = await getDocs(collection(this.db, `projects/${projectId}/issues/${issueDoc.id}/tasks`));
      const tasks = this.buildTemplateTasks(tasksSnapshot.docs.map((docSnap) => docSnap.data()));

      const templateIssue = this.buildTemplateIssue(issueRecord, tasks);
      if (templateIssue) {
        results.push(templateIssue);
      }
    }
    return results;
  }

  /** 課題データをテンプレート形式へ変換 */
  private buildTemplateIssue(
    issueRecord: Record<string, unknown>,
    tasks: ProjectTemplateTask[],
  ): ProjectTemplateIssue | null {
    const name = this.normalizeRequiredString(issueRecord['name']);
    if (!name) {
      return null;
    }
    return {
      name,
      description: this.normalizeNullableString(issueRecord['description']),
      goal: this.normalizeNullableString(issueRecord['goal']),
      themeColor: this.normalizeNullableString(issueRecord['themeColor']),
      tasks,
    };
  }

  /** タスクデータをテンプレート形式へ変換 */
  private buildTemplateTasks(rawTasks: unknown[]): ProjectTemplateTask[] {
    return rawTasks
      .map((raw) => this.buildTemplateTask(raw))
      .filter((task): task is ProjectTemplateTask => task !== null);
  }

  /** タスク1件をテンプレート形式へ変換 */
  private buildTemplateTask(raw: unknown): ProjectTemplateTask | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const record = raw as Record<string, unknown>;
    if (typeof record['archived'] === 'boolean' && record['archived']) {
      return null;
    }

    const title = this.normalizeRequiredString(record['title']);
    if (!title) {
      return null;
    }
    return {
      title,
      description: this.normalizeNullableString(record['description']),
      goal: this.normalizeNullableString(record['goal']),
      themeColor: this.normalizeNullableString(record['themeColor']),
      importance: this.normalizeImportance(record['importance']),
      checklist: this.normalizeChecklist(record['checklist']),
      tagIds: this.normalizeStringArray(record['tagIds']),
    };
  }
  /**
   * 指定したテンプレートを削除
   * 作成者のみが削除可能
   */
  async deleteTemplate(templateId: string): Promise<void> {
    if (!templateId) {
      return;
    }
    const uid = await this.projectsService.getSignedInUid();
    const templateRef = doc(this.db, 'projectTemplates', templateId);
    const templateSnap = await getDoc(templateRef);
    
    if (!templateSnap.exists()) {
      throw new Error('テンプレートが見つかりません');
    }
    
    const templateData = templateSnap.data() as ProjectTemplate;
    if (templateData.createdBy !== uid) {
      throw new Error('テンプレートを削除する権限がありません');
    }
    
    await deleteDoc(templateRef);
  }
}
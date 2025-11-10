import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
  deleteDoc,
  doc,
} from '@angular/fire/firestore';
import { ProjectTemplate } from '../../models/schema';
import { ProjectsService } from './projects.service';

/**
 * プロジェクトテンプレートを管理するサービス
 * - 既存プロジェクトからテンプレートを生成
 * - テンプレート一覧を取得
 */
@Injectable({ providedIn: 'root' })
export class ProjectTemplatesService {
  private db = inject(Firestore);
  private projectsService = inject(ProjectsService);

  /** Firestoreから取得した値をDateへ正規化するユーティリティ */
  private normalizeDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
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

    const parsed = new Date(value as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

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
      createdAt: this.normalizeDate(record['createdAt']),
    };
  }

  /**
   * テンプレート一覧を取得（作成日の新しい順）
   */
  async listTemplates(): Promise<ProjectTemplate[]> {
    const templatesRef = collection(this.db, 'projectTemplates');
    const templatesQuery = query(templatesRef, orderBy('createdAt', 'desc'));
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
    const payload: Record<string, unknown> = {
      // Firestore上に保存するテンプレート名
      name: normalizedName,
      description: project.description ?? null,
      goal: project.goal ?? null,
      sourceProjectId: projectId,
      createdBy: uid,
      createdAt: serverTimestamp(),
    };

    const ref = await addDoc(collection(this.db, 'projectTemplates'), payload);
    return ref.id;
  }
  /**
   * 指定したテンプレートを削除
   */
  async deleteTemplate(templateId: string): Promise<void> {
    if (!templateId) {
      return;
    }
    const templateRef = doc(this.db, 'projectTemplates', templateId);
    await deleteDoc(templateRef);
  }
}
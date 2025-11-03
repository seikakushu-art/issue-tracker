import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
  query,
  orderBy,
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
   * 指定したプロジェクトからテンプレートを生成
   * 期間・担当者・進捗など、個別プロジェクトに紐づく情報は保存しない
   */
  async saveFromProject(projectId: string): Promise<string> {
    const { project, uid } = await this.projectsService.ensureProjectRole(projectId, ['admin']);

    const payload: Record<string, unknown> = {
      name: project.name,
      description: project.description ?? null,
      goal: project.goal ?? null,
      sourceProjectId: projectId,
      createdBy: uid,
      createdAt: serverTimestamp(),
    };

    const ref = await addDoc(collection(this.db, 'projectTemplates'), payload);
    return ref.id;
  }
}
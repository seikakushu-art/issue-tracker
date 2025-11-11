import { Injectable, inject } from '@angular/core';
import { Firestore, collection, query, getDocs, doc, updateDoc } from '@angular/fire/firestore';
import { Issue, Task } from '../../models/schema';

/**
 * 進捗率自動集計サービス
 * タスク→課題、課題→プロジェクトの進捗率を自動計算する
 */
@Injectable({ providedIn: 'root' })
export class ProgressService {
  private db = inject(Firestore);

  /**
   * 課題の進捗率を計算する（配下タスクの加重平均）
   * アーカイブされたタスクと破棄されたタスクは集計対象外
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @returns 進捗率（0-100）
   */
  async calculateIssueProgress(projectId: string, issueId: string): Promise<number> {
    try {
      // 課題配下のすべてのタスクを取得
      const tasksSnapshot = await getDocs(
        query(collection(this.db, `projects/${projectId}/issues/${issueId}/tasks`))
      );

      const tasks: Task[] = tasksSnapshot.docs.map(d => ({
        id: d.id,
        ...(d.data() as Task)
      }));

      if (tasks.length === 0) {
        return 0;
      }

      // 進捗率の加重平均を計算
      // 計算式: 各タスクの「進捗 × 重み」の合計 ÷ 重みの合計
      let totalProgressWeight = 0;
      let totalWeight = 0;

      for (const task of tasks) {
        // 重要度による重み付け（Critical=4, High=3, Medium=2, Low=1）
        const importanceWeight = this.getImportanceWeight(task.importance);
        const weight = importanceWeight || 1;  // 重みが未設定の場合は1

        // 破棄されたタスクとアーカイブされたタスクは集計対象外
        if (task.status === 'discarded' || task.archived) {
          continue;
        }

        const progress = task.progress || 0;
        totalProgressWeight += progress * weight;
        totalWeight += weight;
      }

      if (totalWeight === 0) {
        return 0;
      }

      const progress = Math.round((totalProgressWeight / totalWeight) * 10) / 10; // 小数点1位で四捨五入
      return Math.min(100, Math.max(0, progress)); // 0-100の範囲に制限
    } catch (error) {
      console.error('Error calculating issue progress:', error);
      return 0;
    }
  }

  /**
   * プロジェクトの進捗率を計算する（配下課題の加重平均）
   * 課題の重みは配下タスクの重要度から導出（配下タスクの重要度重みの平均値）
   * @param projectId プロジェクトID
   * @returns 進捗率（0-100）
   */
  async calculateProjectProgress(projectId: string): Promise<number> {
    try {
      // プロジェクト配下のすべての課題を取得
      const issuesSnapshot = await getDocs(
        query(collection(this.db, `projects/${projectId}/issues`))
      );

      const issues: Issue[] = issuesSnapshot.docs.map(d => ({
        id: d.id,
        ...(d.data() as Issue)
      }));

      // アーカイブされた課題と配下タスクが0件の課題は集計対象外
      const activeIssues = issues.filter(issue => 
        !issue.archived && issue.progress !== undefined
      );

      if (activeIssues.length === 0) {
        return 0;
      }

      // 進捗率の加重平均を計算
      let totalProgressWeight = 0;
      let totalWeight = 0;

      for (const issue of activeIssues) {
        const progress = issue.progress || 0;
        // 課題の重みは配下タスクの重要度から導出
        const weight = await this.calculateIssueWeight(projectId, issue.id!);
        
        totalProgressWeight += progress * weight;
        totalWeight += weight;
      }

      if (totalWeight === 0) {
        return 0;
      }

      const progress = Math.round((totalProgressWeight / totalWeight) * 10) / 10; // 小数点1位で四捨五入
      return Math.min(100, Math.max(0, progress)); // 0-100の範囲に制限
    } catch (error) {
      console.error('Error calculating project progress:', error);
      return 0;
    }
  }

  /**
   * 課題の重みを配下タスクの重要度から導出する
   * 配下タスクの重要度重みの平均値を課題の重みとする
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   * @returns 課題の重み（配下タスクの重要度重みの平均値、タスクがない場合は1）
   */
  private async calculateIssueWeight(projectId: string, issueId: string): Promise<number> {
    try {
      // 課題配下のすべてのタスクを取得
      const tasksSnapshot = await getDocs(
        query(collection(this.db, `projects/${projectId}/issues/${issueId}/tasks`))
      );

      const tasks: Task[] = tasksSnapshot.docs.map(d => ({
        id: d.id,
        ...(d.data() as Task)
      }));

      // アーカイブされたタスクと破棄されたタスクは集計対象外
      const activeTasks = tasks.filter(task => 
        task.status !== 'discarded' && !task.archived
      );

      if (activeTasks.length === 0) {
        return 1; // タスクがない場合は既定の重み1
      }

      // 各タスクの重要度から重みを計算し、平均値を求める
      let totalWeight = 0;
      for (const task of activeTasks) {
        const importanceWeight = this.getImportanceWeight(task.importance);
        totalWeight += importanceWeight;
      }

      const averageWeight = totalWeight / activeTasks.length;
      return averageWeight;
    } catch (error) {
      console.error('Error calculating issue weight:', error);
      return 1; // エラー時は既定の重み1
    }
  }

  /**
   * 重要度による重みを取得する
   * @param importance 重要度
   * @returns 重み（Critical=4, High=3, Medium=2, Low=1）
   */
  private getImportanceWeight(importance?: 'Critical' | 'High' | 'Medium' | 'Low'): number {
    switch (importance) {
      case 'Critical':
        return 4;
      case 'High':
        return 3;
      case 'Medium':
        return 2;
      case 'Low':
        return 1;
      default:
        return 1;
    }
  }

  /**
   * 課題配下のすべてのタスクの進捗率を再計算し、課題の進捗率を更新する
   * @param projectId プロジェクトID
   * @param issueId 課題ID
   */
  async updateIssueProgress(projectId: string, issueId: string): Promise<void> {
    const progress = await this.calculateIssueProgress(projectId, issueId);
    const docRef = doc(this.db, `projects/${projectId}/issues/${issueId}`);
    await updateDoc(docRef, { progress });
  }

  /**
   * プロジェクト配下のすべての課題の進捗率を再計算し、プロジェクトの進捗率を更新する
   * @param projectId プロジェクトID
   */
  async updateProjectProgress(projectId: string): Promise<void> {
    const progress = await this.calculateProjectProgress(projectId);
    const docRef = doc(this.db, `projects/${projectId}`);
    await updateDoc(docRef, { progress });
  }
}


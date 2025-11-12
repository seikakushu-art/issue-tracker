import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule, registerLocaleData } from '@angular/common';
import { FormsModule } from '@angular/forms';
import localeJa from '@angular/common/locales/ja';
import { Router } from '@angular/router';
import { Issue, Project, Task } from '../../models/schema';
import { ProjectsService } from '../projects/projects.service';
import { IssuesService } from '../issues/issues.service';
import { TasksService } from '../tasks/tasks.service';
import { resolveIssueThemeColor, tintIssueThemeColor, transparentizeIssueThemeColor } from '../../shared/issue-theme';
import { TaskDetailPanelComponent } from '../tasks/task-detail-panel/task-detail-panel.component';
import { UserDirectoryService, UserDirectoryProfile } from '../../core/user-directory.service';
import { getAvatarColor, getAvatarInitial } from '../../shared/avatar-utils';

registerLocaleData(localeJa);

interface DependencyDisplay {
  id: string;
  label: string;
  type: 'predecessor' | 'successor';
}

interface TreeTask {
  task: Task;
  dependencies: DependencyDisplay[];
  dependents: DependencyDisplay[];
}

interface TreeIssue {
  issue: Issue;
  tasks: TreeTask[];
  collapsed: boolean;
}

interface TreeProject {
  project: Project;
  issues: TreeIssue[];
  collapsed: boolean;
}

interface ProjectFilterOption {
  id: string;
  label: string;
}


@Component({
  selector: 'app-progress-tree',
  standalone: true,
  imports: [CommonModule, FormsModule, TaskDetailPanelComponent],
  templateUrl: './progress-tree.component.html',
  styleUrls: ['./progress-tree.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgressTreeComponent implements OnInit {
  private projectsService = inject(ProjectsService);
  private issuesService = inject(IssuesService);
  private tasksService = inject(TasksService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private userDirectoryService = inject(UserDirectoryService);

  loading = false;
  loadError: string | null = null;
  sampleNotice: string | null = null;

  treeProjects: TreeProject[] = [];

  // 担当者プロフィール情報を保持
  assigneeProfiles: Record<string, UserDirectoryProfile> = {};

  // パネル表示用の選択中データを保持
  selectedTreeTask: TreeTask | null = null;
  selectedTask: Task | null = null;
  selectedIssue: Issue | null = null;
  selectedProject: Project | null = null;

  projectFilterId = 'all';
  projectFilterOptions: ProjectFilterOption[] = [
    { id: 'all', label: 'すべてのプロジェクト' },
  ];

  readonly tokyoTimezone = 'Asia/Tokyo';

  ngOnInit(): void {
    void this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading = true;
    this.loadError = null;
    this.sampleNotice = null;
    this.treeProjects = [];
     // データ再取得時は選択状態も初期化
     this.selectedTreeTask = null;
     this.selectedTask = null;
     this.selectedIssue = null;
     this.selectedProject = null;

    try {
      const projects = (await this.projectsService
        .listMyProjects())
        .filter((project): project is Project & { id: string } => Boolean(project.id))
        .filter((project) => !project.archived);

      const taskIndex = new Map<string, { title: string; issue: Issue; project: Project }>();
      const treeProjects: TreeProject[] = [];

      // プロジェクトごとにissuesとtasksを並列取得
      const projectDataResults = await Promise.all(
        projects.map(async (project) => {
          const [issues, allTasks] = await Promise.all([
            this.issuesService.listIssues(project.id!, false),
            this.tasksService.listTasksByProject(project.id!, false),
          ]);
          return { project, issues, allTasks };
        }),
      );

      for (const { project, issues, allTasks } of projectDataResults) {
        const treeIssues: TreeIssue[] = [];

        for (const issue of issues) {
          if (!issue.id) {
            continue;
          }
          // プロジェクト単位で取得したタスクから、該当issueのタスクをフィルタリング
          const tasks = allTasks.filter((task) => task.issueId === issue.id);
          const normalizedTasks = tasks.map((task) => this.normalizeTaskDates(task));

          for (const task of normalizedTasks) {
            if (task.id) {
              taskIndex.set(task.id, { title: task.title, issue, project });
            }
          }

          const treeTasks: TreeTask[] = normalizedTasks.map((task) => ({
            task,
            dependencies: [],
            dependents: [],
          }));

          treeIssues.push({
            issue,
            tasks: treeTasks,
            collapsed: false,
          });
        }

        treeProjects.push({
          project,
          issues: treeIssues,
          collapsed: false,
        });
      }

      for (const treeProject of treeProjects) {
        for (const treeIssue of treeProject.issues) {
          treeIssue.tasks = treeIssue.tasks.map((treeTask) => ({
            task: treeTask.task,
            dependencies: this.resolveDependencies(treeTask.task, taskIndex, 'dependencies'),
            dependents: this.resolveDependencies(treeTask.task, taskIndex, 'dependents'),
          }));
        }
      }

      // 担当者のプロフィール情報を取得
      await this.loadAssigneeProfiles(treeProjects);

      if (this.hasAnyTasks(treeProjects)) {
        this.treeProjects = treeProjects;
        this.updateProjectFilterOptions(treeProjects);
      } else {
        this.applySampleData('empty');
      }
    } catch (error) {
      console.error('ツリー図のデータ取得に失敗しました:', error);
      this.loadError = 'リアルデータの取得に失敗しました。';
      this.applySampleData('error');
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  toggleProject(group: TreeProject): void {
    group.collapsed = !group.collapsed;
  }

  toggleIssue(group: TreeIssue): void {
    group.collapsed = !group.collapsed;
  }

  selectTask(project: TreeProject, issue: TreeIssue, treeTask: TreeTask): void {
   // 必須情報が欠けている場合は選択処理を行わない
   if (!project.project.id || !issue.issue.id || !treeTask.task.id) {
    return;
  }
  // 選択中のタスク情報をまとめて保持（詳細パネル描画用）
  this.selectedTreeTask = treeTask;
  this.selectedTask = treeTask.task;
  this.selectedIssue = issue.issue;
  this.selectedProject = project.project;
  this.cdr.markForCheck();
}

closeDetailPanel(): void {
  // パネルを閉じた際は状態をクリア
  this.selectedTreeTask = null;
  this.selectedTask = null;
  this.selectedIssue = null;
  this.selectedProject = null;
  this.cdr.markForCheck();
}

handleTaskDetailUpdate(updatedTask: Task): void {
  if (!updatedTask.id) {
    return;
  }

  if (this.selectedTask?.id === updatedTask.id) {
    this.selectedTask = { ...this.selectedTask, ...updatedTask };
  }
  if (this.selectedTreeTask?.task.id === updatedTask.id) {
    this.selectedTreeTask = {
      ...this.selectedTreeTask,
      task: { ...this.selectedTreeTask.task, ...updatedTask },
    };
  }

  for (const project of this.treeProjects) {
    if (!project.project.id || project.project.id !== updatedTask.projectId) {
      continue;
    }
    for (const issue of project.issues) {
      if (!issue.issue.id || issue.issue.id !== updatedTask.issueId) {
        continue;
      }
      const target = issue.tasks.find((treeTask) => treeTask.task.id === updatedTask.id);
      if (target) {
        target.task = { ...target.task, ...updatedTask };
      }
    }
  }

  // 新しい担当者のプロフィール情報を取得
  if (updatedTask.assigneeIds && updatedTask.assigneeIds.length > 0) {
    void this.loadAssigneeProfilesForTask(updatedTask);
  }

  this.cdr.markForCheck();
}

handleDetailEditRequest(): void {
  if (!this.selectedProject?.id || !this.selectedIssue?.id || !this.selectedTask?.id) {
    return;
  }
  void this.router.navigate([
    '/projects',
    this.selectedProject.id,
    'issues',
    this.selectedIssue.id,
  ], {
    queryParams: { focus: this.selectedTask.id },
  });
}

goToTaskDetail(): void {
  // 詳細ページ遷移は明示的なアクション時にのみ実施
  const taskId = this.selectedTask?.id;
  const issueId = this.selectedIssue?.id;
  const projectId = this.selectedProject?.id;
  if (!taskId || !issueId || !projectId) {
      return;
    }
    void this.router.navigate([
      '/projects',
      projectId,
      'issues',
      issueId,
    ], {
      queryParams: { focus: taskId },
    });
  }

  getTaskStatusLabel(task: Task): string {
    switch (task.status) {
      case 'in_progress':
        return '進行中';
      case 'completed':
        return '完了';
      case 'on_hold':
        return '保留';
      case 'discarded':
        return '破棄';
      default:
        return '未完了';
    }
  }

  getImportanceLabel(task: Task): string {
    switch (task.importance) {
      case 'Critical':
        return '至急重要';
      case 'High':
        return '至急';
      case 'Medium':
        return '重要';
      case 'Low':
      default:
        return '普通';
    }
  }

  getStatusClass(task: Task): string {
    switch (task.status) {
      case 'completed':
        return 'status-completed';
      case 'in_progress':
        return 'status-in-progress';
      case 'on_hold':
        return 'status-on-hold';
      case 'discarded':
        return 'status-discarded';
      default:
        return 'status-incomplete';
    }
  }

  getIssueTheme(issue: Issue): string {
    const fallbackKey = issue.id ?? issue.projectId ?? issue.name ?? null;
    return resolveIssueThemeColor(issue.themeColor ?? null, fallbackKey);
  }

  getIssueSurfaceColor(issue: Issue): string {
    return tintIssueThemeColor(this.getIssueTheme(issue), 0.82);
  }

  getIssueOverlayColor(issue: Issue): string {
    return transparentizeIssueThemeColor(this.getIssueTheme(issue), 0.2);
  }

  getTaskSurfaceColor(issue: Issue): string {
    return tintIssueThemeColor(this.getIssueTheme(issue), 0.92);
  }

  getTaskOverlayColor(issue: Issue): string {
    return transparentizeIssueThemeColor(this.getIssueTheme(issue), 0.18);
  }

  hasDependencies(treeTask: TreeTask): boolean {
    return treeTask.dependencies.length > 0 || treeTask.dependents.length > 0;
  }

  private hasAnyTasks(projects: TreeProject[]): boolean {
    return projects.some((project) =>
      project.issues.some((issue) => issue.tasks.length > 0)
    );
  }

  get displayedTreeProjects(): TreeProject[] {
    if (this.projectFilterId === 'all') {
      return this.treeProjects;
    }

    return this.treeProjects.filter((treeProject) => treeProject.project.id === this.projectFilterId);
  }

  onProjectFilterChange(value: string): void {
    this.projectFilterId = value;
  }

  private updateProjectFilterOptions(treeProjects: TreeProject[]): void {
    const options = treeProjects
      .map((treeProject) => treeProject.project)
      .filter((project): project is Project & { id: string } => Boolean(project.id))
      .map((project) => ({
        id: project.id!,
        label: project.name,
      }));

    this.projectFilterOptions = [
      { id: 'all', label: 'すべてのプロジェクト' },
      ...options,
    ];

    if (this.projectFilterId !== 'all' && !options.some((option) => option.id === this.projectFilterId)) {
      this.projectFilterId = 'all';
    }
  }


  private resolveDependencies(task: Task, index: Map<string, { title: string; issue: Issue; project: Project }>, key: 'dependencies' | 'dependents'):
    DependencyDisplay[] {
    const raw = (task as unknown as Record<string, unknown>)[key];

    if (!raw) {
      return [];
    }

    let ids: string[] = [];

    if (Array.isArray(raw)) {
      ids = raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    } else if (typeof raw === 'string' && raw.trim().length > 0) {
      ids = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
    } else if (typeof raw === 'object') {
      ids = Object.values(raw)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    }

    return ids.map((id) => {
      const related = index.get(id);
      const label = related
        ? `${related.project.name} / ${related.issue.name} / ${related.title}`
        : `未特定のタスク（ID: ${id}）`;

      return {
        id,
        label,
        type: key === 'dependencies' ? 'predecessor' : 'successor',
      };
    });
  }

  private normalizeTaskDates(task: Task): Task {
    const clone: Task = { ...task };
    if (clone.startDate instanceof Date) {
      clone.startDate = Number.isNaN(clone.startDate.getTime()) ? null : this.toTokyoDate(clone.startDate);
    } else if (typeof clone.startDate === 'string') {
      const parsed = new Date(clone.startDate);
      clone.startDate = Number.isNaN(parsed.getTime()) ? null : this.toTokyoDate(parsed);
    }
    if (clone.endDate instanceof Date) {
      clone.endDate = Number.isNaN(clone.endDate.getTime()) ? null : this.toTokyoDate(clone.endDate);
    } else if (typeof clone.endDate === 'string') {
      const parsed = new Date(clone.endDate);
      clone.endDate = Number.isNaN(parsed.getTime()) ? null : this.toTokyoDate(parsed);
    }
    return clone;
  }

  private toTokyoDate(date: Date): Date {
    if (Number.isNaN(date.getTime())) {
      return date;
    }
    // 東京時間での日付部分を取得
    const formatter = new Intl.DateTimeFormat('ja-JP', {
      timeZone: this.tokyoTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = parseInt(parts.find((p) => p.type === 'year')!.value, 10);
    const month = parseInt(parts.find((p) => p.type === 'month')!.value, 10) - 1; // 0-indexed
    const day = parseInt(parts.find((p) => p.type === 'day')!.value, 10);
    return new Date(Date.UTC(year, month, day));
  }

  /** 担当者のプロフィール情報を取得 */
  private async loadAssigneeProfiles(treeProjects: TreeProject[]): Promise<void> {
    const assigneeIds = new Set<string>();
    for (const project of treeProjects) {
      for (const issue of project.issues) {
        for (const treeTask of issue.tasks) {
          if (treeTask.task.assigneeIds) {
            for (const assigneeId of treeTask.task.assigneeIds) {
              if (assigneeId) {
                assigneeIds.add(assigneeId);
              }
            }
          }
        }
      }
    }

    if (assigneeIds.size === 0) {
      this.assigneeProfiles = {};
      return;
    }

    try {
      const profiles = await this.userDirectoryService.getProfiles(Array.from(assigneeIds));
      const profileMap: Record<string, UserDirectoryProfile> = {};
      for (const profile of profiles) {
        profileMap[profile.uid] = profile;
      }
      this.assigneeProfiles = profileMap;
    } catch (error) {
      console.error('担当者プロフィールの取得に失敗しました:', error);
      this.assigneeProfiles = {};
    }
  }

  /** 特定タスクの担当者プロフィール情報を取得（更新時用） */
  private async loadAssigneeProfilesForTask(task: Task): Promise<void> {
    if (!task.assigneeIds || task.assigneeIds.length === 0) {
      return;
    }

    // 既に取得済みの担当者はスキップ
    const missingIds = task.assigneeIds.filter((id) => !this.assigneeProfiles[id]);
    if (missingIds.length === 0) {
      return;
    }

    try {
      const profiles = await this.userDirectoryService.getProfiles(missingIds);
      const updatedProfiles = { ...this.assigneeProfiles };
      for (const profile of profiles) {
        updatedProfiles[profile.uid] = profile;
      }
      this.assigneeProfiles = updatedProfiles;
      this.cdr.markForCheck();
    } catch (error) {
      console.error('担当者プロフィールの取得に失敗しました:', error);
    }
  }

  /** 担当者の表示名を取得 */
  getAssigneeDisplayName(uid: string): string {
    const profile = this.assigneeProfiles[uid];
    if (profile?.username && profile.username.trim().length > 0) {
      return profile.username;
    }
    return uid;
  }

  /** 担当者の写真URLを取得 */
  getAssigneePhotoUrl(uid: string): string | null {
    const photoUrl = this.assigneeProfiles[uid]?.photoURL;
    return typeof photoUrl === 'string' && photoUrl.trim().length > 0 ? photoUrl : null;
  }

  /** 担当者のイニシャルを取得 */
  getAssigneeInitial(uid: string): string {
    const profile = this.assigneeProfiles[uid];
    const source = profile?.username && profile.username.trim().length > 0 ? profile.username : uid;
    return getAvatarInitial(source, '?');
  }

  /** 担当者のアバター色を取得 */
  getAssigneeAvatarColor(uid: string): string {
    return getAvatarColor(uid);
  }

  private createSampleDate(base: Date, offset: number): Date {
    const result = new Date(base);
    result.setUTCDate(result.getUTCDate() + offset);
    return result;
  }

  private applySampleData(reason: 'error' | 'empty'): void {
    this.sampleNotice =
      reason === 'error'
        ? '問題の再現用にサンプルデータを表示しています。'
        : 'まだ実データが登録されていないため、サンプルデータを表示しています。';

    const base = this.toTokyoDate(new Date());

    const projectAlpha: Project = {
      id: 'sample-project-alpha',
      name: 'サンプルプロジェクトA',
      description: 'デモ用のプロジェクトA',
      memberIds: [],
      roles: {},
      archived: false,
      progress: 55,
    };

    const projectBeta: Project = {
      id: 'sample-project-beta',
      name: 'サンプルプロジェクトB',
      description: 'デモ用のプロジェクトB',
      memberIds: [],
      roles: {},
      archived: false,
      progress: 30,
    };

    const issueAlpha1: Issue = {
      id: 'sample-issue-alpha-1',
      projectId: projectAlpha.id!,
      name: 'UI改善イニシアチブ',
      description: '主要画面のUIを段階的に改善します。',
      startDate: this.createSampleDate(base, -14),
      endDate: this.createSampleDate(base, 14),
      goal: '第1四半期中に主要画面の改善を完了する',
      themeColor: '#2563eb',
      archived: false,
      progress: 60,
    };

    const issueAlpha2: Issue = {
      id: 'sample-issue-alpha-2',
      projectId: projectAlpha.id!,
      name: 'アクセシビリティ強化',
      description: 'WCAG 2.1 AAに準拠させる。',
      startDate: this.createSampleDate(base, -7),
      endDate: this.createSampleDate(base, 21),
      goal: 'AAレベルの達成',
      themeColor: '#10b981',
      archived: false,
      progress: 40,
    };

    const issueBeta1: Issue = {
      id: 'sample-issue-beta-1',
      projectId: projectBeta.id!,
      name: '新機能 PoC',
      description: 'PoC を実施し、採用可否を判断。',
      startDate: this.createSampleDate(base, -3),
      endDate: this.createSampleDate(base, 28),
      goal: '技術的な成立性の検証',
      themeColor: '#f97316',
      archived: false,
      progress: 25,
    };

    const tasksAlpha1: (Task & { dependencies?: string[]; dependents?: string[] })[] = [
      {
        id: 'sample-task-alpha-1',
        projectId: projectAlpha.id!,
        issueId: issueAlpha1.id!,
        title: '画面レイアウト策定',
        description: 'ワイヤーフレームを作成し、関係者レビューを通過。',
        startDate: this.createSampleDate(base, -12),
        endDate: this.createSampleDate(base, -6),
        goal: 'レビュー合格',
        importance: 'High',
        status: 'completed',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
        dependencies: [],
        dependents: ['sample-task-alpha-2'],
      },
      {
        id: 'sample-task-alpha-2',
        projectId: projectAlpha.id!,
        issueId: issueAlpha1.id!,
        title: 'コンポーネント設計',
        description: '再利用可能なUIコンポーネントの仕様を整理。',
        startDate: this.createSampleDate(base, -5),
        endDate: this.createSampleDate(base, 4),
        goal: '主要部品の設計完了',
        importance: 'Critical',
        status: 'in_progress',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
        dependencies: ['sample-task-alpha-1'],
        dependents: ['sample-task-alpha-3'],
      },
      {
        id: 'sample-task-alpha-3',
        projectId: projectAlpha.id!,
        issueId: issueAlpha1.id!,
        title: 'ユーザーテスト準備',
        description: '想定シナリオとテスト環境を準備。',
        startDate: this.createSampleDate(base, 3),
        endDate: this.createSampleDate(base, 12),
        goal: 'テスト計画の承認',
        importance: 'Medium',
        status: 'incomplete',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
        dependencies: ['sample-task-alpha-2'],
        dependents: [],
      },
    ];

    const tasksAlpha2: (Task & { dependencies?: string[]; dependents?: string[] })[] = [
      {
        id: 'sample-task-alpha-4',
        projectId: projectAlpha.id!,
        issueId: issueAlpha2.id!,
        title: '色コントラスト監査',
        description: '既存画面のコントラスト比を測定。',
        startDate: this.createSampleDate(base, -2),
        endDate: this.createSampleDate(base, 5),
        goal: '主要画面の改善箇所抽出',
        importance: 'Medium',
        status: 'in_progress',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
        dependencies: [],
        dependents: ['sample-task-alpha-5'],
      },
      {
        id: 'sample-task-alpha-5',
        projectId: projectAlpha.id!,
        issueId: issueAlpha2.id!,
        title: 'キーボード操作検証',
        description: '主要操作をキーボードのみで完遂できるか確認。',
        startDate: this.createSampleDate(base, 6),
        endDate: this.createSampleDate(base, 14),
        goal: '重要操作の改善完了',
        importance: 'High',
        status: 'incomplete',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
        dependencies: ['sample-task-alpha-4'],
        dependents: [],
      },
    ];

    const tasksBeta1: (Task & { dependencies?: string[]; dependents?: string[] })[] = [
      {
        id: 'sample-task-beta-1',
        projectId: projectBeta.id!,
        issueId: issueBeta1.id!,
        title: 'PoC 要件定義',
        description: 'スコープと成功基準を策定。',
        startDate: this.createSampleDate(base, -1),
        endDate: this.createSampleDate(base, 4),
        goal: '要件合意',
        importance: 'High',
        status: 'in_progress',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
        dependencies: [],
        dependents: ['sample-task-beta-2'],
      },
      {
        id: 'sample-task-beta-2',
        projectId: projectBeta.id!,
        issueId: issueBeta1.id!,
        title: 'プロトタイプ作成',
        description: '検証用の最小構成を構築。',
        startDate: this.createSampleDate(base, 5),
        endDate: this.createSampleDate(base, 18),
        goal: '主要シナリオの実装',
        importance: 'Critical',
        status: 'incomplete',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
        dependencies: ['sample-task-beta-1'],
        dependents: ['sample-task-beta-3'],
      },
      {
        id: 'sample-task-beta-3',
        projectId: projectBeta.id!,
        issueId: issueBeta1.id!,
        title: '評価とフィードバック',
        description: 'ステークホルダーによる評価を実施。',
        startDate: this.createSampleDate(base, 19),
        endDate: this.createSampleDate(base, 28),
        goal: '採用可否の判断材料収集',
        importance: 'Medium',
        status: 'incomplete',
        archived: false,
        assigneeIds: [],
        tagIds: [],
        checklist: [],
        createdBy: 'system',
        dependencies: ['sample-task-beta-2'],
        dependents: [],
      },
    ];

    const index = new Map<string, { title: string; issue: Issue; project: Project }>();
    const allTasks = [...tasksAlpha1, ...tasksAlpha2, ...tasksBeta1];
    for (const task of allTasks) {
      index.set(task.id!, {
        title: task.title,
        issue: [issueAlpha1, issueAlpha2, issueBeta1].find((issue) => issue.id === task.issueId)!,
        project: [projectAlpha, projectBeta].find((project) => project.id === task.projectId)!,
      });
    }

    this.treeProjects = [
      {
        project: projectAlpha,
        issues: [
          {
            issue: issueAlpha1,
            tasks: tasksAlpha1.map((task) => ({
              task: this.normalizeTaskDates(task),
              dependencies: this.resolveDependencies(task, index, 'dependencies'),
              dependents: this.resolveDependencies(task, index, 'dependents'),
            })),
            collapsed: false,
          },
          {
            issue: issueAlpha2,
            tasks: tasksAlpha2.map((task) => ({
              task: this.normalizeTaskDates(task),
              dependencies: this.resolveDependencies(task, index, 'dependencies'),
              dependents: this.resolveDependencies(task, index, 'dependents'),
            })),
            collapsed: false,
          },
        ],
        collapsed: false,
      },
      {
        project: projectBeta,
        issues: [
          {
            issue: issueBeta1,
            tasks: tasksBeta1.map((task) => ({
              task: this.normalizeTaskDates(task),
              dependencies: this.resolveDependencies(task, index, 'dependencies'),
              dependents: this.resolveDependencies(task, index, 'dependents'),
            })),
            collapsed: false,
          },
        ],
        collapsed: false,
      },
    ];
    this.updateProjectFilterOptions(this.treeProjects);
    this.cdr.markForCheck();
  }
}
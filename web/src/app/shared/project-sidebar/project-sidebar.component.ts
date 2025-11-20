import { Component, Input, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ProjectsService } from '../../features/projects/projects.service';
import { Project, Role } from '../../models/schema';
import { IssuesService } from '../../features/issues/issues.service';
import { Firestore, collection, query, where, onSnapshot, Unsubscribe } from '@angular/fire/firestore';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { normalizeDate } from '../date-utils';

/**
 * プロジェクトを一覧表示するサイドバー。
 * 左側に固定表示し、課題・タスク画面共通で利用する。
 */
@Component({
  selector: 'app-project-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './project-sidebar.component.html',
  styleUrls: ['./project-sidebar.component.scss'],
})
export class ProjectSidebarComponent implements OnInit, OnDestroy {
  private projectsService = inject(ProjectsService);
  private router = inject(Router);
  private issuesService = inject(IssuesService);
  private db = inject(Firestore);
  private auth = inject(Auth);

  /** 現在選択中のプロジェクトID。アクティブ表示に利用する。 */
  @Input() currentProjectId: string | null = null;

  /** 一覧表示用のプロジェクト配列。 */
  projects: Project[] = [];

  /** 読み込み結果の生データを保持し、都度ソートし直せるようにしておく。 */
  private rawProjects: Project[] = [];

  /** 並び替え対象の項目。画面と同様の選択肢を提供する。 */
  sortBy: 'name' | 'startDate' | 'endDate' | 'progress' | 'createdAt' | 'period' | 'issueCount' | 'memberCount' = 'name';

  /** 昇順・降順の指定。 */
  sortOrder: 'asc' | 'desc' = 'asc';

  /** 課題数ソート用のキャッシュ。 */
  private issueCountMap = new Map<string, number>();

  /** 課題数の読み込み処理が進行中かどうか。 */
  private issueCountLoading = false;

  /** ロード状態のフラグ。 */
  loading = false;

  /** エラー発生時のメッセージを控える。 */
  loadError = '';

  /** サイドバーの折り畳み状態 */
  collapsed = false;

  /** Firestoreリアルタイムリスナーの購読解除関数 */
  private unsubscribe: Unsubscribe | undefined;

  /** localStorage用のキー */
  private readonly SORT_BY_KEY = 'project-sidebar-sort-by';
  private readonly SORT_ORDER_KEY = 'project-sidebar-sort-order';
  private readonly COLLAPSED_KEY = 'project-sidebar-collapsed';

  ngOnInit(): void {
    this.loadSortPreferences();
    this.loadCollapsedState();
    this.setupRealtimeListener();
  }

  ngOnDestroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }

  /**
   * Firestoreのリアルタイムリスナーを設定する
   */
  private setupRealtimeListener(): void {
    this.loading = true;
    this.loadError = '';

    onAuthStateChanged(this.auth, (user) => {
      // 既存の購読を解除
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = undefined;
      }

      if (!user) {
        this.loading = false;
        this.projects = [];
        this.rawProjects = [];
        return;
      }

      const q = query(
        collection(this.db, 'projects'),
        where('memberIds', 'array-contains', user.uid)
      );

      this.unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          try {
            const projects = snapshot.docs.map((doc) =>
              this.hydrateProject(doc.id, doc.data() as Project, user.uid)
            );
            // アーカイブされたプロジェクトを除外
            this.rawProjects = projects.filter(project => !project.archived);
            this.applySorting();
            // 課題数ソートで必要となる情報は裏で取得し、完了したら必要に応じて再ソートする。
            void this.prepareIssueCounts(this.rawProjects);
            this.loadError = '';
          } catch (error) {
            console.error('プロジェクト一覧の処理に失敗しました:', error);
            this.loadError = 'プロジェクト一覧を読み込めませんでした';
          } finally {
            this.loading = false;
          }
        },
        (error) => {
          console.error('プロジェクト一覧の取得に失敗しました:', error);
          this.loading = false;
          this.loadError = 'プロジェクト一覧を読み込めませんでした';
          this.projects = [];
          this.rawProjects = [];
        }
      );
    });
  }

  /**
   * Firestoreから受け取った生のプロジェクトデータを画面で扱いやすい形に整形する
   * ProjectsServiceのhydrateProjectと同じロジック
   */
  private hydrateProject(id: string, data: Project, uid: string): Project {
    const dataRecord = data as unknown as Record<string, unknown>;
    const memberIds = (dataRecord['memberIds'] as string[] | undefined) ?? [];
    const roles = (dataRecord['roles'] as Record<string, Role> | undefined) ?? {};
    const project: Project = {
      ...data,
      id,
      memberIds,
      roles,
      startDate: normalizeDate(dataRecord['startDate']),
      endDate: normalizeDate(dataRecord['endDate']),
      createdAt: normalizeDate(dataRecord['createdAt']),
      progress: (dataRecord['progress'] as number) ?? 0,
      archived: (dataRecord['archived'] as boolean) ?? false,
      pinnedBy: (dataRecord['pinnedBy'] as string[] | undefined) ?? [],
    };
    project.currentRole = this.resolveRoleForUser(project, uid) ?? undefined;
    return project;
  }

  /**
   * プロジェクトからユーザーの役割を解決する
   */
  private resolveRoleForUser(project: Project, uid: string): Role | null {
    const roles = project.roles ?? {};
    return roles[uid] ?? null;
  }

  /** 並び替え指定が変わったときに都度適用する。 */
  onSortChange(): void {
    this.saveSortPreferences();
    this.applySorting();
  }

  /**
   * localStorageから並び替え設定を読み込む
   */
  private loadSortPreferences(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const savedSortBy = window.localStorage.getItem(this.SORT_BY_KEY);
      const savedSortOrder = window.localStorage.getItem(this.SORT_ORDER_KEY);
      
      if (savedSortBy && ['name', 'startDate', 'endDate', 'progress', 'createdAt', 'period', 'issueCount', 'memberCount'].includes(savedSortBy)) {
        this.sortBy = savedSortBy as typeof this.sortBy;
      }
      if (savedSortOrder && ['asc', 'desc'].includes(savedSortOrder)) {
        this.sortOrder = savedSortOrder as typeof this.sortOrder;
      }
    } catch (error) {
      console.warn('並び替え設定の読み込みに失敗しました:', error);
    }
  }

  /**
   * 並び替え設定をlocalStorageに保存する
   */
  private saveSortPreferences(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(this.SORT_BY_KEY, this.sortBy);
      window.localStorage.setItem(this.SORT_ORDER_KEY, this.sortOrder);
    } catch (error) {
      console.warn('並び替え設定の保存に失敗しました:', error);
    }
  }

  /**
   * localStorageから折り畳み状態を読み込む
   */
  private loadCollapsedState(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const saved = window.localStorage.getItem(this.COLLAPSED_KEY);
      if (saved === 'true') {
        this.collapsed = true;
      }
    } catch (error) {
      console.warn('折り畳み状態の読み込みに失敗しました:', error);
    }
  }

  /**
   * 折り畳み状態をlocalStorageに保存する
   */
  private saveCollapsedState(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(this.COLLAPSED_KEY, String(this.collapsed));
    } catch (error) {
      console.warn('折り畳み状態の保存に失敗しました:', error);
    }
  }

  /**
   * サイドバーの折り畳み状態を切り替える
   */
  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.saveCollapsedState();
  }

  /** 選択中の条件に基づいてプロジェクト一覧を並べ替える。 */
  private applySorting(): void {
    if (!this.rawProjects || this.rawProjects.length === 0) {
      this.projects = [];
      return;
    }

    // 課題数でのソートが指定されており、まだ取得できていない場合は取得を促す。
    if (this.sortBy === 'issueCount' && !this.issueCountLoading && this.issueCountMap.size === 0) {
      void this.prepareIssueCounts(this.rawProjects);
    }

    const sorted = [...this.rawProjects].sort((a, b) => {
      const aValue = this.resolveSortValue(a);
      const bValue = this.resolveSortValue(b);

      if (aValue < bValue) {
        return this.sortOrder === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return this.sortOrder === 'asc' ? 1 : -1;
      }
      return 0;
    });

    this.projects = sorted;
  }

  /** 指定されたプロジェクトの並び替え用数値を求める。 */
  private resolveSortValue(project: Project): string | number | Date {
    switch (this.sortBy) {
      case 'name':
        return project.name || '';
      case 'startDate':
        return normalizeDate(project.startDate) ?? new Date(0);
      case 'endDate':
        return normalizeDate(project.endDate) ?? new Date(0);
      case 'progress':
        return project.progress ?? 0;
      case 'createdAt':
        return normalizeDate(project.createdAt) ?? new Date(0);
      case 'period':
        return this.getProjectDuration(project);
      case 'issueCount':
        return this.issueCountMap.get(project.id ?? '') ?? 0;
      case 'memberCount':
        return project.memberIds?.length ?? 0;
      default:
        return 0;
    }
  }

  /** プロジェクト期間（日数）を算出する。 */
  private getProjectDuration(project: Project): number {
    const start = normalizeDate(project.startDate);
    const end = normalizeDate(project.endDate);
    if (!start || !end) {
      return 0;
    }
    const diff = end.getTime() - start.getTime();
    return diff > 0 ? Math.round(diff / (1000 * 60 * 60 * 24)) : 0;
  }


  /** 課題数が必要な場合にまとめて取得しキャッシュする。 */
  private async prepareIssueCounts(projects: Project[]): Promise<void> {
    if (this.issueCountLoading || !projects || projects.length === 0) {
      return;
    }
    this.issueCountLoading = true;
    try {
      const results = await Promise.all(
        projects
          .filter((project): project is Project & { id: string } => Boolean(project.id))
          .map(async (project) => {
            try {
              const count = await this.issuesService.countIssues(project.id, false);
              return { id: project.id, count };
            } catch (error) {
              console.error('課題数の取得に失敗しました:', project.id, error);
              return { id: project.id, count: 0 };
            }
          }),
      );

      this.issueCountMap = results.reduce((map, entry) => {
        map.set(entry.id, entry.count);
        return map;
      }, new Map<string, number>());

      if (this.sortBy === 'issueCount') {
        this.applySorting();
      }
    } finally {
      this.issueCountLoading = false;
    }
  }


  /** ループのtrackByでIDを利用して再描画負荷を抑える。 */
  trackByProjectId(_: number, project: Project): string | number {
    return project.id ?? _;
  }

  /**
   * プロジェクト作成導線。既存の一覧画面へ遷移し、作成モーダルを開ける。
   */
  async openCreateProject(): Promise<void> {
    await this.router.navigate(['/projects'], { queryParams: { create: 'true' } });
  }
}
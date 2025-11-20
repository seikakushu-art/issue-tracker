import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router, RouterModule } from '@angular/router';
import { BoardService } from '../board/board.service';
import { IssuesService } from '../issues/issues.service';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { Issue, Project, Task } from '../../models/schema';

type SearchResultType = 'project' | 'issue' | 'task' | 'board';

interface SearchResultItem {
  id: string;
  type: SearchResultType;
  title: string;
  context?: string;
  description?: string;
  routerLink: (string | number)[];
  fragment?: string;
  queryParams?: Record<string, string>;
  titleLower: string;
  contextLower: string | null;
  descriptionLower: string | null;
}

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './global-search.component.html',
  styleUrls: ['./global-search.component.scss'],
})
export class GlobalSearchComponent implements OnInit {
  private readonly projectsService = inject(ProjectsService);
  private readonly issuesService = inject(IssuesService);
  private readonly tasksService = inject(TasksService);
  private readonly boardService = inject(BoardService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly router = inject(Router);

  readonly query = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly includeArchived = signal(false);
  readonly typeFilters = signal<Record<SearchResultType, boolean>>({
    project: true,
    issue: true,
    task: true,
    board: true,
  });
  private readonly items = signal<SearchResultItem[]>([]);

  private readonly typeLabels: Record<SearchResultType, string> = {
    project: 'プロジェクト',
    issue: '課題',
    task: 'タスク',
    board: '掲示板',
  };

  readonly filteredResults = computed(() => {
    const keyword = this.normalizeForSearch(this.query().trim());
    const allItems = this.items();
    const typeFilters = this.typeFilters();
    
    // まずタイプフィルタを適用
    let filtered = allItems.filter((item) => typeFilters[item.type]);
    
    // 次にキーワードフィルタを適用
    if (keyword) {
      filtered = filtered.filter((item) => {
        if (item.titleLower.includes(keyword)) {
          return true;
        }
        if (item.contextLower && item.contextLower.includes(keyword)) {
          return true;
        }
        if (item.descriptionLower && item.descriptionLower.includes(keyword)) {
          return true;
        }
        return false;
      });
    }
    
    return filtered;
  });

  readonly countsByType = computed(() => {
    const counts: Record<SearchResultType, number> = {
      project: 0,
      issue: 0,
      task: 0,
      board: 0,
    };
    for (const item of this.filteredResults()) {
      counts[item.type] += 1;
    }
    return counts;
  });

  readonly totalCount = computed(() => this.filteredResults().length);

  readonly typeOrder: SearchResultType[] = ['project', 'issue', 'task', 'board'];

  ngOnInit(): void {
    void this.loadAllData();
  }

  onResultClick(item: SearchResultItem, event: Event): void {
    // プロジェクトページへの遷移時にスクロール
    if (item.type === 'project') {
      // 遷移完了後にスクロール
      this.router.navigate(item.routerLink, { fragment: item.fragment }).then(() => {
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);
      });
      event.preventDefault();
    } else if (item.type === 'board' && item.fragment) {
      // 掲示板の場合は、fragmentの要素にスクロール
      this.router.navigate(item.routerLink, { fragment: item.fragment }).then(() => {
        setTimeout(() => {
          const element = document.getElementById(item.fragment!);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 300);
      });
      event.preventDefault();
    } else if (item.type === 'task' && item.queryParams) {
      // タスクの場合は、queryParamsを使って遷移
      this.router.navigate(item.routerLink, { queryParams: item.queryParams }).then(() => {
        // 遷移は完了するが、スクロールはtasks-list.component.tsで処理される
      });
      event.preventDefault();
    }
    // プロジェクト以外は通常のルーターリンクを使用
  }

  async loadAllData(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const projects = await this.projectsService.listMyProjects();
      const includeArchived = this.includeArchived();
      const validProjects = projects.filter(
        (project): project is Project & { id: string } => Boolean(project.id),
      ).filter((project) => includeArchived || !project.archived);
      const projectItems = validProjects.map((project) => {
        // ゴールの内容だけを検索対象に含める（「ゴール：」プレフィックスは除外）
        const goalLower = project.goal?.trim();
        return this.createItem({
          id: project.id!,
          type: 'project',
          title: project.name,
          context: project.goal ? `ゴール: ${project.goal}` : undefined,
          description: project.description,
          routerLink: ['/projects', project.id!],
          contextLowerOverride: goalLower ? this.normalizeForSearch(goalLower) : null,
        });
      });

      const issuesByProject = await Promise.all(
        validProjects.map(async (project) => {
          try {
            const issues = await this.issuesService.listIssues(project.id!, includeArchived);
            return issues
              .filter((issue): issue is Issue & { id: string } => Boolean(issue.id))
              .map((issue) => ({ issue, project }));
          } catch (error) {
            console.error('Failed to load issues for search', error);
            return [] as { issue: Issue & { id: string }; project: Project & { id: string } }[];
          }
        }),
      );

      const issueEntries = issuesByProject.flat();
      const issueItems = issueEntries.map(({ issue, project }) => {
        const item = this.createItem({
          id: issue.id!,
          type: 'issue',
          title: issue.name,
          context: `プロジェクト: ${project.name}`,
          description: issue.description,
          routerLink: ['/projects', project.id!, 'issues', issue.id!],
        });
        // 課題のcontext（プロジェクト名）は検索対象から除外
        item.contextLower = null;
        return item;
      });

      // 課題IDから課題情報を取得するためのマップを作成
      const issueMap = new Map<string, { issue: Issue & { id: string }; project: Project & { id: string } }>();
      issueEntries.forEach(({ issue, project }) => {
        if (issue.id) {
          issueMap.set(issue.id, { issue, project });
        }
      });

      const tasksByProject = await Promise.all(
        validProjects.map(async (project) => {
          try {
            const tasks = await this.tasksService.listTasksByProject(project.id!, includeArchived);
            return tasks
              .filter((task): task is Task & { id: string } => Boolean(task.id))
              .map((task) => ({ task, project }));
          } catch (error) {
            console.error('Failed to load tasks for search', error);
            return [] as { task: Task & { id: string }; project: Project & { id: string } }[];
          }
        }),
      );

      const taskItems = tasksByProject
        .flat()
        .map(({ task, project }) => {
          const issueInfo = task.issueId ? issueMap.get(task.issueId) : undefined;
          const contextParts: string[] = [];
          if (issueInfo) {
            contextParts.push(`課題: ${issueInfo.issue.name}`);
          }
          contextParts.push(`プロジェクト: ${project.name}`);
          
          const item = this.createItem({
            id: task.id!,
            type: 'task',
            title: task.title,
            context: contextParts.join(' / '),
            description: task.description,
            routerLink: ['/projects', task.projectId, 'issues', task.issueId],
            queryParams: { focus: task.id! },
          });
          // タスクのcontext（課題名・プロジェクト名）は検索対象から除外
          item.contextLower = null;
          return item;
        })
        .filter((item): item is SearchResultItem => Boolean(item));

      const boardItems = await this.loadBoardItems(validProjects);

      const merged = [...projectItems, ...issueItems, ...taskItems, ...boardItems];
      this.items.set(merged);
    } catch (error) {
      console.error('Failed to load data for global search', error);
      this.error.set('データの読み込みに失敗しました。時間をおいて再度お試しください。');
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  private getProjectDisplayName(projectId: string, allProjects: (Project & { id: string })[]): string {
    const project = allProjects.find(p => p.id === projectId);
    if (!project) {
      return '削除されたプロジェクト';
    }
    if (project.archived) {
      return 'アーカイブされたプロジェクト';
    }
    return project.name;
  }

  private async loadBoardItems(
    projects: (Project & { id: string })[],
  ): Promise<SearchResultItem[]> {
    try {
      const result = await this.boardService.listAccessiblePosts();
      return result.posts
        .filter((post): post is { id: string } & typeof post => Boolean(post.id))
        .map((post) => {
          const projectNames = post.projectIds.map(
            (projectId) => this.getProjectDisplayName(projectId, projects),
          );
          const context = projectNames.length > 0
            ? `関連プロジェクト: ${projectNames.join(', ')}`
            : undefined;
          const item = this.createItem({
            id: post.id!,
            type: 'board',
            title: post.title,
            context,
            description: post.content,
            routerLink: ['/board'],
            fragment: `post-${post.id!}`,
          });
          // 掲示板のcontext（関連プロジェクト名）は検索対象から除外
          item.contextLower = null;
          return item;
        });
    } catch (error) {
      console.error('Failed to load board posts for search', error);
      return [];
    }
  }

  /**
   * 検索用に文字列を正規化（全角アルファベット・数字を半角に統一）
   */
  private normalizeForSearch(text: string): string {
    return text.normalize('NFKC').toLowerCase();
  }

  private createItem(input: {
    id: string;
    type: SearchResultType;
    title: string;
    context?: string;
    description?: string | null;
    routerLink: (string | number)[];
    fragment?: string;
    queryParams?: Record<string, string>;
    contextLowerOverride?: string | null;
  }): SearchResultItem {
    const title = input.title ?? '';
    const context = input.context?.trim() || undefined;
    const description = input.description?.trim() || undefined;
    return {
      id: input.id,
      type: input.type,
      title,
      context,
      description,
      routerLink: [...input.routerLink],
      fragment: input.fragment ?? undefined,
      queryParams: input.queryParams,
      titleLower: this.normalizeForSearch(title),
      contextLower: input.contextLowerOverride !== undefined 
        ? (input.contextLowerOverride ? this.normalizeForSearch(input.contextLowerOverride) : null)
        : (context ? this.normalizeForSearch(context) : null),
      descriptionLower: description ? this.normalizeForSearch(description) : null,
    };
  }

  onQueryChange(value: string): void {
    this.query.set(value);
  }

  async onIncludeArchivedChange(checked: boolean): Promise<void> {
    this.includeArchived.set(checked);
    await this.loadAllData();
  }

  onTypeFilterChange(type: SearchResultType, checked: boolean): void {
    this.typeFilters.update((filters) => ({
      ...filters,
      [type]: checked,
    }));
  }

  /**
   * context用のハイライト（プロジェクトのゴールの場合、「ゴール：」プレフィックスを除外）
   */
  highlightContext(context: string | undefined | null): SafeHtml {
    if (!context) {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }
    
    // 「ゴール：」プレフィックスを検出
    const goalPrefix = 'ゴール: ';
    if (context.startsWith(goalPrefix)) {
      const goalContent = context.slice(goalPrefix.length);
      const prefixHtml = this.escapeHtml(goalPrefix);
      // ゴールの内容だけをハイライト
      const keyword = this.query().trim();
      if (!keyword) {
        return this.sanitizer.bypassSecurityTrustHtml(prefixHtml + this.escapeHtml(goalContent));
      }
      
      const normalizedContent = this.normalizeForSearch(goalContent);
      const normalizedKeyword = this.normalizeForSearch(keyword);
      if (!normalizedKeyword || !normalizedContent.includes(normalizedKeyword)) {
        return this.sanitizer.bypassSecurityTrustHtml(prefixHtml + this.escapeHtml(goalContent));
      }
      
      // ゴールの内容をハイライト
      const segments: string[] = [prefixHtml];
      let contentIndex = 0;
      let normalizedIndex = 0;
      
      // 正規化された文字列でマッチ位置を探す
      let matchIndex = normalizedContent.indexOf(normalizedKeyword, 0);
      
      while (matchIndex !== -1) {
        // マッチ開始位置に対応する元の文字列の位置を探す
        let startOriginalIndex = 0;
        let currentNormalizedIndex = 0;
        for (let i = 0; i < goalContent.length; i++) {
          const charNormalized = this.normalizeForSearch(goalContent[i]);
          if (currentNormalizedIndex + charNormalized.length > matchIndex) {
            startOriginalIndex = i;
            break;
          }
          currentNormalizedIndex += charNormalized.length;
        }
        
        // マッチ終了位置に対応する元の文字列の位置を探す
        const endNormalizedIndex = matchIndex + normalizedKeyword.length;
        let endOriginalIndex = goalContent.length;
        currentNormalizedIndex = 0;
        for (let i = 0; i < goalContent.length; i++) {
          const charNormalized = this.normalizeForSearch(goalContent[i]);
          currentNormalizedIndex += charNormalized.length;
          if (currentNormalizedIndex >= endNormalizedIndex) {
            endOriginalIndex = i + 1;
            break;
          }
        }
        
        // マッチ前の部分
        if (contentIndex < startOriginalIndex) {
          segments.push(this.escapeHtml(goalContent.slice(contentIndex, startOriginalIndex)));
        }
        
        // マッチ部分
        segments.push(`<mark>${this.escapeHtml(goalContent.slice(startOriginalIndex, endOriginalIndex))}</mark>`);
        
        contentIndex = endOriginalIndex;
        matchIndex = normalizedContent.indexOf(normalizedKeyword, endNormalizedIndex);
      }
      
      // 残りの部分
      if (contentIndex < goalContent.length) {
        segments.push(this.escapeHtml(goalContent.slice(contentIndex)));
      }
      
      return this.sanitizer.bypassSecurityTrustHtml(segments.join(''));
    }
    
    return this.highlight(context);
  }

  highlight(text: string | undefined | null): SafeHtml {
    const content = text ?? '';
    const keyword = this.query().trim();
    if (!keyword) {
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(content));
    }
    
    const normalizedContent = this.normalizeForSearch(content);
    const normalizedKeyword = this.normalizeForSearch(keyword);
    if (!normalizedKeyword || !normalizedContent.includes(normalizedKeyword)) {
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(content));
    }
    
    // 正規化された文字列でマッチ位置を探し、元の文字列でハイライト
    const segments: string[] = [];
    let contentIndex = 0;
    let normalizedIndex = 0;
    
    // 各文字の正規化後の位置をマッピング
    const charMap: Array<{ originalStart: number; originalEnd: number }> = [];
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const normalized = this.normalizeForSearch(char);
      const start = normalizedIndex;
      normalizedIndex += normalized.length;
      charMap.push({ originalStart: i, originalEnd: i + 1 });
    }
    
    // 正規化された文字列でマッチ位置を探す
    let matchIndex = normalizedContent.indexOf(normalizedKeyword, 0);
    
    while (matchIndex !== -1) {
      // マッチ開始位置に対応する元の文字列の位置を探す
      let startOriginalIndex = 0;
      let currentNormalizedIndex = 0;
      for (let i = 0; i < content.length; i++) {
        const charNormalized = this.normalizeForSearch(content[i]);
        if (currentNormalizedIndex + charNormalized.length > matchIndex) {
          startOriginalIndex = i;
          break;
        }
        currentNormalizedIndex += charNormalized.length;
      }
      
      // マッチ終了位置に対応する元の文字列の位置を探す
      const endNormalizedIndex = matchIndex + normalizedKeyword.length;
      let endOriginalIndex = content.length;
      currentNormalizedIndex = 0;
      for (let i = 0; i < content.length; i++) {
        const charNormalized = this.normalizeForSearch(content[i]);
        currentNormalizedIndex += charNormalized.length;
        if (currentNormalizedIndex >= endNormalizedIndex) {
          endOriginalIndex = i + 1;
          break;
        }
      }
      
      // マッチ前の部分
      if (contentIndex < startOriginalIndex) {
        segments.push(this.escapeHtml(content.slice(contentIndex, startOriginalIndex)));
      }
      
      // マッチ部分
      segments.push(`<mark>${this.escapeHtml(content.slice(startOriginalIndex, endOriginalIndex))}</mark>`);
      
      contentIndex = endOriginalIndex;
      matchIndex = normalizedContent.indexOf(normalizedKeyword, endNormalizedIndex);
    }
    
    // 残りの部分
    if (contentIndex < content.length) {
      segments.push(this.escapeHtml(content.slice(contentIndex)));
    }
    
    return this.sanitizer.bypassSecurityTrustHtml(segments.join(''));
  }

  trackById(_: number, item: SearchResultItem): string {
    return `${item.type}-${item.id}`;
  }

  labelFor(type: SearchResultType): string {
    return this.typeLabels[type];
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
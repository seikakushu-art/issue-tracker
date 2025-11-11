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
    const keyword = this.query().trim().toLowerCase();
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
      const projectItems = validProjects.map((project) => this.createItem({
        id: project.id!,
        type: 'project',
        title: project.name,
        context: project.goal ? `ゴール: ${project.goal}` : undefined,
        description: project.description,
        routerLink: ['/projects', project.id!],
      }));

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
      const issueItems = issueEntries.map(({ issue, project }) =>
        this.createItem({
          id: issue.id!,
          type: 'issue',
          title: issue.name,
          context: undefined,
          description: issue.description,
          routerLink: ['/projects', project.id!, 'issues', issue.id!],
        }),
      );

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
        .map(({ task }) => {
          return this.createItem({
            id: task.id!,
            type: 'task',
            title: task.title,
            context: undefined,
            description: task.description,
            routerLink: ['/projects', task.projectId, 'issues', task.issueId],
          });
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
      const posts = await this.boardService.listAccessiblePosts();
      return posts
        .filter((post): post is { id: string } & typeof post => Boolean(post.id))
        .map((post) => {
          const projectNames = post.projectIds.map(
            (projectId) => this.getProjectDisplayName(projectId, projects),
          );
          const context = projectNames.length > 0
            ? `関連プロジェクト: ${projectNames.join(', ')}`
            : undefined;
          return this.createItem({
            id: post.id!,
            type: 'board',
            title: post.title,
            context,
            routerLink: ['/board'],
            fragment: `post-${post.id!}`,
          });
        });
    } catch (error) {
      console.error('Failed to load board posts for search', error);
      return [];
    }
  }

  private createItem(input: {
    id: string;
    type: SearchResultType;
    title: string;
    context?: string;
    description?: string | null;
    routerLink: (string | number)[];
    fragment?: string;
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
      titleLower: title.toLowerCase(),
      contextLower: context ? context.toLowerCase() : null,
      descriptionLower: description ? description.toLowerCase() : null,
    };
  }

  onQueryChange(value: string): void {
    this.query.set(value);
  }

  onIncludeArchivedChange(checked: boolean): void {
    this.includeArchived.set(checked);
    void this.loadAllData();
  }

  onTypeFilterChange(type: SearchResultType, checked: boolean): void {
    this.typeFilters.update((filters) => ({
      ...filters,
      [type]: checked,
    }));
  }

  highlight(text: string | undefined | null): SafeHtml {
    const content = text ?? '';
    const keyword = this.query().trim();
    if (!keyword) {
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(content));
    }
    const lowerContent = content.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    let searchIndex = 0;
    let matchIndex = lowerContent.indexOf(lowerKeyword, searchIndex);
    if (matchIndex === -1) {
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(content));
    }
    const segments: string[] = [];
    while (matchIndex !== -1) {
      const before = content.slice(searchIndex, matchIndex);
      const match = content.slice(matchIndex, matchIndex + keyword.length);
      segments.push(this.escapeHtml(before));
      segments.push(`<mark>${this.escapeHtml(match)}</mark>`);
      searchIndex = matchIndex + keyword.length;
      matchIndex = lowerContent.indexOf(lowerKeyword, searchIndex);
    }
    if (searchIndex < content.length) {
      segments.push(this.escapeHtml(content.slice(searchIndex)));
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
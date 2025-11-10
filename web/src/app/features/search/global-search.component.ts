import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterModule } from '@angular/router';
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
  routerLink: (string | number)[];
  fragment?: string;
  titleLower: string;
  contextLower: string | null;
}

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './global-search.component.html',
  styleUrls: ['./global-search.component.scss'],
})
export class GlobalSearchComponent implements OnInit {
  private readonly projectsService = inject(ProjectsService);
  private readonly issuesService = inject(IssuesService);
  private readonly tasksService = inject(TasksService);
  private readonly boardService = inject(BoardService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly query = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
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
    if (!keyword) {
      return allItems;
    }
    return allItems.filter((item) => {
      if (item.titleLower.includes(keyword)) {
        return true;
      }
      if (item.contextLower && item.contextLower.includes(keyword)) {
        return true;
      }
      return false;
    });
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

  async loadAllData(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const projects = await this.projectsService.listMyProjects();
      const validProjects = projects.filter(
        (project): project is Project & { id: string } => Boolean(project.id),
      );
      const projectItems = validProjects.map((project) => this.createItem({
        id: project.id!,
        type: 'project',
        title: project.name,
        context: project.goal ? `ゴール: ${project.goal}` : undefined,
        routerLink: ['/projects', project.id!],
      }));

      const issuesByProject = await Promise.all(
        validProjects.map(async (project) => {
          try {
            const issues = await this.issuesService.listIssues(project.id!, false);
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
          context: `${project.name}`,
          routerLink: ['/projects', project.id!, 'issues', issue.id!],
        }),
      );

      const issueMap = new Map(
        issueEntries.map(({ issue, project }) => [issue.id!, { issue, project }]),
      );

      const tasksByProject = await Promise.all(
        validProjects.map(async (project) => {
          try {
            const tasks = await this.tasksService.listTasksByProject(project.id!, false);
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
          const issueInfo = issueMap.get(task.issueId);
          const contextParts = [] as string[];
          if (issueInfo) {
            contextParts.push(`${issueInfo.project.name} / ${issueInfo.issue.name}`);
          } else {
            const projectName = validProjects.find((project) => project.id === task.projectId)?.name;
            if (projectName) {
              contextParts.push(projectName);
            }
          }
          if (task.importance) {
            contextParts.push(`重要度: ${task.importance}`);
          }
          return this.createItem({
            id: task.id!,
            type: 'task',
            title: task.title,
            context: contextParts.join(' ・ '),
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
            fragment: post.id!,
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
    routerLink: (string | number)[];
    fragment?: string;
  }): SearchResultItem {
    const title = input.title ?? '';
    const context = input.context?.trim() || undefined;
    return {
      id: input.id,
      type: input.type,
      title,
      context,
      routerLink: [...input.routerLink],
      fragment: input.fragment ?? undefined,
      titleLower: title.toLowerCase(),
      contextLower: context ? context.toLowerCase() : null,
    };
  }

  onQueryChange(value: string): void {
    this.query.set(value);
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
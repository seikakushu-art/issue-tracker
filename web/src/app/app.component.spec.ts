import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterModule } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { AppComponent } from './app.component';
import { ProjectsService } from './features/projects/projects.service';
import { IssuesService } from './features/issues/issues.service';
import { TasksService } from './features/tasks/tasks.service';
import { Issue, Project, Task } from './models/schema';

@Component({ standalone: true, template: '' })
class DummyComponent {}

describe('AppComponent', () => {
  const createProjects = (): Project[] => [
    { id: 'p1', name: 'プロジェクトA', memberIds: [], roles: {}, archived: false, progress: 0 },
  ];

  let projectsService: jasmine.SpyObj<ProjectsService>;
  let issuesService: jasmine.SpyObj<IssuesService>;
  let tasksService: jasmine.SpyObj<TasksService>;

  beforeEach(async () => {
    projectsService = jasmine.createSpyObj('ProjectsService', ['listMyProjects']);
    issuesService = jasmine.createSpyObj('IssuesService', ['getIssue']);
    tasksService = jasmine.createSpyObj('TasksService', ['getTask']);

    projectsService.listMyProjects.and.returnValue(Promise.resolve(createProjects()));
    issuesService.getIssue.and.returnValue(Promise.resolve({ id: 'i1', projectId: 'p1', name: '課題1', archived: false } as Issue));
    tasksService.getTask.and.returnValue(Promise.resolve({ id: 't1', projectId: 'p1', issueId: 'i1', title: 'タスク1', status: 'incomplete', archived: false, assigneeIds: [], tagIds: [], checklist: [], createdBy: 'user1' } as Task));

    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule.withRoutes([
          { path: '', component: DummyComponent },
          { path: 'dashboard', component: DummyComponent },
          { path: 'projects', component: DummyComponent },
          { path: 'projects/:projectId', component: DummyComponent },
          { path: 'projects/:projectId/issues/:issueId', component: DummyComponent },
          { path: 'projects/:projectId/issues/:issueId/tasks/:taskId', component: DummyComponent },
          { path: 'board', component: DummyComponent },
          { path: 'gantt', component: DummyComponent },
          { path: 'tree', component: DummyComponent },
          { path: 'attachments', component: DummyComponent },
        ]),
        RouterModule,
        AppComponent,
      ],
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        { provide: IssuesService, useValue: issuesService },
        { provide: TasksService, useValue: tasksService },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.ngZone?.run(() => {
      const router = TestBed.inject(Router);
      router.initialNavigation();
    });
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    // 実際の <h1> のテキストに合わせてここだけ変えてOK
    // 例: <h1>課題管理アプリ</h1> なら '課題管理アプリ'
    expect(compiled.querySelector('h1')?.textContent ?? '').toContain('Issue Tracker');
  });

  it('ヘッダーに主要ナビゲーションリンクが並ぶ', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);

    await fixture.ngZone?.run(async () => router.navigate(['/']));

    fixture.detectChanges();
    await fixture.whenStable();

    const navLinks = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.primary-nav a')
    ).map(link => link.textContent?.trim());

    expect(navLinks).toEqual([
      'ダッシュボード',
      'プロジェクト一覧',
      '掲示板',
      'ガントチャート',
      'ツリー',
      '添付ファイル一覧',
    ]);
  });

  it('ヘッダーナビゲーションから各ページへ遷移できる', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);

    await fixture.ngZone?.run(async () => router.navigate(['/']));

    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    const navLinks = Array.from(host.querySelectorAll('.primary-nav a')) as HTMLAnchorElement[];

    const expectations: { label: string; path: string }[] = [
      { label: 'ダッシュボード', path: '/dashboard' },
      { label: 'プロジェクト一覧', path: '/projects' },
      { label: '掲示板', path: '/board' },
      { label: 'ガントチャート', path: '/gantt' },
      { label: 'ツリー', path: '/tree' },
      { label: '添付ファイル一覧', path: '/attachments' },
    ];

    for (const { label, path } of expectations) {
      const link = navLinks.find(el => el.textContent?.trim() === label) as HTMLAnchorElement;

      await fixture.ngZone?.run(async () => {
        link.click();
        await fixture.whenStable();
      });

      expect(router.url).toBe(path);
    }
  });

  it('プロジェクト詳細ページでパンくずが表示される', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);

    projectsService.listMyProjects.and.returnValue(Promise.resolve(createProjects()));

    await fixture.ngZone?.run(async () => router.navigate(['/projects', 'p1']));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const breadcrumbLabels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.breadcrumb-item')
    )
      .map(el => el.textContent?.trim())
      .filter(Boolean);

    expect(breadcrumbLabels).toContain('プロジェクトA');
  });

  it('課題詳細ページでパンくずが表示される', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);

    projectsService.listMyProjects.and.returnValue(Promise.resolve(createProjects()));
    issuesService.getIssue.and.returnValue(Promise.resolve({ id: 'i1', projectId: 'p1', name: '課題1', archived: false } as Issue));

    await fixture.ngZone?.run(async () => router.navigate(['/projects', 'p1', 'issues', 'i1']));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const breadcrumbLabels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.breadcrumb-item')
    )
      .map(el => el.textContent?.trim())
      .filter(Boolean);

    expect(breadcrumbLabels).toContain('プロジェクトA');
    expect(breadcrumbLabels).toContain('課題1');
  });

  it('タスク詳細ページでパンくずが表示される', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);

    projectsService.listMyProjects.and.returnValue(Promise.resolve(createProjects()));
    issuesService.getIssue.and.returnValue(Promise.resolve({ id: 'i1', projectId: 'p1', name: '課題1', archived: false } as Issue));
    tasksService.getTask.and.returnValue(Promise.resolve({ id: 't1', projectId: 'p1', issueId: 'i1', title: 'タスク1', status: 'incomplete', archived: false, assigneeIds: [], tagIds: [], checklist: [], createdBy: 'user1' } as Task));

    await fixture.ngZone?.run(async () =>
      router.navigate(['/projects', 'p1', 'issues', 'i1', 'tasks', 't1'])
    );

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const breadcrumbLabels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.breadcrumb-item')
    )
      .map(el => el.textContent?.trim())
      .filter(Boolean);

    expect(breadcrumbLabels).toContain('プロジェクトA');
    expect(breadcrumbLabels).toContain('課題1');
    expect(breadcrumbLabels).toContain('タスク1');
  });

  it('パンくずをクリックすると該当ページへ遷移を試みる', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);

    projectsService.listMyProjects.and.returnValue(Promise.resolve(createProjects()));
    issuesService.getIssue.and.returnValue(Promise.resolve({ id: 'i1', projectId: 'p1', name: '課題1', archived: false } as Issue));

    await fixture.ngZone?.run(async () => router.navigate(['/projects', 'p1', 'issues', 'i1']));

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const navigateSpy = spyOn(router, 'navigate').and.callThrough();

    const breadcrumbItems = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.breadcrumb-item')
    );
    const issueCrumb = breadcrumbItems.find(el => el.textContent?.includes('課題1')) as HTMLElement;

    issueCrumb.click();

    expect(navigateSpy).toHaveBeenCalledWith(['/projects/p1/issues/i1']);
  });
});


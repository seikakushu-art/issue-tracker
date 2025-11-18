import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { ProjectSidebarComponent } from './project-sidebar.component';
import { ProjectsService } from '../../features/projects/projects.service';
import { IssuesService } from '../../features/issues/issues.service';
import { Project } from '../../models/schema';

@Component({ standalone: true, template: '' })
class DummyProjectComponent {}

describe('ProjectSidebarComponent', () => {
  let projectsService: jasmine.SpyObj<ProjectsService>;
  let issuesService: jasmine.SpyObj<IssuesService>;

  beforeEach(async () => {
    projectsService = jasmine.createSpyObj('ProjectsService', ['listMyProjects']);
    issuesService = jasmine.createSpyObj('IssuesService', ['countIssues']);

    projectsService.listMyProjects.and.returnValue(
      Promise.resolve([
        { id: 'p1', name: 'プロジェクトA', progress: 30, memberIds: [], roles: {}, archived: false } as Project,
        { id: 'p2', name: 'プロジェクトB', progress: 70, memberIds: [], roles: {}, archived: false } as Project,
      ])
    );

    issuesService.countIssues.and.callFake(() => Promise.resolve(0));

    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule.withRoutes([
          { path: 'projects/:projectId', component: DummyProjectComponent },
        ]),
        ProjectSidebarComponent,
      ],
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        { provide: IssuesService, useValue: issuesService },
      ],
    }).compileComponents();
  });

  it('プロジェクトサイドバーが一覧を表示する', async () => {
    const fixture = TestBed.createComponent(ProjectSidebarComponent);
    fixture.componentInstance.currentProjectId = 'p1';

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const heading = host.querySelector('.sidebar-header h2');
    const projectLinks = host.querySelectorAll('.project-list .project-link');

    expect(heading?.textContent?.trim()).toBe('プロジェクト一覧');
    expect(projectLinks.length).toBe(2);
    expect(projectLinks[0].classList.contains('active')).toBeTrue();
  });

  it('サイドバーからプロジェクトを選択できる', async () => {
    const fixture = TestBed.createComponent(ProjectSidebarComponent);
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const secondProjectLink = fixture.nativeElement.querySelectorAll('.project-link')[1] as HTMLAnchorElement;

    await fixture.ngZone?.run(async () => {
      secondProjectLink.click();
      await fixture.whenStable();
    });

    await fixture.whenStable();
    expect(location.path()).toBe('/projects/p2');
    expect(router.url).toBe('/projects/p2');
  });
});

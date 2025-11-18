import { TestBed } from '@angular/core/testing';
import { FirebaseError } from 'firebase/app';
import { ProjectsListComponent } from './projects-list.component';
import { ProjectsService } from './projects.service';
import { IssuesService } from '../issues/issues.service';
import { ProjectInviteService } from './project-invite.service';
import { UserDirectoryService } from '../../core/user-directory.service';
import { ProjectTemplatesService } from './project-templates.service';
import { TasksService } from '../tasks/tasks.service';
import { TagsService } from '../tags/tags.service';
import { ActivatedRoute, Router } from '@angular/router';
import { Project } from '../../models/schema';

// 依存サービスはシンプルなダミーを渡し、AngularFire など実装を起動しない
const routerMock = { navigate: jasmine.createSpy('navigate') } as unknown as Router;
const activatedRouteMock = {
  snapshot: { queryParamMap: new Map() },
  queryParamMap: { pipe: () => ({ subscribe: () => undefined }) },
} as unknown as ActivatedRoute;

function createComponent(): ProjectsListComponent {
  TestBed.configureTestingModule({
    providers: [
      { provide: ProjectsService, useValue: {} },
      { provide: IssuesService, useValue: {} },
      { provide: ProjectInviteService, useValue: {} },
      { provide: UserDirectoryService, useValue: {} },
      { provide: ProjectTemplatesService, useValue: {} },
      { provide: TasksService, useValue: {} },
      { provide: TagsService, useValue: {} },
      { provide: Router, useValue: routerMock },
      { provide: ActivatedRoute, useValue: activatedRouteMock },
    ],
  });

  return TestBed.runInInjectionContext(() => new ProjectsListComponent());
}

describe('ProjectsListComponent（一覧の基本挙動）', () => {
  let component: ProjectsListComponent;

  beforeEach(() => {
    component = createComponent();
    component.currentUid = 'user-1';
  });

  it('アーカイブ済みを非表示にすると非アーカイブのみ残る', () => {
    const activeProject: Project = { id: 'p1', name: 'Active', archived: false, memberIds: [], roles: {}, pinnedBy: [] } as Project;
    const archivedProject: Project = { id: 'p2', name: 'Archived', archived: true, memberIds: [], roles: {}, pinnedBy: [] } as Project;

    component.projects = [activeProject, archivedProject];
    component.showArchived = false;

    component.filterProjects();

    expect(component.filteredProjects).toEqual([activeProject]);
  });

  it('アーカイブ済みを表示にすると全プロジェクトが含まれる', () => {
    const activeProject: Project = { id: 'p1', name: 'Active', archived: false, memberIds: [], roles: {}, pinnedBy: [] } as Project;
    const archivedProject: Project = { id: 'p2', name: 'Archived', archived: true, memberIds: [], roles: {}, pinnedBy: [] } as Project;

    component.projects = [activeProject, archivedProject];
    component.showArchived = true;

    component.filterProjects();

    expect(component.filteredProjects).toEqual([activeProject, archivedProject]);
  });

  it('ピン止めされたプロジェクトが先頭に並ぶ', () => {
    const pinned: Project = { id: 'p1', name: 'Pinned', archived: false, memberIds: [], roles: {}, pinnedBy: ['user-1'] } as Project;
    const normal: Project = { id: 'p2', name: 'Normal', archived: false, memberIds: [], roles: {}, pinnedBy: [] } as Project;

    component.filteredProjects = [normal, pinned];
    component.sortBy = 'name';
    component.sortOrder = 'asc';

    component.sortProjects();

    expect(component.filteredProjects[0]).toBe(pinned);
  });

  it('スマートフィルターパネルの開閉をトグルできる', () => {
    expect(component.smartFilterVisible).toBeFalse();

    component.toggleSmartFilterPanel();
    expect(component.smartFilterVisible).toBeTrue();

    component.toggleSmartFilterPanel();
    expect(component.smartFilterVisible).toBeFalse();
  });

  it('プロジェクトカードのクリックで対象プロジェクトへ遷移する', () => {
    const project: Project = { id: 'p3', name: 'Navigate', archived: false, memberIds: [], roles: {}, pinnedBy: [] } as Project;

    component.selectProject(project);

    expect(routerMock.navigate).toHaveBeenCalledWith(['/projects', 'p3']);
  });

  it('「新規プロジェクト作成」ボタンでモーダルを初期状態で開く', () => {
    component.projectForm = {
      name: 'Draft',
      description: 'desc',
      startDate: '2024-01-01',
      endDate: '2024-01-10',
      goal: 'goal',
    };
    component.showModal = false;

    component.openCreateModal();

    expect(component.showModal).toBeTrue();
    expect(component.editingProject).toBeNull();
    expect(component.projectForm).toEqual({ name: '', description: '', startDate: '', endDate: '', goal: '' });
    expect(component.selectedTemplateId).toBeNull();
    expect(component.memberSearchTerm).toBe('');
  });

  it('プロジェクトカードの編集ボタンでモーダルを開き、値をセットする', () => {
    component.currentUid = 'admin-uid';
    const project: Project = {
      id: 'p4',
      name: 'Editable',
      description: 'before',
      startDate: '2024-02-01',
      endDate: '2024-02-28',
      goal: 'finish',
      memberIds: ['admin-uid'],
      roles: { 'admin-uid': 'admin' },
      archived: false,
      pinnedBy: [],
    } as unknown as Project;
    const stopPropagation = jasmine.createSpy('stopPropagation');
    const event = { stopPropagation } as unknown as Event;

    component.editProject(project, event);

    expect(stopPropagation).toHaveBeenCalled();
    expect(component.showModal).toBeTrue();
    expect(component.editingProject).toBe(project);
    expect(component.projectForm).toEqual({
      name: 'Editable',
      description: 'before',
      startDate: '2024-02-01',
      endDate: '2024-02-28',
      goal: 'finish',
    });
  });

  it('ピン止め状態の判定は pinnedBy と currentUid に依存する', () => {
    component.currentUid = 'u-pin';
    const pinned: Project = { id: 'p5', name: 'Pinned', archived: false, memberIds: [], roles: {}, pinnedBy: ['u-pin'] } as Project;
    const notPinned: Project = { id: 'p6', name: 'Free', archived: false, memberIds: [], roles: {}, pinnedBy: [] } as Project;

    expect(component.isPinned(pinned)).toBeTrue();
    expect(component.isPinned(notPinned)).toBeFalse();
  });

  it('並び替え順を降順にすると逆順に並ぶ', () => {
    const early: Project = { id: 'p7', name: 'A', archived: false, memberIds: [], roles: {}, pinnedBy: [], createdAt: '2023-01-01' } as unknown as Project;
    const late: Project = { id: 'p8', name: 'B', archived: false, memberIds: [], roles: {}, pinnedBy: [], createdAt: '2024-01-01' } as unknown as Project;
    component.filteredProjects = [early, late];
    component.sortBy = 'createdAt';
    component.sortOrder = 'desc';

    component.sortProjects();

    expect(component.filteredProjects[0]).toBe(late);
    expect(component.filteredProjects[1]).toBe(early);
  });
});

describe('ProjectsListComponent（エラーハンドリング）', () => {
  let component: ProjectsListComponent;

  beforeEach(() => {
    component = createComponent();
    component.currentUid = 'user-1';
  });

  it('オフライン時の保存エラーを人間向けメッセージに変換する', () => {
    const firebaseError = new FirebaseError('unavailable', 'Network connection lost');

    const message = (component as unknown as { buildProjectSaveErrorMessage(error: unknown): string }).buildProjectSaveErrorMessage(firebaseError);

    expect(message).toBe('インターネット接続を確認してください。オフラインのため操作を完了できませんでした。');
  });

  it('タイムアウト時の保存エラーを人間向けメッセージに変換する', () => {
    const firebaseError = new FirebaseError('deadline-exceeded', 'Operation timeout');

    const message = (component as unknown as { buildProjectSaveErrorMessage(error: unknown): string }).buildProjectSaveErrorMessage(firebaseError);

    expect(message).toBe('リクエストがタイムアウトしました。時間をおいて再度お試しください。');
  });

  it('必須項目未入力の場合は保存せずエラーメッセージを表示する', async () => {
    const alertSpy = spyOn(window, 'alert');
    component.projectForm = { ...component.projectForm, name: '   ' };

    await component.saveProject();

    expect(alertSpy).toHaveBeenCalledWith('プロジェクト名を入力してください');
  });

  it('文字数制限超過の場合は保存せずエラーメッセージを表示する', async () => {
    const alertSpy = spyOn(window, 'alert');
    component.projectForm = { ...component.projectForm, name: 'x'.repeat(81) };

    await component.saveProject();

    expect(alertSpy).toHaveBeenCalledWith('プロジェクト名は80文字以内で入力してください');
  });

  it('日付形式エラーが発生した場合はエラーメッセージをそのまま表示する', () => {
    const message = (component as unknown as { buildProjectSaveErrorMessage(error: unknown): string }).buildProjectSaveErrorMessage(new Error('日付形式が不正です'));

    expect(message).toBe('日付形式が不正です');
  });

  it('権限がない操作にはエラーメッセージを表示する', () => {
    const alertSpy = spyOn(window, 'alert');
    const project: Project = { id: 'p9', name: 'Restricted', archived: false, memberIds: ['other'], roles: { other: 'member' }, pinnedBy: [] } as unknown as Project;
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as Event;

    component.editProject(project, event);

    expect(alertSpy).toHaveBeenCalledWith('この操作を行う権限がありません');
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(component.showModal).toBeFalse();
    expect(component.editingProject).toBeNull();
  });

  it('アクセスできないリソースへのアクセス時はエラーメッセージを表示する', async () => {
    const alertSpy = spyOn(window, 'alert');
    const project: Project = { id: 'p10', name: 'Invite Restricted', archived: false, memberIds: ['another'], roles: { another: 'member' }, pinnedBy: [] } as unknown as Project;
    const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as Event;

    await component.openInviteModal(project, event);

    expect(alertSpy).toHaveBeenCalledWith('招待リンクの管理権限がありません');
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(component.showInviteModal).toBeFalse();
    expect(component.inviteProject).toBeNull();
  });
});
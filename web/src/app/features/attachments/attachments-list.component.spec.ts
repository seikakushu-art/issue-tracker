import { TestBed } from '@angular/core/testing';
import { AttachmentsListComponent } from './attachments-list.component';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { UserDirectoryService } from '../../core/user-directory.service';
import { Auth } from '@angular/fire/auth';
import { Attachment, Project } from '../../models/schema';

// AngularFire を実動させないように、必要な依存はすべてテストダブルで差し替える
const projectsServiceStub = {
  listMyProjects: jasmine.createSpy('listMyProjects'),
};

const tasksServiceStub = {
  listAttachmentsForProjects: jasmine.createSpy('listAttachmentsForProjects'),
  listTasksByProject: jasmine.createSpy('listTasksByProject'),
  deleteAttachment: jasmine.createSpy('deleteAttachment'),
};

const userDirectoryServiceStub = {
  getProfiles: jasmine.createSpy('getProfiles'),
};

const authStub: Partial<Auth> = {
  currentUser: { uid: 'user-1' } as unknown as Auth['currentUser'],
};

function createAttachment(partial: Partial<Attachment>): Attachment {
  return {
    id: 'attach-' + Math.random().toString(36).slice(2),
    fileName: 'sample.txt',
    fileSize: 1024,
    fileUrl: 'https://example.com/file',
    uploadedAt: new Date('2024-01-02'),
    uploadedBy: 'user-1',
    projectId: 'project-1',
    projectName: 'Project Alpha',
    issueId: 'issue-1',
    issueName: 'Issue One',
    taskId: 'task-1',
    taskTitle: 'Task One',
    ...partial,
  };
}

describe('AttachmentsListComponent', () => {
  let component: AttachmentsListComponent;

  beforeEach(() => {
    const projects: Project[] = [
      { id: 'project-1', name: 'Project Alpha', archived: false, roles: { 'user-1': 'admin' }, memberIds: ['user-1'] },
      { id: 'project-2', name: 'Project Beta', archived: false, roles: { 'user-1': 'member' }, memberIds: ['user-1'] },
    ];

    projectsServiceStub.listMyProjects.and.resolveTo(projects);

    const attachments = [
      createAttachment({
        id: 'attach-1',
        fileName: 'design.pdf',
        fileSize: 1_048_576,
        uploadedAt: new Date('2024-02-01T10:00:00Z'),
      }),
      createAttachment({
        id: 'attach-2',
        projectId: 'project-2',
        taskId: 'task-2',
        issueId: 'issue-2',
        projectName: 'Project Beta',
        fileName: 'report.docx',
        uploadedBy: 'user-2',
        uploadedAt: new Date('2024-02-02T10:00:00Z'),
      }),
    ];
    tasksServiceStub.listAttachmentsForProjects.and.resolveTo(attachments);
    tasksServiceStub.listTasksByProject.and.resolveTo([
      { id: 'task-1', archived: false },
      { id: 'task-2', archived: false },
    ] as never);
    tasksServiceStub.deleteAttachment.calls.reset();

    userDirectoryServiceStub.getProfiles.and.resolveTo([
      { uid: 'user-1', username: 'Alice' },
      { uid: 'user-2', username: 'Bob' },
    ]);

    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectsService, useValue: projectsServiceStub },
        { provide: TasksService, useValue: tasksServiceStub },
        { provide: UserDirectoryService, useValue: userDirectoryServiceStub },
        { provide: Auth, useValue: authStub },
      ],
    });

    component = TestBed.runInInjectionContext(() => new AttachmentsListComponent());
  });

  it('全プロジェクトの添付ファイルを読み込み、表示用の情報を保持する', async () => {
    await component.ngOnInit();

    const rows = component.attachments();

    expect(tasksServiceStub.listAttachmentsForProjects).toHaveBeenCalledWith(['project-1', 'project-2'], false);
    expect(rows.length).toBe(2);

    // ファイル名・サイズ・アップロード日時・アップローダー表示に必要な値が揃っていること
    expect(rows[0]).toEqual(jasmine.objectContaining({
      fileName: 'design.pdf',
      fileSize: 1_048_576,
      uploadedAt: new Date('2024-02-01T10:00:00Z'),
      uploaderName: 'Alice',
      projectName: 'Project Alpha',
    }));
    expect(component.formatFileSize(rows[0].fileSize)).toBe('1.0 MB');
  });

  it('ダウンロード操作でアンカーを生成しクリックさせる', () => {
    const anchorMock = {
      href: '',
      download: '',
      rel: '',
      target: '',
      click: jasmine.createSpy('click'),
    } as unknown as HTMLAnchorElement;
    spyOn(document, 'createElement').and.returnValue(anchorMock);

    const eventMock = {
      preventDefault: jasmine.createSpy('preventDefault'),
      stopPropagation: jasmine.createSpy('stopPropagation'),
    } as unknown as Event;

    const row = (component as unknown as {
      composeRow: (
        attachment: Attachment,
        context: { profileMap: Map<string, string>; projectNameMap: Map<string, string> },
      ) => ReturnType<AttachmentsListComponent['composeRow']>;
    }).composeRow(createAttachment({ fileUrl: 'https://example.com/resource', fileName: 'memo.txt' }), {
      profileMap: new Map([['user-1', 'Alice']]),
      projectNameMap: new Map(),
    });

    component.downloadAttachment(row, eventMock);

    expect(eventMock.preventDefault).toHaveBeenCalled();
    expect(eventMock.stopPropagation).toHaveBeenCalled();
    expect(anchorMock.href).toBe('https://example.com/resource');
    expect(anchorMock.download).toBe('memo.txt');
    expect(anchorMock.click).toHaveBeenCalled();
  });

  it('削除権限がある場合は確認後に削除サービスを呼び出す', async () => {
    component.currentUid.set('user-1');
    component.projectRoles.set(new Map([
      ['project-1', 'admin'],
    ]));

    const refreshSpy = spyOn(component, 'refresh').and.resolveTo();
    spyOn(window, 'confirm').and.returnValue(true);
    spyOn(window, 'alert');

    const eventMock = {
      stopPropagation: jasmine.createSpy('stopPropagation'),
      preventDefault: jasmine.createSpy('preventDefault'),
    } as unknown as Event;

    const targetRow = createAttachment({
      id: 'deletable-1',
      fileName: 'remove.txt',
    });

    tasksServiceStub.deleteAttachment.and.resolveTo();

    await component.deleteAttachment(targetRow as never, eventMock);

    expect(eventMock.stopPropagation).toHaveBeenCalled();
    expect(eventMock.preventDefault).toHaveBeenCalled();
    expect(tasksServiceStub.deleteAttachment).toHaveBeenCalledWith(
      targetRow.projectId,
      targetRow.issueId,
      targetRow.taskId,
      'deletable-1',
    );
    expect(refreshSpy).toHaveBeenCalled();
    expect(component.deletingId()).toBeNull();
  });

  it('削除権限が無い場合は警告を表示して処理を行わない', async () => {
    component.currentUid.set('user-1');
    component.projectRoles.set(new Map([
      ['project-1', 'member'],
    ]));

    const eventMock = {
      stopPropagation: jasmine.createSpy('stopPropagation'),
      preventDefault: jasmine.createSpy('preventDefault'),
    } as unknown as Event;

    const row = createAttachment({
      uploadedBy: 'someone-else',
      projectId: 'project-1',
      issueId: 'issue-1',
      taskId: 'task-1',
      id: 'attach-no-permission',
    });

    const alertSpy = spyOn(window, 'alert');

    await component.deleteAttachment(row as never, eventMock);

    expect(eventMock.stopPropagation).toHaveBeenCalled();
    expect(eventMock.preventDefault).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('この添付ファイルを削除する権限がありません');
    expect(tasksServiceStub.deleteAttachment).not.toHaveBeenCalled();
  });

  it('確認ダイアログでキャンセルされた場合は削除処理を行わない', async () => {
    component.currentUid.set('user-1');
    component.projectRoles.set(new Map([
      ['project-1', 'admin'],
    ]));

    const eventMock = {
      stopPropagation: jasmine.createSpy('stopPropagation'),
      preventDefault: jasmine.createSpy('preventDefault'),
    } as unknown as Event;

    const row = createAttachment({ id: 'attach-cancel' });

    spyOn(window, 'confirm').and.returnValue(false);
    const refreshSpy = spyOn(component, 'refresh');

    await component.deleteAttachment(row as never, eventMock);

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(tasksServiceStub.deleteAttachment).not.toHaveBeenCalled();
    expect(component.deletingId()).toBeNull();
  });

  it('canDeleteAttachment はロールとアップローダーに応じて正しく判定する', () => {
    component.currentUid.set('user-1');
    component.projectRoles.set(new Map([
      ['project-1', 'admin'],
      ['project-2', 'member'],
    ]));

    const adminRow = createAttachment({ projectId: 'project-1', uploadedBy: 'another-user' });
    const ownRow = createAttachment({ projectId: 'project-2', uploadedBy: 'user-1' });
    const otherMemberRow = createAttachment({ projectId: 'project-2', uploadedBy: 'user-2' });
    const noProjectRow = createAttachment({ projectId: undefined });

    expect(component.canDeleteAttachment(adminRow as never)).toBeTrue();
    expect(component.canDeleteAttachment(ownRow as never)).toBeTrue();
    expect(component.canDeleteAttachment(otherMemberRow as never)).toBeFalse();
    expect(component.canDeleteAttachment(noProjectRow as never)).toBeFalse();
  });

  it('プロジェクト選択とタスクのアーカイブ状態で添付ファイルをフィルタリングする', async () => {
    const projects: Project[] = [
      { id: 'project-1', name: 'Project Alpha', archived: false, memberIds: [], roles: {} },
      { id: 'project-2', name: 'Project Beta', archived: false, memberIds: [], roles: {} },
    ];
    component.projects.set(projects);
    component.selectedProjectId.set('project-2');

    const attachments: Attachment[] = [
      createAttachment({ id: 'active-attachment', projectId: 'project-2', taskId: 'task-active' }),
      createAttachment({ id: 'archived-attachment', projectId: 'project-2', taskId: 'task-archived' }),
    ];
    tasksServiceStub.listAttachmentsForProjects.and.resolveTo(attachments);
    tasksServiceStub.listTasksByProject.and.callFake(async (projectId: string) => {
      if (projectId === 'project-2') {
        return [
          { id: 'task-active', archived: false },
          { id: 'task-archived', archived: true },
        ] as never;
      }
      return [] as never;
    });

    userDirectoryServiceStub.getProfiles.and.resolveTo([{ uid: 'user-1', username: 'Alice' }]);

    await component.refresh();

    const rows = component.attachments();
    expect(tasksServiceStub.listAttachmentsForProjects).toHaveBeenCalledWith(['project-2'], false);
    expect(rows.map(row => row.id)).toEqual(['active-attachment']);
  });
});
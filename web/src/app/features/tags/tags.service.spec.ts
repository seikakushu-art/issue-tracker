import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { TagsService } from './tags.service';
import { ProjectsService } from '../projects/projects.service';

// 依存はテスト用のスタブで置き換える
const authStub: Partial<Auth> = {
  currentUser: null,
  authStateReady: () => Promise.resolve(),
};

const firestoreStub: Partial<Firestore> = {};

describe('TagsService', () => {
  let service: TagsService;
  let projectsServiceSpy: jasmine.SpyObj<ProjectsService>;

  beforeEach(() => {
    projectsServiceSpy = jasmine.createSpyObj<ProjectsService>('ProjectsService', ['ensureProjectRole']);

    TestBed.configureTestingModule({
      providers: [
        TagsService,
        { provide: Firestore, useValue: firestoreStub },
        { provide: Auth, useValue: authStub },
        { provide: ProjectsService, useValue: projectsServiceSpy },
      ],
    });

    service = TestBed.inject(TagsService);
  });

  it('listTags は色コードを正規化し、キャッシュを古いエントリから整理する', async () => {
    const projectId = 'project-1';
    const assignments = (service as unknown as { getProjectColorAssignments: (pid: string) => Map<string, string> })
      .getProjectColorAssignments(projectId);
    assignments.set('stale-id', '#ABCDEF');

    const fetchTagsRawSpy = spyOn(service as unknown as { fetchTagsRaw: (pid: string) => Promise<unknown[]> }, 'fetchTagsRaw')
      .and.resolveTo([
        { id: 'tag-1', name: 'Tag1', color: '#ff0000', projectId },
        { id: 'tag-2', name: 'Tag2', color: '00ff00', projectId },
      ]);

    const tags = await service.listTags(projectId);

    expect(fetchTagsRawSpy).toHaveBeenCalledWith(projectId);
    expect(tags).toEqual([
      { id: 'tag-1', name: 'Tag1', color: '#FF0000', projectId },
      { id: 'tag-2', name: 'Tag2', color: '#00FF00', projectId },
    ]);
    expect(assignments.get('tag-1')).toBe('#FF0000');
    expect(assignments.get('tag-2')).toBe('#00FF00');
    expect(assignments.has('stale-id')).toBeFalse();
  });

  it('listTags はエラー発生時に空配列を返し、例外を飲み込む', async () => {
    const projectId = 'project-error';
    spyOn(service as unknown as { fetchTagsRaw: (pid: string) => Promise<unknown[]> }, 'fetchTagsRaw')
      .and.rejectWith(new Error('failed to fetch'));
    const consoleErrorSpy = spyOn(console, 'error');

    const result = await service.listTags(projectId);

    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('listTags はカラー未設定や3桁カラーのタグに一意なカラーを割り当て、正規化結果を返す', async () => {
    const projectId = 'project-with-fallback';
    const generateUniqueColorSpy = spyOn(
      service as unknown as { generateUniqueColor: (used: Set<string>) => string },
      'generateUniqueColor',
    ).and.returnValue('#ABCDEF');
    spyOn(service as unknown as { fetchTagsRaw: (pid: string) => Promise<unknown[]> }, 'fetchTagsRaw')
      .and.resolveTo([
        { id: 'tag-green', name: 'Green', color: '#0f0', projectId },
        { id: 'tag-missing', name: 'Missing', color: null, projectId },
      ]);

    const tags = await service.listTags(projectId);

    expect(tags).toEqual([
      { id: 'tag-green', name: 'Green', color: '#00FF00', projectId },
      { id: 'tag-missing', name: 'Missing', color: '#ABCDEF', projectId },
    ]);
    expect(generateUniqueColorSpy).toHaveBeenCalled();
    const assignments = (service as unknown as { getProjectColorAssignments: (pid: string) => Map<string, string> })
      .getProjectColorAssignments(projectId);
    expect(assignments.get('tag-green')).toBe('#00FF00');
    expect(assignments.get('tag-missing')).toBe('#ABCDEF');
  });
});
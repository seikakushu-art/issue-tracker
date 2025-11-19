import { TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Storage } from '@angular/fire/storage';
import { TasksService } from './tasks.service';
import { ProgressService } from '../projects/progress.service';
import { ProjectsService } from '../projects/projects.service';

/**
 * Firebase 関連サービスを動かさないためのシンプルなスタブ
 */
const firestoreStub = {} as unknown as Firestore;
const authStub = { currentUser: null } as unknown as Auth;
const storageStub = {} as unknown as Storage;
const progressServiceStub = {} as unknown as ProgressService;
const projectsServiceStub = {} as unknown as ProjectsService;

describe('TasksService', () => {
  let service: TasksService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TasksService,
        { provide: Firestore, useValue: firestoreStub },
        { provide: Auth, useValue: authStub },
        { provide: Storage, useValue: storageStub },
        { provide: ProgressService, useValue: progressServiceStub },
        { provide: ProjectsService, useValue: projectsServiceStub },
      ],
    });

    service = TestBed.inject(TasksService);
  });

  describe('buildAttachmentStoragePath', () => {
    it('ファイル名をサニタイズしてパスを構成できる', () => {
      const result = (service as unknown as { buildAttachmentStoragePath: (...args: string[]) => string })
        .buildAttachmentStoragePath('proj1', 'issue1', 'task1', 'attach1', 'hello world!.txt');

      expect(result).toBe('projects/proj1/issues/issue1/tasks/task1/attachments/attach1_hello_world_.txt');
    });

    it('連続する空白や記号をまとめて安全なファイル名に置換する', () => {
      const result = (service as unknown as { buildAttachmentStoragePath: (...args: string[]) => string })
        .buildAttachmentStoragePath('proj1', 'issue1', 'task1', 'attach1', '  multi\tspace!? name.pdf');

      expect(result).toBe('projects/proj1/issues/issue1/tasks/task1/attachments/attach1__multi_space__name.pdf');
    });
  });

  describe('chunkArray', () => {
    it('指定サイズで配列を分割する', () => {
      const chunks = (service as unknown as { chunkArray: <T>(items: T[], size: number) => T[][] })
        .chunkArray([1, 2, 3, 4, 5], 2);

      expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('サイズが 0 以下の場合は元配列をそのまま返す', () => {
      const source = [1, 2, 3];
      const chunks = (service as unknown as { chunkArray: <T>(items: T[], size: number) => T[][] })
        .chunkArray(source, 0);

      expect(chunks).toEqual([source]);
    });

    it('分割サイズが配列長より大きい場合は配列全体を 1 つのチャンクとして返す', () => {
      const chunks = (service as unknown as { chunkArray: <T>(items: T[], size: number) => T[][] })
        .chunkArray([1, 2, 3], 10);

      expect(chunks).toEqual([[1, 2, 3]]);
    });

    it('空配列を渡した場合は空配列を返す', () => {
      const chunks = (service as unknown as { chunkArray: <T>(items: T[], size: number) => T[][] })
        .chunkArray([], 3);

      expect(chunks).toEqual([]);
    });
  });
});
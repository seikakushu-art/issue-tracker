import { TestBed } from '@angular/core/testing';
import { SmartFilterService } from './smart-filter.service';
import { Auth } from '@angular/fire/auth';
import { Firestore, collection, doc, QuerySnapshot, DocumentReference } from '@angular/fire/firestore';
import * as firestoreModule from '@angular/fire/firestore';
import { SmartFilterCriteria, SmartFilterPreset } from './smart-filter.model';
import { Importance, TaskStatus } from '../../models/schema';

/**
 * SmartFilterService の振る舞いを確認するテスト
 */
describe('SmartFilterService', () => {
  let service: SmartFilterService;
  const authMock: Partial<Auth> = { currentUser: null };

  jasmine.getEnv().allowRespy(true);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SmartFilterService,
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: authMock },
      ],
    });
    service = TestBed.inject(SmartFilterService);
  });

  it('getPresetsCollection: ユーザーごとのパスでコレクションを取得する', async () => {
    spyOn(service as unknown as { getUserId: () => Promise<string> }, 'getUserId').and.resolveTo('uid-123');
    const collectionRef = { path: 'col-ref' } as ReturnType<typeof collection>;
    const collectionSpy = spyOn(firestoreModule, 'collection').and.returnValue(collectionRef);

    const result = await (service as unknown as { getPresetsCollection: (scope: string) => Promise<ReturnType<typeof collection>> }).getPresetsCollection('issues');

    expect(collectionSpy).toHaveBeenCalledWith(jasmine.anything(), 'users/uid-123/smartFilters/issues/presets');
    expect(result).toEqual(collectionRef);
  });

  it('getPresets: Firestore の結果を整形して返す', async () => {
    const getPresetsCollectionSpy = spyOn(service as unknown as { getPresetsCollection: (scope: string) => Promise<ReturnType<typeof collection>> }, 'getPresetsCollection').and.resolveTo({} as ReturnType<typeof collection>);
    const snapshot = {
      docs: [
        {
          id: 'preset-1',
          data: () => ({ name: 'A', criteria: { tagIds: [], assigneeIds: [], importanceLevels: [], statuses: [], due: '' } }),
        },
        {
          id: 'preset-2',
          data: () => ({ name: 'B', criteria: { tagIds: ['t'], assigneeIds: [], importanceLevels: [], statuses: [], due: 'today' } }),
        },
      ],
    } as unknown as QuerySnapshot;

    const getDocsSpy = spyOn(firestoreModule, 'getDocs').and.resolveTo(snapshot);

    const result = await service.getPresets('issues');

    expect(getPresetsCollectionSpy).toHaveBeenCalledWith('issues');
    expect(getDocsSpy).toHaveBeenCalled();
    expect(result).toEqual([
      { id: 'preset-1', name: 'A', criteria: { tagIds: [], assigneeIds: [], importanceLevels: [], statuses: [], due: '' } },
      { id: 'preset-2', name: 'B', criteria: { tagIds: ['t'], assigneeIds: [], importanceLevels: [], statuses: [], due: 'today' } },
    ]);
  });

  it('getPresets: エラー時は空配列を返す', async () => {
    spyOn(service as unknown as { getPresetsCollection: (scope: string) => Promise<ReturnType<typeof collection>> }, 'getPresetsCollection').and.resolveTo({} as ReturnType<typeof collection>);
    spyOn(firestoreModule, 'getDocs').and.rejectWith(new Error('firestore failure'));

    const result = await service.getPresets('tasks');

    expect(result).toEqual([]);
  });

  it('createPreset: 名前が長すぎる場合は例外を投げる', async () => {
    const longName = 'x'.repeat(51);
    await expectAsync(service.createPreset('projects', longName, {
      tagIds: [],
      assigneeIds: [],
      importanceLevels: [],
      statuses: [],
      due: '',
    })).toBeRejectedWithError('フィルター名は最大50文字までです');
  });

  it('createPreset: 既存の名前と重複するときは例外を投げる', async () => {
    const existing: SmartFilterPreset[] = [{ id: 'preset-1', name: '重複', criteria: { tagIds: [], assigneeIds: [], importanceLevels: [], statuses: [], due: '' } }];
    spyOn(service as unknown as { getPresets: (scope: string) => Promise<SmartFilterPreset[]> }, 'getPresets').and.resolveTo(existing);

    await expectAsync(service.createPreset('issues', ' 重複 ', {
      tagIds: [],
      assigneeIds: [],
      importanceLevels: [],
      statuses: [],
      due: '',
    })).toBeRejectedWithError('「重複」という名前のフィルターは既に存在します');
  });

  it('createPreset: 保存時に名称未設定へフォールバックし、保存結果のIDを返す', async () => {
    spyOn(service as unknown as { getPresets: (scope: string) => Promise<SmartFilterPreset[]> }, 'getPresets').and.resolveTo([]);
    spyOn(service as unknown as { getPresetsCollection: (scope: string) => Promise<ReturnType<typeof collection>> }, 'getPresetsCollection').and.resolveTo({} as ReturnType<typeof collection>);

    const fakeAddDoc = spyOn(firestoreModule, 'addDoc').and.resolveTo({ id: 'generated-id' } as unknown as DocumentReference);

    const criteria: SmartFilterCriteria = {
      tagIds: ['t1'],
      assigneeIds: ['u1'],
      importanceLevels: ['High'],
      statuses: ['in_progress'],
      due: '',
    };

    const result = await service.createPreset('tasks', '   ', criteria);

    expect(fakeAddDoc).toHaveBeenCalled();
    expect(result).toEqual({
      id: 'generated-id',
      name: '名称未設定',
      criteria: {
        tagIds: ['t1'],
        assigneeIds: ['u1'],
        importanceLevels: ['High'],
        statuses: ['in_progress'],
        due: '',
      },
    });
  });

  it('createPreset: 返却する criteria は入力の配列を破壊しない', async () => {
    spyOn(service as unknown as { getPresets: (scope: string) => Promise<SmartFilterPreset[]> }, 'getPresets').and.resolveTo([]);
    spyOn(service as unknown as { getPresetsCollection: (scope: string) => Promise<ReturnType<typeof collection>> }, 'getPresetsCollection').and.resolveTo({} as ReturnType<typeof collection>);

    const addDocSpy = spyOn(firestoreModule, 'addDoc').and.resolveTo({ id: 'copy-check' } as unknown as DocumentReference);

    const criteria: SmartFilterCriteria = {
      tagIds: ['t1'],
      assigneeIds: ['u1'],
      importanceLevels: ['High'],
      statuses: ['in_progress'],
      due: 'today',
    };

    const result = await service.createPreset('tasks', ' original ', criteria);

    criteria.tagIds.push('extra');
    criteria.assigneeIds.push('u2');
    criteria.importanceLevels.push('Low' as Importance);
    criteria.statuses.push('completed' as TaskStatus);
    criteria.due = 'week';

    expect(addDocSpy).toHaveBeenCalled();
    expect(result.criteria.tagIds).toEqual(['t1']);
    expect(result.criteria.assigneeIds).toEqual(['u1']);
    expect(result.criteria.importanceLevels).toEqual(['High']);
    expect(result.criteria.statuses).toEqual(['in_progress']);
    expect(result.criteria.due).toBe('today');
    expect(result.criteria.tagIds).not.toBe(criteria.tagIds);
    expect(result.criteria.assigneeIds).not.toBe(criteria.assigneeIds);
    expect(result.criteria.importanceLevels).not.toBe(criteria.importanceLevels);
    expect(result.criteria.statuses).not.toBe(criteria.statuses);
  });

  it('renamePreset: 他のプリセットと名前が衝突する場合は例外を投げる', async () => {
    spyOn(service as unknown as { getPresets: (scope: string) => Promise<SmartFilterPreset[]> }, 'getPresets').and.resolveTo([
      { id: 'p1', name: '既存', criteria: { tagIds: [], assigneeIds: [], importanceLevels: [], statuses: [], due: '' } },
      { id: 'p2', name: '重複', criteria: { tagIds: [], assigneeIds: [], importanceLevels: [], statuses: [], due: '' } },
    ]);

    await expectAsync(service.renamePreset('issues', 'p1', '重複')).toBeRejectedWithError('「重複」という名前のフィルターは既に存在します');
  });

  it('renamePreset: 名前が長すぎる場合は例外を投げる', async () => {
    await expectAsync(service.renamePreset('issues', 'p1', 'x'.repeat(51))).toBeRejectedWithError('フィルター名は最大50文字までです');
  });

  it('renamePreset: 空文字は名称未設定にフォールバックして更新する', async () => {
    spyOn(service as unknown as { getUserId: () => Promise<string> }, 'getUserId').and.resolveTo('user-2');
    spyOn(service as unknown as { getPresets: (scope: string) => Promise<SmartFilterPreset[]> }, 'getPresets').and.resolveTo([
      { id: 'target', name: 'before', criteria: { tagIds: [], assigneeIds: [], importanceLevels: [], statuses: [], due: '' } },
    ]);

    const docSpy = spyOn(firestoreModule, 'doc').and.callFake((...args: unknown[]) => ({ db: args[0], path: args[1], segments: args.slice(2) } as unknown as ReturnType<typeof doc>));
    const updateDocSpy = spyOn(firestoreModule, 'updateDoc').and.resolveTo(undefined);

    const result = await service.renamePreset('issues', 'target', '   ');

    expect(docSpy.calls.mostRecent()?.args[1]).toBe('users/user-2/smartFilters/issues/presets/target');
    const updateArgs = updateDocSpy.calls.mostRecent()?.args ?? [];
    expect(updateArgs[1] as unknown as Record<string, unknown>).toEqual({ name: '名称未設定' });
    expect(result).toEqual([
      { id: 'target', name: 'before', criteria: { tagIds: [], assigneeIds: [], importanceLevels: [], statuses: [], due: '' } },
    ]);
  });

  it('deletePreset: 削除後のリストを返す', async () => {
    spyOn(service as unknown as { getUserId: () => Promise<string> }, 'getUserId').and.resolveTo('user-1');
    spyOn(service as unknown as { getPresets: () => Promise<SmartFilterPreset[]> }, 'getPresets').and.resolveTo([
      { id: 'after', name: '残る', criteria: { tagIds: [], assigneeIds: [], importanceLevels: [], statuses: [], due: '' } },
    ]);

    const docSpy = spyOn(firestoreModule, 'doc').and.returnValue({ path: 'doc-path' } as ReturnType<typeof doc>);
    const deleteDocSpy = spyOn(firestoreModule, 'deleteDoc').and.resolveTo(undefined);

    const result = await service.deletePreset('tasks', 'remove-id');

    expect(docSpy.calls.mostRecent()?.args[1]).toBe('users/user-1/smartFilters/tasks/presets/remove-id');
    expect(deleteDocSpy).toHaveBeenCalled();
    expect(result).toEqual([
      { id: 'after', name: '残る', criteria: { tagIds: [], assigneeIds: [], importanceLevels: [], statuses: [], due: '' } },
    ]);
  });
});
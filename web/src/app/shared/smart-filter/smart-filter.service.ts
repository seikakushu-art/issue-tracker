import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
} from '@angular/fire/firestore';
import { Auth, User, authState } from '@angular/fire/auth';
import { SmartFilterCriteria, SmartFilterPreset } from './smart-filter.model';
import { firstValueFrom, TimeoutError } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';

/**
 * スマートフィルターをFirestoreに永続化するサービス
 * ユーザーごとに分離して保存される
 */
@Injectable({ providedIn: 'root' })
export class SmartFilterService {
  private db = inject(Firestore);
  private auth = inject(Auth);

  /**
   * 現在のユーザーを取得する（認証待ち）
   */
  private async requireUser(): Promise<User> {
    const current = this.auth.currentUser;
    if (current) {
      return current;
    }

    try {
      const user = await firstValueFrom(
        authState(this.auth).pipe(
          filter((user): user is User => user !== null),
          take(1),
          timeout(2000),
        ),
      );
      return user;
    } catch (error) {
      if (error instanceof TimeoutError) {
        console.warn('Firebase認証の待機がタイムアウトしました');
      } else {
        console.error('Firebase認証の待機中にエラーが発生しました:', error);
      }
      throw new Error('ログインが必要です');
    }
  }

  /**
   * ユーザーIDを取得する
   */
  private async getUserId(): Promise<string> {
    const user = await this.requireUser();
    return user.uid;
  }

  /**
   * スコープごとのプリセットコレクション参照を取得
   */
  private async getPresetsCollection(scope: string): Promise<ReturnType<typeof collection>> {
    const userId = await this.getUserId();
    return collection(this.db, `users/${userId}/smartFilters/${scope}/presets`);
  }

  /**
   * プリセット一覧を取得する
   */
  async getPresets(scope: string): Promise<SmartFilterPreset[]> {
    try {
      const presetsRef = await this.getPresetsCollection(scope);
      const snapshot = await getDocs(presetsRef);
      return snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as SmartFilterPreset;
        return {
          ...data,
          id: docSnap.id,
        };
      });
    } catch (error) {
      console.warn('スマートフィルターの読み込みに失敗しました', error);
      return [];
    }
  }

  /**
   * プリセットを新規作成し、保存後に返す
   */
  async createPreset(scope: string, name: string, criteria: SmartFilterCriteria): Promise<SmartFilterPreset> {
    const trimmedName = name.trim();
    
    // スマートフィルター名の文字数上限チェック（50文字）
    const MAX_PRESET_NAME_LENGTH = 50;
    if (trimmedName.length > MAX_PRESET_NAME_LENGTH) {
      throw new Error(`フィルター名は最大${MAX_PRESET_NAME_LENGTH}文字までです`);
    }
    
    // 名前の重複チェック
    const existingPresets = await this.getPresets(scope);
    const finalName = trimmedName.length > 0 ? trimmedName : '名称未設定';
    if (existingPresets.some(preset => preset.name === finalName)) {
      throw new Error(`「${finalName}」という名前のフィルターは既に存在します`);
    }
    
    const presetData: Omit<SmartFilterPreset, 'id'> = {
      name: finalName,
      criteria: {
        tagIds: [...criteria.tagIds],
        assigneeIds: [...criteria.assigneeIds],
        importanceLevels: [...criteria.importanceLevels],
        statuses: [...criteria.statuses],
        due: criteria.due,
      },
    };

    const presetsRef = await this.getPresetsCollection(scope);
    const docRef = await addDoc(presetsRef, presetData);
    
    return {
      ...presetData,
      id: docRef.id,
    };
  }

  /**
   * 既存プリセットの名称を変更する
   */
  async renamePreset(scope: string, presetId: string, nextName: string): Promise<SmartFilterPreset[]> {
    const trimmed = nextName.trim();
    
    // スマートフィルター名の文字数上限チェック（50文字）
    const MAX_PRESET_NAME_LENGTH = 50;
    if (trimmed.length > MAX_PRESET_NAME_LENGTH) {
      throw new Error(`フィルター名は最大${MAX_PRESET_NAME_LENGTH}文字までです`);
    }
    
    const finalName = trimmed.length > 0 ? trimmed : '名称未設定';
    const existingPresets = await this.getPresets(scope);
    
    // 名前の重複チェック（自分自身は除外）
    if (existingPresets.some(preset => preset.id !== presetId && preset.name === finalName)) {
      throw new Error(`「${finalName}」という名前のフィルターは既に存在します`);
    }
    
    // Firestoreのドキュメントを更新
    const userId = await this.getUserId();
    const presetRef = doc(this.db, `users/${userId}/smartFilters/${scope}/presets/${presetId}`);
    await updateDoc(presetRef, { name: finalName });
    
    // 更新後の一覧を返す
    return await this.getPresets(scope);
  }

  /**
   * 指定したプリセットを削除する
   */
  async deletePreset(scope: string, presetId: string): Promise<SmartFilterPreset[]> {
    const userId = await this.getUserId();
    const presetRef = doc(this.db, `users/${userId}/smartFilters/${scope}/presets/${presetId}`);
    await deleteDoc(presetRef);
    
    // 削除後の一覧を返す
    return await this.getPresets(scope);
  }
}

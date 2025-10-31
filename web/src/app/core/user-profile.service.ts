import { Injectable, inject, signal } from '@angular/core';
import { Auth, User, authState, updateProfile } from '@angular/fire/auth';
import {
  Storage,
  getDownloadURL,
  ref,
  uploadBytes,
} from '@angular/fire/storage';
import type { UserProfile } from 'firebase/auth';

/**
 * ユーザーのプロフィール情報を集中管理するサービス
 * アイコンのアップロードや表示名の更新をこのクラスで実施する
 */
@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly auth = inject(Auth);
  private readonly storage = inject(Storage);

  /**
   * Firebase Auth のログイン状態を Signal として保持
   * UI 側からは user() で常に最新の情報を参照できる
   */
  readonly user = signal<User | null>(this.auth.currentUser);

  constructor() {
    // authState を購読し、ログイン状態が変化したら Signal を更新する
    authState(this.auth).subscribe((authUser) => {
      this.user.set(authUser);
    });
  }

  /**
   * 表示名やアイコン画像の更新をまとめて実行する
   */
  async updateUserProfile(options: {
    displayName?: string;
    photoFile?: File | null;
  }): Promise<void> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      throw new Error('ログインしていません');
    }

    // アップロード後のダウンロード URL を格納
    let nextPhotoUrl: string | null | undefined;

    if (options.photoFile instanceof File) {
      // File が渡された場合は Storage にアップロードして URL を取得
      nextPhotoUrl = await this.uploadAvatar(currentUser.uid, options.photoFile);
    } else if (options.photoFile === null) {
      // null が渡された場合はアイコンを削除する意図とみなし null を設定
      nextPhotoUrl = null;
    }

    const profileUpdates: Partial<UserProfile> = {};

    if (options.displayName !== undefined) {
      profileUpdates['displayName'] = options.displayName;
    }

    if (nextPhotoUrl !== undefined) {
      profileUpdates['photoURL'] = nextPhotoUrl;
    }

    // 更新項目がなければ即終了
    if (Object.keys(profileUpdates).length === 0) {
      return;
    }

    // Firebase Auth 上のプロフィール情報を更新
    await updateProfile(currentUser, profileUpdates);

    // 最新情報を再取得し Signal 側も同期させる
    await currentUser.reload();
    this.user.set(this.auth.currentUser);
  }

  /**
   * ユーザー毎に 1 枚のアイコンを Storage に保存し URL を返す
   */
  private async uploadAvatar(uid: string, file: File): Promise<string> {
    // ユーザー ID 毎に固定パスへアップロードすることで最新画像で上書きできるようにする
    const storageRef = ref(this.storage, `avatars/${uid}/avatar.png`);
    await uploadBytes(storageRef, file, {
      contentType: file.type,
    });
    return getDownloadURL(storageRef);
  }
}
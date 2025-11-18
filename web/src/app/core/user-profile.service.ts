import { Injectable, inject, signal } from '@angular/core';
import { Auth, User, authState, updateProfile } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import {
  Storage,
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from '@angular/fire/storage';
import type { UserProfile } from 'firebase/auth';

/**
 * ユーザーのプロフィール情報を集中管理するサービス
 * ユーザー名の初期登録とアイコンのアップロードを担当する
 */
@Injectable({ providedIn: 'root' })
export class UserProfileService {
  private readonly auth = inject(Auth);
  private readonly storage = inject(Storage);
  private readonly db = inject(Firestore);

  /**
   * Firebase Auth のログイン状態を Signal として保持
   * UI 側からは user() で常に最新の情報を参照できる
   */
  readonly user = signal<User | null>(this.auth.currentUser);
  /** Firestore 上のユーザー名を保持する Signal */
  readonly username = signal<string | null>(null);
  /** Firestore 上のプロフィール情報（ユーザー名＋アイコンURL）を保持 */
  readonly directoryProfile = signal<{ username: string; photoURL: string | null } | null>(null);

  constructor() {
    // authState を購読し、ログイン状態が変化したら Signal を更新する
    authState(this.auth).subscribe((authUser) => {
      this.user.set(authUser);
      void this.refreshDirectoryProfile(authUser);
    });
  }

  /**
   * 新規アカウント向けにユーザー名を登録し、必要であればアイコンをアップロードする
   */
  async initializeUserProfile(options: { username: string; photoFile?: File | null }): Promise<void> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      throw new Error('ログインしていません');
    }

    const normalized = this.normalizeUsername(options.username);
    if (!normalized) {
      throw new Error('ユーザー名は3〜10文字の半角英数字またはアンダースコアで入力してください');
    }
    const available = await this.isUsernameAvailable(normalized);
    if (!available) {
      throw new Error('このユーザー名は既に使用されています');
    }

    let photoUrl: string | null = null;

    if (options.photoFile instanceof File) {
      photoUrl = await this.uploadAvatar(normalized, options.photoFile);
    }

    await setDoc(doc(this.db, 'users', currentUser.uid), {
      username: normalized,
      photoURL: photoUrl,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const profileUpdates: Partial<UserProfile> = { displayName: normalized };
    if (photoUrl !== null) {
      profileUpdates['photoURL'] = photoUrl;
    }
    await updateProfile(currentUser, profileUpdates);
    await currentUser.reload();
    this.user.set(this.auth.currentUser);
    await this.refreshDirectoryProfile(this.auth.currentUser);
  }

  /**
   * ユーザー名の利用可否を判定する
   */
  async isUsernameAvailable(username: string): Promise<boolean> {
    const normalized = this.normalizeUsername(username);
    if (!normalized) {
      return false;
    }
    const usersRef = collection(this.db, 'users');
    const snapshot = await getDocs(query(usersRef, where('username', '==', normalized), limit(1)));
    return snapshot.empty;
  }

  /**
   * ユーザーのアイコンを更新する（ユーザー名は変更不可）
   */
  async updateUserAvatar(options: { photoFile?: File | null } = {}): Promise<void> {
    const currentUser = this.auth.currentUser;
    if (!currentUser) {
      throw new Error('ログインしていません');
    }

    const currentUsername = this.username();
    if (!currentUsername) {
      throw new Error('ユーザー名が登録されていません');
    }

    // 既存のアイコンURLを取得（削除時にStorageからも削除するため）
    const directoryProfile = this.directoryProfile();
    const currentPhotoUrl = directoryProfile?.photoURL ?? currentUser.photoURL ?? null;

    let nextPhotoUrl: string | null | undefined;
    if (options.photoFile instanceof File) {
      nextPhotoUrl = await this.uploadAvatar(currentUsername, options.photoFile);
      // 新しいアイコンをアップロードした場合、古いアイコンをStorageから削除
      if (currentPhotoUrl && currentPhotoUrl !== nextPhotoUrl) {
        try {
          // Storageのパスを抽出して削除
          const storageRef = ref(this.storage, `avatars/${currentUsername}/avatar.png`);
          await deleteObject(storageRef);
        } catch (error) {
          console.warn('古いアイコンファイルの削除に失敗しました:', error);
          // エラーが発生しても続行（ファイルが既に存在しない場合など）
        }
      }
    } else if (options.photoFile === null) {
      nextPhotoUrl = null;
      // アイコンを削除する場合、Storageからも削除
      if (currentPhotoUrl) {
        try {
          const storageRef = ref(this.storage, `avatars/${currentUsername}/avatar.png`);
          await deleteObject(storageRef);
        } catch (error) {
          console.warn('アイコンファイルの削除に失敗しました:', error);
          // エラーが発生しても続行（ファイルが既に存在しない場合など）
        }
      }
      // 掲示板投稿のauthorPhotoUrlもnullに更新
      try {
        await this.updateBulletinPostsPhotoUrl(currentUser.uid, null);
      } catch (error) {
        console.warn('掲示板投稿のアイコン更新に失敗しました:', error);
        // エラーが発生しても続行
      }
    }

    const profileUpdates: Partial<UserProfile> = {};

    if (nextPhotoUrl !== undefined) {
      // Firebase Authでは、nullの代わりに空文字列を使用してアイコンを削除
      profileUpdates['photoURL'] = nextPhotoUrl ?? '';
    }

    if (Object.keys(profileUpdates).length > 0) {
      await updateProfile(currentUser, profileUpdates);
      await setDoc(
        doc(this.db, 'users', currentUser.uid),
        {
          photoURL: nextPhotoUrl ?? null,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (Object.keys(profileUpdates).length > 0) {
      await currentUser.reload();
      this.user.set(this.auth.currentUser);
      await this.refreshDirectoryProfile(this.auth.currentUser);
    }
  }

  /**
   * Firestore からユーザーディレクトリ情報を取得して Signal に反映する
   */
  private async refreshDirectoryProfile(authUser: User | null): Promise<void> {
    if (!authUser) {
      this.username.set(null);
      this.directoryProfile.set(null);
      return;
    }

    try {
      const snap = await getDoc(doc(this.db, 'users', authUser.uid));
      if (!snap.exists()) {
        this.username.set(null);
        this.directoryProfile.set(null);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      const usernameValue = typeof data['username'] === 'string' ? data['username'].trim() : '';
      const normalized = this.normalizeUsername(usernameValue);
      const photoValue = typeof data['photoURL'] === 'string' && data['photoURL'].trim().length > 0
        ? data['photoURL'].trim()
        : null;
      if (!normalized) {
        this.username.set(null);
        this.directoryProfile.set(null);
        return;
      }
      this.username.set(normalized);
      this.directoryProfile.set({ username: normalized, photoURL: photoValue });
    } catch (error) {
      console.error('ユーザープロフィールの取得に失敗しました:', error);
      this.username.set(null);
      this.directoryProfile.set(null);
    }
  }

  /**
   * ユーザー名をバリデーションし、正当な場合のみ正規化して返す
   */
  private normalizeUsername(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim().toLowerCase();
    const pattern = /^[a-z0-9_]{3,10}$/;
    return pattern.test(trimmed) ? trimmed : null;
  }

  /**
   * 指定したユーザー名で Storage にアイコンをアップロードし URL を返す
   */
  private async uploadAvatar(username: string, file: File): Promise<string> {
    const storageRef = ref(this.storage, `avatars/${username}/avatar.png`);
    await uploadBytes(storageRef, file, {
      contentType: file.type,
    });
    return getDownloadURL(storageRef);
  }

  /**
   * 掲示板投稿のauthorPhotoUrlを更新する
   */
  private async updateBulletinPostsPhotoUrl(authorId: string, photoUrl: string | null): Promise<void> {
    const postsRef = collection(this.db, 'bulletinPosts');
    const postsQuery = query(postsRef, where('authorId', '==', authorId));
    const snapshot = await getDocs(postsQuery);

    const updatePromises = snapshot.docs.map((postDoc) =>
      updateDoc(postDoc.ref, {
        authorPhotoUrl: photoUrl,
        updatedAt: serverTimestamp(),
      }),
    );

    await Promise.all(updatePromises);
  }
}
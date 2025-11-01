import { Injectable, inject } from '@angular/core';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

export interface UserDirectoryProfile {
  uid: string;
  displayName: string;
  photoURL: string | null;
}

@Injectable({ providedIn: 'root' })
export class UserDirectoryService {
  private readonly db = inject(Firestore);

  /**
   * 指定したユーザーID一覧のプロフィール情報を取得する
   * Firestore の users コレクションから displayName / photoURL を参照し、
   * 情報が存在しない場合はフォールバックとして UID を表示名に利用する
   */
  async getProfiles(uids: string[]): Promise<UserDirectoryProfile[]> {
    const uniqueIds = Array.from(new Set((uids ?? []).filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)));
    if (uniqueIds.length === 0) {
      return [];
    }

    const results = await Promise.all(
      uniqueIds.map(async (uid) => {
        try {
          const snapshot = await getDoc(doc(this.db, 'users', uid));
          if (snapshot.exists()) {
            const data = snapshot.data() as Record<string, unknown>;
            const rawDisplayName = data['displayName'];
            const rawPhotoUrl = data['photoURL'] ?? data['photoUrl'];
            const displayName = typeof rawDisplayName === 'string' && rawDisplayName.trim().length > 0
              ? rawDisplayName.trim()
              : uid;
            const photoURL = typeof rawPhotoUrl === 'string' && rawPhotoUrl.trim().length > 0
              ? rawPhotoUrl
              : null;
            return { uid, displayName, photoURL } satisfies UserDirectoryProfile;
          }
        } catch (error) {
          console.error('ユーザープロフィールの取得に失敗しました:', uid, error);
        }
        return { uid, displayName: uid, photoURL: null } satisfies UserDirectoryProfile;
      })
    );

    const profileMap = new Map(results.map((profile) => [profile.uid, profile]));
    return uniqueIds.map((uid) => profileMap.get(uid) ?? { uid, displayName: uid, photoURL: null });
  }
}
import { Injectable, inject } from '@angular/core';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import {
  Firestore, collection, query, where, onSnapshot, Unsubscribe
} from '@angular/fire/firestore';

@Injectable({ providedIn: 'root' })
export class ProjectsLiveService {
  private auth = inject(Auth);
  private db = inject(Firestore);
  private unsub: Unsubscribe | undefined;

  init() {
    console.log('[live] init called');
    onAuthStateChanged(this.auth, (user) => {
      // 既存購読は止める
      this.unsub?.(); this.unsub = undefined;

      if (!user) {
        console.log('[live] not signed in → no listen');
        return; // ★ 未ログインでは購読しない
      }

      const q = query(
        collection(this.db, 'projects'),
        where('memberIds', 'array-contains', user.uid)
      );

      console.log('[live] start listen for uid =', user.uid);
      this.unsub = onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          console.log('[live] projects:', list);
        },
        (err) => console.error('[live] listen error:', err)
      );
    });
  }

  destroy() { this.unsub?.(); this.unsub = undefined; }
}

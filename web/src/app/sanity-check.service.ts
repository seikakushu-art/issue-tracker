import { Injectable, inject } from '@angular/core';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { getApps } from 'firebase/app';

@Injectable({ providedIn: 'root' })
export class SanityCheckService {
  private db = inject(Firestore);

  async ping() {
    console.log('[PING] start');
    console.log('[PING] apps =', getApps().map(a => a.name));
    // まずは存在しないコレクションでOK：疎通確認用
    const snap = await getDocs(collection(this.db, '__ping__'));
    console.log('[PING] Firestore OK / docs:', snap.size);
  }
}

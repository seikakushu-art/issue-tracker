import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  query,
  where,
  getDocs,
  Timestamp,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Task } from '../models/schema';
//通知サービス
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private db = inject(Firestore);
  private auth = inject(Auth);

  async tasksDueToday() {
    const uid = this.auth.currentUser?.uid;
    if (!uid) return [] as Task[];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999,
    );

    const q = query(
      collection(this.db, 'tasks'),
      where('assigneeIds', 'array-contains', uid),
      where('endDate', '>=', Timestamp.fromDate(start)),
      where('endDate', '<=', Timestamp.fromDate(end)),
      where('status', 'in', ['todo', 'doing']),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Task) }));
  }
}

import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  doc,
  updateDoc,
} from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Project } from '../../models/schema';
//プロジェクトを作成する
@Injectable({ providedIn: 'root' })
export class ProjectsService {
  private db = inject(Firestore);
  private auth = inject(Auth);

  async createProject(input: {
    name: string;
    description?: string;
    startDate?: Date;
    endDate?: Date;
    goal?: string;
  }) {
    console.log('●●●createProject called with:', input); 
    const uid = this.auth.currentUser?.uid;
    if (!uid) 
      {console.error('●●●User not authenticated - createProject');
        throw new Error('not signed in');
      }
    const payload: Record<string, unknown> = {
      name: input.name,
      memberIds: [uid],
      roles: { [uid]: 'admin' },
      archived: false,
      createdAt: serverTimestamp(), // 最初から入れて OK
    };
    if (input.description !== undefined) payload['description'] = input.description;
    if (input.goal !== undefined) payload['goal'] = input.goal;
    if (input.startDate !== undefined) payload['startDate'] = input.startDate;
    if (input.endDate !== undefined) payload['endDate'] = input.endDate;
    console.log('●●●Creating document with payload:', payload);
    try {
    const ref = await addDoc(collection(this.db, 'projects'), payload);
    console.log('●●●Document created with ID:', ref.id);
    return ref.id;
    } catch (error) {
      console.error('●●●Error creating document:', error);
      throw error;
    }
  }
  async listMyProjects(): Promise<Project[]> {
    console.log('●●●listMyProjects called');
    const uid = this.auth.currentUser?.uid;
    console.log('●●●Current UID:', uid); 
    if (!uid) {
      console.error('●●●User not authenticated - returning empty array');
      return [];
    }
    try {
      console.log('●●●Creating Firestore query...');
    const q = query(
      collection(this.db, 'projects'),
      where('memberIds', 'array-contains', uid),
    );
    console.log('●●●Executing Firestore query...');
    const snap = await getDocs(q);
    console.log('●●●Firestore query completed, documents:', snap.docs.length);
    const projects = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Project) }));
    console.log('●●●Mapped projects:', projects);
    return projects;
    } catch (error) {
      console.error('●●●Error in listMyProjects:', error);
      return [];
    }
  }

  async archive(id: string, archived: boolean) {
    return updateDoc(doc(this.db, 'projects', id), { archived });
  }
}

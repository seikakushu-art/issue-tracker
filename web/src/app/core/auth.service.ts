import { Injectable, inject } from '@angular/core';
import {
  Auth,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
} from '@angular/fire/auth';
import {
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type ActionCodeSettings,
} from 'firebase/auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);

  private verificationSettings(): ActionCodeSettings {
    return { url: `${location.origin}/login`, handleCodeInApp: false };
  }

  async setRemember(remember: boolean) {
    // ここで選択に応じて永続化層を切替
    await setPersistence(
      this.auth,
      remember ? browserLocalPersistence : browserSessionPersistence,
    );
  }

  async register(email: string, password: string, displayName: string) {
    const cred = await createUserWithEmailAndPassword(
      this.auth,
      email,
      password,
    );
    if (displayName) await updateProfile(cred.user, { displayName });
    await cred.user.reload();
    await sendEmailVerification(cred.user, this.verificationSettings());
    return cred.user;
  }

  login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  logout() {
    return signOut(this.auth);
  }

  resetPassword(email: string) {
    return sendPasswordResetEmail(this.auth, email);
  }

  async resendVerification() {
    const user = this.auth.currentUser;
    if (!user) throw new Error('ログインしていません');
    await sendEmailVerification(user, this.verificationSettings());
  }
}

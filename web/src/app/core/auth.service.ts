import { Injectable, inject } from '@angular/core';
import {
  Auth,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from '@angular/fire/auth';
import {
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type ActionCodeSettings,
} from 'firebase/auth';

const REMEMBER_EXPIRES_KEY = 'issue-tracker:remember-expires-at';
@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);

  private verificationSettings(): ActionCodeSettings {
    return { url: `${location.origin}/login`, handleCodeInApp: false };
  }

  async applyRememberPreference(remember: boolean) {
    await setPersistence(
      this.auth,
      remember ? browserLocalPersistence : browserSessionPersistence,
    );

    if (!remember) {
      this.clearRememberMarker();
    }
  }

  markRememberSession(durationDays = 30) {
    if (!this.hasStorage()) {
      return;
    }
    const expiresAt = Date.now() + durationDays * 24 * 60 * 60 * 1000;
    try {
      window.localStorage.setItem(REMEMBER_EXPIRES_KEY, String(expiresAt));
    } catch (error) {
      console.warn('ログイン状態の保持情報を保存できませんでした:', error);
    }
  }

  clearRememberMarker() {
    if (!this.hasStorage()) {
      return;
    }
    try {
      window.localStorage.removeItem(REMEMBER_EXPIRES_KEY);
    } catch (error) {
      console.warn('ログイン状態の保持情報を削除できませんでした:', error);
    }
  }

  isRememberSessionValid(): boolean {
    if (!this.hasStorage()) {
      return true;
    }
    try {
      const raw = window.localStorage.getItem(REMEMBER_EXPIRES_KEY);
      // マーカーがない場合は、rememberをチェックしなかったセッションと判断
      // この場合、FirebaseのbrowserSessionPersistenceに依存するため、
      // ブラウザを閉じると自動的にログアウトされる
      if (!raw) {
        return true;
      }
      const expiresAt = Number.parseInt(raw, 10);
      if (Number.isNaN(expiresAt)) {
        this.clearRememberMarker();
        return true;
      }
      // 有効期限が切れていない場合は有効
      if (expiresAt > Date.now()) {
        return true;
      }
      // 有効期限が切れている場合は無効
      this.clearRememberMarker();
      return false;
    } catch (error) {
      console.warn('ログイン状態の保持情報を読み取れませんでした:', error);
      return true;
    }
  }

  private hasStorage(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  async register(email: string, password: string) {
    const cred = await createUserWithEmailAndPassword(
      this.auth,
      email,
      password,
    );
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

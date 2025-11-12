import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { AuthService } from './auth.service';
import { isPlatformBrowser } from '@angular/common';

/**
 * Firebase 認証状態に応じてアクセス制御を行うガード
 * 未ログイン時はログイン画面へリダイレクトする
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);
  const platformId = inject(PLATFORM_ID);

  // SSR（サーバーレンダリング）側ではログイン状態を正しく判定できないため、
  // ここでルートガードを強制的に止めると毎回ログイン画面が描画される。
  // ブラウザでのハイドレーション後に改めて判定させる方が体験が安定するので、
  // サーバー上では常に通過させるようにして画面チラツキを抑える。
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const rememberValid = authService.isRememberSessionValid();
  if (!rememberValid) {
    try {
      await auth.signOut();
    } catch (error) {
      console.warn('ログアウト処理に失敗しました:', error);
    }
  }

  try {
    // Firebase Auth が現在のユーザー情報を確定するまで待機することで、
    // 再読み込み時の一時的な未ログイン判定を防止する狙い。
    await auth.authStateReady();
  } catch (error) {
    console.warn('認証状態の初期化に失敗しました:', error);
  }

  // authStateReady() の後で currentUser を参照すると、
  // ブラウザ上では確定したログイン情報を基に判定できる。
  const currentUser = auth.currentUser;

  if (currentUser) {
    return true;
  }

  const params: Record<string, string> = {};
  if (state.url && state.url !== '/' && state.url !== '/login') {
    params['redirect'] = state.url;
  }

  const extras = Object.keys(params).length > 0 ? { queryParams: params } : undefined;
  return router.createUrlTree(['/login'], extras);
};
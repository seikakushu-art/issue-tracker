import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth, authState } from '@angular/fire/auth';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { AuthService } from './auth.service';

/**
 * Firebase 認証状態に応じてアクセス制御を行うガード
 * 未ログイン時はログイン画面へリダイレクトする
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const authService = inject(AuthService);

  const rememberValid = authService.isRememberSessionValid();
  if (!rememberValid) {
    try {
      await auth.signOut();
    } catch (error) {
      console.warn('ログアウト処理に失敗しました:', error);
    }
  }

  let currentUser = auth.currentUser;
  if (!currentUser) {
    try {
      currentUser = await firstValueFrom(authState(auth).pipe(take(1)));
    } catch (error) {
      console.warn('認証状態の取得に失敗しました:', error);
      currentUser = null;
    }
  }

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
import { inject, PLATFORM_ID } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { Firestore, getDoc, doc } from '@angular/fire/firestore';
import { isPlatformBrowser } from '@angular/common';
import { FirebaseError } from '@angular/fire/app';

/**
 * プロジェクトメンバーシップをチェックするガード
 * プロジェクトにアクセスできない場合はプロジェクト一覧へリダイレクト
 */
export const projectGuard: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const db = inject(Firestore);
  const platformId = inject(PLATFORM_ID);

  // SSR側ではチェックをスキップ
  if (!isPlatformBrowser(platformId)) {
    return true;
  }

  const projectId = route.params['projectId'];
  if (!projectId) {
    // projectIdがない場合はプロジェクト一覧へ
    return router.createUrlTree(['/projects']);
  }

  try {
    // 認証状態を待機
    await auth.authStateReady();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      // 未ログインの場合はログイン画面へ
      return router.createUrlTree(['/login'], {
        queryParams: { redirect: route.url.join('/') }
      });
    }

    // プロジェクトの存在とメンバーシップをチェック
    const projectDoc = await getDoc(doc(db, 'projects', projectId));
    
    if (!projectDoc.exists()) {
      // プロジェクトが存在しない場合
      return router.createUrlTree(['/projects'], {
        queryParams: { error: 'not_found' }
      });
    }

    const projectData = projectDoc.data();
    const memberIdsRaw = projectData?.['memberIds'];
    
    // memberIdsは配列またはオブジェクトの可能性がある
    let isMember = false;
    if (Array.isArray(memberIdsRaw)) {
      // 配列の場合
      isMember = memberIdsRaw.includes(currentUser.uid);
    } else if (memberIdsRaw && typeof memberIdsRaw === 'object') {
      // オブジェクト（マップ）の場合
      isMember = currentUser.uid in memberIdsRaw;
    }
    
    if (!isMember) {
      // メンバーでない場合
      return router.createUrlTree(['/projects'], {
        queryParams: { error: 'access_denied' }
      });
    }

    // メンバーの場合はアクセス許可
    return true;
  } catch (error) {
    console.error('プロジェクトアクセスチェックに失敗しました:', error);
    
    // Firebaseの権限エラーの場合
    if (error instanceof FirebaseError && error.code === 'permission-denied') {
      return router.createUrlTree(['/projects'], {
        queryParams: { error: 'access_denied' }
      });
    }

    // その他のエラーの場合もプロジェクト一覧へ
    return router.createUrlTree(['/projects'], {
      queryParams: { error: 'unknown' }
    });
  }
};


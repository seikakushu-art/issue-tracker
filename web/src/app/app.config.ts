import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';

import { initializeApp } from 'firebase/app';
import { provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import { getStorage, provideStorage } from '@angular/fire/storage';

//  Web アプリ設定をそのままコピペ
const firebaseConfig = {
  apiKey: 'AIzaSyAks1R4s_hy_t5NvJXU9HFtMlIXSxksZZM',
  authDomain: 'kensyu10115.firebaseapp.com',
  projectId: 'kensyu10115',
  storageBucket: 'kensyu10115.appspot.com', 
  messagingSenderId: '412477725597',
  appId: '1:412477725597:web:90766942d4dc9446f52d74',
  measurementId: 'G-5S4Z76V2KN', 
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideClientHydration(),

    // Firebase はここで1回だけ初期化
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideFunctions(() => getFunctions()),
    provideStorage(() => getStorage()),
  ],
};

// src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { setLogLevel } from 'firebase/firestore';

bootstrapApplication(AppComponent, appConfig).catch(console.error);
setLogLevel('debug');

import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

// AngularFire のトークンをインポート
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // スタンドアロンコンポーネントなので imports にそのまま入れる
      imports: [AppComponent],
      providers: [
        // ActivatedRoute のダミー
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              params: {},
              queryParams: {},
              data: {},
            },
            params: of({}),
            queryParams: of({}),
            data: of({}),
            fragment: of(null),
            url: of([]),
          },
        },
        // ProjectsService が注入している Firestore / Auth / Storage のダミー
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser: null } },
        { provide: Storage, useValue: {} },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    // 実際の <h1> のテキストに合わせてここだけ変えてOK
    // 例: <h1>課題管理アプリ</h1> なら '課題管理アプリ'
    expect(compiled.querySelector('h1')?.textContent ?? '').toContain('Issue Tracker');
  });
});


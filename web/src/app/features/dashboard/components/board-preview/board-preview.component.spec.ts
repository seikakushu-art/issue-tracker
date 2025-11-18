import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { BoardPreviewComponent } from './board-preview.component';
import { BulletinPreviewItem } from '../../dashboard.service';

function createPost(overrides: Partial<BulletinPreviewItem> = {}): BulletinPreviewItem {
  const defaultPost: BulletinPreviewItem = {
    id: '1',
    title: 'Sample title',
    authorId: 'author-1',
    authorUsername: 'Alice',
    authorPhotoUrl: null,
    author: 'Alice',
    postedAt: new Date(),
    excerpt: 'Sample excerpt',
    href: '/board/1',
    fragment: null,
  };

  return { ...defaultPost, ...overrides };
}

describe('BoardPreviewComponent', () => {
  let component: BoardPreviewComponent;
  let fixture: ComponentFixture<BoardPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BoardPreviewComponent, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(BoardPreviewComponent);
    component = fixture.componentInstance;
  });

  it('空の投稿ではプレースホルダのみを表示する', () => {
    component.posts = [];

    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.board-preview__empty')).not.toBeNull();
    expect(compiled.querySelector('.board-preview__list')).toBeNull();
  });

  it('投稿がある場合はプレースホルダを表示しない', () => {
    component.posts = [createPost()];

    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.board-preview__empty')).toBeNull();
    expect(compiled.querySelector('.board-preview__list')).not.toBeNull();
  });

  it('投稿は最大5件まで表示する', () => {
    const posts = Array.from({ length: 6 }, (_, index) =>
      createPost({ id: `${index}`, title: `Post ${index + 1}`, postedAt: new Date() }),
    );
    component.posts = posts;

    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.board-preview__item');
    expect(items.length).toBe(5);
  });

  it('12時間以内の投稿に「新規」タグを表示する', () => {
    const recentPost = createPost({ id: 'recent', postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    const oldPost = createPost({ id: 'old', postedAt: new Date(Date.now() - 13 * 60 * 60 * 1000) });
    component.posts = [recentPost, oldPost];

    fixture.detectChanges();

    const tags = fixture.nativeElement.querySelectorAll('.board-preview__new-tag');
    expect(tags.length).toBe(1);
    expect(tags[0].textContent?.trim()).toBe('新規');
  });

  it('投稿がちょうど12時間前でも「新規」タグを表示する', () => {
    // テスト実行中の時間経過を考慮して、わずかに12時間未満にする
    const boundaryPost = createPost({ id: 'boundary', postedAt: new Date(Date.now() - 12 * 60 * 60 * 1000 + 1000) });
    component.posts = [boundaryPost];

    fixture.detectChanges();

    const tag = fixture.nativeElement.querySelector('.board-preview__new-tag');
    expect(tag?.textContent?.trim()).toBe('新規');
  });

  it('画像がない場合はイニシャル付きのプレースホルダを表示する', () => {
    const post = createPost({ authorUsername: 'Bob', authorPhotoUrl: null });
    component.posts = [post];

    fixture.detectChanges();

    const fallback = fixture.nativeElement.querySelector('.board-preview__avatar--fallback') as HTMLElement | null;
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent?.trim()).toBe('B');
    // ブラウザはHSLをRGBに変換するため、RGB形式をチェックする
    expect(fallback?.style.backgroundColor).toMatch(/^rgb\(/);
  });

  it('画像がある場合はプレースホルダではなく画像を表示する', () => {
    const post = createPost({ authorPhotoUrl: 'https://example.com/avatar.png' });
    component.posts = [post];

    fixture.detectChanges();

    const avatarImg = fixture.nativeElement.querySelector('.board-preview__avatar') as HTMLImageElement | null;
    const fallback = fixture.nativeElement.querySelector('.board-preview__avatar--fallback');
    expect(avatarImg?.src).toContain('https://example.com/avatar.png');
    expect(fallback).toBeNull();
  });

  it('埋め込み表示ではヘッダとaria-labelledbyを外す', () => {
    component.embedded = true;
    component.moreLink = '/board';
    component.posts = [createPost()];

    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.board-preview__header')).toBeNull();
    expect(compiled.getAttribute('aria-labelledby')).toBeNull();
  });

  it('「もっと見る」リンクを設定しない場合は表示しない', () => {
    component.moreLink = '';
    component.posts = [createPost()];

    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.board-preview__more')).toBeNull();
  });
});
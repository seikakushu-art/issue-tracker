import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProgressGanttTimelineComponent } from './progress-gantt-timeline.component';

describe('ProgressGanttTimelineComponent', () => {
  let fixture: ComponentFixture<ProgressGanttTimelineComponent>;
  let component: ProgressGanttTimelineComponent;

  const timeline = [
    { date: new Date('2024-01-01T00:00:00Z'), isWeekend: false, isHoliday: false, isToday: false, dayLabel: '1', weekdayLabel: '月' },
    { date: new Date('2024-01-02T00:00:00Z'), isWeekend: false, isHoliday: false, isToday: false, dayLabel: '2', weekdayLabel: '火' },
    { date: new Date('2024-01-03T00:00:00Z'), isWeekend: false, isHoliday: false, isToday: true, dayLabel: '3', weekdayLabel: '水' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressGanttTimelineComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ProgressGanttTimelineComponent);
    component = fixture.componentInstance;
    component.timeline = timeline;
    component.timelineMonths = [{ label: '2024年1月', span: timeline.length }];
    component.gridTemplate = 'repeat(3, 1fr)';
    fixture.detectChanges();
  });

  it('スクロールを親へ通知する', () => {
    const scrolledSpy = jasmine.createSpy('scrolled');
    component.scrolled.subscribe(scrolledSpy);

    const viewport = component.nativeElement!;
    viewport.dispatchEvent(new Event('scroll'));

    expect(scrolledSpy).toHaveBeenCalled();
  });

  it('ホイールイベントのバブリングを止める', () => {
    const stopPropagation = jasmine.createSpy('stopPropagation');
    component.onWheel({ stopPropagation } as unknown as WheelEvent);

    expect(stopPropagation).toHaveBeenCalled();
  });

  it('ドラッグ操作でスクロールできる', () => {
    const viewport = component.nativeElement!;
    Object.defineProperty(viewport, 'scrollLeft', { value: 10, writable: true, configurable: true });
    Object.defineProperty(viewport, 'scrollTop', { value: 5, writable: true, configurable: true });
    const scrollToSpy = spyOn(viewport, 'scrollTo').and.callFake((optionsOrX?: ScrollToOptions | number, y?: number) => {
      if (typeof optionsOrX === 'object' && optionsOrX !== null) {
        const options = optionsOrX as ScrollToOptions;
        if (options.left !== undefined) {
          Object.defineProperty(viewport, 'scrollLeft', { value: options.left, writable: true, configurable: true });
        }
        if (options.top !== undefined) {
          Object.defineProperty(viewport, 'scrollTop', { value: options.top, writable: true, configurable: true });
        }
      } else if (typeof optionsOrX === 'number' && typeof y === 'number') {
        Object.defineProperty(viewport, 'scrollLeft', { value: optionsOrX, writable: true, configurable: true });
        Object.defineProperty(viewport, 'scrollTop', { value: y, writable: true, configurable: true });
      }
    });
    (viewport as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = jasmine.createSpy('setPointerCapture');
    (viewport as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = jasmine.createSpy(
      'releasePointerCapture',
    );

    component.onPointerDown({
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 20,
      target: viewport,
    } as unknown as PointerEvent);

    expect(viewport.classList.contains('is-dragging')).toBeTrue();

    const preventDefault = jasmine.createSpy('preventDefault');
    component.onPointerMove({
      pointerId: 1,
      clientX: 12,
      clientY: 18,
      cancelable: true,
      preventDefault,
    } as unknown as PointerEvent);

    expect(scrollToSpy).toHaveBeenCalled();
    expect(scrollToSpy.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ left: 8, top: 7 }));
    expect(preventDefault).toHaveBeenCalled();

    component.onPointerUp({ pointerId: 1 } as unknown as PointerEvent);

    expect(viewport.classList.contains('is-dragging')).toBeFalse();
    expect((component as unknown as { dragState: unknown }).dragState).toBeNull();
    expect((viewport as unknown as { releasePointerCapture: jasmine.Spy }).releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('右クリックドラッグを無視する', () => {
    const viewport = component.nativeElement!;
    spyOn(viewport, 'setPointerCapture');

    component.onPointerDown({
      pointerId: 1,
      button: 1,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
      target: viewport,
    } as unknown as PointerEvent);

    expect(viewport.classList.contains('is-dragging')).toBeFalse();
    expect((component as unknown as { dragState: unknown }).dragState).toBeNull();
    expect(viewport.setPointerCapture).not.toHaveBeenCalled();
  });

  it('別のポインターIDの移動は無視する', () => {
    const viewport = component.nativeElement!;
    const scrollSpy = spyOn(viewport, 'scrollTo');

    component.onPointerDown({
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 20,
      target: viewport,
    } as unknown as PointerEvent);

    component.onPointerMove({ pointerId: 2, clientX: 15, clientY: 25, cancelable: true } as unknown as PointerEvent);

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('キャンセル不可のイベントではpreventDefaultしない', () => {
    const viewport = component.nativeElement!;
    component.onPointerDown({
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 20,
      target: viewport,
    } as unknown as PointerEvent);

    const preventDefault = jasmine.createSpy('preventDefault');
    component.onPointerMove({ pointerId: 1, clientX: 12, clientY: 18, cancelable: false, preventDefault } as unknown as PointerEvent);

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('インタラクティブ要素上ではドラッグを開始しない', () => {
    const viewport = component.nativeElement!;
    const button = document.createElement('button');
    viewport.appendChild(button);

    component.onPointerDown({
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
      target: button,
    } as unknown as PointerEvent);

    expect(viewport.classList.contains('is-dragging')).toBeFalse();
    expect((component as unknown as { dragState: unknown }).dragState).toBeNull();
  });

  it('強調対象の日付を判定する', () => {
    component.highlightedDayIndex = 1;
    expect(component.isDayHighlighted(1)).toBeTrue();
    expect(component.isDayHighlighted(0)).toBeFalse();

    component.highlightedDayIndex = null;
    component.highlightedTaskRange = [0, 1];
    expect(component.isDayHighlighted(1)).toBeTrue();
    expect(component.isDayHighlighted(2)).toBeFalse();
  });

  it('ヘッダーの日付ホバーを親へ伝える', () => {
    const hoverSpy = jasmine.createSpy('hover');
    component.dayHoverChange.subscribe(hoverSpy);

    component.onDayHover(2);
    component.onDayHover(null);

    expect(hoverSpy).toHaveBeenCalledTimes(2);
    expect(hoverSpy.calls.allArgs()).toEqual([[2], [null]]);
  });
});
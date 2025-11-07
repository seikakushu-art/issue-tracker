import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import type { TimelineDay, TimelineMonthSegment } from './progress-gantt.component';

@Component({
  selector: 'app-progress-gantt-timeline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './progress-gantt-timeline.component.html',
  styleUrls: ['./progress-gantt-timeline.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgressGanttTimelineComponent {
  @Input({ required: true }) timeline: TimelineDay[] = [];
  @Input({ required: true }) timelineMonths: TimelineMonthSegment[] = [];
  @Input() gridTemplate = '';
  @Input() labelColumnWidth = 280;
  @Input() dayCellWidth = 48;
    /** 表示側で強調したい日付インデックス */
  @Input() highlightedDayIndex: number | null = null;
  /** タスク選択に応じて強調したい日付範囲 [start, end] */
  @Input() highlightedTaskRange: Readonly<[number, number]> | null = null;

  @Output() scrolled = new EventEmitter<Event>();
  /** タイムラインのヘッダー上でホバー中の日付インデックスを親へ通知 */
  @Output() dayHoverChange = new EventEmitter<number | null>();

  @ViewChild('viewport', { static: true }) private viewportRef?: ElementRef<HTMLDivElement>;

  private dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null = null;

  get nativeElement(): HTMLDivElement | null {
    return this.viewportRef?.nativeElement ?? null;
  }

  onScroll(event: Event): void {
    this.scrolled.emit(event);
  }

  onWheel(event: WheelEvent): void {
    event.stopPropagation();
  }
   /** タイムラインをドラッグしたときの初期化 */
   onPointerDown(event: PointerEvent): void {
    const viewport = this.viewportRef?.nativeElement;
    if (!viewport) {
      return;
    }

    if (event.button !== 0 && event.pointerType === 'mouse') {
      return;
    }

    // ボタンやリンク操作の邪魔をしないため、インタラクティブ要素はドラッグ対象外
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select')) {
      return;
    }

    this.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.classList.add('is-dragging');
    viewport.setPointerCapture(event.pointerId);
  }

  /** ドラッグ移動に応じてスクロール位置を更新 */
  onPointerMove(event: PointerEvent): void {
    const viewport = this.viewportRef?.nativeElement;
    if (!viewport || !this.dragState || this.dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - this.dragState.startX;
    const deltaY = event.clientY - this.dragState.startY;
    viewport.scrollTo({
      left: this.dragState.scrollLeft - deltaX,
      top: this.dragState.scrollTop - deltaY,
    });
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  /** ドラッグ終了時の後片付け */
  onPointerUp(event: PointerEvent): void {
    const viewport = this.viewportRef?.nativeElement;
    if (!viewport || !this.dragState || this.dragState.pointerId !== event.pointerId) {
      return;
    }

    viewport.classList.remove('is-dragging');
    viewport.releasePointerCapture(event.pointerId);
    this.dragState = null;
  }

  /** タイムラインヘッダーにマウスが乗った際のガイド更新 */
  onDayHover(index: number | null): void {
    this.dayHoverChange.emit(index);
  }

  /** 強調表示対象かどうかを判定 */
  isDayHighlighted(index: number): boolean {
    if (this.highlightedDayIndex === index) {
      return true;
    }
    if (this.highlightedTaskRange) {
      const [start, end] = this.highlightedTaskRange;
      return index >= start && index <= end;
    }
    return false;
  }
}
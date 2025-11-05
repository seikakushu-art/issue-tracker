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

  @Output() scrolled = new EventEmitter<Event>();

  @ViewChild('viewport', { static: true }) private viewportRef?: ElementRef<HTMLDivElement>;

  get nativeElement(): HTMLDivElement | null {
    return this.viewportRef?.nativeElement ?? null;
  }

  onScroll(event: Event): void {
    this.scrolled.emit(event);
  }

  onWheel(event: WheelEvent): void {
    event.stopPropagation();
  }
}
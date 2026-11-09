import { vi } from 'vitest';
import { createTaskTestContext } from '../testing/task-test-context';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TasksPage } from './tasks.page';
import { TaskService } from '../task.service';


vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));

describe('TasksPage weekly agenda', () => {
  beforeEach(async () => {
    const context = createTaskTestContext();
    await TestBed.configureTestingModule({ imports: [TasksPage], providers: [provideRouter([]), ...context.providers] }).compileComponents();
    await TestBed.inject(TaskService).ready;
    TestBed.tick();
  });

  it('renders local schedules only on their selected day and separates legacy tasks', async () => {
    const fixture = TestBed.createComponent(TasksPage);
    const page = fixture.componentInstance;
    const service = TestBed.inject(TaskService);
    service.addTask('Programada', 'Detalle', undefined, new Date(2026, 10, 10, 15, 30).toISOString());
    page.selectDay('2026-11-10');
    fixture.detectChanges();
    const root = fixture.nativeElement;
    expect(root.querySelectorAll('.task-schedule').length).toBe(1);
    expect(root.querySelector('.task-schedule').textContent).toContain('10-11-2026');
    expect(root.querySelector('.timeline-time').textContent).toContain('15:30');
    expect(root.querySelectorAll('.unscheduled-list .task-card').length).toBe(2);
    expect(root.querySelector('#unscheduled-heading').textContent).toBe('Sin programar');
    expect(root.querySelectorAll('.task-date').length).toBe(1);
    page.selectDay('2026-11-11');
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('.timeline-time')).toBeNull();
    expect(root.querySelectorAll('.unscheduled-list .task-card').length).toBe(2);
    expect(root.querySelector('.day-empty')).toBeTruthy();
    expect(page.formatScheduledAt('invalid')).toBe('');
    expect(page.formatScheduledTime('invalid')).toBe('');
  });

  it('combines selected day, chronological order, search and state without changing service data', () => {
    const page = TestBed.createComponent(TasksPage).componentInstance;
    const service = TestBed.inject(TaskService);
    const later = service.addTask('Agenda tarde', 'Detalle', undefined, new Date(2026, 10, 10, 18).toISOString())!;
    const earlier = service.addTask('Agenda temprano', 'Detalle', undefined, new Date(2026, 10, 10, 9).toISOString())!;
    service.addTask('Otro dia', 'Detalle', undefined, new Date(2026, 10, 11, 9).toISOString());
    const original = service.tasks();
    page.selectDay('2026-11-10');
    expect(page.filteredTasks.slice(0, 2).map(t => t.id)).toEqual([earlier.id, later.id]);
    expect(service.tasks()).toBe(original);
    expect(service.tasks()[0].id).toBe(1);
    service.toggleTask(earlier.id);
    page.searchQuery = 'AGENDA';
    page.statusFilter = 'completed';
    expect(page.filteredTasks.map(t => t.id)).toEqual([earlier.id]);
    page.statusFilter = 'pending';
    expect(page.filteredTasks.map(t => t.id)).toEqual([later.id]);
    page.searchQuery = 'detalle';
    expect(page.filteredTasks.some(t => t.title === 'Otro dia')).toBe(false);
  });

  it('calculates real Monday-to-Sunday weeks across month and year boundaries', () => {
    const page = TestBed.createComponent(TasksPage).componentInstance;
    page.selectDay('2026-12-31');
    page.changeWeek(0);
    expect(page.weekDays.map(day => day.key)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
    page.changeWeek(1);
    expect(page.selectedDate).toBe('2027-01-07');
    expect(page.weekDays[0].key).toBe('2027-01-04');
    page.changeWeek(-1);
    expect(page.selectedDate).toBe('2026-12-31');
    page.showCurrentWeek();
    const now = new Date();
    const selected = new Date(page.selectedDate + 'T12:00:00');
    expect(selected.getDate()).toBe(now.getDate());
    expect(selected.getMonth()).toBe(now.getMonth());
    expect(selected.getFullYear()).toBe(now.getFullYear());
    expect(new Date(page.weekDays[0].key + 'T12:00:00').getDay()).toBe(1);
    expect(page.weekDays.some(day => day.key === page.selectedDate)).toBe(true);
  });

  it('paginates the day and unscheduled results together and resets on day changes', () => {
    const page = TestBed.createComponent(TasksPage).componentInstance;
    const service = TestBed.inject(TaskService);
    page.selectDay('2026-11-10');
    for (let n = 0; n < 6; n++) service.addTask('Programada ' + n, 'Detalle', undefined, new Date(2026, 10, 10, 9 + n).toISOString());
    expect(page.totalPages).toBe(2);
    expect(page.paginatedTasks.length).toBe(5);
    page.nextPage();
    expect(page.taskGroups[0].tasks.length).toBe(1);
    expect(page.taskGroups[1].tasks.length).toBe(2);
    expect(page.taskNumber(page.paginatedTasks[0])).toBe(6);
    page.selectDay('2026-11-11');
    expect(page.currentPage).toBe(1);
    expect(page.totalPages).toBe(1);
    expect(page.filteredTasks.length).toBe(2);
    page.statusFilter = 'completed';
    page.resetInvalidPage();
    expect(page.filteredTasks.length).toBe(0);
    expect(page.totalPages).toBe(1);
  });

  it('uses the local scheduled day rather than creation day or the UTC date prefix', () => {
    const page = TestBed.createComponent(TasksPage).componentInstance;
    const service = TestBed.inject(TaskService);
    const instant = '2026-11-11T01:30:00Z';
    const date = new Date(instant);
    const pad = (n: number) => String(n).padStart(2, '0');
    const localDay = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    const task = service.addTask('Zona horaria', 'Detalle', undefined, instant)!;
    page.selectDay(localDay);
    expect(page.filteredTasks.some(t => t.id === task.id)).toBe(true);
    page.changeWeek(1);
    expect(page.filteredTasks.some(t => t.id === task.id)).toBe(false);
    expect(page.filteredTasks.every(t => !t.scheduledAt)).toBe(true);
  });

  it('provides accessible selectable days with actual day numbers', () => {
    const fixture = TestBed.createComponent(TasksPage);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('.week-days button');
    expect(buttons.length).toBe(7);
    expect(fixture.nativeElement.querySelectorAll('.week-days button[aria-pressed="true"]').length).toBe(1);
    buttons[0].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedDate).toBe(buttons[0].getAttribute('data-day'));
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0].querySelector('strong').textContent).toBe(fixture.componentInstance.weekDays[0].number);
    expect(buttons[0].getAttribute('aria-label')).toBeTruthy();
  });
});

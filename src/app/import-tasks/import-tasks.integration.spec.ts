import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NavController } from '@ionic/angular';
import { vi } from 'vitest';
import { HomePage } from '../home/home.page';
import { TasksPage } from '../tasks/tasks.page';
import { TaskService } from '../task.service';
import { createTaskTestContext } from '../testing/task-test-context';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));

describe('Imported tasks in existing views', () => {
  it('updates summary, search, status filters and unscheduled agenda for the current user', async () => {
    const context = createTaskTestContext();
    await TestBed.configureTestingModule({ imports: [HomePage, TasksPage], providers: [provideRouter([]), ...context.providers,
      { provide: NavController, useValue: { navigateRoot: vi.fn() } }
    ] }).compileComponents();
    const service = TestBed.inject(TaskService);
    await service.ready;
    await service.importTasks([
      { id: 1, userId: 8, title: 'Importada completada', completed: true },
      { id: 2, userId: 8, title: 'Importada pendiente', completed: false }
    ], context.userA.id);
    const summary = TestBed.createComponent(HomePage);
    summary.detectChanges();
    expect(summary.nativeElement.querySelector('.stat-total strong').textContent).toBe('4');
    expect(summary.nativeElement.querySelector('.stat-completed strong').textContent).toBe('1');
    expect(summary.nativeElement.querySelector('.donut-center strong').textContent).toBe('25%');
    const agenda = TestBed.createComponent(TasksPage);
    agenda.componentInstance.searchQuery = 'IMPORTADA';
    agenda.componentInstance.statusFilter = 'completed';
    agenda.detectChanges();
    expect(agenda.nativeElement.querySelectorAll('.unscheduled-list .task-card').length).toBe(1);
    expect(agenda.nativeElement.querySelector('.task-info h3').textContent).toBe('Importada completada');
    expect(agenda.nativeElement.querySelector('.timeline-time')).toBeNull();
    context.currentUser.set(context.userB);
    TestBed.tick();
    expect(service.totalTasks()).toBe(0);
    expect(agenda.componentInstance.filteredTasks).toEqual([]);
  });
});

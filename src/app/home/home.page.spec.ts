import { NavController } from '@ionic/angular';
import { vi } from 'vitest';
import { AuthService } from '../auth.service';
import { TaskService } from '../task.service';
import { TaskSyncService } from '../task-sync.service';
import { TaskRealtimeService } from '../task-realtime.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { HomePage } from './home.page';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;
  const logout = vi.fn();
  const navigateRoot = vi.fn();

  beforeEach(async () => {
    logout.mockReset().mockResolvedValue(undefined);
    navigateRoot.mockReset().mockResolvedValue(true);
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [provideRouter([]),
        { provide: TaskRealtimeService, useValue: { label: () => 'Desconectado', state: () => ({ status: 'disconnected' }) } },
        { provide: TaskSyncService, useValue: { running: () => false, label: () => 'Inicia sesión para sincronizar', state: () => ({ status: 'reauth' }), sync: vi.fn() } },
        { provide: AuthService, useValue: { logout } },
        { provide: NavController, useValue: { navigateRoot } },
        { provide: TaskService, useValue: {
          totalTasks: () => 0, pendingTasks: () => 0, completedTasks: () => 0, completionProgress: () => 0
        } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('waits for logout before replacing the root with login', async () => {
    await component.logout();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigateRoot).toHaveBeenCalledExactlyOnceWith('/login', { replaceUrl: true });
    expect(component.isLoggingOut).toBe(false);
    expect(fixture.nativeElement.querySelector('.logout-button').textContent).toContain('Cerrar');
  });

  it('ignores repeated logout taps while session removal is pending', async () => {
    let finish!: () => void;
    logout.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = component.logout();
    await component.logout();
    expect(component.isLoggingOut).toBe(true);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigateRoot).not.toHaveBeenCalled();
    finish();
    await first;
    expect(navigateRoot).toHaveBeenCalledTimes(1);
    expect(component.isLoggingOut).toBe(false);
  });
});

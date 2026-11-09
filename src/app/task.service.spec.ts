import { vi } from 'vitest';
import { Preferences } from '@capacitor/preferences';
import { Task } from './task.model';
import { createTaskTestContext } from './testing/task-test-context';
﻿import { TestBed } from '@angular/core/testing';
import { TaskService } from './task.service';


vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));

describe('TaskService', () => {
  let service: TaskService;

  let context: ReturnType<typeof createTaskTestContext>;
  beforeEach(async () => {
    context = createTaskTestContext();
    TestBed.configureTestingModule({ providers: context.providers });
    service = TestBed.inject(TaskService);
    await service.ready;
    TestBed.tick();
  });

  it('shares current counters and progress across task changes', () => {
    const task = service.addTask('  Nueva  ', '  Detalle  ');
    expect(task?.title).toBe('Nueva');
    expect(task?.description).toBe('Detalle');
    expect(task?.completed).toBe(false);
    expect(service.totalTasks()).toBe(3);
    service.toggleTask(task!.id);
    expect(service.completedTasks()).toBe(1);
    expect(service.pendingTasks()).toBe(2);
    expect(service.completionProgress()).toBeCloseTo(1 / 3);
    expect(service.updateTask(task!.id, 'Editada', 'Otro detalle')).toBe(true);
    expect(service.getTask(task!.id)?.completed).toBe(true);
    service.toggleTask(task!.id);
    expect(service.completedTasks()).toBe(0);
    service.deleteTask(task!.id);
    expect(service.totalTasks()).toBe(2);
  });

  it('rejects blank fields and missing tasks without changing the collection', () => {
    const original = service.tasks();
    expect(service.addTask('   ', 'Detalle')).toBeUndefined();
    expect(service.addTask('Titulo', '   ')).toBeUndefined();
    expect(service.updateTask(1, '   ', 'Detalle')).toBe(false);
    expect(service.updateTask(1, 'Titulo', '   ')).toBe(false);
    expect(service.updateTask(-1, 'Titulo', 'Detalle')).toBe(false);
    expect(service.tasks()).toBe(original);
  });

  it('reports zero progress for an empty collection', () => {
    for (const task of service.tasks()) service.deleteTask(task.id);
    expect(service.totalTasks()).toBe(0);
    expect(service.pendingTasks()).toBe(0);
    expect(service.completedTasks()).toBe(0);
    expect(service.completionProgress()).toBe(0);
  });

  it('stores an optional schedule separately from creation and photography', () => {
    const scheduled = '2026-11-10T15:30:00-03:00';
    const task = service.addTask('Programada', 'Detalle', 'foto.png', scheduled)!;
    expect(task.scheduledAt).toBe(new Date(scheduled).toISOString());
    expect(task.createdAt).toBeDefined();
    expect(task.photoPath).toBe('foto.png');
    const createdAt = task.createdAt;
    service.updateTask(task.id, 'Editada', 'Detalle', 'foto.png', '2026-11-12T10:00:00Z');
    expect(service.getTask(task.id)?.scheduledAt).toBe('2026-11-12T10:00:00.000Z');
    expect(service.getTask(task.id)?.createdAt).toBe(createdAt);
    service.toggleTask(task.id);
    expect(service.getTask(task.id)?.scheduledAt).toBe('2026-11-12T10:00:00.000Z');
    expect(service.getTask(task.id)?.photoPath).toBe('foto.png');
  });

  it('supports unscheduled and legacy tasks and preserves omitted schedules', () => {
    expect(service.getTask(1)?.scheduledAt).toBeUndefined();
    expect(service.addTask('Sin fecha', 'Detalle')?.scheduledAt).toBeUndefined();
    expect(service.updateTask(1, 'Antigua', 'Detalle')).toBe(true);
    expect(service.getTask(1)?.scheduledAt).toBeUndefined();
    const task = service.addTask('Con fecha', 'Detalle', undefined, '2026-11-10T12:00:00Z')!;
    service.updateTask(task.id, 'Otro titulo', 'Detalle');
    expect(service.getTask(task.id)?.scheduledAt).toBe(task.scheduledAt);
    service.updateTask(task.id, 'Otro titulo', 'Detalle', undefined, '');
    expect(service.getTask(task.id)?.scheduledAt).toBeUndefined();
  });

  it('rejects invalid schedules without modifying tasks', () => {
    const original = service.tasks();
    expect(service.addTask('Titulo', 'Detalle', undefined, 'invalid')).toBeUndefined();
    expect(service.updateTask(1, 'Titulo', 'Detalle', undefined, 'invalid')).toBe(false);
    expect(service.tasks()).toBe(original);
  });

  it('automatically assigns new tasks to the authenticated user', () => {
    const task = service.addTask('Privada A', 'Detalle')!;
    expect(task.userId).toBe(context.userA.id);
    context.currentUser.set(context.userB);
    const other = service.addTask('Privada B', 'Detalle')!;
    expect(other.userId).toBe(context.userB.id);
    expect(service.tasks().map(t => t.id)).toEqual([other.id]);
  });

  it('updates the visible tasks and all dashboard counters when the user changes', () => {
    service.addTask('Privada A', 'Detalle');
    const ownerAIds = service.tasks().map(t => t.id);
    context.currentUser.set(context.userB);
    expect(service.tasks()).toEqual([]);
    expect(service.totalTasks()).toBe(0);
    expect(service.completionProgress()).toBe(0);
    const taskB = service.addTask('Privada B', 'Detalle')!;
    service.toggleTask(taskB.id);
    expect(service.totalTasks()).toBe(1);
    expect(service.pendingTasks()).toBe(0);
    expect(service.completedTasks()).toBe(1);
    expect(service.completionProgress()).toBe(1);
    context.currentUser.set(context.userA);
    expect(service.tasks().map(t => t.id)).toEqual(ownerAIds);
    expect(service.completedTasks()).toBe(0);
    expect(service.getTask(taskB.id)).toBeUndefined();
  });

  it('rejects cross-user reads, updates, toggles and deletions', async () => {
    const taskA = service.addTask('Solo A', 'Privada', 'task-photos/a.png')!;
    context.currentUser.set(context.userB);
    const taskB = service.addTask('Solo B', 'Privada')!;
    const writes = vi.mocked(Preferences.set).mock.calls.length;
    expect(service.getTask(taskA.id)).toBeUndefined();
    expect(service.updateTask(taskA.id, 'Ataque', 'Detalle')).toBe(false);
    service.toggleTask(taskA.id);
    service.deleteTask(taskA.id);
    expect(vi.mocked(Preferences.set).mock.calls.length).toBe(writes);
    expect(service.tasks().map(t => t.id)).toEqual([taskB.id]);
    context.currentUser.set(context.userA);
    expect(service.getTask(taskA.id)).toEqual(taskA);
    await vi.waitFor(() => {
      const stored = JSON.parse(context.storage.get('tareafacil_tasks')!) as Task[];
      expect(stored.find(t => t.id === taskA.id)?.title).toBe('Solo A');
      expect(stored.find(t => t.id === taskB.id)?.title).toBe('Solo B');
    });
  });

  it('exposes no private tasks or mutations when logged out or auth is not ready', () => {
    const task = service.addTask('Privada', 'Detalle')!;
    context.currentUser.set(null);
    expect(service.tasks()).toEqual([]);
    expect(service.totalTasks()).toBe(0);
    expect(service.getTask(task.id)).toBeUndefined();
    expect(service.addTask('Sin sesion', 'Detalle')).toBeUndefined();
    expect(service.updateTask(task.id, 'Cambio', 'Detalle')).toBe(false);
    service.deleteTask(task.id);
    service.toggleTask(task.id);
    context.isReady.set(false);
    context.currentUser.set(context.userA);
    expect(service.tasks()).toEqual([]);
    expect(service.addTask('Carga pendiente', 'Detalle')).toBeUndefined();
    context.isReady.set(true);
    expect(service.getTask(task.id)).toEqual(task);
  });

  it('generates globally distinct IDs without overwriting another users hidden task', () => {
    const a = service.addTask('A', 'Detalle')!;
    context.currentUser.set(context.userB);
    const b = service.addTask('B', 'Detalle')!;
    expect(b.id).not.toBe(a.id);
    service.deleteTask(b.id);
    context.currentUser.set(context.userA);
    expect(service.getTask(a.id)).toEqual(a);
  });
});

describe('TaskService asynchronous ownership migration', () => {
  const legacy = { id: 81, title: 'Antigua', description: 'Todos los datos', completed: true,
    createdAt: '2026-10-01T12:00:00Z', scheduledAt: '2026-11-10T18:30:00Z',
    photoPath: 'task-photos/persistent.png', latitude: 0, longitude: -70.66, accuracy: 0 };

  it('migrates once, preserves all fields and reloads ownership from Preferences', async () => {
    const context = createTaskTestContext();
    const other: Task = { ...legacy, id: 82, userId: context.userB.id, title: 'Ya asignada' };
    context.storage.set('tareafacil_tasks', JSON.stringify([legacy, other]));
    TestBed.configureTestingModule({ providers: context.providers });
    const service = TestBed.inject(TaskService);
    expect(service.tasks()).toEqual([]);
    expect(service.addTask('Demasiado pronto', 'Detalle')).toBeUndefined();
    await service.ready;
    TestBed.tick();
    expect(service.tasks()).toEqual([{ ...legacy, userId: context.userA.id }]);
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!)).toEqual([{ ...legacy, userId: context.userA.id }, other]);
    const writes = vi.mocked(Preferences.set).mock.calls.length;
    context.currentUser.set(context.userB);
    TestBed.tick();
    expect(service.tasks()).toEqual([other]);
    expect(vi.mocked(Preferences.set).mock.calls.length).toBe(writes);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: context.providers });
    const reloaded = TestBed.inject(TaskService);
    await reloaded.ready;
    TestBed.tick();
    expect(reloaded.tasks()).toEqual([other]);
    expect(vi.mocked(Preferences.set).mock.calls.length).toBe(writes);
    context.currentUser.set(context.userA);
    expect(reloaded.tasks()).toEqual([{ ...legacy, userId: context.userA.id }]);
  });

  it('waits for both asynchronous task data and auth before assigning legacy ownership', async () => {
    const context = createTaskTestContext();
    context.isReady.set(false);
    let release!: (value: { value: string }) => void;
    vi.mocked(Preferences.get).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    TestBed.configureTestingModule({ providers: context.providers });
    const service = TestBed.inject(TaskService);
    TestBed.tick();
    expect(service.tasks()).toEqual([]);
    release({ value: JSON.stringify([legacy]) });
    await Promise.resolve();
    TestBed.tick();
    expect(service.tasks()).toEqual([]);
    expect(Preferences.set).not.toHaveBeenCalled();
    context.currentUser.set(context.userB);
    context.isReady.set(true);
    TestBed.tick();
    await service.ready;
    expect(service.tasks()).toEqual([{ ...legacy, userId: context.userB.id }]);
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!)[0].userId).toBe(context.userB.id);
  });

  it('keeps legacy data unassigned until a user logs in', async () => {
    const context = createTaskTestContext();
    context.currentUser.set(null);
    context.storage.set('tareafacil_tasks', JSON.stringify([legacy]));
    TestBed.configureTestingModule({ providers: context.providers });
    const service = TestBed.inject(TaskService);
    await service.ready;
    expect(service.tasks()).toEqual([]);
    expect(Preferences.set).not.toHaveBeenCalled();
    context.currentUser.set(context.userA);
    TestBed.tick();
    await vi.waitFor(() => expect(JSON.parse(context.storage.get('tareafacil_tasks')!)[0].userId).toBe(context.userA.id));
    expect(service.tasks()).toEqual([{ ...legacy, userId: context.userA.id }]);
  });

  it('serializes migration and later saves without losing either users tasks', async () => {
    const context = createTaskTestContext();
    context.storage.set('tareafacil_tasks', JSON.stringify([legacy]));
    let release!: () => void;
    vi.mocked(Preferences.set).mockImplementationOnce(({ key, value }) => new Promise<void>(resolve => {
      release = () => { context.storage.set(key, value); resolve(); };
    }));
    TestBed.configureTestingModule({ providers: context.providers });
    const service = TestBed.inject(TaskService);
    await vi.waitFor(() => expect(release).toBeDefined());
    const taskA = service.addTask('A nueva', 'Detalle')!;
    context.currentUser.set(context.userB);
    const taskB = service.addTask('B nueva', 'Detalle')!;
    release();
    await service.ready;
    await vi.waitFor(() => {
      const stored = JSON.parse(context.storage.get('tareafacil_tasks')!) as Task[];
      expect(stored.map(t => t.id)).toEqual([legacy.id, taskA.id, taskB.id]);
      expect(stored.map(t => t.userId)).toEqual([context.userA.id, context.userA.id, context.userB.id]);
    });
  });
});

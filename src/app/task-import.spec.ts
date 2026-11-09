import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';
import { TaskService } from './task.service';
import { ExternalTask } from './external-task.model';
import { createTaskTestContext } from './testing/task-test-context';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));

describe('TaskService manual import', () => {
  let service: TaskService;
  let context: ReturnType<typeof createTaskTestContext>;
  const external: ExternalTask = { id: 1, userId: 999, title: '  Externa  ', completed: true };
  beforeEach(async () => {
    context = createTaskTestContext();
    TestBed.configureTestingModule({ providers: context.providers });
    service = TestBed.inject(TaskService);
    await service.ready;
    TestBed.tick();
  });
  afterEach(() => vi.restoreAllMocks());

  it('maps to a new locally owned task and preserves all existing records', async () => {
    const original = service.tasks();
    const before = Date.now();
    const result = await service.importTasks([external], context.userA.id);
    const task = service.tasks().at(-1)!;
    expect(result).toEqual({ imported: 1, existing: 0 });
    expect(task.id).not.toBe(external.id);
    expect(task.userId).toBe(context.userA.id);
    expect(task.title).toBe('Externa');
    expect(task.description).toBe('Tarea importada de JSONPlaceholder.');
    expect(task.completed).toBe(true);
    expect(Date.parse(task.createdAt!)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(task.createdAt!)).toBeLessThanOrEqual(Date.now());
    expect(task.externalSource).toBe('jsonplaceholder');
    expect(task.externalId).toBe(1);
    for (const field of ['scheduledAt', 'photoPath', 'latitude', 'longitude', 'accuracy']) expect(task).not.toHaveProperty(field);
    expect(service.tasks().slice(0, 2)).toEqual(original);
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!)).toEqual(service.tasks());
  });

  it('deduplicates within a batch and on repeat without overwriting local edits', async () => {
    expect(await service.importTasks([external, external], context.userA.id)).toEqual({ imported: 1, existing: 1 });
    const task = service.tasks().at(-1)!;
    service.updateTask(task.id, 'Titulo local editado', 'Detalle local');
    expect(await service.importTasks([external], context.userA.id)).toEqual({ imported: 0, existing: 1 });
    expect(service.getTask(task.id)?.title).toBe('Titulo local editado');
    expect(service.totalTasks()).toBe(3);
  });

  it('allows the same external task for B while retaining A records and distinct local IDs', async () => {
    await service.importTasks([external], context.userA.id);
    const first = service.tasks().at(-1)!;
    context.currentUser.set(context.userB);
    expect(await service.importTasks([external], context.userB.id)).toEqual({ imported: 1, existing: 0 });
    const second = service.tasks()[0];
    expect(second.userId).toBe(context.userB.id);
    expect(second.id).not.toBe(first.id);
    expect(service.tasks().length).toBe(1);
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!).length).toBe(4);
    context.currentUser.set(context.userA);
    expect(service.getTask(first.id)).toEqual(first);
    expect(service.getTask(second.id)).toBeUndefined();
  });

  it('rejects logout and a changed owner without saving anything', async () => {
    const before = context.storage.get('tareafacil_tasks');
    context.currentUser.set(null);
    await expect(service.importTasks([external], context.userA.id)).rejects.toThrow();
    context.currentUser.set(context.userB);
    await expect(service.importTasks([external], context.userA.id)).rejects.toThrow();
    expect(context.storage.get('tareafacil_tasks')).toBe(before);
  });

  it('waits for initialization and rejects a user switch while waiting', async () => {
    TestBed.resetTestingModule();
    context = createTaskTestContext();
    let release!: (value: { value: string }) => void;
    vi.mocked(Preferences.get).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    TestBed.configureTestingModule({ providers: context.providers });
    service = TestBed.inject(TaskService);
    const pending = service.importTasks([external], context.userA.id);
    context.currentUser.set(context.userB);
    release({ value: '[]' });
    await expect(pending).rejects.toThrow();
    expect(service.tasks()).toEqual([]);
    expect(Preferences.set).not.toHaveBeenCalled();
  });

  it('rejects invalid input before changing any stored record', async () => {
    const before = service.tasks();
    await expect(service.importTasks([{ ...external, title: ' ' }], context.userA.id)).rejects.toThrow();
    expect(service.tasks()).toBe(before);
  });

  it('reloads imported metadata and completion from Preferences', async () => {
    await service.importTasks([external], context.userA.id);
    const task = service.tasks().at(-1)!;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: context.providers });
    service = TestBed.inject(TaskService);
    await service.ready;
    expect(service.getTask(task.id)).toEqual(task);
  });

  it('handles concurrent batches without duplicate IDs or records', async () => {
    const results = await Promise.all([service.importTasks([external], context.userA.id), service.importTasks([external], context.userA.id)]);
    expect(results.reduce((n, result) => n + result.imported, 0)).toBe(1);
    expect(results.reduce((n, result) => n + result.existing, 0)).toBe(1);
    expect(service.tasks().filter(task => task.externalId === 1).length).toBe(1);
  });

  it('reports storage failures and can persist a retry without duplicates', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = context.storage.get('tareafacil_tasks');
    vi.mocked(Preferences.set).mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(service.importTasks([external], context.userA.id)).rejects.toThrow('Storage unavailable');
    expect(context.storage.get('tareafacil_tasks')).toBe(before);
    expect(await service.importTasks([external], context.userA.id)).toEqual({ imported: 0, existing: 1 });
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!).filter((task: { externalId?: number }) => task.externalId === 1).length).toBe(1);
  });
});

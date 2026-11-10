import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';
import { createTaskTestContext } from './testing/task-test-context';
import { TaskService } from './task.service';
import { TaskSyncService } from './task-sync.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { RemoteTaskService, SyncContext, TaskRemoteError } from './remote-task.service';
import { RemoteTask, taskContent } from './remote-task.model';
import { Task } from './task.model';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));

describe('Manual task synchronization with persisted local storage', () => {
  let context: ReturnType<typeof createTaskTestContext>;
  let tasks: TaskService;
  let sync: TaskSyncService;
  let remoteUser: ReturnType<typeof signal<{ id: string } | null>>;
  let database: Map<string, RemoteTask>;
  const api = { insert: vi.fn(), update: vi.fn(), find: vi.fn(), download: vi.fn() };

  function row(task: Task, ownerId = 'remote-a', revision = 1): RemoteTask {
    return { ...taskContent(task), id: task.remoteId!, owner_id: ownerId,
      local_task_id: task.id, origin_device_id: task.originDeviceId ?? 'device',
      created_at: task.createdAt ?? '2026-01-01T00:00:00Z',
      updated_at: new Date().toISOString(), revision };
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    context = createTaskTestContext();
    context.currentUser.set({ ...context.userA, remoteUserId: 'remote-a' });
    context.storage.set('tareafacil_tasks', '[]');
    remoteUser = signal<{ id: string } | null>({ id: 'remote-a' });
    database = new Map();
    api.insert.mockImplementation(async (task: Task, ctx: SyncContext) => {
      ctx.assertCurrent();
      if (database.has(task.remoteId!)) throw new TaskRemoteError('duplicate', '23505', 409);
      const result = row(task, ctx.ownerId);
      database.set(result.id, result);
      return result;
    });
    api.update.mockImplementation(async (task: Task, ctx: SyncContext) => {
      ctx.assertCurrent();
      const current = database.get(task.remoteId!);
      if (!current || current.revision !== task.remoteRevision) return null;
      const result = row(task, ctx.ownerId, current.revision + 1);
      database.set(result.id, result);
      return result;
    });
    api.find.mockImplementation(async (task: Task, ctx: SyncContext, external: boolean) => {
      ctx.assertCurrent();
      return external ? [...database.values()].find(r => r.owner_id === ctx.ownerId && r.external_source === task.externalSource && r.external_id === task.externalId) ?? null
        : database.get(task.remoteId!) ?? null;
    });
    api.download.mockImplementation(async (ctx: SyncContext) => {
      ctx.assertCurrent();
      return [...database.values()].filter(r => r.owner_id === ctx.ownerId);
    });
    TestBed.configureTestingModule({ providers: [...context.providers,
      { provide: SupabaseAuthService, useValue: { currentUser: remoteUser } },
      { provide: RemoteTaskService, useValue: api }
    ] });
    tasks = TestBed.inject(TaskService);
    await tasks.ready;
    sync = TestBed.inject(TaskSyncService);
    TestBed.tick();
  });

  it('persists stable identities before INSERT and acknowledges only confirmed rows', async () => {
    const task = tasks.addTask('Nueva', 'Detalle', 'local.jpg', undefined, 0, 0, 0)!;
    expect(task.syncStatus).toBe('pending');
    const original = api.insert.getMockImplementation()!;
    api.insert.mockImplementation(async (sent: Task, ctx: SyncContext) => {
      const stored: Task[] = JSON.parse(context.storage.get('tareafacil_tasks')!);
      expect(stored.find(t => t.id === task.id)?.remoteId).toBe(sent.remoteId);
      expect(stored.find(t => t.id === task.id)?.originDeviceId).toBeDefined();
      return original(sent, ctx);
    });
    expect(await sync.sync()).toBe('success');
    const result = tasks.getTask(task.id)!;
    expect(result).toMatchObject({ remoteId: task.remoteId, userId: context.userA.id, photoPath: 'local.jpg', latitude: 0, longitude: 0, accuracy: 0, syncStatus: 'synced', remoteRevision: 1 });
    expect(result.createdAt).toBe(task.createdAt);
    expect(sync.label()).toBe('Sincronizado');
    expect(sync.state().lastSyncedAt).toBeDefined();
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!)[0].syncStatus).toBe('synced');
  });

  it('migrates legacy tasks idempotently without changing other owners or losing fields', async () => {
    const legacy: Task = { id: 8, userId: context.userA.id, title: 'Antigua', description: 'Detalle', completed: true,
      createdAt: '2026-01-01T00:00:00Z', scheduledAt: '2026-11-12T12:00:00Z', photoPath: 'local.jpg',
      latitude: 0, longitude: -70, accuracy: 0, externalSource: 'jsonplaceholder', externalId: 1 };
    const other = { ...legacy, id: 9, userId: context.userB.id };
    context.storage.set('tareafacil_tasks', JSON.stringify([legacy, other]));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [...context.providers] });
    const migrated = TestBed.inject(TaskService);
    await migrated.ready;
    const first = await migrated.prepareSync(context.userA.id, () => undefined);
    const second = await migrated.prepareSync(context.userA.id, () => undefined);
    expect(second).toEqual(first);
    expect(first[0]).toMatchObject(legacy);
    expect(first[0].remoteId).toBeDefined();
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!)[1]).toEqual(other);
    expect(JSON.parse(context.storage.get('tareafacil_tasks_before_sync_v1')!)).toEqual([legacy, other]);
  });

  it('updates and completes by known revision without changing the local identity', async () => {
    const task = tasks.addTask('Nueva', 'Detalle')!;
    await sync.sync();
    tasks.updateTask(task.id, 'Editada', 'Otro detalle');
    tasks.toggleTask(task.id);
    expect(tasks.getTask(task.id)?.localRevision).toBe(3);
    await sync.sync();
    expect(api.update.mock.calls[0][0].remoteRevision).toBe(1);
    expect(database.get(task.remoteId!)!).toMatchObject({ title: 'Editada', completed: true, revision: 2 });
    expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
  });

  it('keeps tombstones, hides them from all local views and retains photo paths', async () => {
    const task = tasks.addTask('Eliminar', 'Detalle', 'keep.jpg')!;
    await sync.sync();
    tasks.deleteTask(task.id);
    expect(tasks.getTask(task.id)).toBeUndefined();
    expect(tasks.totalTasks()).toBe(0);
    expect(tasks.syncTasks(context.userA.id)[0]).toMatchObject({ photoPath: 'keep.jpg', syncStatus: 'pending', deletedAt: expect.any(String) });
    await sync.sync();
    expect(database.get(task.remoteId!)?.deleted_at).toBeTruthy();
    expect(tasks.syncTasks(context.userA.id)[0].syncStatus).toBe('synced');
  });

  it('downloads own rows and tombstones, allocates local IDs and preserves other users', async () => {
    context.currentUser.set(context.userB);
    const other = tasks.addTask('Solo B', 'Privada')!;
    context.currentUser.set({ ...context.userA, remoteUserId: 'remote-a' });
    const remote = row({ ...other, remoteId: crypto.randomUUID(), title: 'Desde remoto' });
    database.set(remote.id, remote);
    const deleted = { ...remote, id: crypto.randomUUID(), deleted_at: new Date().toISOString() };
    database.set(deleted.id, deleted);
    await sync.sync();
    expect(tasks.tasks().map(t => t.title)).toEqual(['Desde remoto']);
    expect(tasks.tasks()[0].id).not.toBe(other.id);
    expect(tasks.syncTasks(context.userA.id)).toHaveLength(2);
    context.currentUser.set(context.userB);
    expect(tasks.getTask(other.id)).toEqual(other);
  });

  it('prefers newer remote revisions and saves a conflict copy before overwriting', async () => {
    const task = tasks.addTask('Inicial', 'Detalle')!;
    await sync.sync();
    const server = database.get(task.remoteId!)!;
    database.set(server.id, { ...server, title: 'Edición remota', revision: 2 });
    tasks.updateTask(task.id, 'Edición offline', 'Detalle');
    await sync.sync();
    expect(tasks.getTask(task.id)?.title).toBe('Edición remota');
    expect(sync.label()).toBe('Conflicto');
    const key = [...context.storage.keys()].find(k => k.startsWith('tareafacil_sync_conflicts_'))!;
    expect(JSON.parse(context.storage.get(key)!)[0].local.title).toBe('Edición offline');
  });

  it('keeps an edit during upload pending with the acknowledged remote revision', async () => {
    const task = tasks.addTask('Inicial', 'Detalle')!;
    const original = api.insert.getMockImplementation()!;
    api.insert.mockImplementation(async (sent: Task, ctx: SyncContext) => {
      tasks.updateTask(task.id, 'Durante envío', 'Detalle');
      return original(sent, ctx);
    });
    await sync.sync();
    expect(tasks.getTask(task.id)).toMatchObject({ title: 'Durante envío', syncStatus: 'pending', remoteRevision: 1 });
    await sync.sync();
    expect(database.get(task.remoteId!)?.title).toBe('Durante envío');
    expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
  });

  it('retries a lost INSERT response without creating duplicates', async () => {
    const task = tasks.addTask('Nueva', 'Detalle')!;
    const original = api.insert.getMockImplementation()!;
    api.insert.mockImplementationOnce(async (sent: Task, ctx: SyncContext) => {
      await original(sent, ctx);
      throw new TaskRemoteError('Failed to fetch', 'NETWORK', 0);
    });
    await sync.sync();
    expect(sync.label()).toBe('Sin conexión');
    expect(tasks.getTask(task.id)?.syncStatus).toBe('pending');
    await sync.sync();
    expect(database.size).toBe(1);
    expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
    expect(sync.label()).toBe('Sincronizado');
  });

  it('reconciles a lost UPDATE response without a false conflict', async () => {
    const task = tasks.addTask('Nueva', 'Detalle')!;
    await sync.sync();
    tasks.updateTask(task.id, 'Editada', 'Detalle');
    const original = api.update.getMockImplementation()!;
    api.update.mockImplementationOnce(async (sent: Task, ctx: SyncContext) => {
      await original(sent, ctx);
      throw new TaskRemoteError('Failed to fetch', 'NETWORK', 0);
    });
    await sync.sync();
    await sync.sync();
    expect(tasks.getTask(task.id)?.remoteRevision).toBe(2);
    expect(sync.label()).toBe('Sincronizado');
  });

  it('synchronizes imported tasks and deduplicates retries and tombstones', async () => {
    const candidates = [{ id: 7, userId: 99, title: 'Importada', completed: true }];
    await tasks.importTasks(candidates, context.userA.id);
    await sync.sync();
    expect([...database.values()][0]).toMatchObject({ owner_id: 'remote-a', external_source: 'jsonplaceholder', external_id: 7 });
    const task = tasks.tasks()[0];
    tasks.deleteTask(task.id);
    await sync.sync();
    expect((await tasks.importTasks(candidates, context.userA.id)).existing).toBe(1);
    expect(tasks.tasks()).toHaveLength(0);
  });

  it('adopts an existing external row instead of duplicating an import across devices', async () => {
    await tasks.importTasks([{ id: 7, userId: 99, title: 'Importada local', completed: false }], context.userA.id);
    const local = tasks.tasks()[0];
    const server = row({ ...local, remoteId: crypto.randomUUID(), title: 'Importada remota' });
    database.set(server.id, server);
    api.insert.mockRejectedValue(new TaskRemoteError('duplicate external', '23505', 409));
    await sync.sync();
    expect(tasks.tasks()).toHaveLength(1);
    expect(tasks.tasks()[0]).toMatchObject({ id: local.id, remoteId: server.id, title: server.title });
    expect(sync.label()).toBe('Conflicto');
  });

  it('ignores an old response after switching accounts, including the same remote UUID', async () => {
    const task = tasks.addTask('Solo A', 'Detalle')!;
    const original = api.insert.getMockImplementation()!;
    api.insert.mockImplementation(async (sent: Task, ctx: SyncContext) => {
      const result = await original(sent, ctx);
      remoteUser.set({ id: 'remote-a' }); // new session, same account
      return result;
    });
    await sync.sync();
    expect(tasks.getTask(task.id)?.syncStatus).toBe('pending');
    expect(api.download).not.toHaveBeenCalled();
    expect(sync.running()).toBe(false);
    expect(sync.label()).toBe('Cambios pendientes');
  });

  it('does not synchronize a mismatched or missing remote identity', async () => {
    tasks.addTask('Pendiente', 'Detalle');
    remoteUser.set({ id: 'remote-b' });
    await sync.sync();
    expect(sync.label()).toBe('Inicia sesión para sincronizar');
    expect(api.insert).not.toHaveBeenCalled();
    remoteUser.set(null);
    expect(await sync.sync()).toBe('reauth');
    expect(api.download).not.toHaveBeenCalled();
  });

  it('does not send when local persistence fails and leaves retryable pending state', async () => {
    tasks.addTask('Pendiente', 'Detalle');
    vi.mocked(Preferences.set).mockRejectedValue(new Error('Disco lleno'));
    expect(await sync.sync()).toBe('error');
    expect(sync.label()).toBe('Error');
    expect(api.insert).not.toHaveBeenCalled();
    expect(tasks.tasks()[0].syncStatus).toBe('pending');
  });

  it('serializes manual sync attempts; local mutations alone do not invoke the transport without a coordinator', async () => {
    tasks.addTask('Pendiente', 'Detalle');
    TestBed.tick();
    expect(api.insert).not.toHaveBeenCalled();
    let finish!: (rows: RemoteTask[]) => void;
    api.download.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = sync.sync();
    await vi.waitFor(() => expect(finish).toBeDefined());
    await sync.sync();
    expect(api.insert).toHaveBeenCalledOnce();
    finish([]);
    await first;
    expect(sync.running()).toBe(false);
  });

  it('restores stable pending UUIDs after reloading Preferences and restores last-sync metadata', async () => {
    const task = tasks.addTask('Persistida', 'Detalle')!;
    await tasks.prepareSync(context.userA.id, () => undefined);
    const migrated = { ...tasks.getTask(task.id)! };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [...context.providers,
      { provide: SupabaseAuthService, useValue: { currentUser: remoteUser } },
      { provide: RemoteTaskService, useValue: api }
    ] });
    tasks = TestBed.inject(TaskService);
    await tasks.ready;
    sync = TestBed.inject(TaskSyncService);
    expect(tasks.getTask(task.id)).toEqual(migrated);
    await sync.sync();
    expect(database.size).toBe(1);
    const lastSyncedAt = sync.state().lastSyncedAt;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [...context.providers,
      { provide: SupabaseAuthService, useValue: { currentUser: remoteUser } },
      { provide: RemoteTaskService, useValue: api }
    ] });
    tasks = TestBed.inject(TaskService);
    await tasks.ready;
    sync = TestBed.inject(TaskSyncService);
    TestBed.tick();
    await vi.waitFor(() => expect(sync.state().lastSyncedAt).toBe(lastSyncedAt));
    expect(tasks.getTask(task.id)?.remoteId).toBe(task.remoteId);
    expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
  });

  it('ignores a response when a different local user takes over during upload', async () => {
    const task = tasks.addTask('Privada A', 'Detalle')!;
    const original = api.insert.getMockImplementation()!;
    api.insert.mockImplementation(async (sent: Task, ctx: SyncContext) => {
      const result = await original(sent, ctx);
      context.currentUser.set({ ...context.userB, remoteUserId: 'remote-b' });
      remoteUser.set({ id: 'remote-b' });
      return result;
    });
    await sync.sync();
    expect(tasks.tasks()).toEqual([]);
    expect(api.download).not.toHaveBeenCalled();
    const stored: Task[] = JSON.parse(context.storage.get('tareafacil_tasks')!);
    expect(stored.find(t => t.id === task.id)).toMatchObject({ userId: context.userA.id, syncStatus: 'pending' });
  });

  it('does not overwrite a conflicting local edit if its conflict backup cannot be saved', async () => {
    const task = tasks.addTask('Inicial', 'Detalle')!;
    await sync.sync();
    const server = database.get(task.remoteId!)!;
    database.set(server.id, { ...server, title: 'Remota', revision: 2 });
    tasks.updateTask(task.id, 'Local importante', 'Detalle');
    const persist = vi.mocked(Preferences.set).getMockImplementation()!;
    vi.mocked(Preferences.set).mockImplementation(args => args.key.startsWith('tareafacil_sync_conflicts_')
      ? Promise.reject(new Error('No se pudo guardar el respaldo')) : persist(args));
    await sync.sync();
    expect(sync.label()).toBe('Error');
    expect(tasks.getTask(task.id)).toMatchObject({ title: 'Local importante', syncStatus: 'pending' });
  });
});

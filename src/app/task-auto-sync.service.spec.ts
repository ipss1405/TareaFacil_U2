import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';
import { createTaskTestContext } from './testing/task-test-context';
import { TaskAutoSyncService } from './task-auto-sync.service';
import { TaskService } from './task.service';
import { TaskSyncService } from './task-sync.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { SupabaseClientService } from './supabase-client.service';
import { TaskRealtimeService } from './task-realtime.service';
import { RemoteTaskService, SyncContext, TaskRemoteError } from './remote-task.service';
import { RemoteTask, taskContent } from './remote-task.model';
import { Task } from './task.model';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));
vi.mock('@capacitor/app', () => ({ App: { getState: vi.fn(), addListener: vi.fn() } }));

describe('TaskAutoSyncService confirmed foreground synchronization', () => {
  let context: ReturnType<typeof createTaskTestContext>;
  let tasks: TaskService;
  let sync: TaskSyncService;
  let remoteUser: ReturnType<typeof signal<{ id: string } | null>>;
  let database: Map<string, RemoteTask>;
  let receiver: ((event: unknown) => void) | undefined;
  const api = { insert: vi.fn(), update: vi.fn(), find: vi.fn(), download: vi.fn() };
  const removeListener = vi.fn();
  const channel = { on: vi.fn(), subscribe: vi.fn() };

  function row(task: Task, owner: string, revision = 1): RemoteTask {
    return { ...taskContent(task), id: task.remoteId!, owner_id: owner,
      local_task_id: task.id, origin_device_id: task.originDeviceId ?? 'device',
      created_at: task.createdAt ?? new Date().toISOString(), updated_at: new Date().toISOString(), revision };
  }
  function start(native = false) {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(native);
    TestBed.inject(TaskAutoSyncService);
    TestBed.tick();
  }
  async function advance(ms = 750) {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(ms);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
  }
  async function create(title = 'Local') {
    return (await tasks.persistLocalChange(() => tasks.addTask(title, 'Detalle')))!;
  }
  async function deferredInsert() {
    let finish!: () => void;
    const normal = api.insert.getMockImplementation()!;
    api.insert.mockImplementationOnce((task: Task, ctx: SyncContext) => new Promise(resolve => {
      finish = () => { resolve(normal(task, ctx)); };
    }));
    return { finish: () => finish() };
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    vi.mocked(App.getState).mockResolvedValue({ isActive: true });
    vi.mocked(App.addListener).mockResolvedValue({ remove: removeListener });
    removeListener.mockResolvedValue(undefined);
    context = createTaskTestContext();
    context.currentUser.set({ ...context.userA, remoteUserId: 'remote-a' });
    context.storage.set('tareafacil_tasks', '[]');
    remoteUser = signal<{ id: string } | null>({ id: 'remote-a' });
    database = new Map();
    receiver = undefined;
    channel.on.mockImplementation((_type, _filter, callback) => { receiver = callback; return channel; });
    channel.subscribe.mockImplementation(callback => { callback('SUBSCRIBED'); return channel; });
    api.insert.mockImplementation(async (task: Task, ctx: SyncContext) => {
      ctx.assertCurrent();
      if (database.has(task.remoteId!)) throw new TaskRemoteError('Duplicate', '23505', 409);
      const result = row(task, ctx.ownerId); database.set(result.id, result); return result;
    });
    api.update.mockImplementation(async (task: Task, ctx: SyncContext) => {
      ctx.assertCurrent();
      const previous = database.get(task.remoteId!);
      if (!previous || previous.revision !== task.remoteRevision) return null;
      const result = row(task, ctx.ownerId, previous.revision + 1); database.set(result.id, result); return result;
    });
    api.find.mockImplementation(async (task: Task, ctx: SyncContext) => {
      ctx.assertCurrent(); return database.get(task.remoteId!) ?? null;
    });
    api.download.mockImplementation(async (ctx: SyncContext) => {
      ctx.assertCurrent(); return [...database.values()].filter(item => item.owner_id === ctx.ownerId);
    });
    TestBed.configureTestingModule({ providers: [...context.providers,
      { provide: SupabaseAuthService, useValue: { currentUser: remoteUser } },
      { provide: RemoteTaskService, useValue: api },
      { provide: SupabaseClientService, useValue: { client: { channel: () => channel, removeChannel: vi.fn().mockResolvedValue('ok') } } }
    ] });
    tasks = TestBed.inject(TaskService); await tasks.ready;
    sync = TestBed.inject(TaskSyncService); TestBed.tick();
    vi.useFakeTimers();
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('creates locally and uploads automatically after 750 ms', async () => {
    start(); const task = await create();
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!)[0].syncStatus).toBe('pending');
    await advance(749); expect(api.insert).not.toHaveBeenCalled();
    await advance(1); expect(database.get(task.remoteId!)?.title).toBe('Local');
    expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
  });

  it('does not upload before a deferred local Preferences write is confirmed', async () => {
    start(); let finish!: () => void;
    const normal = vi.mocked(Preferences.set).getMockImplementation()!;
    vi.mocked(Preferences.set).mockImplementationOnce(async options => {
      await new Promise<void>(resolve => { finish = resolve; }); await normal(options);
    });
    const saving = create();
    await advance(); expect(api.insert).not.toHaveBeenCalled();
    finish(); await saving; await advance(); expect(api.insert).toHaveBeenCalledTimes(1);
  });

  it('does not upload a failed Preferences mutation, even if startup was already scheduled', async () => {
    start(); vi.mocked(Preferences.set).mockRejectedValueOnce(new Error('Storage failed'));
    await expect(create()).rejects.toThrow('Storage failed');
    await advance(30000); expect(api.insert).not.toHaveBeenCalled(); expect(tasks.totalTasks()).toBe(0);
  });

  it('groups nearby edits even when the task remains pending and the count is unchanged', async () => {
    start(); const task = await create();
    await advance(400);
    await tasks.persistLocalChange(() => tasks.updateTask(task.id, 'Editada', 'Detalle'));
    await advance(400); expect(api.insert).not.toHaveBeenCalled();
    await advance(350); expect(api.insert).toHaveBeenCalledTimes(1);
    expect(database.get(task.remoteId!)?.title).toBe('Editada');
  });

  it('uploads confirmed completion, removal and imported tasks without manual clicks', async () => {
    start(); const task = await create(); await advance();
    await tasks.persistLocalChange(() => tasks.toggleTask(task.id)); await advance();
    expect(database.get(task.remoteId!)?.completed).toBe(true);
    await tasks.persistLocalChange(() => tasks.deleteTask(task.id)); await advance();
    expect(database.get(task.remoteId!)?.deleted_at).toBeTruthy();
    await tasks.importTasks([{ id: 7, userId: 99, title: 'Importada', completed: false }], context.userA.id);
    await advance(); expect([...database.values()].some(item => item.external_id === 7)).toBe(true);
  });

  it('does not auto-upload an import whose Preferences write failed', async () => {
    start(); await advance();
    vi.mocked(Preferences.set).mockRejectedValueOnce(new Error('Storage failed'));
    await expect(tasks.importTasks([{ id: 7, userId: 1, title: 'Importada', completed: false }], context.userA.id)).rejects.toThrow();
    await advance(30000); expect(api.insert).not.toHaveBeenCalled();
  });

  it('keeps confirmed offline changes pending and retries when an online event arrives', async () => {
    start(); window.dispatchEvent(new Event('offline'));
    const task = await create(); await advance(30000);
    expect(api.insert).not.toHaveBeenCalled(); expect(tasks.getTask(task.id)?.syncStatus).toBe('pending');
    window.dispatchEvent(new Event('online')); await advance();
    expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
  });

  it('treats online as a hint and retries actual network errors with bounded backoff', async () => {
    api.insert.mockRejectedValue(new TaskRemoteError('Network unavailable', 'NETWORK'));
    start(); const task = await create(); await advance();
    expect(sync.state().status).toBe('offline'); expect(tasks.getTask(task.id)?.syncStatus).toBe('pending');
    await advance(2000); await advance(5000); await advance(15000);
    expect(api.insert).toHaveBeenCalledTimes(4);
    await advance(60000); expect(api.insert).toHaveBeenCalledTimes(4);
    window.dispatchEvent(new Event('online')); await advance(); expect(api.insert).toHaveBeenCalledTimes(5);
  });

  it('does not duplicate a row after a lost INSERT response', async () => {
    const normal = api.insert.getMockImplementation()!;
    api.insert.mockImplementationOnce(async (task, ctx) => {
      await normal(task, ctx); throw new TaskRemoteError('Lost response', 'NETWORK');
    });
    start(); const task = await create(); await advance(); await advance(2000);
    expect(database.size).toBe(1); expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
  });

  it('remembers edits made during upload and sends a second pass without overwriting them', async () => {
    const pending = await deferredInsert(); start(); const task = await create(); await advance();
    await tasks.persistLocalChange(() => tasks.updateTask(task.id, 'Durante envio', 'Detalle'));
    await advance(); expect(api.insert).toHaveBeenCalledTimes(1);
    pending.finish(); await advance(0);
    expect(tasks.getTask(task.id)?.title).toBe('Durante envio');
    expect(tasks.getTask(task.id)?.syncStatus).toBe('pending');
    await advance(); expect(api.update).toHaveBeenCalledTimes(1);
    expect(database.get(task.remoteId!)?.title).toBe('Durante envio');
    expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
  });

  it('shares the lock with a running manual reconciliation', async () => {
    const pending = await deferredInsert(); start(); await create();
    const manual = sync.sync(); await advance();
    expect(api.insert).toHaveBeenCalledTimes(1);
    expect(await sync.sync()).toBe('busy');
    pending.finish(); expect(await manual).toBe('success');
    await advance(2000); expect(api.insert).toHaveBeenCalledTimes(1);
  });

  it('does not turn a real Realtime event into another upload', async () => {
    start(); TestBed.inject(TaskRealtimeService); TestBed.tick(); await advance();
    const incoming = row({ id: 42, userId: 'remote', title: 'Remota', description: 'Detalle', completed: false,
      remoteId: 'remote-task', createdAt: new Date().toISOString() }, 'remote-a');
    receiver!({ eventType: 'INSERT', schema: 'public', table: 'tasks', new: incoming });
    await advance(0); await advance(30000);
    expect(tasks.totalTasks()).toBe(1); expect(tasks.tasks()[0].syncStatus).toBe('synced');
    expect(api.insert).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled(); expect(api.download).not.toHaveBeenCalled();
  });

  it.each([401, 403, 400])('stops automatic retries after HTTP %s until manual recovery', async status => {
    api.insert.mockRejectedValueOnce(new TaskRemoteError('Rejected', status === 403 ? '42501' : 'ERROR', status));
    start(); await create(); await advance();
    await advance(60000); window.dispatchEvent(new Event('online')); await advance();
    expect(api.insert).toHaveBeenCalledTimes(1);
    expect(await sync.sync()).toBe('success');
    const task = tasks.tasks()[0]; await tasks.persistLocalChange(() => tasks.toggleTask(task.id)); await advance();
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it('stops at a conflict, retains the backup and resumes only after manual reconciliation', async () => {
    const task = await create(); await sync.sync();
    const previous = database.get(task.remoteId!)!;
    database.set(previous.id, { ...previous, revision: 2, title: 'Otra instancia' });
    start(); await tasks.persistLocalChange(() => tasks.updateTask(task.id, 'Edicion local', 'Detalle')); await advance();
    expect(sync.state().status).toBe('conflict');
    expect(JSON.parse(context.storage.get('tareafacil_sync_conflicts_user-a_remote-a')!)[0].local.title).toBe('Edicion local');
    const inserts = api.insert.mock.calls.length;
    await create('Posterior'); window.dispatchEvent(new Event('online')); await advance(60000);
    expect(api.insert).toHaveBeenCalledTimes(inserts);
    expect(await sync.sync()).toBe('success'); expect(database.size).toBe(2);
  });

  it('waits for a matching remote session and resumes pending work when it becomes valid', async () => {
    remoteUser.set(null); start(); const task = await create(); await advance(30000);
    expect(api.insert).not.toHaveBeenCalled();
    remoteUser.set({ id: 'remote-a' }); await advance(); expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
  });

  it('resumes after an expired session is replaced with a fresh authenticated session', async () => {
    api.insert.mockRejectedValueOnce(new TaskRemoteError('Expired', 'PGRST301', 401));
    start(); await create(); await advance(); await advance(60000); expect(api.insert).toHaveBeenCalledTimes(1);
    remoteUser.set({ id: 'remote-a' }); await advance(); expect(api.insert).toHaveBeenCalledTimes(2);
  });

  it('cancels delayed sends on logout and does not upload another users pending records', async () => {
    start(); await create(); context.currentUser.set(null); remoteUser.set(null); await advance(60000);
    expect(api.insert).not.toHaveBeenCalled();
    context.currentUser.set({ ...context.userB, remoteUserId: 'remote-b' }); remoteUser.set({ id: 'remote-b' }); await advance();
    expect(api.insert).not.toHaveBeenCalled(); await create('B'); await advance();
    expect([...database.values()].map(item => item.owner_id)).toEqual(['remote-b']);
  });

  it('cancels network retry timers on a session change', async () => {
    api.insert.mockRejectedValue(new TaskRemoteError('Offline', 'NETWORK'));
    start(); await create(); await advance();
    context.currentUser.set(null); remoteUser.set(null); await advance(60000); expect(api.insert).toHaveBeenCalledTimes(1);
  });

  it('does not send in a hidden document and retries on return to the foreground', async () => {
    start(); let visible = false;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
    document.dispatchEvent(new Event('visibilitychange')); await create(); await advance(30000);
    expect(api.insert).not.toHaveBeenCalled(); visible = true;
    document.dispatchEvent(new Event('visibilitychange')); await advance(); expect(api.insert).toHaveBeenCalledTimes(1);
  });

  it('uses native app state without installing a network plugin and removes its listener', async () => {
    vi.mocked(App.getState).mockResolvedValue({ isActive: false }); start(true);
    await create(); await advance(); expect(api.insert).not.toHaveBeenCalled();
    const callback = vi.mocked(App.addListener).mock.calls[0][1] as unknown as (state: { isActive: boolean }) => void;
    callback({ isActive: true }); await advance(); expect(api.insert).toHaveBeenCalledTimes(1);
    callback({ isActive: false }); await create('En pausa'); await advance(30000); expect(api.insert).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule(); expect(removeListener).toHaveBeenCalledTimes(1);
  });
  it('retries a transient server failure but stops after bounded attempts', async () => {
    api.insert.mockRejectedValueOnce(new TaskRemoteError('Unavailable', 'SERVER', 503));
    start(); const task = await create(); await advance();
    expect(tasks.getTask(task.id)?.syncStatus).toBe('pending');
    await advance(2000); expect(tasks.getTask(task.id)?.syncStatus).toBe('synced');
  });

  it('resumes pending work for the new account after an old manual request finishes', async () => {
    const pending = await deferredInsert(); start(); await create('A');
    const manual = sync.sync(); await advance();
    context.currentUser.set({ ...context.userB, remoteUserId: 'remote-b' }); remoteUser.set({ id: 'remote-b' });
    await create('B'); await advance(); expect(api.insert).toHaveBeenCalledTimes(1);
    pending.finish(); expect(await manual).toBe('cancelled'); await advance();
    expect([...database.values()].map(item => item.owner_id)).toEqual(['remote-b']);
    expect(tasks.tasks()[0].title).toBe('B'); expect(tasks.tasks()[0].syncStatus).toBe('synced');
  });

  it('does not start a second upload in the background after an in-flight edit', async () => {
    const pending = await deferredInsert(); start(); const task = await create(); await advance();
    await tasks.persistLocalChange(() => tasks.updateTask(task.id, 'Nueva edicion', 'Detalle'));
    let visible = false;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    pending.finish(); await advance(30000); expect(api.update).not.toHaveBeenCalled();
    visible = true; document.dispatchEvent(new Event('visibilitychange')); await advance();
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it('resumes after bounded network failures when the application returns to the foreground', async () => {
    const normal = api.insert.getMockImplementation()!;
    api.insert.mockRejectedValue(new TaskRemoteError('Offline', 'NETWORK'));
    start(); await create(); await advance(); await advance(22000);
    expect(api.insert).toHaveBeenCalledTimes(4);
    api.insert.mockImplementation(normal);
    let visible = false;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visible = true; document.dispatchEvent(new Event('visibilitychange')); await advance();
    expect(tasks.tasks()[0].syncStatus).toBe('synced');
  });

  it('finishes the in-flight acknowledgement but does not start new task requests in the background', async () => {
    const pending = await deferredInsert(); start(); await create('First'); await create('Second'); await advance();
    let visible = false;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    pending.finish(); await advance(30000);
    expect(api.insert).toHaveBeenCalledTimes(1); expect(api.download).not.toHaveBeenCalled();
    expect(tasks.tasks().filter(task => task.syncStatus === 'pending')).toHaveLength(1);
    visible = true; document.dispatchEvent(new Event('visibilitychange')); await advance();
    expect(api.insert).toHaveBeenCalledTimes(2);
    expect(tasks.tasks().every(task => task.syncStatus === 'synced')).toBe(true);
  });

});

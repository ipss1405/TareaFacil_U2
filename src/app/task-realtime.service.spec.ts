import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';
import { TaskRealtimeService } from './task-realtime.service';
import { TaskService } from './task.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { SupabaseClientService } from './supabase-client.service';
import { fromRemote, RemoteTask, taskContent } from './remote-task.model';
import { createTaskTestContext } from './testing/task-test-context';
import { Task } from './task.model';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));

type Callback = (payload: unknown) => void;
function channelDouble() {
  const handlers = new Map<string, Callback>();
  let statusCallback: (status: string, error?: Error) => void;
  const channel = {
    on: vi.fn().mockImplementation((_type, filter: { event: string }, callback: Callback) => { handlers.set(filter.event, callback); return channel; }),
    subscribe: vi.fn().mockImplementation(callback => { statusCallback = callback; return channel; }),
    emit: (event: string, row: unknown, schema = 'public', table = 'tasks') => handlers.get(event)?.({ eventType: event, new: row, schema, table }),
    status: (status: string, error?: Error) => statusCallback(status, error)
  };
  return channel;
}

describe('TaskRealtimeService owner-scoped Postgres Changes', () => {
  let context: ReturnType<typeof createTaskTestContext>;
  let tasks: TaskService;
  let realtime: TaskRealtimeService;
  let remoteUser: ReturnType<typeof signal<{ id: string } | null>>;
  let channels: ReturnType<typeof channelDouble>[];
  const client = { channel: vi.fn(), removeChannel: vi.fn(), from: vi.fn() };
  const row: RemoteTask = { id: 'remote-task', owner_id: 'remote-a', local_task_id: 42, origin_device_id: 'device',
    title: 'Desde Supabase', description: 'Remota', completed: false, created_at: '2026-01-01T00:00:00Z',
    scheduled_at: null, latitude: 0, longitude: -70, accuracy: 5, external_source: null, external_id: null,
    updated_at: '2026-11-09T14:00:00Z', deleted_at: null, revision: 1 };

  beforeEach(async () => {
    vi.resetAllMocks();
    context = createTaskTestContext();
    context.currentUser.set({ ...context.userA, remoteUserId: 'remote-a' });
    context.storage.set('tareafacil_tasks', '[]');
    remoteUser = signal<{ id: string } | null>({ id: 'remote-a' });
    channels = [];
    client.channel.mockImplementation(() => { const channel = channelDouble(); channels.push(channel); return channel; });
    client.removeChannel.mockResolvedValue('ok');
    TestBed.configureTestingModule({ providers: [...context.providers,
      { provide: SupabaseAuthService, useValue: { currentUser: remoteUser } },
      { provide: SupabaseClientService, useValue: { client } }
    ] });
    tasks = TestBed.inject(TaskService);
    await tasks.ready;
    realtime = TestBed.inject(TaskRealtimeService);
    TestBed.tick();
    channels[0].status('SUBSCRIBED');
  });

  async function inserted() {
    channels[0].emit('INSERT', row);
    await vi.waitFor(() => expect(tasks.tasks()).toHaveLength(1));
    await vi.waitFor(() => expect(JSON.parse(context.storage.get('tareafacil_tasks')!)).toHaveLength(1));
  }

  async function localSynced(): Promise<Task> {
    const task = tasks.addTask('Local', 'Detalle', 'task-photos/keep.jpg')!;
    await tasks.prepareSync(context.userA.id, () => undefined);
    await tasks.acceptRemote(fromRemote({ ...row, ...taskContent(task), id: task.remoteId! }, context.userA.id), () => undefined, task, true);
    return tasks.getTask(task.id)!;
  }

  it('reuses the injected client for exactly INSERT and UPDATE on public.tasks with an owner filter', () => {
    expect(client.channel).toHaveBeenCalledOnce();
    expect(channels[0].on.mock.calls.map(call => call[1])).toEqual([
      { event: 'INSERT', schema: 'public', table: 'tasks', filter: 'owner_id=eq.remote-a' },
      { event: 'UPDATE', schema: 'public', table: 'tasks', filter: 'owner_id=eq.remote-a' }
    ]);
    expect(realtime.label()).toBe('En tiempo real');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('applies a remote INSERT as synced and persists it without manual sync', async () => {
    await inserted();
    expect(tasks.tasks()[0]).toMatchObject({ remoteId: row.id, userId: context.userA.id, title: row.title, syncStatus: 'synced', remoteRevision: 1 });
    expect(tasks.pendingSyncCount()).toBe(0);
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!)[0].syncStatus).toBe('synced');
  });

  it('applies UPDATE, GPS and scheduling while preserving the local ID and photoPath', async () => {
    const local = await localSynced();
    channels[0].emit('UPDATE', { ...row, id: local.remoteId, revision: 2, title: 'Actualizada', completed: true, scheduled_at: '2026-11-12T12:00:00Z', latitude: 1, longitude: 2, accuracy: 0 });
    await vi.waitFor(() => expect(tasks.getTask(local.id)?.remoteRevision).toBe(2));
    expect(tasks.getTask(local.id)).toMatchObject({ title: 'Actualizada', completed: true, latitude: 1, longitude: 2, accuracy: 0,
      scheduledAt: '2026-11-12T12:00:00Z', photoPath: 'task-photos/keep.jpg', syncStatus: 'synced' });
  });

  it('persists a remote tombstone and hides it from counters and task views', async () => {
    const local = await localSynced();
    channels[0].emit('UPDATE', { ...row, id: local.remoteId, revision: 2, deleted_at: '2026-11-09T15:00:00Z' });
    await vi.waitFor(() => expect(tasks.tasks()).toHaveLength(0));
    expect(tasks.totalTasks()).toBe(0);
    expect(tasks.completedTasks()).toBe(0);
    expect(tasks.syncTasks(context.userA.id)[0]).toMatchObject({ deletedAt: '2026-11-09T15:00:00Z', photoPath: 'task-photos/keep.jpg', syncStatus: 'synced' });
    await vi.waitFor(() => expect(JSON.parse(context.storage.get('tareafacil_tasks')!)[0].deletedAt).toBeTruthy());
  });

  it('does not perform remote writes or reopen channels after receiving an event', async () => {
    await inserted();
    TestBed.tick();
    expect(client.from).not.toHaveBeenCalled();
    expect(client.channel).toHaveBeenCalledOnce();
  });

  it('reconciles an echo of the same pending upload without generating another pending change', async () => {
    const local = tasks.addTask('Local', 'Detalle', 'keep.jpg')!;
    await tasks.prepareSync(context.userA.id, () => undefined);
    channels[0].emit('INSERT', { ...row, ...taskContent(local), id: local.remoteId });
    await vi.waitFor(() => expect(tasks.getTask(local.id)?.syncStatus).toBe('synced'));
    expect(tasks.getTask(local.id)?.photoPath).toBe('keep.jpg');
    expect(tasks.getTask(local.id)?.remoteRevision).toBe(1);
    expect(tasks.pendingSyncCount()).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('preserves differing offline edits and their revision base for manual conflict resolution', async () => {
    const local = await localSynced();
    tasks.updateTask(local.id, 'Offline importante', 'Detalle', local.photoPath);
    channels[0].emit('UPDATE', { ...row, id: local.remoteId, title: 'Otra edición', revision: 2 });
    await vi.waitFor(() => expect(realtime.state().message).toContain('pendientes'));
    expect(tasks.getTask(local.id)).toMatchObject({ title: 'Offline importante', syncStatus: 'pending', remoteRevision: 1 });
  });

  it('ignores duplicates and out-of-order rows and cannot regress to an older HTTP response', async () => {
    await inserted();
    const local = tasks.tasks()[0];
    channels[0].emit('UPDATE', { ...row, title: 'Más reciente', revision: 3 });
    await vi.waitFor(() => expect(tasks.getTask(local.id)?.remoteRevision).toBe(3));
    channels[0].emit('UPDATE', { ...row, title: 'Atrasada', revision: 2 });
    await tasks.acceptRemote(fromRemote({ ...row, title: 'HTTP atrasado', revision: 2 }, context.userA.id), () => undefined, local, true);
    channels[0].emit('UPDATE', { ...row, title: 'Más reciente', revision: 3 });
    await Promise.resolve();
    expect(tasks.getTask(local.id)).toMatchObject({ title: 'Más reciente', remoteRevision: 3, syncStatus: 'synced' });
  });

  it('ignores another owner, schema, table and physical DELETE', async () => {
    channels[0].emit('INSERT', { ...row, owner_id: 'remote-b' });
    channels[0].emit('INSERT', row, 'other');
    channels[0].emit('INSERT', row, 'public', 'other');
    channels[0].emit('DELETE', row);
    await Promise.resolve();
    expect(tasks.tasks()).toHaveLength(0);
  });

  it('does not open a channel for mismatched, missing or legacy identities', () => {
    remoteUser.set({ id: 'remote-b' });
    TestBed.tick();
    expect(client.removeChannel).toHaveBeenCalledOnce();
    expect(client.channel).toHaveBeenCalledOnce();
    context.currentUser.set(context.userA);
    TestBed.tick();
    remoteUser.set(null);
    TestBed.tick();
    expect(client.channel).toHaveBeenCalledOnce();
    expect(realtime.label()).toBe('Desconectado');
  });

  it('removes the channel at logout and ignores late data and status callbacks immediately', async () => {
    await inserted();
    const before = context.storage.get('tareafacil_tasks');
    context.currentUser.set(null);
    channels[0].emit('UPDATE', { ...row, revision: 2, title: 'Late' });
    channels[0].status('SUBSCRIBED');
    TestBed.tick();
    await Promise.resolve();
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(realtime.label()).toBe('Desconectado');
    expect(context.storage.get('tareafacil_tasks')).toBe(before);
  });

  it('switches owners and never applies callbacks queued under the previous account', async () => {
    await inserted();
    context.currentUser.set({ ...context.userB, remoteUserId: 'remote-b' });
    remoteUser.set({ id: 'remote-b' });
    TestBed.tick();
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(channels[1].on.mock.calls[0][1].filter).toBe('owner_id=eq.remote-b');
    channels[0].emit('UPDATE', { ...row, revision: 2, title: 'Late A' });
    channels[1].emit('INSERT', { ...row, id: 'remote-b-task', owner_id: 'remote-b', title: 'Solo B' });
    await vi.waitFor(() => expect(tasks.tasks()).toHaveLength(1));
    expect(tasks.tasks()[0].title).toBe('Solo B');
    const stored: Task[] = JSON.parse(context.storage.get('tareafacil_tasks')!);
    expect(stored.find(task => task.userId === context.userA.id)?.title).toBe(row.title);
  });

  it('invalidates the old channel for a new session with the same remote UUID', () => {
    remoteUser.set({ id: 'remote-a' });
    TestBed.tick();
    channels[0].emit('INSERT', row);
    channels[0].status('SUBSCRIBED');
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
    expect(client.channel).toHaveBeenCalledTimes(2);
    expect(tasks.tasks()).toHaveLength(0);
    expect(realtime.label()).toBe('Reconectando');
  });

  it('leaves local CRUD available during channel errors and recovers connection status', () => {
    channels[0].status('CHANNEL_ERROR', new Error('offline'));
    expect(realtime.label()).toBe('Reconectando');
    const local = tasks.addTask('Sin red', 'Detalle')!;
    tasks.toggleTask(local.id);
    tasks.deleteTask(local.id);
    expect(tasks.syncTasks(context.userA.id)[0]).toMatchObject({ syncStatus: 'pending', deletedAt: expect.any(String) });
    channels[0].status('TIMED_OUT');
    expect(realtime.label()).toBe('Reconectando');
    channels[0].status('CLOSED');
    expect(realtime.label()).toBe('Desconectado');
    channels[0].status('SUBSCRIBED');
    expect(realtime.label()).toBe('En tiempo real');
  });

  it('does not depend on remote connectivity to restore local readiness', () => {
    expect(tasks.ready).toBeInstanceOf(Promise);
    expect(context.isReady()).toBe(true);
    context.isReady.set(false);
    TestBed.tick();
    expect(client.removeChannel).toHaveBeenCalledOnce();
    expect(client.channel).toHaveBeenCalledOnce();
  });

  it('ignores an event when logout happens before its queued application', async () => {
    channels[0].emit('INSERT', row);
    context.currentUser.set(null);
    TestBed.tick();
    await Promise.resolve();
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!)).toEqual([]);
  });

  it('rejects incomplete rows without replacing local data', async () => {
    channels[0].emit('INSERT', { id: row.id, owner_id: row.owner_id });
    await vi.waitFor(() => expect(realtime.state().message).toContain('No se pudo aplicar'));
    expect(tasks.tasks()).toHaveLength(0);
  });

  it('keeps a persistence failure visible and can apply a later valid event', async () => {
    const persist = vi.mocked(Preferences.set).getMockImplementation()!;
    vi.mocked(Preferences.set).mockRejectedValueOnce(new Error('Disco lleno'));
    channels[0].emit('INSERT', row);
    await vi.waitFor(() => expect(realtime.state().message).toContain('No se pudo aplicar'));
    vi.mocked(Preferences.set).mockImplementation(persist);
    channels[0].emit('UPDATE', { ...row, revision: 2, title: 'Reintento remoto' });
    await vi.waitFor(() => expect(JSON.parse(context.storage.get('tareafacil_tasks')!)[0]?.remoteRevision).toBe(2));
  });

  it('removes the active channel when the application injector is destroyed', () => {
    TestBed.resetTestingModule();
    expect(client.removeChannel).toHaveBeenCalledWith(channels[0]);
  });

  it('does not block the application if opening a channel fails', () => {
    client.channel.mockImplementationOnce(() => { throw new Error('Bad realtime configuration'); });
    remoteUser.set({ id: 'remote-a' });
    TestBed.tick();
    expect(realtime.label()).toBe('Desconectado');
    expect(realtime.state().message).toContain('Sincronizar');
    expect(tasks.addTask('Sigue offline', 'Detalle')).toBeDefined();
  });

  it('ignores unsubscribe network failures without applying late callbacks', async () => {
    client.removeChannel.mockRejectedValueOnce(new Error('offline'));
    context.currentUser.set(null);
    TestBed.tick();
    await Promise.resolve();
    channels[0].emit('INSERT', row);
    channels[0].status('SUBSCRIBED');
    expect(realtime.label()).toBe('Desconectado');
    expect(tasks.tasks()).toEqual([]);
  });
});

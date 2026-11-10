import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { RemoteTaskService, SyncContext } from './remote-task.service';
import { Task } from './task.model';
import { RemoteTask, fromRemote, taskContent, sameTaskContent } from './remote-task.model';

describe('RemoteTaskService with the real Supabase query builder', () => {
  const task: Task = { id: 42, userId: 'local-a', remoteId: 'remote-task', originDeviceId: 'device',
    title: 'Propia', description: 'Detalle', completed: false, createdAt: '2026-01-01T00:00:00Z',
    scheduledAt: '2026-11-12T12:00:00.000Z', latitude: 0, longitude: 0, accuracy: 0,
    photoPath: 'local-only.jpg', remoteRevision: 3 };
  const row: RemoteTask = { ...taskContent(task), id: 'remote-task', owner_id: 'remote-a', local_task_id: 42,
    origin_device_id: 'device', created_at: task.createdAt!, updated_at: '2026-11-09T12:00:00Z', revision: 4 };
  let fetchMock: ReturnType<typeof vi.fn>;
  let service: RemoteTaskService;
  let valid: boolean;
  const ctx: SyncContext = { ownerId: 'remote-a', assertCurrent: () => { if (!valid) throw new Error('Session changed'); } };
  const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  beforeEach(() => {
    valid = true;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    service = TestBed.inject(RemoteTaskService);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('inserts a UUID owned by the authenticated context and excludes local-only fields', async () => {
    fetchMock.mockResolvedValue(response(row, 201));
    expect(await service.insert(task, ctx)).toEqual(row);
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/rest/v1/tasks');
    const sent = JSON.parse(options.body);
    expect(sent).toMatchObject({ owner_id: 'remote-a', id: 'remote-task', local_task_id: 42, latitude: 0 });
    expect(sent.photoPath).toBeUndefined();
    expect(sent.userId).toBeUndefined();
    expect(sent.revision).toBeUndefined();
  });

  it('updates with owner, UUID and revision filters and preserves immutable identity', async () => {
    fetchMock.mockResolvedValue(response([row]));
    expect(await service.update(task, ctx)).toEqual(row);
    const [url, options] = fetchMock.mock.calls[0];
    const params = new URL(url).searchParams;
    expect(params.get('owner_id')).toBe('eq.remote-a');
    expect(params.get('id')).toBe('eq.remote-task');
    expect(params.get('revision')).toBe('eq.3');
    expect(options.method).toBe('PATCH');
    const sent = JSON.parse(options.body);
    expect(sent.origin_device_id).toBeUndefined();
    expect(sent.local_task_id).toBeUndefined();
    expect(sent.owner_id).toBeUndefined();
  });

  it('returns null when the revision no longer matches', async () => {
    fetchMock.mockResolvedValue(response([]));
    expect(await service.update(task, ctx)).toBeNull();
  });

  it('downloads all pages including deleted rows with an explicit owner filter', async () => {
    const page = Array.from({ length: 500 }, (_, i) => ({ ...row, id: `row-${i}` }));
    fetchMock.mockResolvedValueOnce(response(page)).mockResolvedValueOnce(response([{ ...row, deleted_at: '2026-11-09T00:00:00Z' }]));
    const result = await service.download(ctx);
    expect(result).toHaveLength(501);
    expect(result[500].deleted_at).toBeTruthy();
    for (const [url] of fetchMock.mock.calls) {
      const params = new URL(url).searchParams;
      expect(params.get('owner_id')).toBe('eq.remote-a');
      expect(params.has('deleted_at')).toBe(false);
    }
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('offset')).toBe('500');
  });

  it('refuses rows from another account even if a remote endpoint returns them', async () => {
    fetchMock.mockResolvedValue(response([{ ...row, owner_id: 'remote-b' }]));
    await expect(service.download(ctx)).rejects.toThrow('otra cuenta');
  });

  it('does not issue a request if the captured session is invalid', async () => {
    valid = false;
    await expect(service.download(ctx)).rejects.toThrow('Session changed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a response arriving after a session change', async () => {
    fetchMock.mockImplementation(async () => { valid = false; return response([row]); });
    await expect(service.download(ctx)).rejects.toThrow('Session changed');
  });

  it('preserves real PostgreSQL errors for duplicate reconciliation', async () => {
    fetchMock.mockResolvedValue(response({ message: 'duplicate key', code: '23505' }, 409));
    await expect(service.insert(task, ctx)).rejects.toMatchObject({ code: '23505', status: 409 });
  });

  it('reports transport errors instead of returning an empty successful download', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(service.download(ctx)).rejects.toMatchObject({ status: 0 });
  });

  it('maps nullable fields and compares equivalent PostgreSQL timestamps', () => {
    const local = fromRemote({ ...row, scheduled_at: '2026-11-12T12:00:00+00:00' }, 'local-a');
    expect(local).toMatchObject({ userId: 'local-a', remoteId: row.id, syncStatus: 'synced', remoteRevision: 4 });
    expect(local.photoPath).toBeUndefined();
    expect(sameTaskContent(task, { ...row, scheduled_at: '2026-11-12T12:00:00+00:00' })).toBe(true);
  });
  it('stops new automatic download pages after the application leaves the foreground', async () => {
    let active = true;
    const page = Array.from({ length: 500 }, (_, index) => ({ ...row, id: 'row-' + index }));
    fetchMock.mockImplementation(async () => { active = false; return response(page); });
    await expect(service.download({ ...ctx, canStartRequest: () => active })).rejects.toMatchObject({ code: 'PAUSED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts an in-flight write acknowledgement after pausing so newer edits retain their revision base', async () => {
    let active = true;
    fetchMock.mockImplementation(async () => { active = false; return response(row, 201); });
    expect(await service.insert(task, { ...ctx, canStartRequest: () => active })).toEqual(row);
    await expect(service.update(task, { ...ctx, canStartRequest: () => active })).rejects.toMatchObject({ code: 'PAUSED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});

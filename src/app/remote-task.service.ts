import { Injectable, inject } from '@angular/core';
import { SupabaseClientService } from './supabase-client.service';
import { Task } from './task.model';
import { RemoteTask, readRemoteTask, taskContent } from './remote-task.model';

export interface SyncContext {
  ownerId: string;
  assertCurrent: () => void;
}

export class TaskRemoteError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message); }
}

@Injectable({ providedIn: 'root' })
export class RemoteTaskService {
  private readonly clients = inject(SupabaseClientService);

  private async request<T>(context: SyncContext, operation: () => PromiseLike<{ data: T; error: { message: string; code?: string } | null; status: number }>): Promise<T> {
    context.assertCurrent();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => { context.assertCurrent(); return operation(); }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new TaskRemoteError('La sincronización superó el tiempo de espera.', 'NETWORK')), 12000);
        })
      ]);
      context.assertCurrent();
      if (result.error) throw new TaskRemoteError(result.error.message, result.error.code, result.status);
      return result.data;
    } catch (error) {
      context.assertCurrent();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private row(value: unknown, context: SyncContext): RemoteTask {
    return readRemoteTask(value, context.ownerId);
  }

  async insert(task: Task, context: SyncContext): Promise<RemoteTask> {
    if (!task.remoteId || !task.originDeviceId) throw new TaskRemoteError('Falta la identidad persistida de la tarea.');
    const data = await this.request(context, () => this.clients.client.from('tasks').insert({
      ...taskContent(task), id: task.remoteId, owner_id: context.ownerId,
      local_task_id: task.id, origin_device_id: task.originDeviceId,
      created_at: task.createdAt
    }).select().abortSignal(AbortSignal.timeout(10000)).single().retry(false));
    return this.row(data, context);
  }

  async update(task: Task, context: SyncContext): Promise<RemoteTask | null> {
    if (!task.remoteId || !task.remoteRevision) throw new TaskRemoteError('Falta la revisión remota.');
    const data = await this.request(context, () => this.clients.client.from('tasks')
      .update(taskContent(task)).eq('owner_id', context.ownerId).eq('id', task.remoteId)
      .eq('revision', task.remoteRevision).select().abortSignal(AbortSignal.timeout(10000)).maybeSingle().retry(false));
    return data ? this.row(data, context) : null;
  }

  async find(task: Task, context: SyncContext, byExternal = false): Promise<RemoteTask | null> {
    const data = await this.request(context, () => {
      let query = this.clients.client.from('tasks').select('*').eq('owner_id', context.ownerId);
      query = byExternal
        ? query.eq('external_source', task.externalSource!).eq('external_id', task.externalId!)
        : query.eq('id', task.remoteId!);
      return query.abortSignal(AbortSignal.timeout(10000)).maybeSingle().retry(false);
    });
    return data ? this.row(data, context) : null;
  }

  async download(context: SyncContext): Promise<RemoteTask[]> {
    const rows: RemoteTask[] = [];
    // Stable ordering and pagination; tombstones are deliberately included.
    for (let offset = 0; ; offset += 500) {
      const data = await this.request(context, () => this.clients.client.from('tasks')
        .select('*').eq('owner_id', context.ownerId).order('id').range(offset, offset + 499)
        .abortSignal(AbortSignal.timeout(10000)).retry(false));
      if (!Array.isArray(data)) throw new TaskRemoteError('Respuesta de tareas no válida.');
      rows.push(...data.map(value => this.row(value, context)));
      if (data.length < 500) return rows;
    }
  }
}

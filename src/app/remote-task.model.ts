import { Task } from './task.model';

export interface RemoteTask {
  id: string;
  owner_id: string;
  local_task_id: number;
  origin_device_id: string;
  title: string;
  description: string;
  completed: boolean;
  created_at: string;
  scheduled_at: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  external_source: 'jsonplaceholder' | null;
  external_id: number | null;
  updated_at: string;
  deleted_at: string | null;
  revision: number;
}

export function readRemoteTask(value: unknown, ownerId: string): RemoteTask {
  if (!value || typeof value !== 'object') throw new Error('Respuesta de tareas no válida.');
  const row = value as RemoteTask;
  if (row.owner_id !== ownerId || typeof row.id !== 'string' ||
    !Number.isSafeInteger(row.local_task_id) || typeof row.origin_device_id !== 'string' ||
    typeof row.title !== 'string' || typeof row.description !== 'string' ||
    typeof row.completed !== 'boolean' || !Number.isInteger(row.revision) || row.revision < 1 ||
    typeof row.created_at !== 'string' || typeof row.updated_at !== 'string') {
    throw new Error('Respuesta inválida o de otra cuenta.');
  }
  return row;
}

export function taskContent(task: Task) {
  const date = (value?: string) => value ? new Date(value).toISOString() : null;
  return {
    title: task.title, description: task.description, completed: task.completed,
    scheduled_at: date(task.scheduledAt),
    latitude: task.latitude ?? null, longitude: task.longitude ?? null,
    accuracy: task.accuracy ?? null,
    external_source: task.externalSource ?? null, external_id: task.externalId ?? null,
    deleted_at: date(task.deletedAt)
  };
}

export function fromRemote(row: RemoteTask, userId: string): Task {
  return {
    id: row.local_task_id, userId, remoteId: row.id,
    originDeviceId: row.origin_device_id,
    title: row.title, description: row.description, completed: row.completed,
    createdAt: row.created_at, scheduledAt: row.scheduled_at ?? undefined,
    latitude: row.latitude ?? undefined, longitude: row.longitude ?? undefined,
    accuracy: row.accuracy ?? undefined,
    externalSource: row.external_source ?? undefined, externalId: row.external_id ?? undefined,
    updatedAt: row.updated_at, deletedAt: row.deleted_at ?? undefined,
    remoteRevision: row.revision, syncStatus: 'synced', lastSyncedAt: new Date().toISOString()
  };
}

export function sameTaskContent(local: Task, remote: RemoteTask): boolean {
  return JSON.stringify(taskContent(local)) === JSON.stringify(taskContent(fromRemote(remote, local.userId)));
}

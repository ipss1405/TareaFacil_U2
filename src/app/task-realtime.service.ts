import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { AuthService } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { SupabaseClientService } from './supabase-client.service';
import { TaskService } from './task.service';
import { fromRemote, readRemoteTask, RemoteTask, sameTaskContent } from './remote-task.model';

type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';
interface Connection {
  local: object;
  remote: object;
  status: ConnectionState;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class TaskRealtimeService {
  private readonly auth = inject(AuthService);
  private readonly remoteAuth = inject(SupabaseAuthService);
  private readonly clients = inject(SupabaseClientService);
  private readonly tasks = inject(TaskService);
  private readonly connection = signal<Connection | null>(null);
  private generation = 0;

  readonly state = computed(() => {
    const local = this.auth.currentUser();
    const remote = this.remoteAuth.currentUser();
    const connection = this.connection();
    return local?.remoteUserId && local.remoteUserId === remote?.id &&
      connection?.local === local && connection.remote === remote
      ? connection : { status: 'disconnected' as ConnectionState, message: undefined };
  });
  readonly label = computed(() => ({ connected: 'En tiempo real', disconnected: 'Desconectado',
    reconnecting: 'Reconectando' })[this.state().status]);

  constructor() {
    effect(onCleanup => {
      const ready = this.auth.isReady();
      const local = this.auth.currentUser();
      const remote = this.remoteAuth.currentUser();
      const generation = ++this.generation;
      if (!ready || !local?.remoteUserId || local.remoteUserId !== remote?.id) return;
      untracked(() => {
        let active = true;
        let channel: RealtimeChannel | undefined;
        let remove = () => { active = false; };
        let queue = Promise.resolve();
        const current = () => active && generation === this.generation &&
          this.auth.currentUser() === local && this.remoteAuth.currentUser() === remote &&
          local.remoteUserId === remote.id;
        const assertCurrent = () => { if (!current()) throw new Error('La sesión Realtime cambió.'); };
        const publish = (status: ConnectionState, message?: string) => {
          if (current()) this.connection.set({ local, remote, status, message });
        };
        const receive = (payload: RealtimePostgresChangesPayload<RemoteTask>) => {
          if (!current() || !['INSERT', 'UPDATE'].includes(payload.eventType) ||
            payload.schema !== 'public' || payload.table !== 'tasks' ||
            !payload.new || typeof payload.new !== 'object' ||
            (payload.new as Partial<RemoteTask>).owner_id !== remote.id) return;
          // Order event application and local persistence without blocking startup.
          queue = queue.then(async () => {
            assertCurrent();
            await this.tasks.ready;
            assertCurrent();
            const row = readRemoteTask(payload.new, remote.id);
            const existing = this.tasks.syncTasks(local.id).find(task => task.remoteId === row.id);
            if (existing?.remoteRevision !== undefined && row.revision <= existing.remoteRevision) return;
            if (existing?.syncStatus === 'pending' && !sameTaskContent(existing, row)) {
              // Keep the offline edit and its base revision. Manual sync already
              // implements remote-wins conflicts with a persisted local backup.
              this.connection.update(value => value ? { ...value,
                message: 'Hay cambios locales pendientes. Pulsa Sincronizar para combinar los cambios remotos.' } : value);
              return;
            }
            await this.tasks.acceptRemote(fromRemote(row, local.id), assertCurrent, existing?.syncStatus === 'pending' ? { ...existing } : undefined, true);
            assertCurrent();
            if (!this.tasks.pendingSyncCount()) this.connection.update(value => value ? { ...value, message: undefined } : value);
          }).catch(() => {
            if (current()) this.connection.update(value => value ? { ...value,
              message: 'No se pudo aplicar un cambio remoto. Tus datos locales se conservan; utiliza Sincronizar.' } : value);
          });
        };
        publish('reconnecting');
        try {
          const client = this.clients.client;
          remove = () => {
            // Invalidate synchronously; removing the server channel may be async.
            active = false;
            if (channel) {
              const previous = channel;
              channel = undefined;
              void client.removeChannel(previous).catch(() => undefined);
            }
          };
          onCleanup(remove);
          channel = client.channel(`tasks:${remote.id}:${generation}`);
          channel.on<RemoteTask>('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: `owner_id=eq.${remote.id}` }, receive)
            .on<RemoteTask>('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `owner_id=eq.${remote.id}` }, receive)
            .subscribe((status, error) => {
              if (status === 'SUBSCRIBED') publish('connected');
              else if (status === 'CLOSED') publish('disconnected');
              else publish('reconnecting', error?.message ?? 'Realtime no está disponible. Puedes seguir usando Sincronizar.');
            });
        } catch {
          remove();
          this.connection.set({ local, remote, status: 'disconnected', message: 'Realtime no está disponible. Puedes seguir usando Sincronizar.' });
        }
      });
    });
  }
}

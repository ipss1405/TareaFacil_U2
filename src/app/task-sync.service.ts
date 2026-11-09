import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { AuthService } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { TaskService } from './task.service';
import { RemoteTaskService, SyncContext, TaskRemoteError } from './remote-task.service';
import { fromRemote, RemoteTask, sameTaskContent } from './remote-task.model';
import { Task } from './task.model';

type SyncStatus = 'pending' | 'syncing' | 'synced' | 'offline' | 'reauth' | 'error' | 'conflict';
interface SyncReport {
  localId: string;
  ownerId: string;
  status: SyncStatus;
  message?: string;
  lastSyncedAt?: string;
  localSession?: object;
  remoteSession?: object;
}

@Injectable({ providedIn: 'root' })
export class TaskSyncService {
  private readonly auth = inject(AuthService);
  private readonly remoteAuth = inject(SupabaseAuthService);
  private readonly tasks = inject(TaskService);
  private readonly remote = inject(RemoteTaskService);
  private readonly report = signal<SyncReport | null>(null);
  readonly running = signal(false);

  readonly state = computed(() => {
    const local = this.auth.currentUser();
    const remote = this.remoteAuth.currentUser();
    const report = this.report();
    const own = local?.id === report?.localId && local?.remoteUserId === report?.ownerId ? report : null;
    if (!local?.remoteUserId || local.remoteUserId !== remote?.id) {
      return { status: 'reauth' as SyncStatus, lastSyncedAt: own?.lastSyncedAt, message: undefined };
    }
    if (own && own.localSession === local && own.remoteSession === remote && own.status !== 'synced') return own;
    return { lastSyncedAt: own?.lastSyncedAt, message: undefined,
      status: this.tasks.pendingSyncCount() ? 'pending' : own?.lastSyncedAt ? 'synced' : 'pending' };
  });
  readonly label = computed(() => ({ pending: 'Cambios pendientes', syncing: 'Sincronizando...',
    synced: 'Sincronizado', offline: 'Sin conexión', reauth: 'Inicia sesión para sincronizar',
    error: 'Error', conflict: 'Conflicto' })[this.state().status]);

  constructor() {
    effect(() => {
      const user = this.auth.currentUser();
      if (!user?.remoteUserId) return;
      untracked(() => {
        void Preferences.get({ key: this.metadataKey(user.id, user.remoteUserId!) }).then(({ value }) => {
          if (this.auth.currentUser() !== user || this.running() || this.report()?.localId === user.id) return;
          if (value) {
            const metadata: { lastSyncedAt?: string } = JSON.parse(value);
            this.report.set({ localId: user.id, ownerId: user.remoteUserId!, status: 'synced', lastSyncedAt: metadata.lastSyncedAt });
          }
        }).catch(() => { /* Metadata never blocks local startup. */ });
      });
    });
  }

  private metadataKey(localId: string, ownerId: string): string {
    return `tareafacil_sync_${localId}_${ownerId}`;
  }

  async sync(): Promise<void> {
    if (this.running()) return;
    const local = this.auth.currentUser();
    const remoteUser = this.remoteAuth.currentUser();
    if (!local?.remoteUserId || remoteUser?.id !== local.remoteUserId) return;
    const context: SyncContext = {
      ownerId: remoteUser.id,
      assertCurrent: () => {
        if (this.auth.currentUser() !== local || this.remoteAuth.currentUser() !== remoteUser ||
          this.auth.currentUser()?.remoteUserId !== remoteUser.id) {
          throw new TaskRemoteError('La sesión cambió. Vuelve a iniciar la sincronización.', 'SESSION');
        }
      }
    };
    const previousTime = this.state().lastSyncedAt;
    const publish = (status: SyncStatus, message?: string, lastSyncedAt = previousTime) => {
      context.assertCurrent();
      this.report.set({ localId: local.id, ownerId: remoteUser.id, status, message, lastSyncedAt,
        localSession: local, remoteSession: remoteUser });
    };
    this.running.set(true);
    publish('syncing');
    let conflicts = 0;
    try {
      const snapshot = await this.tasks.prepareSync(local.id, context.assertCurrent);
      context.assertCurrent();
      for (const task of snapshot.filter(task => task.syncStatus === 'pending')) {
        context.assertCurrent();
        let row: RemoteTask | null;
        let confirmedWrite = true;
        if (task.remoteRevision) {
          row = await this.remote.update(task, context);
          context.assertCurrent();
          if (!row) {
            row = await this.remote.find(task, context);
            confirmedWrite = false;
          }
        } else {
          try {
            row = await this.remote.insert(task, context);
          } catch (error) {
            context.assertCurrent();
            if (!(error instanceof TaskRemoteError) || error.code !== '23505') throw error;
            row = await this.remote.find(task, context);
            context.assertCurrent();
            if (!row && task.externalSource && task.externalId !== undefined) {
              row = await this.remote.find(task, context, true);
            }
            confirmedWrite = false;
          }
        }
        context.assertCurrent();
        if (!row) throw new TaskRemoteError('No se encontró la tarea remota. Se conserva el cambio pendiente.');
        const equivalent = sameTaskContent(task, row);
        if (!confirmedWrite && !equivalent) {
          await this.saveConflict(task, row, context);
          context.assertCurrent();
          conflicts++;
        }
        await this.tasks.acceptRemote(fromRemote(row, local.id), context.assertCurrent, task, confirmedWrite || equivalent);
        context.assertCurrent();
      }
      const rows = await this.remote.download(context);
      context.assertCurrent();
      for (const row of rows) {
        context.assertCurrent();
        await this.tasks.acceptRemote(fromRemote(row, local.id), context.assertCurrent);
        context.assertCurrent();
      }
      const lastSyncedAt = new Date().toISOString();
      await Preferences.set({ key: this.metadataKey(local.id, remoteUser.id), value: JSON.stringify({ lastSyncedAt }) });
      context.assertCurrent();
      publish(conflicts ? 'conflict' : this.tasks.pendingSyncCount() ? 'pending' : 'synced',
        conflicts ? `${conflicts} conflicto(s): prevaleció la versión remota. Se conservó una copia local del cambio en el registro de conflictos.` : undefined,
        lastSyncedAt);
    } catch (error) {
      try {
        context.assertCurrent();
        const message = error instanceof Error ? error.message : 'No se pudo sincronizar.';
        const code = error instanceof TaskRemoteError ? error.code : undefined;
        const status = error instanceof TaskRemoteError ? error.status : undefined;
        publish(status === 401 || code === 'PGRST301' ? 'reauth'
          : code === 'NETWORK' || status === 0 || /fetch|network|sin conexión|timeout|aborted/i.test(message) ? 'offline' : 'error', message);
      } catch { /* Ignore responses from a previous session. */ }
    } finally {
      this.running.set(false);
    }
  }

  private async saveConflict(local: Task, remote: RemoteTask, context: SyncContext): Promise<void> {
    context.assertCurrent();
    const key = `tareafacil_sync_conflicts_${local.userId}_${context.ownerId}`;
    const { value } = await Preferences.get({ key });
    context.assertCurrent();
    const history: unknown = value ? JSON.parse(value) : [];
    if (!Array.isArray(history)) throw new Error('No se pudo leer el registro de conflictos. Se conserva el pendiente.');
    await Preferences.set({ key, value: JSON.stringify([...history, { at: new Date().toISOString(), local, remote }]) });
    context.assertCurrent();
  }
}

import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { Task } from './task.model';
import { AuthService } from './auth.service';
import { ExternalTask, isExternalTask } from './external-task.model';

export interface TaskImportResult {
  imported: number;
  existing: number;
}

type StoredTask = Omit<Task, 'userId'> & { userId?: string };


@Injectable({
  providedIn: 'root'
})
export class TaskService {

  private readonly storageKey = 'tareafacil_tasks';
  private readonly auth = inject(AuthService);
  private readonly loaded = signal(false);
  private persistence: Promise<void> = Promise.resolve();
  private latestWrite: Promise<void> = Promise.resolve();
  private localChanges: Promise<void> = Promise.resolve();
  private deviceId?: string;
  private resolveReady!: () => void;
  readonly ready = new Promise<void>(resolve => { this.resolveReady = resolve; });

  private readonly taskState = signal<StoredTask[]>([
    {
      id: 1,
      title: 'Estudiar Ionic',
      description: 'Repasar los componentes de Ionic',
      completed: false
    },
    {
      id: 2,
      title: 'Practicar TypeScript',
      description: 'Repasar interfaces y funciones',
      completed: false
    }
  ]);

  readonly tasks = computed<readonly Task[]>(() => {
    const userId = this.currentUserId();
    return userId
      ? this.taskState().filter((task): task is Task => task.userId === userId && !task.deletedAt)
      : [];
  });

  readonly pendingSyncCount = computed(() => this.taskState()
    .filter(task => task.userId === this.currentUserId() && task.syncStatus !== 'synced').length);

  private changed<T extends StoredTask>(task: T): T {
    return { ...task, remoteId: task.remoteId ?? crypto.randomUUID(),
      updatedAt: new Date().toISOString(), localRevision: (task.localRevision ?? 0) + 1,
      syncStatus: 'pending' };
  }

  syncTasks(userId: string): readonly Task[] {
    if (this.currentUserId() !== userId) throw new Error('La sesión cambió.');
    return this.taskState().filter((task): task is Task => task.userId === userId);
  }

  async prepareSync(userId: string, assertCurrent: () => void): Promise<readonly Task[]> {
    assertCurrent();
    await this.ready;
    await this.localChanges;
    assertCurrent();
    if (!this.loaded()) throw new Error('No se pudieron cargar las tareas locales.');
    if (!this.deviceId) {
      const { value } = await Preferences.get({ key: 'tareafacil_sync_device_id' });
      assertCurrent();
      this.deviceId = value ?? crypto.randomUUID();
      await Preferences.set({ key: 'tareafacil_sync_device_id', value: this.deviceId });
      assertCurrent();
    }
    const backup = await Preferences.get({ key: 'tareafacil_tasks_before_sync_v1' });
    assertCurrent();
    if (!backup.value) {
      await Preferences.set({ key: 'tareafacil_tasks_before_sync_v1', value: JSON.stringify(this.taskState()) });
      assertCurrent();
    }
    this.taskState.update(tasks => tasks.map(task => {
      if (task.userId !== userId) return task;
      return { ...task, remoteId: task.remoteId ?? crypto.randomUUID(),
        originDeviceId: task.originDeviceId ?? this.deviceId,
        createdAt: task.createdAt ?? new Date().toISOString(),
        updatedAt: task.updatedAt ?? task.createdAt ?? new Date().toISOString(),
        localRevision: task.localRevision ?? 1, syncStatus: task.syncStatus ?? 'pending' };
    }));
    // Rewrites the latest state, so a previous failed local save is retried.
    await this.saveTasks(true);
    assertCurrent();
    return this.syncTasks(userId).map(task => ({ ...task }));
  }

  async acceptRemote(incoming: Task, assertCurrent: () => void, sent?: Task, confirmedWrite = false): Promise<void> {
    assertCurrent();
    if (incoming.userId !== this.currentUserId()) throw new Error('La sesión cambió.');
    const current = this.syncTasks(incoming.userId).find(task => task.remoteId === incoming.remoteId ||
      (incoming.externalSource && task.externalSource === incoming.externalSource && task.externalId === incoming.externalId));
    // Realtime can overtake an HTTP response or deliver a duplicate on reconnect.
    if (current && current.remoteId === incoming.remoteId && current.remoteRevision !== undefined && incoming.remoteRevision !== undefined &&
      (incoming.remoteRevision < current.remoteRevision ||
        (incoming.remoteRevision === current.remoteRevision && current.syncStatus === 'synced'))) return;
    if (current?.syncStatus === 'pending' && !sent) return;
    if (current && sent && current.localRevision !== sent.localRevision) {
      // An edit during upload remains pending, but can use the acknowledged base.
      if (confirmedWrite) {
        this.taskState.update(tasks => tasks.map(task => task === current
          ? { ...task, remoteRevision: incoming.remoteRevision, remoteId: incoming.remoteId } : task));
        await this.saveTasks(true);
        assertCurrent();
      }
      return;
    }
    const replacement: Task = { ...incoming,
      id: current?.id ?? Math.max(Date.now(), 0, ...this.taskState().map(task => task.id + 1)),
      createdAt: current?.createdAt ?? incoming.createdAt,
      photoPath: current?.photoPath,
      localRevision: current?.localRevision ?? 1 };
    this.taskState.update(tasks => current
      ? tasks.map(task => task === current ? replacement : task)
      : [...tasks, replacement]);
    await this.saveTasks(true);
    assertCurrent();
  }

  readonly totalTasks = computed(
    () => this.tasks().length
  );

  readonly pendingTasks = computed(
    () =>
      this.tasks()
        .filter(task => !task.completed)
        .length
  );

  readonly completedTasks = computed(
    () =>
      this.tasks()
        .filter(task => task.completed)
        .length
  );

  readonly completionProgress = computed(
    () =>
      this.totalTasks() === 0
        ? 0
        : this.completedTasks() / this.totalTasks()
  );

  constructor() {
    effect(() => {
      const loaded = this.loaded();
      const ready = this.auth.isReady();
      const userId = this.auth.currentUser()?.id;
      if (loaded && ready) untracked(() => this.initializeForUser(userId));
    });
    void this.loadTasks();
  }

  private currentUserId(): string | undefined {
    return this.loaded() && this.auth.isReady() ? this.auth.currentUser()?.id : undefined;
  }

  private initializeForUser(userId?: string) {
    if (userId && this.taskState().some(task => !task.userId)) {
      this.taskState.update(tasks => tasks.map(task => task.userId ? task : { ...task, userId }));
      void this.saveTasks();
    }
    void this.persistence.then(() => this.resolveReady());
  }

  getTask(id: number): Task | undefined {
    return this.tasks()
      .find(task => task.id === id);
  }

  addTask(
    title: string,
    description: string,
    photoPath?: string,
    scheduledAt?: string,
    latitude?: number,
    longitude?: number,
    accuracy?: number
  ): Task | undefined {

    const userId = this.currentUserId();
    if (!userId) return undefined;

    if (
      !title.trim() ||
      !description.trim() ||
      (
        scheduledAt?.trim() &&
        Number.isNaN(Date.parse(scheduledAt))
      )
    ) {
      return undefined;
    }

    const task: Task = this.changed({
      userId,

      id: Math.max(
        Date.now(),
        ...this.taskState()
          .map(item => item.id + 1)
      ),

      title: title.trim(),

      description: description.trim(),

      completed: false,

      createdAt:
        new Date().toISOString(),

      scheduledAt:
        scheduledAt?.trim()
          ? new Date(scheduledAt).toISOString()
          : undefined,

      photoPath:
        photoPath?.trim()
          ? photoPath
          : undefined,

      latitude:
        latitude !== undefined &&
        Number.isFinite(latitude)
          ? latitude
          : undefined,

      longitude:
        longitude !== undefined &&
        Number.isFinite(longitude)
          ? longitude
          : undefined,

      accuracy:
        accuracy !== undefined &&
        Number.isFinite(accuracy)
          ? accuracy
          : undefined
    });

    this.taskState.update(
      tasks => [
        ...tasks,
        task
      ]
    );

    void this.saveTasks();

    return task;
  }

  async importTasks(candidates: readonly ExternalTask[], expectedUserId: string): Promise<TaskImportResult> {
    const startedUserId = this.auth.isReady() ? this.auth.currentUser()?.id : undefined;
    if (!expectedUserId || startedUserId !== expectedUserId) throw new Error('La sesión cambió. Vuelve a consultar las tareas.');
    await this.ready;
    if (this.currentUserId() !== expectedUserId) throw new Error('La sesión cambió. Vuelve a consultar las tareas.');
    if (!Array.isArray(candidates) || !candidates.every(isExternalTask)) throw new Error('Hay tareas externas no válidas.');

    const seen = new Set(this.taskState()
      .filter(task => task.userId === expectedUserId && task.externalSource === 'jsonplaceholder')
      .map(task => task.externalId));
    let nextId = Math.max(Date.now(), 0, ...this.taskState().map(task => task.id + 1));
    let existing = 0;
    const imported: Task[] = [];
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) { existing++; continue; }
      seen.add(candidate.id);
      if (nextId === candidate.id) nextId++;
      imported.push(this.changed({
        id: nextId++, userId: expectedUserId,
        title: candidate.title.trim(), description: 'Tarea importada de JSONPlaceholder.',
        completed: candidate.completed, createdAt: new Date().toISOString(),
        externalSource: 'jsonplaceholder', externalId: candidate.id
      }));
    }
    if (imported.length) this.taskState.update(tasks => [...tasks, ...imported]);
    // Also persist on retry when all selected records already exist in memory.
    await this.saveTasks(true);
    return { imported: imported.length, existing };
  }

  updateTask(
    id: number,
    title: string,
    description: string,
    photoPath?: string,
    scheduledAt?: string,
    latitude?: number,
    longitude?: number,
    accuracy?: number,
    removeLocation = false
  ): boolean {

    const userId = this.currentUserId();
    if (!userId) return false;

    if (
      !title.trim() ||
      !description.trim() ||
      (
        scheduledAt?.trim() &&
        Number.isNaN(Date.parse(scheduledAt))
      ) ||
      !this.getTask(id)
    ) {
      return false;
    }

    this.taskState.update(
      tasks =>
        tasks.map(task =>
          task.id === id && task.userId === userId
            ? this.changed({
                ...task,

                title:
                  title.trim(),

                description:
                  description.trim(),

                scheduledAt:
                  scheduledAt === undefined
                    ? task.scheduledAt
                    : scheduledAt.trim()
                      ? new Date(scheduledAt).toISOString()
                      : undefined,

                photoPath:
                  photoPath?.trim()
                    ? photoPath
                    : undefined,

                latitude:
                  removeLocation
                    ? undefined
                    : latitude === undefined
                      ? task.latitude
                      : latitude,

                longitude:
                  removeLocation
                    ? undefined
                    : longitude === undefined
                      ? task.longitude
                      : longitude,

                accuracy:
                  removeLocation
                    ? undefined
                    : accuracy === undefined
                      ? task.accuracy
                      : accuracy
              })
            : task
        )
    );

    void this.saveTasks();

    return true;
  }

  deleteTask(id: number) {
    const userId = this.currentUserId();
    if (!userId || !this.getTask(id)) return;

    this.taskState.update(
      tasks =>
        tasks.map(task => task.id === id && task.userId === userId
          ? this.changed({ ...task, deletedAt: new Date().toISOString() }) : task)
    );

    void this.saveTasks();
  }

  toggleTask(id: number) {
    const userId = this.currentUserId();
    if (!userId || !this.getTask(id)) return;

    this.taskState.update(
      tasks =>
        tasks.map(task =>
          task.id === id && task.userId === userId
            ? this.changed({
                ...task,
                completed: !task.completed
              })
            : task
        )
    );

    void this.saveTasks();
  }

  /** Confirm a UI mutation, reverting only its unchanged records if storage fails. */
  persistLocalChange<T>(change: () => T): Promise<T> {
    const user = this.auth.currentUser();
    const operation = this.localChanges.then(async () => {
      await this.persistence;
      if (!user || !this.auth.isReady() || this.auth.currentUser() !== user || !this.loaded()) {
        throw new Error('La sesión cambió o los datos locales no están disponibles.');
      }
      const before = this.taskState();
      const result = change();
      const after = this.taskState();
      if (before === after) return result;
      const write = this.latestWrite;
      try {
        await write;
        return result;
      } catch (error) {
        const previous = new Map(before.map(task => [task.id, task]));
        const changed = new Map(after.filter(task => previous.get(task.id) !== task).map(task => [task.id, task]));
        // Keep unrelated tasks and any newer local/Realtime revision intact.
        this.taskState.update(current => current.flatMap(task => {
          if (changed.get(task.id) !== task) return [task];
          const original = previous.get(task.id);
          return original ? [original] : [];
        }));
        // A later queued snapshot may contain the failed mutation. Reconcile it
        // with the current state, without hiding the original failure from UI.
        await this.saveTasks(true).catch(() => undefined);
        throw error;
      }
    });
    this.localChanges = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private saveTasks(reportFailure = false): Promise<void> {
    // Persist the complete collection, never the filtered view. Serialize writes
    // so an earlier migration cannot overwrite a later user operation.
    const value = JSON.stringify(this.taskState());
    const write = this.persistence.then(() => Preferences.set({ key: this.storageKey, value }));
    this.latestWrite = write;
    this.persistence = write.catch(error => console.error('No se pudieron guardar las tareas localmente:', error));
    return reportFailure ? write : this.persistence;
  }

  private async loadTasks(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: this.storageKey });
      if (value) {
        const storedTasks: unknown = JSON.parse(value);
        if (!Array.isArray(storedTasks)) throw new Error('Formato de tareas no válido');
        this.taskState.set(storedTasks as StoredTask[]);
      } else {
        await this.saveTasks();
      }
      this.loaded.set(true);
      if (this.auth.isReady()) this.initializeForUser(this.auth.currentUser()?.id);
    } catch (error) {
      // Do not overwrite unreadable storage with the default tasks.
      console.error('No se pudieron cargar las tareas almacenadas:', error);
      this.resolveReady();
    }
  }
}

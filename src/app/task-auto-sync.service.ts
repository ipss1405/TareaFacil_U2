import { effect, inject, Injectable, OnDestroy, untracked } from '@angular/core';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { TaskService } from './task.service';
import { SyncCompletion, TaskSyncService } from './task-sync.service';

@Injectable({ providedIn: 'root' })
export class TaskAutoSyncService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly remoteAuth = inject(SupabaseAuthService);
  private readonly tasks = inject(TaskService);
  private readonly sync = inject(TaskSyncService);
  private readonly subscriptions = new Subscription();
  private local: ReturnType<AuthService['currentUser']> = null;
  private remote: ReturnType<SupabaseAuthService['currentUser']> = null;
  private generation = 0;
  private destroyed = false;
  private wanted = false;
  private blocked = false;
  private reconcile = false;
  private launching = false;
  private retries = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  private nativeActive = !Capacitor.isNativePlatform();
  private networkPaused = false;
  private nativeListener?: PluginListenerHandle;
  private nativeStateVersion = 0;

  private readonly online = () => { this.networkPaused = false; this.request(true); };
  private readonly offline = () => { this.networkPaused = true; this.clearTimer(); };
  private readonly visibility = () => {
    this.visible = document.visibilityState !== 'hidden';
    this.foregroundChanged();
  };

  constructor() {
    this.subscriptions.add(this.tasks.localChangesConfirmed.subscribe(event => {
      if (event.userId === this.auth.currentUser()?.id) this.request(true);
    }));
    this.subscriptions.add(this.sync.completed.subscribe(event => this.finished(event)));
    effect(() => {
      const ready = this.auth.isReady();
      const local = this.auth.currentUser();
      const remote = this.remoteAuth.currentUser();
      untracked(() => {
        const nextLocal = ready ? local : null;
        const nextRemote = ready ? remote : null;
        if (this.local === nextLocal && this.remote === nextRemote) return;
        this.generation++;
        this.clearTimer();
        this.local = nextLocal;
        this.remote = nextRemote;
        this.wanted = false;
        this.blocked = false;
        this.reconcile = false;
        this.retries = 0;
        this.networkPaused = false;
        if (this.valid()) this.request(true);
      });
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.online);
      window.addEventListener('offline', this.offline);
      document.addEventListener('visibilitychange', this.visibility);
    }
    if (Capacitor.isNativePlatform()) this.observeNativeState();
  }

  private valid(): boolean {
    return !this.destroyed && this.auth.isReady() && !!this.local?.remoteUserId &&
      this.remote?.id === this.local.remoteUserId && this.auth.currentUser() === this.local &&
      this.remoteAuth.currentUser() === this.remote;
  }

  private foreground(): boolean { return this.visible && this.nativeActive; }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private request(resetRetries: boolean) {
    if (!this.valid()) return;
    this.wanted = true;
    if (resetRetries) this.retries = 0;
    if (!this.blocked) this.schedule(750);
  }

  private schedule(delay: number) {
    this.clearTimer();
    if (!this.valid() || this.blocked || !this.foreground() || this.networkPaused) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, delay);
  }

  private async run() {
    if (!this.valid() || !this.foreground() || this.networkPaused || this.blocked || !this.wanted || this.launching || this.sync.running()) return;
    const generation = this.generation;
    this.launching = true;
    try {
      // Pending counts alone can contain optimistic, not-yet-durable changes.
      await this.tasks.waitForLocalPersistence();
      if (generation !== this.generation || !this.valid() || !this.foreground() || this.networkPaused || this.blocked) return;
      if (this.sync.running()) return;
      if (!this.tasks.pendingSyncCount() && !this.reconcile) { this.wanted = false; return; }
      this.wanted = false;
      const outcome = await this.sync.sync(() => generation === this.generation && this.valid() && this.foreground());
      if (generation === this.generation && outcome === 'busy') this.wanted = true;
    } catch {
      // A failed local write must never trigger remote upload. A later confirmed
      // mutation or an explicit manual retry can request another attempt.
      if (generation === this.generation) this.wanted = false;
    } finally {
      this.launching = false;
      if (this.wanted && this.timer === undefined && !this.retries && !this.blocked && !this.sync.running()) this.schedule(750);
    }
  }

  private finished(event: SyncCompletion) {
    if (!this.valid()) return;
    if (event.localSession !== this.local || event.remoteSession !== this.remote) {
      if (this.wanted && !this.blocked) this.schedule(750);
      return;
    }
    this.clearTimer();
    if (event.outcome === 'success') {
      this.blocked = false;
      this.retries = 0;
      this.reconcile = false;
      this.wanted = this.wanted || this.tasks.pendingSyncCount() > 0;
      if (this.wanted) this.schedule(750);
    } else if (event.outcome === 'paused') {
      this.wanted = true;
      this.reconcile = true;
      this.retries = 0;
      this.schedule(750);
    } else if (event.outcome === 'transient') {
      this.wanted = true;
      this.reconcile = true;
      const delays = [2000, 5000, 15000];
      if (this.retries < delays.length) this.schedule(delays[this.retries++]);
    } else {
      // Only a successful manual reconciliation or a new authenticated session
      // resumes automatic sends after authorization errors or conflicts.
      this.blocked = true;
    }
  }

  private foregroundChanged() {
    if (!this.foreground()) { this.clearTimer(); return; }
    this.networkPaused = false;
    this.request(true);
  }

  private observeNativeState() {
    void App.addListener('appStateChange', state => {
      this.nativeStateVersion++;
      this.nativeActive = state.isActive;
      this.foregroundChanged();
    }).then(handle => {
      if (this.destroyed) void handle.remove().catch(() => undefined); else this.nativeListener = handle;
    }).catch(() => undefined);
    const version = this.nativeStateVersion;
    void App.getState().then(state => {
      if (!this.destroyed && version === this.nativeStateVersion) {
        this.nativeActive = state.isActive;
        this.foregroundChanged();
      }
    }).catch(() => undefined);
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.generation++;
    this.clearTimer();
    this.subscriptions.unsubscribe();
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.online);
      window.removeEventListener('offline', this.offline);
      document.removeEventListener('visibilitychange', this.visibility);
    }
    void this.nativeListener?.remove().catch(() => undefined);
  }
}

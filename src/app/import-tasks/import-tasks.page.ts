import { Component, OnDestroy, effect, inject, signal, computed } from '@angular/core';
import { IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonButton, IonList, IonItem, IonCheckbox, IonProgressBar } from '@ionic/angular';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { AuthService } from '../auth.service';
import { TaskService } from '../task.service';
import { TaskApiService } from '../task-api.service';
import { ExternalTask } from '../external-task.model';

@Component({
  selector: 'app-import-tasks', templateUrl: './import-tasks.page.html', styleUrls: ['./import-tasks.page.scss'],
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonContent, IonButton, IonList, IonItem, IonCheckbox, IonProgressBar]
})
export class ImportTasksPage implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly tasks = inject(TaskService);
  private readonly api = inject(TaskApiService);
  private readonly cancelQuery = new Subject<void>();
  private owner?: string;
  private request = 0;
  private active = false;
  readonly candidates = signal<ExternalTask[]>([]);
  readonly selectedIds = signal<ReadonlySet<number>>(new Set());
  readonly loading = signal(false);
  readonly importing = signal(false);
  readonly error = signal('');
  readonly result = signal('');
  readonly selectedCount = computed(() => this.candidates().filter(task => this.selectedIds().has(task.id)).length);

  constructor() {
    effect(() => {
      const current = this.auth.isReady() ? this.auth.currentUser()?.id : undefined;
      if (this.owner && current !== this.owner) {
        this.invalidate();
        this.error.set('La sesión cambió. Vuelve a abrir Importar tareas.');
      }
    });
  }

  get sessionValid(): boolean {
    return !!this.owner && this.auth.isReady() && this.auth.currentUser()?.id === this.owner;
  }

  async ionViewWillEnter() {
    this.active = true;
    this.owner = this.auth.isReady() ? this.auth.currentUser()?.id : undefined;
    const owner = this.owner;
    await this.tasks.ready;
    if (!this.active || !owner || !this.sessionValid || this.owner !== owner) return;
    await this.loadCandidates();
  }

  ionViewWillLeave() { this.active = false; this.invalidate(); }
  ngOnDestroy() { this.ionViewWillLeave(); this.cancelQuery.complete(); }

  private invalidate() {
    this.request++;
    this.cancelQuery.next();
    this.owner = undefined;
    this.candidates.set([]);
    this.selectedIds.set(new Set());
    this.loading.set(false);
    this.result.set('');
  }

  async loadCandidates() {
    if (this.loading() || this.importing() || !this.sessionValid) return;
    const request = ++this.request;
    this.loading.set(true);
    this.error.set('');
    this.result.set('');
    this.candidates.set([]);
    this.selectedIds.set(new Set());
    try {
      const candidates = await firstValueFrom(this.api.getCandidates().pipe(takeUntil(this.cancelQuery)), { defaultValue: [] });
      if (request === this.request && this.active && this.sessionValid) this.candidates.set(candidates);
    } catch {
      if (request === this.request && this.sessionValid) this.error.set('No se pudo consultar JSONPlaceholder. Comprueba tu conexión e inténtalo de nuevo. Tus tareas locales siguen guardadas.');
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  isImported(externalId: number): boolean {
    return this.sessionValid && this.tasks.tasks().some(task => task.externalSource === 'jsonplaceholder' && task.externalId === externalId);
  }

  select(externalId: number, checked: boolean) {
    if (!this.sessionValid || this.importing() || this.isImported(externalId)) return;
    this.selectedIds.update(current => {
      const next = new Set(current);
      if (checked) next.add(externalId); else next.delete(externalId);
      return next;
    });
  }

  async importSelected() {
    if (this.importing() || this.loading() || !this.sessionValid || !this.selectedCount()) return;
    const owner = this.owner!;
    const request = this.request;
    const selected = this.candidates().filter(task => this.selectedIds().has(task.id));
    this.importing.set(true);
    this.error.set('');
    this.result.set('');
    try {
      const result = await this.tasks.importTasks(selected, owner);
      if (this.active && this.sessionValid && request === this.request) {
        this.selectedIds.set(new Set());
        this.result.set(`Importadas: ${result.imported}. Ya existían: ${result.existing}. Guardadas localmente.`);
      }
    } catch {
      if (this.sessionValid && request === this.request) this.error.set('No se pudo completar la importación. Comprueba la sesión e inténtalo de nuevo.');
    } finally { this.importing.set(false); }
  }
}

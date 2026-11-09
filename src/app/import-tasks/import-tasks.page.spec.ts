import { Preferences } from '@capacitor/preferences';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ImportTasksPage } from './import-tasks.page';
import { TaskService } from '../task.service';
import { TaskApiService } from '../task-api.service';
import { ExternalTask } from '../external-task.model';
import { createTaskTestContext } from '../testing/task-test-context';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));

describe('ImportTasksPage', () => {
  let context: ReturnType<typeof createTaskTestContext>;
  let service: TaskService;
  let page: ImportTasksPage;
  let getCandidates: ReturnType<typeof vi.fn>;
  const candidates: ExternalTask[] = [
    { id: 1, userId: 9, title: 'Primera externa', completed: true },
    { id: 2, userId: 9, title: 'Segunda externa', completed: false }
  ];
  beforeEach(async () => {
    context = createTaskTestContext();
    getCandidates = vi.fn().mockReturnValue(of(candidates));
    await TestBed.configureTestingModule({ imports: [ImportTasksPage], providers: [provideRouter([]), ...context.providers,
      { provide: TaskApiService, useValue: { getCandidates } }
    ] }).compileComponents();
    service = TestBed.inject(TaskService);
    await service.ready;
    page = TestBed.createComponent(ImportTasksPage).componentInstance;
    await page.ionViewWillEnter();
    TestBed.tick();
  });
  afterEach(() => { page.ngOnDestroy(); vi.restoreAllMocks(); });

  it('loads candidates without saving until a selection is confirmed', () => {
    expect(getCandidates).toHaveBeenCalledTimes(1);
    expect(page.candidates()).toEqual(candidates);
    expect(page.selectedCount()).toBe(0);
    expect(service.totalTasks()).toBe(2);
  });

  it('shows a network error and preserves all local tasks', async () => {
    const original = service.tasks();
    const saved = context.storage.get('tareafacil_tasks');
    getCandidates.mockReturnValue(throwError(() => new Error('Offline')));
    await page.loadCandidates();
    expect(page.error()).toContain('Tus tareas locales siguen guardadas');
    expect(page.loading()).toBe(false);
    expect(service.tasks()).toBe(original);
    expect(context.storage.get('tareafacil_tasks')).toBe(saved);
  });

  it('imports a selected task and marks it as already imported', async () => {
    page.select(1, true);
    expect(page.selectedCount()).toBe(1);
    await page.importSelected();
    expect(page.result()).toContain('Importadas: 1');
    expect(page.isImported(1)).toBe(true);
    expect(page.isImported(2)).toBe(false);
    expect(page.selectedCount()).toBe(0);
    page.select(1, true);
    expect(page.selectedCount()).toBe(0);
    expect(service.totalTasks()).toBe(3);
  });

  it('blocks a second submission while the first import is pending', async () => {
    let finish!: (result: { imported: number; existing: number }) => void;
    const importTasks = vi.spyOn(service, 'importTasks').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    page.select(1, true);
    const first = page.importSelected();
    await page.importSelected();
    expect(importTasks).toHaveBeenCalledTimes(1);
    expect(page.importing()).toBe(true);
    finish({ imported: 1, existing: 0 });
    await first;
    expect(page.importing()).toBe(false);
  });

  it('invalidates the selection when the account changes before import', async () => {
    const importTasks = vi.spyOn(service, 'importTasks');
    page.select(1, true);
    context.currentUser.set(context.userB);
    TestBed.tick();
    await page.importSelected();
    expect(importTasks).not.toHaveBeenCalled();
    expect(page.candidates()).toEqual([]);
    expect(page.error()).toContain('Vuelve a abrir');
    expect(service.totalTasks()).toBe(0);
  });

  it('cancels a pending consultation on logout and ignores its later response', async () => {
    const response = new Subject<ExternalTask[]>();
    getCandidates.mockReturnValue(response);
    const pending = page.loadCandidates();
    expect(page.loading()).toBe(true);
    context.currentUser.set(null);
    TestBed.tick();
    response.next(candidates);
    response.complete();
    await pending;
    expect(page.candidates()).toEqual([]);
    expect(page.loading()).toBe(false);
    expect(page.selectedCount()).toBe(0);
  });

  it('renders already imported entries with disabled selection controls', async () => {
    await service.importTasks([candidates[0]], context.userA.id);
    const fixture = TestBed.createComponent(ImportTasksPage);
    await fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.already-imported').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.already-imported ion-checkbox').disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('.imported-label').textContent).toContain('Ya importada');
    fixture.componentInstance.ngOnDestroy();
  });

  it('keeps a failed save retryable and persists it without duplicating the batch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(Preferences.set).mockRejectedValueOnce(new Error('Storage unavailable'));
    page.select(1, true);
    await page.importSelected();
    expect(page.error()).toContain('No se pudo completar');
    expect(page.selectedCount()).toBe(1);
    expect(page.importing()).toBe(false);
    await page.importSelected();
    expect(page.result()).toContain('Importadas: 0. Ya exist');
    expect(page.selectedCount()).toBe(0);
    expect(JSON.parse(context.storage.get('tareafacil_tasks')!).filter((task: { externalId?: number }) => task.externalId === 1).length).toBe(1);
  });
});

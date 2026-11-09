import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { TaskService } from './task.service';
import { SupabaseAuthService } from './supabase-auth.service';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));

describe('AuthService logout and task persistence', () => {
  let auth: AuthService;
  let tasks: TaskService;
  let storage: Map<string, string>;

  beforeEach(async () => {
    vi.resetAllMocks();
    const browserCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto),
      randomUUID: browserCrypto.randomUUID.bind(browserCrypto),
      subtle: {
        importKey: vi.fn().mockResolvedValue({}),
        deriveBits: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer)
      }
    });
    storage = new Map();
    TestBed.configureTestingModule({ providers: [{
      provide: SupabaseAuthService,
      useValue: {
        signUp: vi.fn().mockResolvedValue({ success: true, userId: 'remote-a' }),
        signIn: vi.fn().mockResolvedValue({ success: true, userId: 'remote-a' }),
        signOut: vi.fn().mockResolvedValue(undefined)
      }
    }] });
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => ({ value: storage.get(key) ?? null }));
    vi.mocked(Preferences.set).mockImplementation(async ({ key, value }) => { storage.set(key, value); });
    vi.mocked(Preferences.remove).mockImplementation(async ({ key }) => { storage.delete(key); });
    auth = TestBed.inject(AuthService);
    await vi.waitFor(() => expect(auth.isReady()).toBe(true));
    await auth.register('Persona A', 'a@example.test', 'Password123!');
    const userId = auth.currentUser()!.id;
    storage.set('tareafacil_tasks', JSON.stringify([
      { id: 1, userId, title: 'Privada A', description: 'Con recursos', completed: false,
        photoPath: 'task-photos/persistent.png', latitude: 0, longitude: -70.66, accuracy: 12,
        scheduledAt: '2026-11-10T18:30:00Z', createdAt: '2026-11-08T12:00:00Z' },
      { id: 2, userId: 'other-user', title: 'Privada B', description: 'Otro usuario', completed: true }
    ]));
    storage.set('unrelated-key', 'keep');
    tasks = TestBed.inject(TaskService);
    await tasks.ready;
    TestBed.tick();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('removes only the session and leaves users, tasks, photography and GPS data intact', async () => {
    const before = new Map(storage);
    await auth.logout();
    TestBed.tick();
    expect(auth.currentUser()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(tasks.tasks()).toEqual([]);
    expect(Preferences.remove).toHaveBeenCalledExactlyOnceWith({ key: 'tareafacil_current_user_id' });
    before.delete('tareafacil_current_user_id');
    expect(storage).toEqual(before);
  });

  it('restores only the correct users persisted tasks after login again', async () => {
    const originalTasks = tasks.tasks();
    const storedTasks = storage.get('tareafacil_tasks');
    await auth.logout();
    TestBed.tick();
    expect(tasks.tasks()).toEqual([]);
    const result = await auth.login('a@example.test', 'Password123!');
    TestBed.tick();
    expect(result.success).toBe(true);
    expect(storage.get('tareafacil_current_user_id')).toBe(auth.currentUser()!.id);
    expect(tasks.tasks()).toEqual(originalTasks);
    expect(tasks.totalTasks()).toBe(1);
    expect(tasks.getTask(2)).toBeUndefined();
    expect(storage.get('tareafacil_tasks')).toBe(storedTasks);
  });
});

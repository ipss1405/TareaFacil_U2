import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { User } from './user.model';

vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } }));

describe('AuthService remote coordination', () => {
  let auth: AuthService;
  let storage: Map<string, string>;
  const remote = {
    signUp: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), currentUser: vi.fn()
  };

  async function initialize() {
    auth = TestBed.inject(AuthService);
    await vi.waitFor(() => expect(auth.isReady()).toBe(true));
  }

  async function registered() {
    await initialize();
    expect((await auth.register(' Rosa ', ' ROSA@example.test ', 'Password123!')).success).toBe(true);
    const user = auth.currentUser()!;
    await auth.logout();
    vi.clearAllMocks();
    return user;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    storage = new Map();
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => ({ value: storage.get(key) ?? null }));
    vi.mocked(Preferences.set).mockImplementation(async ({ key, value }) => { storage.set(key, value); });
    vi.mocked(Preferences.remove).mockImplementation(async ({ key }) => { storage.delete(key); });
    remote.signUp.mockResolvedValue({ success: true, userId: 'remote-rosa' });
    remote.signIn.mockResolvedValue({ success: true, userId: 'remote-rosa' });
    remote.signOut.mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseAuthService, useValue: remote }] });
    // Deterministic verifier: still distinguishes passwords and preserves salt.
    const browserCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: browserCrypto.getRandomValues.bind(browserCrypto),
      randomUUID: browserCrypto.randomUUID.bind(browserCrypto),
      subtle: {
        importKey: vi.fn().mockImplementation(async (_format, bytes: Uint8Array) => ({ bytes })),
        deriveBits: vi.fn().mockImplementation(async (_algorithm, key: { bytes: Uint8Array }) => key.bytes.buffer)
      }
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('registers remotely before persisting a separate local ID and offline hash', async () => {
    await initialize();
    const result = await auth.register(' Rosa ', ' ROSA@example.test ', 'Password123!');
    expect(result.success).toBe(true);
    expect(remote.signUp).toHaveBeenCalledExactlyOnceWith('rosa@example.test', 'Password123!', 'Rosa');
    const user = auth.currentUser()!;
    expect(user.remoteUserId).toBe('remote-rosa');
    expect(user.id).not.toBe(user.remoteUserId);
    expect(user.passwordHash).not.toContain('Password123!');
    expect(JSON.parse(storage.get('tareafacil_users')!)).toEqual([user]);
    expect(storage.get('tareafacil_current_user_id')).toBe(user.id);
  });

  it('does not create a local account when remote signup fails for connectivity', async () => {
    await initialize();
    remote.signUp.mockResolvedValue({ success: false, kind: 'connectivity', message: 'Sin conexión' });
    expect((await auth.register('Rosa', 'rosa@example.test', 'Password123!')).success).toBe(false);
    expect(auth.currentUser()).toBeNull();
    expect(storage.has('tareafacil_users')).toBe(false);
  });

  it('keeps remote signup rejection visible without persisting a local account', async () => {
    await initialize();
    remote.signUp.mockResolvedValue({ success: false, kind: 'rejected', message: 'Registro rechazado' });
    expect(await auth.register('Rosa', 'rosa@example.test', 'Password123!')).toEqual({ success: false, message: 'Registro rechazado' });
    expect(storage.size).toBe(0);
  });

  it('authenticates a linked user remotely while preserving the local ID', async () => {
    const user = await registered();
    expect((await auth.login(user.email, 'Password123!')).success).toBe(true);
    expect(remote.signIn).toHaveBeenCalledExactlyOnceWith(user.email, 'Password123!');
    expect(auth.currentUser()!.id).toBe(user.id);
  });

  it('allows offline login only after verifying the local password', async () => {
    const user = await registered();
    remote.signIn.mockResolvedValue({ success: false, kind: 'connectivity', message: 'Sin red' });
    expect((await auth.login(user.email, 'wrong-password')).success).toBe(false);
    expect(auth.currentUser()).toBeNull();
    expect(await auth.login(user.email, 'Password123!')).toEqual({ success: true, message: 'Sesión local iniciada sin conexión.' });
    expect(auth.currentUser()!.id).toBe(user.id);
  });

  it('does not fallback to local login when remote credentials are rejected', async () => {
    const user = await registered();
    remote.signIn.mockResolvedValue({ success: false, kind: 'rejected', message: 'Invalid login credentials' });
    expect(await auth.login(user.email, 'Password123!')).toEqual({ success: false, message: 'Invalid login credentials' });
    expect(auth.currentUser()).toBeNull();
    expect(storage.has('tareafacil_current_user_id')).toBe(false);
  });

  it('rejects a different remote UUID without changing the local association', async () => {
    const user = await registered();
    remote.signIn.mockResolvedValue({ success: true, userId: 'someone-else' });
    expect((await auth.login(user.email, 'Password123!')).success).toBe(false);
    expect(remote.signOut).toHaveBeenCalledOnce();
    expect(auth.currentUser()).toBeNull();
    expect(JSON.parse(storage.get('tareafacil_users')!)[0].remoteUserId).toBe('remote-rosa');
  });

  it('keeps legacy users local without registering or linking them remotely', async () => {
    const linked = await registered();
    const legacy: User = { id: linked.id, name: linked.name, email: linked.email, passwordHash: linked.passwordHash, createdAt: linked.createdAt };
    storage.set('tareafacil_users', JSON.stringify([legacy]));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseAuthService, useValue: remote }] });
    await initialize();
    expect((await auth.login(legacy.email, 'Password123!')).success).toBe(true);
    expect(auth.currentUser()!.remoteUserId).toBeUndefined();
    expect(remote.signIn).not.toHaveBeenCalled();
    expect(remote.signUp).not.toHaveBeenCalled();
  });

  it('logs out remotely and removes only the local session key', async () => {
    await initialize();
    await auth.register('Rosa', 'rosa@example.test', 'Password123!');
    storage.set('tareafacil_tasks', '[{"photoPath":"keep.jpg"}]');
    const before = new Map(storage);
    await auth.logout();
    before.delete('tareafacil_current_user_id');
    expect(storage).toEqual(before);
    expect(remote.signOut).toHaveBeenCalledOnce();
    expect(auth.currentUser()).toBeNull();
  });

  it('restores a linked local session and isReady without any remote request', async () => {
    storage.set('tareafacil_users', JSON.stringify([{ id: 'local-id', remoteUserId: 'remote-id', name: 'Rosa', email: 'rosa@example.test', passwordHash: 'unused', createdAt: '2026-01-01' }]));
    storage.set('tareafacil_current_user_id', 'local-id');
    remote.signIn.mockImplementation(() => new Promise(() => undefined));
    await initialize();
    expect(auth.currentUser()!.id).toBe('local-id');
    expect(remote.signIn).not.toHaveBeenCalled();
    expect(remote.currentUser).not.toHaveBeenCalled();
  });

  it('updates the offline verifier after a successful remote password change', async () => {
    const user = await registered();
    expect((await auth.login(user.email, 'NewPassword123!')).success).toBe(true);
    await auth.logout();
    remote.signIn.mockResolvedValue({ success: false, kind: 'connectivity', message: 'Sin red' });
    expect((await auth.login(user.email, 'Password123!')).success).toBe(false);
    expect((await auth.login(user.email, 'NewPassword123!')).success).toBe(true);
  });
});

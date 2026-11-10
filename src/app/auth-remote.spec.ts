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

  describe('first remote login on a new installation', () => {
    const remoteId = '9b4149d2-e39e-4d3b-870b-a3393d3f9011';
    const remoteEmail = 'nuevo@example.test';
    const profile = { id: remoteId, email: remoteEmail, user_metadata: { name: ' Persona remota ' } };

    beforeEach(() => {
      remote.signIn.mockResolvedValue({ success: true, userId: remoteId });
      remote.currentUser.mockReturnValue(profile);
    });

    it('creates a separate local profile and confirms users and session before exposing success', async () => {
      await initialize();
      const set = vi.mocked(Preferences.set).getMockImplementation()!;
      let finish!: () => void;
      vi.mocked(Preferences.set).mockImplementation(async options => {
        if (options.key === 'tareafacil_current_user_id') {
          await new Promise<void>(resolve => { finish = resolve; });
        }
        await set(options);
      });
      const pending = auth.login(' NUEVO@example.test ', 'Password123!');
      await vi.waitFor(() => expect(finish).toBeDefined());
      expect(auth.currentUser()).toBeNull();
      expect(storage.has('tareafacil_current_user_id')).toBe(false);
      finish();
      expect((await pending).success).toBe(true);
      const user = auth.currentUser()!;
      expect(user).toMatchObject({ email: remoteEmail, remoteUserId: remoteId, name: 'Persona remota' });
      expect(user.id).not.toBe(remoteId);
      expect(user.passwordHash).toContain('.');
      expect(user.passwordHash).not.toContain('Password123!');
      expect(JSON.parse(storage.get('tareafacil_users')!)).toEqual([user]);
      expect(storage.get('tareafacil_current_user_id')).toBe(user.id);
      expect(remote.signIn).toHaveBeenCalledExactlyOnceWith(remoteEmail, 'Password123!');
      expect(remote.signUp).not.toHaveBeenCalled();
    });

    it('uses the authenticated email and a safe fallback name', async () => {
      remote.currentUser.mockReturnValue({ id: remoteId, email: ' CANONICAL@example.test ', user_metadata: {} });
      await initialize();
      expect((await auth.login('alias@example.test', 'Password123!')).success).toBe(true);
      expect(auth.currentUser()).toMatchObject({ email: 'canonical@example.test', name: 'Usuario' });
    });

    it('supports offline login after restart once the remote user is cached', async () => {
      await initialize(); await auth.login(remoteEmail, 'Password123!');
      const user = auth.currentUser()!; await auth.logout();
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: SupabaseAuthService, useValue: remote }] });
      await initialize();
      remote.signIn.mockResolvedValue({ success: false, kind: 'connectivity', message: 'Sin red' });
      expect((await auth.login(remoteEmail, 'WrongPassword')).success).toBe(false);
      expect((await auth.login(remoteEmail, 'Password123!')).success).toBe(true);
      expect(auth.currentUser()!.id).toBe(user.id);
    });

    it('does not duplicate the same email on subsequent login', async () => {
      await initialize(); await auth.login(remoteEmail, 'Password123!');
      const id = auth.currentUser()!.id; await auth.logout();
      await auth.login('NUEVO@example.test', 'Password123!');
      expect(JSON.parse(storage.get('tareafacil_users')!)).toHaveLength(1);
      expect(auth.currentUser()!.id).toBe(id);
    });

    it('reuses the local ID for a remote UUID already associated under another email', async () => {
      const existing: User = { id: 'local-existing', remoteUserId: remoteId, name: 'Original',
        email: 'old@example.test', passwordHash: 'old.hash', createdAt: '2026-01-01' };
      storage.set('tareafacil_users', JSON.stringify([existing]));
      await initialize(); await auth.login(remoteEmail, 'Password123!');
      const users = JSON.parse(storage.get('tareafacil_users')!);
      expect(users).toHaveLength(1);
      expect(auth.currentUser()).toMatchObject({ id: existing.id, remoteUserId: remoteId, email: remoteEmail, createdAt: existing.createdAt });
    });

    it('rejects an authenticated email already owned by another local profile', async () => {
      storage.set('tareafacil_users', JSON.stringify([{ id: 'local-other', name: 'Other',
        email: remoteEmail, remoteUserId: 'other-remote', passwordHash: 'keep', createdAt: '2026-01-01' }]));
      const previous = storage.get('tareafacil_users');
      await initialize();
      expect((await auth.login('alias@example.test', 'Password123!')).success).toBe(false);
      expect(auth.currentUser()).toBeNull();
      expect(storage.get('tareafacil_users')).toBe(previous);
    });

    it.each(['rejected', 'connectivity'])('does not create a local profile after remote %s', async kind => {
      remote.signIn.mockResolvedValue({ success: false, kind, message: 'No autorizado o sin red' });
      await initialize();
      expect((await auth.login(remoteEmail, 'Password123!')).success).toBe(false);
      expect(auth.currentUser()).toBeNull();
      expect(storage.size).toBe(0);
      expect(Preferences.set).not.toHaveBeenCalled();
    });

    it.each([null, { ...profile, id: 'not-a-uuid' }, { ...profile, id: 'ba4149d2-e39e-4d3b-870b-a3393d3f9011' }, { ...profile, email: '' }])('rejects invalid remote identity without local writes: %j', async value => {
      remote.currentUser.mockReturnValue(value);
      await initialize();
      expect((await auth.login(remoteEmail, 'Password123!')).success).toBe(false);
      expect(storage.size).toBe(0);
      expect(auth.currentUser()).toBeNull();
      expect(remote.signOut).toHaveBeenCalledOnce();
    });

    it.each(['tareafacil_users', 'tareafacil_current_user_id'])('rolls back a failed %s write and allows a clean retry', async key => {
      await initialize();
      const set = vi.mocked(Preferences.set).getMockImplementation()!;
      let fail = true;
      vi.mocked(Preferences.set).mockImplementation(async options => {
        await set(options);
        if (options.key === key && fail) { fail = false; throw new Error('Full disk'); }
      });
      const result = await auth.login(remoteEmail, 'Password123!');
      expect(result.success).toBe(false);
      expect(result.message).toContain('No se pudo');
      expect(auth.currentUser()).toBeNull();
      expect(storage.size).toBe(0);
      expect(remote.signOut).toHaveBeenCalledOnce();
      expect((await auth.login(remoteEmail, 'Password123!')).success).toBe(true);
      expect(JSON.parse(storage.get('tareafacil_users')!)).toHaveLength(1);
    });

    it('preserves all existing users and unrelated task data after session persistence failure', async () => {
      const old: User = { id: 'legacy', name: 'Legacy', email: 'legacy@example.test', passwordHash: 'keep', createdAt: '2026-01-01' };
      storage.set('tareafacil_users', JSON.stringify([old]));
      storage.set('tareafacil_tasks', '[{"id":1,"userId":"legacy","photoPath":"keep.jpg"}]');
      const before = new Map(storage);
      await initialize();
      const set = vi.mocked(Preferences.set).getMockImplementation()!;
      vi.mocked(Preferences.set).mockImplementation(async options => {
        if (options.key === 'tareafacil_current_user_id') throw new Error('Write failed');
        await set(options);
      });
      expect((await auth.login(remoteEmail, 'Password123!')).success).toBe(false);
      expect(storage).toEqual(before);
      expect(auth.currentUser()).toBeNull();
    });

    it('preserves previous users when provisioning succeeds', async () => {
      const old: User = { id: 'legacy', name: 'Legacy', email: 'legacy@example.test', passwordHash: 'keep', createdAt: '2026-01-01' };
      storage.set('tareafacil_users', JSON.stringify([old]));
      await initialize(); await auth.login(remoteEmail, 'Password123!');
      expect(JSON.parse(storage.get('tareafacil_users')!)[0]).toEqual(old);
      expect(JSON.parse(storage.get('tareafacil_users')!)).toHaveLength(2);
    });

    it('does not create duplicates during concurrent first-login attempts', async () => {
      await initialize();
      const first = auth.login(remoteEmail, 'Password123!');
      const second = await auth.login(remoteEmail, 'Password123!');
      expect(second.success).toBe(false);
      expect((await first).success).toBe(true);
      expect(remote.signIn).toHaveBeenCalledTimes(1);
      expect(JSON.parse(storage.get('tareafacil_users')!)).toHaveLength(1);
    });
  });

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

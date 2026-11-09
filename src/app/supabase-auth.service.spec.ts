import { TestBed } from '@angular/core/testing';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { vi } from 'vitest';
import { REMOTE_AUTH_TIMEOUT_MS, SupabaseAuthService } from './supabase-auth.service';
import { SupabaseClientService } from './supabase-client.service';

describe('SupabaseAuthService', () => {
  const user = { id: 'remote-id', email: 'rosa@example.test' };
  const session = { access_token: 'access', user };
  const api = { signUp: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn() };
  let service: SupabaseAuthService;

  beforeEach(() => {
    vi.resetAllMocks();
    api.signUp.mockResolvedValue({ data: { session }, error: null });
    api.signInWithPassword.mockResolvedValue({ data: { session }, error: null });
    api.signOut.mockResolvedValue({ error: null });
    TestBed.configureTestingModule({ providers: [{
      provide: SupabaseClientService, useValue: { client: { auth: api } }
    }] });
    service = TestBed.inject(SupabaseAuthService);
  });

  afterEach(() => vi.useRealTimers());

  it('bounds a signup promise that never settles, including pre-fetch SDK waits', async () => {
    vi.useFakeTimers();
    api.signUp.mockImplementation(() => new Promise(() => undefined));
    const pending = service.signUp(user.email, 'Password123!', 'Rosa');
    await vi.advanceTimersByTimeAsync(REMOTE_AUTH_TIMEOUT_MS);
    expect(await pending).toMatchObject({ success: false, kind: 'connectivity', message: expect.stringContaining('12 segundos') });
    expect(service.currentUser()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not accept a signup session arriving after the deadline', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    api.signUp.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = service.signUp(user.email, 'Password123!', 'Rosa');
    await vi.advanceTimersByTimeAsync(REMOTE_AUTH_TIMEOUT_MS);
    expect((await pending).success).toBe(false);
    finish({ data: { session }, error: null });
    await Promise.resolve();
    expect(service.currentUser()).toBeNull();
  });

  it('bounds login and removes timeout timers after successful requests', async () => {
    vi.useFakeTimers();
    await service.signIn(user.email, 'Password123!');
    expect(vi.getTimerCount()).toBe(0);
    api.signInWithPassword.mockImplementation(() => new Promise(() => undefined));
    const pending = service.signIn(user.email, 'Password123!');
    await vi.advanceTimersByTimeAsync(REMOTE_AUTH_TIMEOUT_MS);
    expect(await pending).toMatchObject({ success: false, kind: 'connectivity' });
  });

  it('explains the real invalid API key failure without treating it as offline', async () => {
    api.signUp.mockResolvedValue({ data: {}, error: new AuthApiError('Invalid API key', 401, undefined) });
    expect(await service.signUp(user.email, 'Password123!', 'Rosa')).toMatchObject({
      success: false, kind: 'rejected', message: expect.stringContaining('clave pública (HTTP 401)')
    });
  });

  it('sends name as signup metadata and exposes the remote session user', async () => {
    expect(await service.signUp('rosa@example.test', 'Password123!', 'Rosa')).toEqual({ success: true, userId: user.id });
    expect(api.signUp).toHaveBeenCalledExactlyOnceWith({ email: user.email, password: 'Password123!', options: { data: { name: 'Rosa' } } });
    expect(service.currentUser()).toEqual(user);
  });

  it('requires a valid session before accepting a remote signup', async () => {
    api.signUp.mockResolvedValue({ data: { session: null, user }, error: null });
    expect(await service.signUp(user.email, 'Password123!', 'Rosa')).toMatchObject({ success: false, kind: 'rejected' });
    expect(service.currentUser()).toBeNull();
  });

  it('uses password sign-in and exposes the remote UUID', async () => {
    expect(await service.signIn(user.email, 'Password123!')).toEqual({ success: true, userId: user.id });
    expect(api.signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: user.email, password: 'Password123!' });
  });

  it('distinguishes rejected credentials from connectivity failures', async () => {
    api.signInWithPassword.mockResolvedValue({ data: {}, error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') });
    expect(await service.signIn(user.email, 'wrong')).toEqual({ success: false, kind: 'rejected', message: 'Invalid login credentials' });
  });

  it('classifies SDK transport failures as connectivity', async () => {
    api.signInWithPassword.mockResolvedValue({ data: {}, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    expect(await service.signIn(user.email, 'Password123!')).toMatchObject({ success: false, kind: 'connectivity' });
  });

  it('does not classify HTTP 503 as offline', async () => {
    api.signInWithPassword.mockResolvedValue({ data: {}, error: new AuthRetryableFetchError('Service unavailable', 503) });
    expect(await service.signIn(user.email, 'Password123!')).toMatchObject({ success: false, kind: 'rejected' });
  });

  it('classifies thrown network fetch failures as connectivity', async () => {
    api.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await service.signIn(user.email, 'Password123!')).toMatchObject({ success: false, kind: 'connectivity' });
  });

  it('classifies timeouts as connectivity', async () => {
    api.signUp.mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
    expect(await service.signUp(user.email, 'Password123!', 'Rosa')).toMatchObject({ success: false, kind: 'connectivity' });
  });

  it('does not treat configuration or programming errors as offline', async () => {
    api.signInWithPassword.mockRejectedValue(new Error('Missing configuration'));
    expect(await service.signIn(user.email, 'Password123!')).toMatchObject({ success: false, kind: 'rejected' });
  });

  it('signs out the current remote session and discards in-memory tokens', async () => {
    await service.signIn(user.email, 'Password123!');
    await service.signOut();
    expect(api.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(service.currentUser()).toBeNull();
  });

  it('discards tokens even when offline logout throws', async () => {
    await service.signIn(user.email, 'Password123!');
    api.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(service.signOut()).resolves.toBeUndefined();
    expect(service.currentUser()).toBeNull();
  });

  it('discards tokens even when logout returns an API error', async () => {
    await service.signIn(user.email, 'Password123!');
    api.signOut.mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) });
    await service.signOut();
    expect(service.currentUser()).toBeNull();
  });

  it('does not initialize a client or call the network without a remote session', async () => {
    await service.signOut();
    expect(api.signOut).not.toHaveBeenCalled();
  });
});

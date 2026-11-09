import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { environment } from '../environments/environment';
import { SupabaseClientService } from './supabase-client.service';

describe('SupabaseClientService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is lazy and shares one client without reading persisted remote credentials', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = TestBed.inject(SupabaseClientService);
    expect(fetchMock).not.toHaveBeenCalled();
    const client = service.client;
    expect(service.client).toBe(client);
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the configured public project and key for SDK requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Invalid login credentials' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await TestBed.inject(SupabaseClientService).client.auth.signInWithPassword({ email: 'rosa@example.test', password: 'wrong' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${environment.supabase.url}/auth/v1/token?grant_type=password`);
    expect(new Headers(options.headers).get('apikey')).toBe(environment.supabase.publishableKey);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps one client and clears its actual SDK session even if logout is offline', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: 'test-access', refresh_token: 'test-refresh',
      expires_in: 3600, token_type: 'bearer',
      user: { id: 'remote-id', email: 'rosa@example.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const service = TestBed.inject(SupabaseClientService);
    const client = service.client;
    expect((await client.auth.signInWithPassword({ email: 'rosa@example.test', password: 'Password123!' })).error).toBeNull();
    expect((await client.auth.getSession()).data.session).not.toBeNull();
    await client.auth.signOut({ scope: 'local' });
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(service.client).toBe(client);
  });

  it('rejects a secret key before creating a client or sending requests', () => {
    const original = environment.supabase.publishableKey;
    try {
      environment.supabase.publishableKey = 'sb_secret_not_allowed';
      expect(() => TestBed.inject(SupabaseClientService).client).toThrow('Publishable Key');
    } finally {
      environment.supabase.publishableKey = original;
    }
  });
});

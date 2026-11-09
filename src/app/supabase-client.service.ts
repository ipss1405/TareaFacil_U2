import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseClientService {
  private instance?: SupabaseClient;

  // Lazy: restoring the local session never initializes or waits for the SDK.
  get client(): SupabaseClient {
    if (!this.instance) {
      const { url, publishableKey } = environment.supabase;
      if (!url || !publishableKey) {
        throw new Error('Configura Project URL y Publishable Key de Supabase.');
      }
      if (!publishableKey.startsWith('sb_publishable_')) {
        throw new Error('Usa exclusivamente la Publishable Key pública de Supabase.');
      }
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error('Project URL debe ser una URL HTTPS pública de Supabase.');
      }
      this.instance = createClient(url, publishableKey, {
        auth: {
          // Stage 1: local session remains in Preferences; remote tokens are
          // memory-only and require a new remote login after restarting the app.
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        },
        global: {
          fetch: (input, init) => fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)])
              : AbortSignal.timeout(8000)
          })
        }
      });
    }
    return this.instance;
  }
}

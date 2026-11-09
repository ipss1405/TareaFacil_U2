import { Injectable, inject, signal } from '@angular/core';
import { AuthRetryableFetchError, Session, User } from '@supabase/supabase-js';
import { SupabaseClientService } from './supabase-client.service';

export const REMOTE_AUTH_TIMEOUT_MS = 12000;

export type RemoteAuthResult =
  | { success: true; userId: string }
  | { success: false; kind: 'connectivity' | 'rejected'; message: string };

@Injectable({ providedIn: 'root' })
export class SupabaseAuthService {
  private readonly clients = inject(SupabaseClientService);
  private readonly userState = signal<User | null>(null);
  readonly currentUser = this.userState.asReadonly();

  async signUp(email: string, password: string, name: string): Promise<RemoteAuthResult> {
    try {
      const { data, error } = await this.withDeadline(() => this.clients.client.auth.signUp({
        email, password, options: { data: { name } }
      }));
      if (error) return this.failure(error);
      return this.acceptSession(data.session);
    } catch (error) {
      return this.failure(error);
    }
  }

  async signIn(email: string, password: string): Promise<RemoteAuthResult> {
    try {
      const { data, error } = await this.withDeadline(() => this.clients.client.auth.signInWithPassword({ email, password }));
      if (error) return this.failure(error);
      return this.acceptSession(data.session);
    } catch (error) {
      return this.failure(error);
    }
  }

  async signOut(): Promise<void> {
    if (!this.userState()) return;
    try {
      await this.withDeadline(() => this.clients.client.auth.signOut({ scope: 'local' }));
    } catch {
      // SDK scope 'local' removes memory tokens before contacting the server.
    } finally {
      this.userState.set(null);
    }
  }

  private acceptSession(session: Session | null): RemoteAuthResult {
    if (!session?.access_token || !session.user?.id) {
      return { success: false, kind: 'rejected', message: 'Supabase no devolvió una sesión válida. Comprueba la confirmación del correo.' };
    }
    this.userState.set(session.user);
    return { success: true, userId: session.user.id };
  }

  private async withDeadline<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Bound the entire SDK promise, including initialization, locks and parsing,
      // not just fetch. A late result cannot reach acceptSession or local storage.
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new DOMException(
            'La operación con Supabase superó los 12 segundos. Revisa tu conexión e inténtalo de nuevo.',
            'TimeoutError'
          )), REMOTE_AUTH_TIMEOUT_MS);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private failure(error: unknown): RemoteAuthResult {
    if (error instanceof Error && /invalid api key/i.test(error.message)) {
      return { success: false, kind: 'rejected', message: 'Supabase rechazó la clave pública (HTTP 401). Revisa Project URL y Publishable Key.' };
    }
    // AuthRetryableFetchError with HTTP 5xx is a server failure, not offline.
    const connectivity =
      (error instanceof AuthRetryableFetchError && !error.status) ||
      (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) ||
      (error instanceof DOMException && ['TimeoutError', 'AbortError', 'NetworkError'].includes(error.name));
    return {
      success: false,
      kind: connectivity ? 'connectivity' : 'rejected',
      message: connectivity
        ? error instanceof DOMException && error.name === 'TimeoutError'
          ? error.message
          : 'No se pudo conectar con Supabase. Revisa tu conexión e inténtalo de nuevo.'
        : error instanceof Error ? error.message : 'No se pudo autenticar con Supabase.'
    };
  }
}

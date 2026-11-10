import {
  Injectable,
  computed,
  inject,
  signal
} from '@angular/core';

import {
  Preferences
} from '@capacitor/preferences';

import {
  User
} from './user.model';
import { SupabaseAuthService } from './supabase-auth.service';

export interface AuthResult {
  success: boolean;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {

  private readonly remoteAuth = inject(SupabaseAuthService);

  private provisioning = false;
  private sessionGeneration = 0;

  private readonly usersKey =
    'tareafacil_users';

  private readonly sessionKey =
    'tareafacil_current_user_id';

  private readonly usersState =
    signal<User[]>([]);

  private readonly currentUserState =
    signal<User | null>(null);

  private readonly readyState =
    signal(false);

  readonly currentUser =
    this.currentUserState.asReadonly();

  readonly isReady =
    this.readyState.asReadonly();

  readonly isAuthenticated = computed(
    () => this.currentUser() !== null
  );

  constructor() {
    void this.initialize();
  }

  async register(
    name: string,
    email: string,
    password: string
  ): Promise<AuthResult> {

    const cleanName =
      name.trim();

    const cleanEmail =
      email.trim().toLowerCase();

    if (
      !cleanName ||
      !cleanEmail ||
      !password
    ) {
      return {
        success: false,
        message:
          'Completa nombre, correo y contraseña.'
      };
    }

    if (
      !this.isValidEmail(cleanEmail)
    ) {
      return {
        success: false,
        message:
          'Ingresa un correo válido.'
      };
    }

    if (
      password.length < 6
    ) {
      return {
        success: false,
        message:
          'La contraseña debe tener al menos 6 caracteres.'
      };
    }

    const existingUser =
      this.usersState()
        .find(
          user =>
            user.email === cleanEmail
        );

    if (existingUser) {
      return {
        success: false,
        message:
          'Ya existe una cuenta con este correo.'
      };
    }

    const passwordHash =
      await this.createPasswordHash(
        password
      );

    const remote = await this.remoteAuth.signUp(cleanEmail, password, cleanName);
    if (!remote.success) {
      return { success: false, message: remote.message };
    }

    const user: User = {
      id: this.createUserId(),
      remoteUserId: remote.userId,
      name: cleanName,
      email: cleanEmail,
      passwordHash,
      createdAt:
        new Date().toISOString()
    };

    this.usersState.update(
      users => [
        ...users,
        user
      ]
    );

    await this.saveUsers();

    /*
     * Después del registro dejamos
     * la sesión iniciada automáticamente.
     */
    await this.saveSession(user);

    return {
      success: true,
      message:
        'Cuenta creada correctamente.'
    };
  }

  async login(
    email: string,
    password: string
  ): Promise<AuthResult> {

    const cleanEmail =
      email.trim().toLowerCase();

    if (
      !cleanEmail ||
      !password
    ) {
      return {
        success: false,
        message:
          'Ingresa correo y contraseña.'
      };
    }

    const user =
      this.usersState()
        .find(
          item =>
            item.email === cleanEmail
        );

    if (!user) {
      return this.loginRemoteFirstTime(cleanEmail, password);
    }

    if (user.remoteUserId) {
      const remote = await this.remoteAuth.signIn(cleanEmail, password);
      if (remote.success) {
        if (remote.userId !== user.remoteUserId) {
          await this.remoteAuth.signOut();
          return { success: false, message: 'La cuenta remota no corresponde al usuario local.' };
        }
        // A remotely changed password becomes the new offline verifier.
        const updatedUser = { ...user, passwordHash: await this.createPasswordHash(password) };
        this.usersState.update(users => users.map(item => item.id === user.id ? updatedUser : item));
        await this.saveUsers();
        await this.saveSession(updatedUser);
        return { success: true, message: 'Sesión iniciada correctamente.' };
      }
      if (remote.kind !== 'connectivity') {
        return { success: false, message: remote.message };
      }
    }

    const passwordCorrect =
      await this.verifyPassword(
        password,
        user.passwordHash
      );

    if (!passwordCorrect) {
      return {
        success: false,
        message:
          'Correo o contraseña incorrectos.'
      };
    }

    await this.saveSession(user);

    return {
      success: true,
      message:
        user.remoteUserId ? 'Sesión local iniciada sin conexión.' : 'Sesión iniciada correctamente.'
    };
  }

  private async loginRemoteFirstTime(email: string, password: string): Promise<AuthResult> {
    if (!this.isReady() || this.provisioning) {
      return { success: false, message: 'Espera a que termine el inicio de sesión e inténtalo de nuevo.' };
    }
    this.provisioning = true;
    const generation = this.sessionGeneration;
    const previousUser = this.currentUser();
    const assertCurrent = () => {
      if (generation !== this.sessionGeneration || this.currentUser() !== previousUser) {
        throw new Error('La sesión cambió. Vuelve a iniciar sesión.');
      }
    };
    let previousUsersValue: string | null = null;
    let previousSessionValue: string | null = null;
    let usersAttempted = false;
    let sessionAttempted = false;
    let acceptedRemote = false;
    try {
      const result = await this.remoteAuth.signIn(email, password);
      acceptedRemote = result.success;
      assertCurrent();
      if (!result.success) return { success: false, message: result.message };
      const remote = this.remoteAuth.currentUser();
      if (!remote || remote.id !== result.userId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(remote.id) ||
        typeof remote.email !== 'string' || !this.isValidEmail(remote.email.trim())) {
        throw new Error('Supabase no devolvió una identidad válida para crear el acceso local.');
      }
      const authenticatedEmail = remote.email.trim().toLowerCase();
      const passwordHash = await this.createPasswordHash(password);
      assertCurrent();
      const users = this.usersState();
      const byId = users.find(user => user.remoteUserId === remote.id);
      const byEmail = users.find(user => user.email.trim().toLowerCase() === authenticatedEmail);
      if (users.filter(user => user.remoteUserId === remote.id).length > 1 ||
        (byEmail && byEmail !== byId)) {
        throw new Error('El correo o la identidad remota ya están asociados a otro perfil local.');
      }
      const remoteName = [remote.user_metadata?.['name'], remote.user_metadata?.['full_name']]
        .find(value => typeof value === 'string' && value.trim());
      const user: User = byId
        ? { ...byId, email: authenticatedEmail, passwordHash }
        : { id: this.createUserId(), remoteUserId: remote.id, email: authenticatedEmail,
            name: typeof remoteName === 'string' && remoteName.trim() ? remoteName.trim() : 'Usuario',
            passwordHash, createdAt: new Date().toISOString() };
      const nextUsers = byId ? users.map(item => item === byId ? user : item) : [...users, user];
      previousUsersValue = (await Preferences.get({ key: this.usersKey })).value;
      assertCurrent();
      previousSessionValue = (await Preferences.get({ key: this.sessionKey })).value;
      assertCurrent();
      usersAttempted = true;
      await Preferences.set({ key: this.usersKey, value: JSON.stringify(nextUsers) });
      assertCurrent();
      sessionAttempted = true;
      await Preferences.set({ key: this.sessionKey, value: user.id });
      assertCurrent();
      // Publish only once both persistent writes are confirmed.
      this.usersState.set(nextUsers);
      this.currentUserState.set(user);
      return { success: true, message: 'Sesión iniciada correctamente.' };
    } catch {
      let rollbackFailed = false;
      if (sessionAttempted) {
        try {
          if (previousSessionValue === null) await Preferences.remove({ key: this.sessionKey });
          else await Preferences.set({ key: this.sessionKey, value: previousSessionValue });
        } catch { rollbackFailed = true; }
      }
      if (usersAttempted) {
        try {
          if (previousUsersValue === null) await Preferences.remove({ key: this.usersKey });
          else await Preferences.set({ key: this.usersKey, value: previousUsersValue });
        } catch { rollbackFailed = true; }
      }
      if (acceptedRemote) await this.remoteAuth.signOut();
      return { success: false, message: rollbackFailed
        ? 'No se pudo guardar ni restaurar completamente el acceso local. Revisa el almacenamiento y vuelve a intentarlo.'
        : 'No se pudo validar o guardar el acceso local. No se inició sesión; vuelve a intentarlo.' };
    } finally {
      this.provisioning = false;
    }
  }

  async logout(): Promise<void> {
    this.sessionGeneration++;

    this.currentUserState.set(null);

    await Preferences.remove({
      key: this.sessionKey
    });
    await this.remoteAuth.signOut();
  }

  private async initialize():
    Promise<void> {

    try {

      await this.loadUsers();

      const {
        value: currentUserId
      } = await Preferences.get({
        key: this.sessionKey
      });

      if (currentUserId) {

        const user =
          this.usersState()
            .find(
              item =>
                item.id === currentUserId
            );

        this.currentUserState.set(
          user ?? null
        );

      }

    } catch (error) {

      console.error(
        'No se pudo inicializar la autenticación:',
        error
      );

      this.currentUserState.set(null);

    } finally {

      this.readyState.set(true);

    }

  }

  private async loadUsers():
    Promise<void> {

    const {
      value
    } = await Preferences.get({
      key: this.usersKey
    });

    if (!value) {
      this.usersState.set([]);
      return;
    }

    try {

      const users: unknown =
        JSON.parse(value);

      this.usersState.set(
        Array.isArray(users)
          ? users as User[]
          : []
      );

    } catch {

      this.usersState.set([]);

    }

  }

  private async saveUsers():
    Promise<void> {

    await Preferences.set({
      key: this.usersKey,
      value:
        JSON.stringify(
          this.usersState()
        )
    });
  }

  private async saveSession(
    user: User
  ): Promise<void> {

    this.currentUserState.set(user);

    await Preferences.set({
      key: this.sessionKey,
      value: user.id
    });
  }

  private isValidEmail(
    email: string
  ): boolean {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      .test(email);
  }

  private createUserId(): string {

    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID ===
        'function'
    ) {
      return crypto.randomUUID();
    }

    return (
      `user-${Date.now()}-` +
      Math.random()
        .toString(36)
        .slice(2, 10)
    );
  }

  /*
   * La contraseña NO se guarda
   * directamente.
   *
   * Guardamos:
   *
   * salt.hash
   */
  private async createPasswordHash(
    password: string
  ): Promise<string> {

    const salt =
      crypto.getRandomValues(
        new Uint8Array(16)
      );

    const hash =
      await this.derivePasswordHash(
        password,
        salt
      );

    return (
      `${this.bytesToBase64(salt)}.` +
      `${this.bytesToBase64(hash)}`
    );
  }

  private async verifyPassword(
    password: string,
    storedValue: string
  ): Promise<boolean> {

    const parts =
      storedValue.split('.');

    if (parts.length !== 2) {
      return false;
    }

    const salt =
      this.base64ToBytes(
        parts[0]
      );

    const expectedHash =
      parts[1];

    const actualHash =
      await this.derivePasswordHash(
        password,
        salt
      );

    return (
      this.bytesToBase64(
        actualHash
      ) === expectedHash
    );
  }

  private async derivePasswordHash(
    password: string,
    salt: Uint8Array
  ): Promise<Uint8Array> {

    const encoder =
      new TextEncoder();

    const passwordKey =
      await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        [
          'deriveBits'
        ]
      );

    const derivedBits =
      await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: new Uint8Array(salt),
          iterations: 120000,
          hash: 'SHA-256'
        },
        passwordKey,
        256
      );

    return new Uint8Array(
      derivedBits
    );
  }

  private bytesToBase64(
    bytes: Uint8Array
  ): string {

    let binary = '';

    bytes.forEach(
      byte => {
        binary +=
          String.fromCharCode(byte);
      }
    );

    return btoa(binary);
  }

  private base64ToBytes(
    value: string
  ): Uint8Array {

    const binary =
      atob(value);

    return Uint8Array.from(
      binary,
      character =>
        character.charCodeAt(0)
    );
  }
}

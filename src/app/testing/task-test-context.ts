import { computed, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';
import { AuthService } from '../auth.service';
import { User } from '../user.model';

export function createTaskTestContext() {
  const userA: User = { id: 'user-a', name: 'A', email: 'a@example.test', passwordHash: 'test', createdAt: '2026-01-01T00:00:00Z' };
  const userB: User = { ...userA, id: 'user-b', name: 'B', email: 'b@example.test' };
  const currentUser = signal<User | null>(userA);
  const isReady = signal(true);
  const storage = new Map<string, string>();
  vi.mocked(Preferences.get).mockReset().mockImplementation(async ({ key }) => ({ value: storage.get(key) ?? null }));
  vi.mocked(Preferences.set).mockReset().mockImplementation(async ({ key, value }) => { storage.set(key, value); });
  return {
    userA, userB, currentUser, isReady, storage,
    providers: [{ provide: AuthService, useValue: { currentUser, isReady, isAuthenticated: computed(() => currentUser() !== null) } }]
  };
}

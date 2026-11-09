import { Component, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterStateSnapshot, Routes, UrlTree, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Observable } from 'rxjs';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { vi } from 'vitest';

@Component({ template: '' })
class RouteStubComponent {}

const protectedUrls = ['/summary', '/home', '/task-form', '/task-form/123', '/import-tasks'];

describe('authGuard', () => {
  const ready = signal(true);
  const authenticated = signal(true);

  beforeEach(() => {
    ready.set(true);
    authenticated.set(true);
    const testRoutes: Routes = [
      ...['summary', 'home', 'task-form', 'task-form/:id', 'import-tasks'].map(path => ({ path, component: RouteStubComponent, canActivate: [authGuard] })),
      ...['splash', 'login', 'register'].map(path => ({ path, component: RouteStubComponent })),
      { path: '', redirectTo: 'splash', pathMatch: 'full' }
    ];
    TestBed.configureTestingModule({ providers: [provideRouter(testRoutes), {
      provide: AuthService, useValue: { isReady: ready, isAuthenticated: computed(() => authenticated()) }
    }] });
  });

  const invoke = () => TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot));

  it('allows authenticated navigation to all protected routes', async () => {
    const harness = await RouterTestingHarness.create();
    for (const url of protectedUrls) {
      await harness.navigateByUrl(url, RouteStubComponent);
      expect(TestBed.inject(Router).url).toBe(url);
    }
  });

  it('redirects unauthenticated navigation once while keeping public routes accessible', async () => {
    authenticated.set(false);
    const router = TestBed.inject(Router);
    const harness = await RouterTestingHarness.create();
    const completed: string[] = [];
    const subscription = router.events.subscribe(event => {
      if (event instanceof NavigationEnd) completed.push(event.urlAfterRedirects);
    });
    for (const url of protectedUrls) {
      await harness.navigateByUrl('/register', RouteStubComponent);
      completed.length = 0;
      await harness.navigateByUrl(url, RouteStubComponent);
      expect(router.url).toBe('/login');
      expect(completed).toEqual(['/login']);
    }
    await harness.navigateByUrl('/splash', RouteStubComponent);
    expect(router.url).toBe('/splash');
    await harness.navigateByUrl('/login', RouteStubComponent);
    expect(router.url).toBe('/login');
    subscription.unsubscribe();
  });

  it('waits for session restoration before allowing navigation', () => {
    ready.set(false);
    authenticated.set(false);
    const decisions: (boolean | UrlTree)[] = [];
    (invoke() as Observable<boolean | UrlTree>).subscribe(value => decisions.push(value));
    TestBed.tick();
    expect(decisions).toEqual([]);
    authenticated.set(true);
    ready.set(true);
    TestBed.tick();
    expect(decisions).toEqual([true]);
    authenticated.set(false);
    TestBed.tick();
    expect(decisions).toEqual([true]);
  });

  it('returns one login UrlTree only after an unauthenticated restoration finishes', () => {
    ready.set(false);
    authenticated.set(false);
    const decisions: (boolean | UrlTree)[] = [];
    (invoke() as Observable<boolean | UrlTree>).subscribe(value => decisions.push(value));
    TestBed.tick();
    expect(decisions).toEqual([]);
    ready.set(true);
    TestBed.tick();
    expect(decisions.length).toBe(1);
    expect(TestBed.inject(Router).serializeUrl(decisions[0] as UrlTree)).toBe('/login');
    authenticated.set(true);
    TestBed.tick();
    expect(decisions.length).toBe(1);
  });

  it('cancels its readiness watcher if navigation is abandoned', () => {
    ready.set(false);
    const decisions: (boolean | UrlTree)[] = [];
    const subscription = (invoke() as Observable<boolean | UrlTree>).subscribe(value => decisions.push(value));
    TestBed.tick();
    subscription.unsubscribe();
    ready.set(true);
    TestBed.tick();
    expect(decisions).toEqual([]);
  });

  it('returns a redirect decision without triggering a second imperative navigation', () => {
    authenticated.set(false);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    const result = invoke() as UrlTree;
    expect(router.serializeUrl(result)).toBe('/login');
    expect(navigate).not.toHaveBeenCalled();
    navigate.mockRestore();
  });
});

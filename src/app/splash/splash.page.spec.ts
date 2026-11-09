import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { vi } from 'vitest';
import { SplashPage } from './splash.page';
import { AuthService } from '../auth.service';

describe('SplashPage session routing', () => {
  const navigateRoot = vi.fn().mockResolvedValue(true);
  const ready = signal(true);
  const authenticated = signal(true);
  let page: SplashPage;

  beforeEach(() => {
    vi.useFakeTimers();
    navigateRoot.mockClear();
    ready.set(true);
    authenticated.set(true);
    TestBed.configureTestingModule({ providers: [
      { provide: NavController, useValue: { navigateRoot } },
      { provide: AuthService, useValue: { isReady: ready, isAuthenticated: authenticated } }
    ] });
    page = TestBed.runInInjectionContext(() => new SplashPage());
    TestBed.tick();
  });

  afterEach(() => { page.ngOnDestroy(); vi.useRealTimers(); });

  it('waits three seconds then replaces splash with summary for a restored session', () => {
    page.ionViewDidEnter();
    vi.advanceTimersByTime(2999);
    TestBed.tick();
    expect(navigateRoot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    TestBed.tick();
    expect(navigateRoot).toHaveBeenCalledWith('/summary', expect.objectContaining({ replaceUrl: true }));
    expect(navigateRoot).toHaveBeenCalledTimes(1);
  });

  it('goes to login after three seconds without a session', () => {
    authenticated.set(false);
    page.ionViewDidEnter();
    vi.advanceTimersByTime(3000);
    TestBed.tick();
    expect(navigateRoot).toHaveBeenCalledWith('/login', expect.objectContaining({ replaceUrl: true }));
  });

  it('waits for delayed initialization and makes only one routing decision', () => {
    ready.set(false);
    authenticated.set(false);
    page.ionViewDidEnter();
    vi.advanceTimersByTime(5000);
    TestBed.tick();
    expect(navigateRoot).not.toHaveBeenCalled();
    authenticated.set(true);
    ready.set(true);
    TestBed.tick();
    expect(navigateRoot).toHaveBeenCalledWith('/summary', expect.anything());
    authenticated.set(false);
    TestBed.tick();
    expect(navigateRoot).toHaveBeenCalledTimes(1);
  });

  it('still waits the full timer if session initialization finishes first', () => {
    ready.set(false);
    page.ionViewDidEnter();
    vi.advanceTimersByTime(1000);
    ready.set(true);
    TestBed.tick();
    expect(navigateRoot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    TestBed.tick();
    expect(navigateRoot).toHaveBeenCalledTimes(1);
  });

  it('cancels pending navigation when leaving before the timer finishes', () => {
    page.ionViewDidEnter();
    page.ionViewWillLeave();
    vi.advanceTimersByTime(4000);
    TestBed.tick();
    expect(navigateRoot).not.toHaveBeenCalled();
  });

  it('does not navigate if initialization completes after the page was destroyed', () => {
    ready.set(false);
    page.ionViewDidEnter();
    vi.advanceTimersByTime(3000);
    TestBed.tick();
    page.ngOnDestroy();
    ready.set(true);
    TestBed.tick();
    expect(navigateRoot).not.toHaveBeenCalled();
  });

  it('restarts the timer cleanly on reentry', () => {
    page.ionViewDidEnter();
    vi.advanceTimersByTime(2000);
    page.ionViewDidEnter();
    vi.advanceTimersByTime(1000);
    TestBed.tick();
    expect(navigateRoot).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    TestBed.tick();
    expect(navigateRoot).toHaveBeenCalledTimes(1);
  });
});

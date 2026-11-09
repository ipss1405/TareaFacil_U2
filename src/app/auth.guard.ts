import { Injector, effect, inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const injector = inject(Injector);
  const decide = () => auth.isAuthenticated() ? true : router.createUrlTree(['/login']);

  if (auth.isReady()) return decide();

  return new Observable<boolean | UrlTree>(subscriber => {
    const watcher = effect(() => {
      if (auth.isReady()) {
        subscriber.next(decide());
        subscriber.complete();
      }
    }, { injector, manualCleanup: true });
    return () => watcher.destroy();
  });
};

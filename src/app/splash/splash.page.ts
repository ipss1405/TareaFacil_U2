import { Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { IonContent, IonProgressBar, NavController } from '@ionic/angular';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-splash',
  templateUrl: 'splash.page.html',
  styleUrls: ['splash.page.scss'],
  imports: [IonContent, IonProgressBar]
})
export class SplashPage implements OnDestroy {
  private readonly nav = inject(NavController);
  private readonly auth = inject(AuthService);
  private readonly delayElapsed = signal(false);
  private timer?: ReturnType<typeof setTimeout>;


  constructor() {
    effect(() => {
      if (!this.delayElapsed() || !this.auth.isReady()) return;

      this.delayElapsed.set(false);
      void this.nav.navigateRoot(this.auth.isAuthenticated() ? '/summary' : '/login', {
        replaceUrl: true,
        animated: !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      });
    });
  }

  ionViewDidEnter() {
    this.clearTimer();
    this.timer = setTimeout(() => this.delayElapsed.set(true), 3000);
  }

  ionViewWillLeave() { this.clearTimer(); }
  ngOnDestroy() { this.clearTimer(); }

  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.delayElapsed.set(false);
  }
}

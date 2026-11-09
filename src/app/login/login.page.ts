import {
  Component,
  ChangeDetectorRef,
  inject
} from '@angular/core';

import {
  FormsModule
} from '@angular/forms';

import {
  Router
} from '@angular/router';

import {
  IonContent,
  IonInput,
  IonButton,
  IonIcon
} from '@ionic/angular';

import {
  addIcons
} from 'ionicons';

import {
  logInOutline,
  personAddOutline,
  mailOutline,
  lockClosedOutline,
  eyeOutline,
  eyeOffOutline
} from 'ionicons/icons';

import {
  AuthService
} from '../auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  imports: [
    FormsModule,
    IonContent,
    IonInput,
    IonButton,
    IonIcon
  ]
})
export class LoginPage {

  private readonly changeDetector = inject(ChangeDetectorRef);

  private readonly authService =
    inject(AuthService);

  private readonly router =
    inject(Router);

  email = '';
  password = '';
  showPassword = false;
  message = '';
  isSubmitting = false;

  constructor() {

    addIcons({
      logInOutline,
      personAddOutline,
      mailOutline,
      lockClosedOutline,
      eyeOutline,
      eyeOffOutline
    });

  }

  async login(): Promise<void> {

    if (this.isSubmitting) return;

    this.message = '';
    this.isSubmitting = true;

    try {

      const result =
        await this.authService.login(
          this.email,
          this.password
        );

      this.message = result.message;

      if (result.success) {

        await this.router.navigateByUrl(
          '/summary',
          {
            replaceUrl: true
          }
        );

      }

    } catch (error) {
      this.message = error instanceof Error
        ? error.message
        : 'No se pudo iniciar sesión. Inténtalo de nuevo.';
    } finally {

      this.isSubmitting = false;
      this.changeDetector.markForCheck();

    }

  }

  goToRegister(): void {

    void this.router.navigateByUrl(
      '/register'
    );

  }

}

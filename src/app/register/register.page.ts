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
  personOutline,
  mailOutline,
  lockClosedOutline,
  personAddOutline,
  arrowBackOutline,
  eyeOutline,
  eyeOffOutline
} from 'ionicons/icons';

import {
  AuthService
} from '../auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  imports: [
    FormsModule,
    IonContent,
    IonInput,
    IonButton,
    IonIcon
  ]
})
export class RegisterPage {

  private readonly changeDetector = inject(ChangeDetectorRef);

  private readonly authService =
    inject(AuthService);

  private readonly router =
    inject(Router);

  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  showPassword = false;
  showConfirmPassword = false;

  message = '';

  isSubmitting = false;

  constructor() {

    addIcons({
      personOutline,
      mailOutline,
      lockClosedOutline,
      personAddOutline,
      arrowBackOutline,
      eyeOutline,
      eyeOffOutline
    });

  }

  async register(): Promise<void> {

    if (this.isSubmitting) return;

    this.message = '';

    if (
      this.password !==
      this.confirmPassword
    ) {

      this.message =
        'Las contraseñas no coinciden.';

      return;
    }

    this.isSubmitting = true;

    try {

      const result =
        await this.authService.register(
          this.name,
          this.email,
          this.password
        );

      this.message =
        result.message;

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
        : 'No se pudo completar el registro. Inténtalo de nuevo.';
    } finally {

      this.isSubmitting = false;
      // Angular runs without Zone.js: plain async field changes need a notification.
      this.changeDetector.markForCheck();

    }

  }

  goToLogin(): void {

    void this.router.navigateByUrl(
      '/login'
    );

  }

}

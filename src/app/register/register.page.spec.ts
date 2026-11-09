import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../auth.service';
import { RegisterPage } from './register.page';

describe('RegisterPage async feedback and password visibility', () => {
  let fixture: ComponentFixture<RegisterPage>;
  const register = vi.fn();

  beforeEach(async () => {
    register.mockReset();
    await TestBed.configureTestingModule({ imports: [RegisterPage], providers: [
      provideRouter([]), { provide: AuthService, useValue: { register } }
    ] }).compileComponents();
    fixture = TestBed.createComponent(RegisterPage);
    Object.assign(fixture.componentInstance, { name: 'David', email: 'david@example.test', password: 'Password123!', confirmPassword: 'Password123!' });
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders an async remote failure and unlocks the button without a forced detectChanges', async () => {
    let finish!: (result: { success: boolean; message: string }) => void;
    register.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const button = fixture.nativeElement.querySelector('ion-button.register-button');
    button.click();
    await fixture.whenStable();
    expect(button.textContent).toContain('Creando cuenta...');
    finish({ success: false, message: 'Supabase rechazó la clave pública (HTTP 401).' });
    await vi.waitFor(() => expect(fixture.nativeElement.querySelector('.register-message')?.textContent).toContain('HTTP 401'));
    expect(button.textContent).toContain('Crear cuenta');
    expect(button.disabled).toBe(false);
    expect(fixture.componentInstance.isSubmitting).toBe(false);
  });

  it('catches thrown errors and always releases submission state', async () => {
    register.mockRejectedValue(new Error('No se pudo guardar el registro.'));
    await fixture.componentInstance.register();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.register-message').textContent).toContain('No se pudo guardar');
    expect(fixture.componentInstance.isSubmitting).toBe(false);
  });

  it('navigates after confirmed registration and ignores duplicate submissions', async () => {
    let finish!: (result: { success: boolean; message: string }) => void;
    register.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const first = fixture.componentInstance.register();
    await fixture.componentInstance.register();
    expect(register).toHaveBeenCalledOnce();
    finish({ success: true, message: 'Cuenta creada' });
    await first;
    expect(navigate).toHaveBeenCalledWith('/summary', { replaceUrl: true });
    expect(fixture.componentInstance.isSubmitting).toBe(false);
  });

  it('toggles each password independently, preserves values and updates accessible labels', async () => {
    const inputs = fixture.nativeElement.querySelectorAll('ion-input');
    const buttons = fixture.nativeElement.querySelectorAll('button.password-toggle');
    expect(inputs[2].type).toBe('password');
    expect(inputs[3].type).toBe('password');
    expect(buttons[0].getAttribute('aria-label')).toBe('Mostrar contraseña');
    buttons[0].click();
    await fixture.whenStable();
    expect(inputs[2].type).toBe('text');
    expect(inputs[3].type).toBe('password');
    expect(buttons[0].getAttribute('aria-label')).toBe('Ocultar contraseña');
    buttons[1].click();
    await fixture.whenStable();
    expect(inputs[3].type).toBe('text');
    expect(buttons[1].getAttribute('aria-label')).toBe('Ocultar confirmación de contraseña');
    buttons[0].click();
    buttons[1].click();
    await fixture.whenStable();
    expect(inputs[2].type).toBe('password');
    expect(inputs[3].type).toBe('password');
    expect(fixture.componentInstance.password).toBe('Password123!');
    expect(fixture.componentInstance.confirmPassword).toBe('Password123!');
  });
});

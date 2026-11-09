import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../auth.service';
import { LoginPage } from './login.page';

describe('LoginPage async feedback and password visibility', () => {
  let fixture: ComponentFixture<LoginPage>;
  const login = vi.fn();

  beforeEach(async () => {
    login.mockReset();
    await TestBed.configureTestingModule({ imports: [LoginPage], providers: [
      provideRouter([]), { provide: AuthService, useValue: { login } }
    ] }).compileComponents();
    fixture = TestBed.createComponent(LoginPage);
    fixture.componentInstance.password = 'Password123!';
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('renders async authentication errors and re-enables login without forced change detection', async () => {
    login.mockResolvedValue({ success: false, message: 'Credenciales incorrectas' });
    fixture.nativeElement.querySelector('ion-button.login-button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.login-message').textContent).toContain('Credenciales incorrectas');
    expect(fixture.nativeElement.querySelector('ion-button.login-button').disabled).toBe(false);
  });

  it('catches unexpected failures and restores submission state', async () => {
    login.mockRejectedValue(new Error('Error de almacenamiento'));
    await fixture.componentInstance.login();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.login-message').textContent).toContain('Error de almacenamiento');
    expect(fixture.componentInstance.isSubmitting).toBe(false);
  });

  it('toggles password visibility without changing its value', async () => {
    const button = fixture.nativeElement.querySelector('button.password-toggle');
    const input = fixture.nativeElement.querySelectorAll('ion-input')[1];
    expect(input.type).toBe('password');
    expect(button.getAttribute('aria-label')).toBe('Mostrar contraseña');
    button.click();
    await fixture.whenStable();
    expect(input.type).toBe('text');
    expect(button.getAttribute('aria-label')).toBe('Ocultar contraseña');
    button.click();
    await fixture.whenStable();
    expect(input.type).toBe('password');
    expect(fixture.componentInstance.password).toBe('Password123!');
  });
});

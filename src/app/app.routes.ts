import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: 'splash',
    loadComponent: () =>
      import('./splash/splash.page')
        .then((m) => m.SplashPage),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./login/login.page')
        .then((m) => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./register/register.page')
        .then((m) => m.RegisterPage),
  },
  {
    path: 'import-tasks',
    canActivate: [authGuard],
    loadComponent: () => import('./import-tasks/import-tasks.page').then(m => m.ImportTasksPage),
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./tasks/tasks.page')
        .then((m) => m.TasksPage),
  },
  {
    path: 'summary',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./home/home.page')
        .then((m) => m.HomePage),
  },
  {
    path: 'tasks',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  {
    path: 'task-form/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./task-form/task-form.page')
        .then((m) => m.TaskFormPage),
  },
  {
    path: 'task-form',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./task-form/task-form.page')
        .then((m) => m.TaskFormPage),
  },
  {
    path: '',
    redirectTo: 'splash',
    pathMatch: 'full',
  },
];
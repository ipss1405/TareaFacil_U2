import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IonButtons, NavController, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, IonProgressBar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, checkmarkOutline, checkmarkCircleOutline, ellipseOutline, layersOutline, cameraOutline, locationOutline, sparklesOutline, logOutOutline, syncOutline } from 'ionicons/icons';
import { TaskService } from '../task.service';
import { AuthService } from '../auth.service';
import { TaskSyncService } from '../task-sync.service';
import { TaskRealtimeService } from '../task-realtime.service';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [DatePipe, IonButtons, RouterLink, IonHeader, IonToolbar, IonTitle, IonContent, IonButton, IonIcon, IonProgressBar]
})
export class HomePage {
  readonly taskService = inject(TaskService);
  readonly taskSync = inject(TaskSyncService);
  readonly taskRealtime = inject(TaskRealtimeService);
  private readonly auth = inject(AuthService);
  private readonly nav = inject(NavController);
  isLoggingOut = false;

  constructor() {
    addIcons({ addOutline, checkmarkOutline, checkmarkCircleOutline, ellipseOutline, layersOutline, cameraOutline, locationOutline, sparklesOutline, logOutOutline, syncOutline });
  }
  async logout(): Promise<void> {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;
    try {
      await this.auth.logout();
      await this.nav.navigateRoot('/login', { replaceUrl: true });
    } finally {
      this.isLoggingOut = false;
    }
  }
}

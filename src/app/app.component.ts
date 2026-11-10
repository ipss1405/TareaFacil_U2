import { TaskAutoSyncService } from './task-auto-sync.service';
import { Component, inject } from '@angular/core';
import { TaskRealtimeService } from './task-realtime.service';
import { IonApp, IonRouterOutlet } from '@ionic/angular';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  readonly taskAutoSync = inject(TaskAutoSyncService);
  // The service lives for the app lifetime, including agenda and form routes.
  readonly taskRealtime = inject(TaskRealtimeService);
}

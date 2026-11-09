import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, timeout } from 'rxjs';
import { ExternalTask, isExternalTask } from './external-task.model';

@Injectable({ providedIn: 'root' })
export class TaskApiService {
  private readonly http = inject(HttpClient);

  getCandidates() {
    return this.http.get<unknown>('https://jsonplaceholder.typicode.com/todos').pipe(
      timeout(15000),
      map(response => {
        if (!Array.isArray(response) || !response.every(isExternalTask)) {
          throw new Error('Respuesta de tareas externas no válida.');
        }
        return (response as ExternalTask[]).slice(0, 10).map(task => ({ ...task, title: task.title.trim() }));
      })
    );
  }
}

import { TestBed } from '@angular/core/testing';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TaskApiService } from './task-api.service';
import { ExternalTask } from './external-task.model';

describe('TaskApiService', () => {
  let service: TaskApiService;
  let http: HttpTestingController;
  const url = 'https://jsonplaceholder.typicode.com/todos';
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(TaskApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('GETs todos and exposes only the first ten validated titles', () => {
    let result: ExternalTask[] = [];
    service.getCandidates().subscribe(tasks => { result = tasks; });
    const request = http.expectOne(url);
    expect(request.request.method).toBe('GET');
    request.flush(Array.from({ length: 12 }, (_, i) => ({ id: i + 1, userId: 99, title: '  Tarea ' + i + '  ', completed: i === 0 })));
    expect(result.length).toBe(10);
    expect(result[0]).toEqual({ id: 1, userId: 99, title: 'Tarea 0', completed: true });
  });

  it('reports network errors without returning fabricated tasks', () => {
    let error: HttpErrorResponse | undefined;
    service.getCandidates().subscribe({ next: () => { throw new Error('Unexpected success'); }, error: value => { error = value; } });
    http.expectOne(url).error(new ProgressEvent('error'));
    expect(error?.status).toBe(0);
  });

  it('rejects malformed responses and missing or invalid task fields', () => {
    for (const response of [{ todos: [] }, [{ id: 1, userId: 1, title: ' ', completed: false }], [{ id: 1, userId: 1, title: 'Titulo', completed: 'false' }], [{ id: -1, userId: 1, title: 'Titulo', completed: false }]]) {
      let failed = false;
      service.getCandidates().subscribe({ error: () => { failed = true; } });
      http.expectOne(url).flush(response);
      expect(failed).toBe(true);
    }
  });
});

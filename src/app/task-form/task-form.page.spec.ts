import { createTaskTestContext } from '../testing/task-test-context';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { NavController } from '@ionic/angular';
import { Camera, MediaType } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Geolocation, Position } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import { Task } from '../task.model';
import { vi } from 'vitest';
import { TaskFormPage } from './task-form.page';
import { TaskService } from '../task.service';

vi.mock('@capacitor/camera', async importOriginal => {
  const actual = await importOriginal<typeof import('@capacitor/camera')>();
  return { ...actual, Camera: { takePhoto: vi.fn() } };
});

vi.mock('@capacitor/filesystem', async importOriginal => {
  const actual = await importOriginal<typeof import('@capacitor/filesystem')>();
  return { ...actual, Filesystem: { readFile: vi.fn(), writeFile: vi.fn(), getUri: vi.fn(), deleteFile: vi.fn() } };
});

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: { getCurrentPosition: vi.fn(), checkPermissions: vi.fn(), requestPermissions: vi.fn() }
}));


vi.mock('@capacitor/preferences', () => ({ Preferences: { get: vi.fn(), set: vi.fn() } }));

describe('TaskFormPage scheduling and persistent photography', () => {
  let page: TaskFormPage;
  let service: TaskService;
  let context: ReturnType<typeof createTaskTestContext>;
  const snapshot = { paramMap: convertToParamMap({}) };
  const navigateBack = vi.fn();
  const base64Photo = 'aW1hZ2U=';
  const dataUrl = 'data:image/png;base64,' + base64Photo;
  const createObjectURL = vi.fn();
  const revokeObjectURL = vi.fn();

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    createObjectURL.mockReturnValue('blob:test-photo-preview');
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    vi.mocked(Geolocation.getCurrentPosition).mockResolvedValue(position());
    vi.mocked(Camera.takePhoto).mockResolvedValue({
      type: MediaType.Photo, saved: false, thumbnail: dataUrl,
      webPath: 'blob:temporary-camera-photo', metadata: { format: 'png' }
    });
    vi.mocked(Filesystem.writeFile).mockResolvedValue({ uri: 'file:///data/photo.png' });
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: base64Photo });
    vi.mocked(Filesystem.getUri).mockResolvedValue({ uri: 'file:///data/photo.png' });
    context = createTaskTestContext();
    snapshot.paramMap = convertToParamMap({});
    await TestBed.configureTestingModule({
      imports: [TaskFormPage],
      providers: [provideRouter([]), ...context.providers,
        { provide: ActivatedRoute, useValue: { snapshot } },
        { provide: NavController, useValue: { navigateBack } }]
    }).compileComponents();
    page = TestBed.createComponent(TaskFormPage).componentInstance;
    service = TestBed.inject(TaskService);
    await service.ready;
    TestBed.tick();
    await page.ionViewWillEnter();
    page.newTitle = 'Nueva';
    page.newDescription = 'Detalle';
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('combines local date and time into ISO and resets the form', async () => {
    page.scheduledDate = '2026-11-10';
    page.scheduledTime = '15:30';
    await page.saveTask();
    expect(service.tasks().at(-1)?.scheduledAt).toBe(new Date(2026, 10, 10, 15, 30).toISOString());
    expect(navigateBack).toHaveBeenCalledWith('/home', { replaceUrl: true });
    expect(page.scheduledDate).toBe('');
    expect(page.scheduledTime).toBe('');
  });

  it('allows no schedule but rejects partial or invalid scheduling', async () => {
    page.scheduledDate = '2026-11-10';
    await page.saveTask();
    expect(service.totalTasks()).toBe(2);
    expect(page.validationMessage).toContain('fecha y hora');
    page.scheduledTime = '25:30';
    await page.saveTask();
    expect(service.totalTasks()).toBe(2);
    page.scheduledTime = '15:30';
    page.scheduledDate = '2026-02-30';
    await page.saveTask();
    expect(service.totalTasks()).toBe(2);
    page.scheduledDate = '';
    page.scheduledTime = '';
    expect(page.validationMessage).toBe('');
    await page.saveTask();
    expect(service.tasks().at(-1)?.scheduledAt).toBeUndefined();
    expect(service.totalTasks()).toBe(3);
  });

  it('loads local scheduling for editing and preserves createdAt and photo', async () => {
    const task = service.addTask('Editar', 'Detalle', 'task-photos/saved.png', new Date(2026, 10, 10, 15, 30).toISOString())!;
    snapshot.paramMap = convertToParamMap({ id: String(task.id) });
    await page.ionViewWillEnter();
    expect(page.scheduledDate).toBe('2026-11-10');
    expect(Filesystem.readFile).toHaveBeenCalledWith({ path: 'task-photos/saved.png', directory: Directory.Data });
    expect(page.photoPreviewUrl).toBe(dataUrl);
    expect(page.scheduledTime).toBe('15:30');
    page.scheduledTime = '16:45';
    await page.saveTask();
    expect(service.getTask(task.id)?.scheduledAt).toBe(new Date(2026, 10, 10, 16, 45).toISOString());
    expect(service.getTask(task.id)?.createdAt).toBe(task.createdAt);
    expect(service.getTask(task.id)?.photoPath).toBe('task-photos/saved.png');
  });

  it('edits legacy tasks without inventing a schedule', async () => {
    snapshot.paramMap = convertToParamMap({ id: '1' });
    await page.ionViewWillEnter();
    expect(page.scheduledDate).toBe('');
    expect(page.scheduledTime).toBe('');
    await page.saveTask();
    expect(service.getTask(1)?.scheduledAt).toBeUndefined();
  });

  it('keeps captured photography when saving a scheduled task', async () => {
    await page.takePhoto();
    const permanentPath = page.photoPath;
    expect(Camera.takePhoto).toHaveBeenCalledWith(expect.objectContaining({ includeMetadata: true }));
    expect(permanentPath).toMatch(/^task-photos\/[^/]+\.png$/);
    expect(permanentPath).not.toBe('blob:temporary-camera-photo');
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: permanentPath, data: base64Photo, directory: Directory.Data, recursive: true
    });
    expect(Filesystem.readFile).toHaveBeenCalledWith({ path: permanentPath, directory: Directory.Data });
    expect(page.photoPreviewUrl).toBe(dataUrl);
    expect(page.isTakingPhoto).toBe(false);
    page.scheduledDate = '2026-11-10';
    page.scheduledTime = '15:30';
    await page.saveTask();
    expect(service.tasks().at(-1)?.photoPath).toBe(permanentPath);
    expect(service.tasks().at(-1)?.scheduledAt).toBeDefined();
    expect(page.photoPath).toBe('');
    expect(page.photoPreviewUrl).toBe('');
  });

  it('persists native camera bytes and converts the saved file URI for preview', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    vi.mocked(Camera.takePhoto).mockResolvedValue({
      type: MediaType.Photo, saved: false, uri: 'file:///cache/camera.jpg', metadata: { format: 'jpeg' }
    });
    vi.spyOn(Capacitor, 'convertFileSrc').mockReturnValue('https://localhost/_capacitor_file_/data/photo.jpg');
    vi.mocked(Filesystem.getUri).mockResolvedValue({ uri: 'file:///data/photo.jpg' });
    await page.takePhoto();
    expect(page.photoPath).toMatch(/^task-photos\/[^/]+\.jpg$/);
    expect(Filesystem.readFile).toHaveBeenCalledWith({ path: 'file:///cache/camera.jpg' });
    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: page.photoPath, data: base64Photo, directory: Directory.Data, recursive: true
    });
    expect(Filesystem.getUri).toHaveBeenCalledWith({ path: page.photoPath, directory: Directory.Data });
    expect(Capacitor.convertFileSrc).toHaveBeenCalledWith('file:///data/photo.jpg');
    expect(page.photoPreviewUrl).toBe('https://localhost/_capacitor_file_/data/photo.jpg');
  });

  it('recovers a Blob preview and removes both photo fields and its temporary URL', async () => {
    const blob = new Blob(['photo bytes'], { type: 'image/png' });
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: blob });
    const task = service.addTask('Con foto', 'Detalle', 'task-photos/saved.png')!;
    snapshot.paramMap = convertToParamMap({ id: String(task.id) });
    await page.ionViewWillEnter();
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(page.photoPath).toBe('task-photos/saved.png');
    expect(page.photoPreviewUrl).toBe('blob:test-photo-preview');
    page.removePhoto();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:test-photo-preview');
    expect(page.photoPath).toBe('');
    expect(page.photoPreviewUrl).toBe('');
    expect(page.cameraMessage).toContain('eliminada');
    await page.saveTask();
    expect(service.getTask(task.id)?.photoPath).toBeUndefined();
  });

  it('reports a storage failure without replacing an existing photograph', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error('Storage unavailable'));
    page.photoPath = 'task-photos/original.png';
    page.photoPreviewUrl = dataUrl;
    await page.takePhoto();
    expect(page.isTakingPhoto).toBe(false);
    expect(page.photoPath).toBe('task-photos/original.png');
    expect(page.photoPreviewUrl).toBe(dataUrl);
    expect(page.cameraMessage).toContain('No se pudo guardar');
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });

  it('keeps legacy data URL previews without reading a persistent file', async () => {
    const task = service.addTask('Foto antigua', 'Detalle', dataUrl)!;
    snapshot.paramMap = convertToParamMap({ id: String(task.id) });
    await page.ionViewWillEnter();
    expect(page.photoPath).toBe(dataUrl);
    expect(page.photoPreviewUrl).toBe(dataUrl);
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });

  it('rejects editing another users task without loading its photograph', async () => {
    const task = service.addTask('Privada de A', 'Detalle privado', 'task-photos/private.png')!;
    context.currentUser.set(context.userB);
    TestBed.tick();
    snapshot.paramMap = convertToParamMap({ id: String(task.id) });
    await page.ionViewWillEnter();
    expect(navigateBack).toHaveBeenCalledWith('/home', { replaceUrl: true });
    expect(page.editingId).toBeNull();
    expect(page.newTitle).toBe('');
    expect(page.photoPath).toBe('');
    expect(page.photoPreviewUrl).toBe('');
    expect(Filesystem.readFile).not.toHaveBeenCalled();
  });
});

const photoBytes = 'aW1hZ2U=';
const photoPreview = `data:image/png;base64,${photoBytes}`;
const capturedPhoto = { type: MediaType.Photo, saved: false, thumbnail: photoPreview,
  webPath: 'blob:temporary-capture', metadata: { format: 'png' } };
function position(latitude = -33.45, longitude = -70.66, accuracy = 7): Position {
  return { timestamp: 1794225600000, coords: { latitude, longitude, accuracy,
    altitude: null, altitudeAccuracy: null, heading: null, speed: null,
    magneticHeading: null, trueHeading: null, headingAccuracy: null, course: null } };
}

// Native codes are documented by Capacitor 8. Web rejects with the browser's
// GeolocationPositionError codes, not the native OS-PLUG-GLOC codes.
const locationFailures = [
  { label: 'native position error', platform: 'android', error: { code: 'OS-PLUG-GLOC-0002', message: 'Error trying to obtain the location' } },
  { label: 'native permission denied', platform: 'android', error: { code: 'OS-PLUG-GLOC-0003', message: 'Location permission request was denied' } },
  { label: 'native location services disabled', platform: 'android', error: { code: 'OS-PLUG-GLOC-0007', message: 'Location services are not enabled' } },
  { label: 'native request to enable location denied', platform: 'android', error: { code: 'OS-PLUG-GLOC-0009', message: 'Request to enable location was denied' } },
  { label: 'native timeout', platform: 'android', error: { code: 'OS-PLUG-GLOC-0010', message: 'Could not obtain location in time' } },
  { label: 'web permission denied', platform: 'web', error: { code: 1, message: 'User denied Geolocation' } },
  { label: 'web position unavailable', platform: 'web', error: { code: 2, message: 'Position unavailable' } },
  { label: 'web timeout', platform: 'web', error: { code: 3, message: 'Timeout expired' } }
];

describe('TaskFormPage peripheral flows with deterministic Capacitor doubles', () => {
  let page: TaskFormPage;
  let tasks: TaskService;
  let context: ReturnType<typeof createTaskTestContext>;
  let files: Map<string, string>;
  const snapshot = { paramMap: convertToParamMap({}) };
  const navigateBack = vi.fn();

  async function configure() {
    await TestBed.configureTestingModule({ imports: [TaskFormPage], providers: [
      provideRouter([]), ...context.providers,
      { provide: ActivatedRoute, useValue: { snapshot } },
      { provide: NavController, useValue: { navigateBack } }
    ] }).compileComponents();
    tasks = TestBed.inject(TaskService);
    await tasks.ready;
    TestBed.tick();
  }

  async function enter(id?: number) {
    snapshot.paramMap = convertToParamMap(id === undefined ? {} : { id: String(id) });
    page = TestBed.createComponent(TaskFormPage).componentInstance;
    await page.ionViewWillEnter();
    if (id === undefined) { page.newTitle = 'Tarea de prueba'; page.newDescription = 'Periféricos'; }
  }

  async function persisted(id: number): Promise<Task> {
    await vi.waitFor(() => expect(JSON.parse(context.storage.get('tareafacil_tasks') ?? '[]')
      .some((task: Task) => task.id === id)).toBe(true));
    return (JSON.parse(context.storage.get('tareafacil_tasks')!) as Task[]).find(task => task.id === id)!;
  }

  async function editWithPhoto() {
    files.set('task-photos/original.png', photoBytes);
    const task = tasks.addTask('Con fotografía', 'Datos válidos', 'task-photos/original.png')!;
    await enter(task.id);
    return task;
  }

  async function editWithLocation() {
    await page.getCurrentLocation();
    await page.saveTask();
    const task = tasks.tasks().at(-1)!;
    await persisted(task.id);
    await enter(task.id);
    return task;
  }

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    files = new Map();
    vi.mocked(Camera.takePhoto).mockResolvedValue(capturedPhoto);
    vi.mocked(Filesystem.writeFile).mockImplementation(async ({ path, data, directory }) => {
      expect(directory).toBe(Directory.Data);
      if (typeof data !== 'string') throw new Error('Expected base64 bytes');
      files.set(path, data);
      return { uri: `file:///data/${path}` };
    });
    vi.mocked(Filesystem.readFile).mockImplementation(async ({ path }) => {
      const data = files.get(path);
      if (data === undefined) throw new Error('File not found');
      return { data };
    });
    vi.mocked(Filesystem.getUri).mockImplementation(async ({ path }) => ({ uri: `file:///data/${path}` }));
    vi.mocked(Geolocation.getCurrentPosition).mockResolvedValue(position());
    // The form delegates permission prompting to getCurrentPosition. In
    // particular, requestPermissions is not implemented by Capacitor on Web.
    vi.mocked(Geolocation.requestPermissions).mockRejectedValue(new Error('Not implemented on web'));
    context = createTaskTestContext();
    snapshot.paramMap = convertToParamMap({});
    await configure();
    await enter();
  });
  afterEach(() => vi.restoreAllMocks());

  describe('Camera', () => {
    it('captures with the exact current options and persists full bytes before exposing a permanent path', async () => {
      await page.takePhoto();
      expect(Camera.takePhoto).toHaveBeenCalledExactlyOnceWith({
        quality: 85, correctOrientation: true, saveToGallery: false, includeMetadata: true
      });
      expect(page.photoPath).toMatch(/^task-photos\/.+\.png$/);
      expect(Filesystem.writeFile).toHaveBeenCalledExactlyOnceWith({ path: page.photoPath,
        data: photoBytes, directory: Directory.Data, recursive: true });
      expect(files.get(page.photoPath)).toBe(photoBytes);
      expect(page.photoPreviewUrl).toBe(photoPreview);
      expect(page.cameraMessage).toBe('Fotografía guardada correctamente.');
      expect(page.isTakingPhoto).toBe(false);
    });

    it.each([
      { label: 'native cancellation', platform: 'android', error: { code: 'OS-PLUG-CAMR-0006', message: 'Photo capture canceled' } },
      { label: 'native capture error', platform: 'android', error: { code: 'OS-PLUG-CAMR-0010', message: 'Could not take photo' } },
      { label: 'native permission denied', platform: 'android', error: { code: 'OS-PLUG-CAMR-0003', message: 'Camera permission denied' } },
      { label: 'web cancellation', platform: 'web', error: new Error('User cancelled photos app') },
      { label: 'web camera permission denied', platform: 'web', error: new DOMException('Permission denied', 'NotAllowedError') }
    ])('handles $label and keeps the existing task photo and preview', async ({ platform, error }) => {
      const task = await editWithPhoto();
      vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
      vi.mocked(Camera.takePhoto).mockRejectedValueOnce(error);
      vi.mocked(Filesystem.readFile).mockClear();
      const pending = page.takePhoto();
      expect(page.isTakingPhoto).toBe(true);
      await expect(pending).resolves.toBeUndefined();
      expect(page.isTakingPhoto).toBe(false);
      expect(page.photoPath).toBe(task.photoPath);
      expect(page.photoPreviewUrl).toBe(photoPreview);
      expect(page.cameraMessage).toMatch(/No se pudo guardar|rechazado|cancelada/);
      if (platform === 'android' && 'code' in error && error.code === 'OS-PLUG-CAMR-0010') {
        expect(console.error).toHaveBeenCalledWith('No se pudo obtener o guardar la fotografía:', error);
      }
      expect(page.cameraMessage).toContain(error instanceof DOMException || ('code' in error && error.code === 'OS-PLUG-CAMR-0003')
        ? 'rechazado' : ('code' in error && error.code === 'OS-PLUG-CAMR-0010') ? 'No se pudo guardar' : 'cancelada');
      expect(Filesystem.writeFile).not.toHaveBeenCalled();
      expect(Filesystem.readFile).not.toHaveBeenCalled();
      expect(files.get(task.photoPath!)).toBe(photoBytes);
      await page.saveTask();
      expect(tasks.getTask(task.id)?.photoPath).toBe(task.photoPath);
    });

    it('keeps the loading flag true until capture settles and releases it after success', async () => {
      let finish!: (photo: Awaited<ReturnType<typeof Camera.takePhoto>>) => void;
      vi.mocked(Camera.takePhoto).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = page.takePhoto();
      expect(page.isTakingPhoto).toBe(true);
      expect(Filesystem.writeFile).not.toHaveBeenCalled();
      finish(capturedPhoto);
      await pending;
      expect(page.isTakingPhoto).toBe(false);
      expect(page.photoPreviewUrl).toBe(photoPreview);
    });

    it('associates a captured photo, reloads task metadata and recovers preview from the simulated filesystem', async () => {
      await page.takePhoto();
      const path = page.photoPath;
      await page.saveTask();
      const task = tasks.tasks().at(-1)!;
      expect((await persisted(task.id)).photoPath).toBe(path);
      TestBed.resetTestingModule();
      await configure();
      await enter(task.id);
      expect(tasks.getTask(task.id)?.photoPath).toBe(path);
      expect(page.photoPath).toBe(path);
      expect(page.photoPreviewUrl).toBe(photoPreview);
      expect(Filesystem.readFile).toHaveBeenCalledWith({ path, directory: Directory.Data });
      expect(Camera.takePhoto).toHaveBeenCalledOnce();
    });

    it('removes the association when editing and persists it without deleting the physical file', async () => {
      const task = await editWithPhoto();
      page.removePhoto();
      expect(page.photoPath).toBe('');
      expect(page.photoPreviewUrl).toBe('');
      expect(page.cameraMessage).toContain('eliminada del formulario');
      await page.saveTask();
      await vi.waitFor(() => expect((JSON.parse(context.storage.get('tareafacil_tasks')!) as Task[])
        .find(t => t.id === task.id)?.photoPath).toBeUndefined());
      expect(tasks.getTask(task.id)?.photoPath).toBeUndefined();
      expect(files.get(task.photoPath!)).toBe(photoBytes);
      expect(Filesystem.deleteFile).not.toHaveBeenCalled();
    });

    it('preserves existing bytes, path, preview and saved association when filesystem writing fails', async () => {
      const task = await editWithPhoto();
      vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(new Error('Storage full'));
      await page.takePhoto();
      expect(page.isTakingPhoto).toBe(false);
      expect(page.photoPath).toBe(task.photoPath);
      expect(page.photoPreviewUrl).toBe(photoPreview);
      expect(files).toEqual(new Map([[task.photoPath!, photoBytes]]));
      await page.saveTask();
      expect(tasks.getTask(task.id)?.photoPath).toBe(task.photoPath);
      expect(page.isTakingPhoto).toBe(false);
    });

    it('preserves the previous photo when reading the new native capture URI fails', async () => {
      const task = await editWithPhoto();
      vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
      vi.mocked(Camera.takePhoto).mockResolvedValueOnce({ type: MediaType.Photo, saved: false,
        uri: 'file:///cache/unreadable.jpg', metadata: { format: 'jpeg' } });
      await page.takePhoto();
      expect(Filesystem.readFile).toHaveBeenCalledWith({ path: 'file:///cache/unreadable.jpg' });
      expect(Filesystem.writeFile).not.toHaveBeenCalled();
      expect(page.photoPath).toBe(task.photoPath);
      expect(page.photoPreviewUrl).toBe(photoPreview);
      expect(page.isTakingPhoto).toBe(false);
      expect(page.cameraMessage).toContain('No se pudo guardar');
    });


    it('blocks saving and a second capture while the camera is busy', async () => {
      let finish!: (photo: Awaited<ReturnType<typeof Camera.takePhoto>>) => void;
      vi.mocked(Camera.takePhoto).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const add = vi.spyOn(tasks, 'addTask');
      const pending = page.takePhoto();
      await page.takePhoto(); await page.saveTask();
      expect(Camera.takePhoto).toHaveBeenCalledTimes(1);
      expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
      finish(capturedPhoto); await pending;
      await page.saveTask();
      expect(add).toHaveBeenCalledTimes(1);
      expect(tasks.tasks().at(-1)?.photoPath).toMatch(/^task-photos\//);
    });

    it('keeps the previous association until the replacement preview is ready', async () => {
      const task = await editWithPhoto();
      let finish!: (value: { data: string }) => void;
      vi.mocked(Filesystem.readFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = page.takePhoto();
      await vi.waitFor(() => expect(Filesystem.writeFile).toHaveBeenCalledTimes(1));
      expect(page.photoPath).toBe(task.photoPath);
      expect(page.photoPreviewUrl).toBe(photoPreview);
      await page.saveTask();
      finish({ data: photoBytes }); await pending;
      expect(page.photoPath).not.toBe(task.photoPath);
      const replacement = page.photoPath;
      await page.saveTask();
      expect(tasks.getTask(task.id)?.photoPath).toBe(replacement);
      expect(Filesystem.deleteFile).not.toHaveBeenCalled();
    });

    it('retains the previous photo and preview if the new preview fails', async () => {
      const task = await editWithPhoto();
      vi.mocked(Filesystem.readFile).mockRejectedValueOnce(new Error('New preview failed'));
      await page.takePhoto();
      expect(Filesystem.writeFile).toHaveBeenCalledTimes(1);
      expect(page.photoPath).toBe(task.photoPath);
      expect(page.photoPreviewUrl).toBe(photoPreview);
      expect(page.cameraMessage).toContain('No se pudo guardar');
      await page.saveTask();
      expect(tasks.getTask(task.id)?.photoPath).toBe(task.photoPath);
    });

    it.each(['leave', 'logout', 'switch', 'same-user-new-session'])('ignores a late capture after %s', async scenario => {
      const task = await editWithPhoto();
      let finish!: (photo: Awaited<ReturnType<typeof Camera.takePhoto>>) => void;
      vi.mocked(Camera.takePhoto).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = page.takePhoto();
      if (scenario === 'leave') page.ionViewWillLeave();
      else if (scenario === 'logout') context.currentUser.set(null);
      else if (scenario === 'switch') context.currentUser.set(context.userB);
      else context.currentUser.set({ ...context.userA });
      TestBed.tick(); finish(capturedPhoto); await pending;
      expect(page.photoPath).toBe(task.photoPath);
      expect(page.photoPreviewUrl).toBe(photoPreview);
      expect(Filesystem.writeFile).not.toHaveBeenCalled();
      expect(page.isTakingPhoto).toBe(false);
    });

    it('ignores a late filesystem write after leaving', async () => {
      const task = await editWithPhoto();
      let finish!: (value: { uri: string }) => void;
      vi.mocked(Filesystem.writeFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = page.takePhoto();
      await vi.waitFor(() => expect(Filesystem.writeFile).toHaveBeenCalledTimes(1));
      page.ionViewWillLeave(); finish({ uri: 'file:///new.png' }); await pending;
      expect(page.photoPath).toBe(task.photoPath);
      expect(page.photoPreviewUrl).toBe(photoPreview);
    });

    it('ignores and releases a late blob preview after leaving', async () => {
      const task = await editWithPhoto();
      let finish!: (value: { data: Blob }) => void;
      const revoke = vi.fn();
      const create = vi.fn().mockReturnValue('blob:late-preview');
      const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
      URL.createObjectURL = create; URL.revokeObjectURL = revoke;
      try {
        vi.mocked(Filesystem.readFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const pending = page.takePhoto();
        await vi.waitFor(() => expect(Filesystem.writeFile).toHaveBeenCalledTimes(1));
        page.ionViewWillLeave(); finish({ data: new Blob(['photo']) }); await pending;
        expect(page.photoPath).toBe(task.photoPath);
        expect(page.photoPreviewUrl).toBe(photoPreview);
        expect(revoke).toHaveBeenCalledWith('blob:late-preview');
      } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
    });

    it('reports preview recovery errors without erasing the existing task or its photo association', async () => {
      const task = await editWithPhoto();
      vi.mocked(Filesystem.readFile).mockRejectedValueOnce(new Error('Read failed'));
      await enter(task.id);
      expect(page.photoPreviewUrl).toBe('');
      expect(page.photoPath).toBe(task.photoPath);
      expect(page.cameraMessage).toBe('No se pudo cargar la fotografía guardada.');
      expect(tasks.getTask(task.id)).toMatchObject(task);
      expect(files.get(task.photoPath!)).toBe(photoBytes);
      expect(page.isTakingPhoto).toBe(false);
    });
  });

  describe('GPS', () => {
    it('obtains latitude, longitude and accuracy with permission granted and the exact current options', async () => {
      // A granted permission allows getCurrentPosition to resolve a Position;
      // permission states themselves are not returned by that method.
      await page.getCurrentLocation();
      expect(Geolocation.getCurrentPosition).toHaveBeenCalledExactlyOnceWith({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      expect(page.latitude).toBe(-33.45);
      expect(page.longitude).toBe(-70.66);
      expect(page.accuracy).toBe(7);
      expect(page.hasLocation).toBe(true);
      expect(page.locationRemoved).toBe(false);
      expect(page.isGettingLocation).toBe(false);
      expect(page.locationMessage).toBe('Ubicación obtenida correctamente.');
      expect(Geolocation.checkPermissions).not.toHaveBeenCalled();
      expect(Geolocation.requestPermissions).not.toHaveBeenCalled();
    });

    it('accepts zero coordinates and accuracy and associates them with a saved task', async () => {
      vi.mocked(Geolocation.getCurrentPosition).mockResolvedValue(position(0, 0, 0));
      await page.getCurrentLocation();
      expect(page.hasLocation).toBe(true);
      await page.saveTask();
      expect(tasks.tasks().at(-1)).toMatchObject({ latitude: 0, longitude: 0, accuracy: 0 });
    });

    it('keeps the location loading flag set until the real form flow finishes', async () => {
      let finish!: (value: Position) => void;
      vi.mocked(Geolocation.getCurrentPosition).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = page.getCurrentLocation();
      expect(page.isGettingLocation).toBe(true);
      expect(page.hasLocation).toBe(false);
      finish(position());
      await pending;
      expect(page.isGettingLocation).toBe(false);
      expect(page.hasLocation).toBe(true);
    });

    it.each(locationFailures)('handles $label without inventing coordinates or leaving the loading flag set', async ({ platform, error }) => {
      vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
      vi.mocked(Geolocation.getCurrentPosition).mockRejectedValueOnce(error);
      const pending = page.getCurrentLocation();
      expect(page.isGettingLocation).toBe(true);
      await expect(pending).resolves.toBe(false);
      expect(page.latitude).toBeUndefined();
      expect(page.longitude).toBeUndefined();
      expect(page.accuracy).toBeUndefined();
      expect(page.hasLocation).toBe(false);
      expect(page.isGettingLocation).toBe(false);
      expect(page.locationMessage).toMatch(/rechazado|desactivado|agot\u00f3|No se pudo/);
      expect(console.error).toHaveBeenCalledWith('No se pudo obtener la ubicación:', error);
      expect(Geolocation.requestPermissions).not.toHaveBeenCalled();
    });

    it.each(locationFailures)('preserves a valid saved location after $label', async ({ platform, error }) => {
      const task = await editWithLocation();
      vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
      vi.mocked(Geolocation.getCurrentPosition).mockRejectedValueOnce(error);
      await page.getCurrentLocation();
      expect(page.isGettingLocation).toBe(false);
      expect(page.hasLocation).toBe(true);
      expect(page.latitude).toBe(task.latitude);
      expect(page.longitude).toBe(task.longitude);
      expect(page.accuracy).toBe(task.accuracy);
      expect(page.locationRemoved).toBe(false);
      await page.saveTask();
      expect(tasks.getTask(task.id)).toMatchObject({ latitude: task.latitude, longitude: task.longitude, accuracy: task.accuracy });
    });

    it('updates an existing location and clears a previous removal after a successful new reading', async () => {
      const task = await editWithLocation();
      page.removeLocation();
      expect(page.locationRemoved).toBe(true);
      vi.mocked(Geolocation.getCurrentPosition).mockResolvedValueOnce(position(-34, -71, 3));
      await page.getCurrentLocation();
      expect(page.locationRemoved).toBe(false);
      expect(page.isGettingLocation).toBe(false);
      await page.saveTask();
      expect(tasks.getTask(task.id)).toMatchObject({ latitude: -34, longitude: -71, accuracy: 3 });
      expect(tasks.getTask(task.id)?.createdAt).toBe(task.createdAt);
    });

    it('persists a captured location and recovers it when editing after service recreation without another GPS request', async () => {
      await page.getCurrentLocation();
      await page.saveTask();
      const task = tasks.tasks().at(-1)!;
      expect(await persisted(task.id)).toMatchObject({ userId: context.userA.id, latitude: -33.45, longitude: -70.66, accuracy: 7 });
      TestBed.resetTestingModule();
      await configure();
      await enter(task.id);
      expect(page.latitude).toBe(-33.45);
      expect(page.longitude).toBe(-70.66);
      expect(page.accuracy).toBe(7);
      expect(page.hasLocation).toBe(true);
      expect(page.locationMessage).toBe('Ubicación guardada en esta tarea.');
      expect(Geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
    });

    it('uses locationRemoved to actually erase stored coordinates while preserving task identity and photo', async () => {
      const task = await editWithPhoto();
      await page.getCurrentLocation();
      await page.saveTask();
      await enter(task.id);
      expect(page.hasLocation).toBe(true);
      page.removeLocation();
      expect(page.locationRemoved).toBe(true);
      expect(page.latitude).toBeUndefined();
      expect(page.longitude).toBeUndefined();
      expect(page.accuracy).toBeUndefined();
      expect(page.hasLocation).toBe(false);
      expect(page.locationMessage).toBe('Ubicación eliminada del formulario.');
      await page.saveTask();
      await vi.waitFor(() => {
        const stored = (JSON.parse(context.storage.get('tareafacil_tasks')!) as Task[]).find(t => t.id === task.id)!;
        expect(stored).not.toHaveProperty('latitude');
        expect(stored).not.toHaveProperty('longitude');
        expect(stored).not.toHaveProperty('accuracy');
        expect(stored).toMatchObject({ id: task.id, userId: task.userId, photoPath: task.photoPath });
      });
      await enter(task.id);
      expect(page.hasLocation).toBe(false);
      expect(page.photoPath).toBe(task.photoPath);
    });

    it('does not resurrect removed coordinates if a subsequent GPS attempt fails before saving', async () => {
      const task = await editWithLocation();
      page.removeLocation();
      vi.mocked(Geolocation.getCurrentPosition).mockRejectedValueOnce({ code: 'OS-PLUG-GLOC-0003', message: 'Location permission request was denied' });
      await page.getCurrentLocation();
      expect(page.locationRemoved).toBe(true);
      expect(page.isGettingLocation).toBe(false);
      expect(page.hasLocation).toBe(false);
      await page.saveTask();
      expect(tasks.getTask(task.id)?.latitude).toBeUndefined();
      expect(tasks.getTask(task.id)?.longitude).toBeUndefined();
      expect(tasks.getTask(task.id)?.accuracy).toBeUndefined();
    });
  });
  describe('automatic GPS on creation', () => {
    it('waits for GPS, avoids double submit and preserves photo, schedule and owner', async () => {
      let finish!: (value: Position) => void;
      vi.mocked(Geolocation.getCurrentPosition).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      page.photoPath = 'task-photos/existing.png';
      page.scheduledDate = '2026-11-10'; page.scheduledTime = '15:30';
      const count = tasks.totalTasks();
      const first = page.saveTask();
      await page.saveTask();
      expect(tasks.totalTasks()).toBe(count);
      expect(Geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
      finish(position()); await first;
      expect(tasks.totalTasks()).toBe(count + 1);
      expect(tasks.tasks().at(-1)).toMatchObject({ latitude: -33.45, longitude: -70.66, accuracy: 7,
        userId: context.userA.id, photoPath: 'task-photos/existing.png',
        scheduledAt: new Date(2026, 10, 10, 15, 30).toISOString() });
    });

    it('does not request GPS for invalid input or editing', async () => {
      page.newTitle = ' '; await page.saveTask();
      expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
      const task = tasks.addTask('Existing', 'Detail', undefined, undefined, 1, 2, 3)!;
      await enter(task.id); await page.saveTask();
      expect(Geolocation.getCurrentPosition).not.toHaveBeenCalled();
      expect(tasks.getTask(task.id)).toMatchObject({ latitude: 1, longitude: 2, accuracy: 3 });
    });

    it.each(locationFailures)('offers an explicit choice after $label and saves without stale coordinates', async ({ error }) => {
      page.latitude = 1; page.longitude = 2; page.accuracy = 3;
      vi.mocked(Geolocation.getCurrentPosition).mockRejectedValueOnce(error);
      const count = tasks.totalTasks(); await page.saveTask();
      expect(tasks.totalTasks()).toBe(count);
      expect(page.awaitingLocationDecision).toBe(true);
      expect(page.isSaving).toBe(false);
      await page.saveTask(true);
      expect(tasks.totalTasks()).toBe(count + 1);
      expect(tasks.tasks().at(-1)?.latitude).toBeUndefined();
      expect(tasks.tasks().at(-1)?.longitude).toBeUndefined();
      expect(tasks.tasks().at(-1)?.accuracy).toBeUndefined();
      expect(Geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    });

    it.each([
      { code: 'OS-PLUG-GLOC-0003', text: 'rechazado' },
      { code: 'OS-PLUG-GLOC-0007', text: 'desactivado' },
      { code: 'OS-PLUG-GLOC-0010', text: 'tiempo' },
      { code: 'OS-PLUG-GLOC-0002', text: 'No se pudo' }
    ])('shows a specific creation error for $code', async ({ code, text }) => {
      vi.mocked(Geolocation.getCurrentPosition).mockRejectedValueOnce({ code });
      await page.saveTask();
      expect(page.locationMessage).toContain(text);
      expect(page.awaitingLocationDecision).toBe(true);
    });

    it('does not continue a failed creation under a different session', async () => {
      vi.mocked(Geolocation.getCurrentPosition).mockRejectedValueOnce({ code: 1 });
      await page.saveTask();
      context.currentUser.set(context.userB);
      const add = vi.spyOn(tasks, 'addTask');
      await page.saveTask(true);
      expect(add).not.toHaveBeenCalled();
    });

    it('retries after timeout and saves a fresh reading', async () => {
      vi.mocked(Geolocation.getCurrentPosition).mockRejectedValueOnce({ code: 3 });
      await page.saveTask(); expect(page.locationMessage).toContain('agotó');
      await page.saveTask();
      expect(Geolocation.getCurrentPosition).toHaveBeenCalledTimes(2);
      expect(tasks.tasks().at(-1)?.latitude).toBe(-33.45);
    });

    it('shares a pending manual GPS request instead of issuing two', async () => {
      let finish!: (value: Position) => void;
      vi.mocked(Geolocation.getCurrentPosition).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const manual = page.getCurrentLocation(); const saving = page.saveTask();
      expect(Geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
      finish(position()); await manual; await saving;
      expect(tasks.tasks().at(-1)?.latitude).toBe(-33.45);
    });

    it.each(['leave', 'logout', 'switch', 'same-user-new-session'])('ignores late GPS after %s', async scenario => {
      let finish!: (value: Position) => void;
      vi.mocked(Geolocation.getCurrentPosition).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const add = vi.spyOn(tasks, 'addTask'); const saving = page.saveTask();
      if (scenario === 'leave') page.ionViewWillLeave();
      else if (scenario === 'logout') context.currentUser.set(null);
      else if (scenario === 'switch') context.currentUser.set(context.userB);
      else context.currentUser.set({ ...context.userA });
      TestBed.tick(); finish(position()); await saving;
      expect(add).not.toHaveBeenCalled();
      expect(page.latitude).toBeUndefined();
      expect(navigateBack).not.toHaveBeenCalled();
    });
  });

});

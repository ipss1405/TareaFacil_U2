import {
  ChangeDetectorRef,
  Component,
  inject,
  viewChildren
} from '@angular/core';

import {
  FormsModule,
  NgModel
} from '@angular/forms';

import {
  ActivatedRoute
} from '@angular/router';

import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonBackButton,
  IonItem,
  IonInput,
  IonButton,
  IonIcon,
  NavController
} from '@ionic/angular';

import {
  Camera
} from '@capacitor/camera';

import {
  Geolocation
} from '@capacitor/geolocation';

import {
  Capacitor
} from '@capacitor/core';

import {
  Directory,
  Filesystem
} from '@capacitor/filesystem';

import {
  addIcons
} from 'ionicons';

import {
  addOutline,
  pencilOutline,
  checkmarkOutline,
  closeOutline,
  cameraOutline,
  locationOutline
} from 'ionicons/icons';

import {
  TaskService
} from '../task.service';

@Component({
  selector: 'app-task-form',
  templateUrl: 'task-form.page.html',
  styleUrls: ['task-form.page.scss'],
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonBackButton,
    IonItem,
    IonInput,
    IonButton,
    IonIcon
  ]
})
export class TaskFormPage {

  private readonly taskService =
    inject(TaskService);

  private readonly route =
    inject(ActivatedRoute);

  private readonly nav =
    inject(NavController);

  private readonly changeDetector =
    inject(ChangeDetectorRef);

  private readonly formControls =
    viewChildren(NgModel);

  editingId: number | null = null;

  newTitle = '';

  newDescription = '';

  scheduledDate = '';

  scheduledTime = '';

  /*
   * photoPath:
   * guarda la ruta permanente del archivo.
   *
   * Ejemplo:
   * task-photos/1762620000000-abcd1234.jpg
   */
  photoPath = '';

  /*
   * photoPreviewUrl:
   * se utiliza solamente para mostrar
   * la fotografía en pantalla.
   */
  photoPreviewUrl = '';

  cameraMessage = '';

  isTakingPhoto = false;

  latitude: number | undefined;

  longitude: number | undefined;

  accuracy: number | undefined;

  locationMessage = '';

  isGettingLocation = false;

  locationRemoved = false;

  validationAttempted = false;

  get titleMissing(): boolean {
    return (
      this.validationAttempted &&
      !this.newTitle.trim()
    );
  }

  get descriptionMissing(): boolean {
    return (
      this.validationAttempted &&
      !this.newDescription.trim()
    );
  }

  get hasLocation(): boolean {
    return (
      this.latitude !== undefined &&
      this.longitude !== undefined
    );
  }

  private get selectedSchedule():
    Date | undefined {

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        this.scheduledDate
      ) ||
      !/^\d{2}:\d{2}$/.test(
        this.scheduledTime
      )
    ) {
      return undefined;
    }

    const date =
      new Date(
        this.scheduledDate +
        'T' +
        this.scheduledTime +
        ':00'
      );

    const [year, month, day] =
      this.scheduledDate
        .split('-')
        .map(Number);

    const [hours, minutes] =
      this.scheduledTime
        .split(':')
        .map(Number);

    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day &&
      date.getHours() === hours &&
      date.getMinutes() === minutes
    )
      ? date
      : undefined;
  }

  get scheduleMessage(): string {

    if (
      !this.validationAttempted ||
      (
        !this.scheduledDate &&
        !this.scheduledTime
      )
    ) {
      return '';
    }

    if (
      !this.scheduledDate ||
      !this.scheduledTime
    ) {
      return 'Completa fecha y hora, o deja ambas vacías para guardar sin programación.';
    }

    return this.selectedSchedule
      ? ''
      : 'Selecciona una fecha y hora válidas.';
  }

  get validationMessage(): string {

    if (
      this.titleMissing &&
      this.descriptionMissing
    ) {
      return 'Completa el título y la descripción antes de guardar.';
    }

    if (this.titleMissing) {
      return 'Completa el título antes de guardar.';
    }

    if (this.descriptionMissing) {
      return 'Completa la descripción antes de guardar.';
    }

    return this.scheduleMessage;
  }

  constructor() {

    addIcons({
      addOutline,
      pencilOutline,
      checkmarkOutline,
      closeOutline,
      cameraOutline,
      locationOutline
    });

  }

  async ionViewWillEnter() {

    this.clearForm();
    await this.taskService.ready;

    const id =
      this.route.snapshot.paramMap.get('id');

    if (id !== null) {

      const task =
        this.taskService.getTask(
          Number(id)
        );

      if (!task) {

        void this.nav.navigateBack(
          '/home',
          {
            replaceUrl: true
          }
        );

        return;
      }

      this.editingId = task.id;

      this.newTitle =
        task.title;

      this.newDescription =
        task.description;

      this.photoPath =
        task.photoPath ?? '';

      /*
       * Si la tarea ya tenía fotografía,
       * recuperamos el archivo almacenado
       * y generamos una URL para mostrarlo.
       */
      if (this.photoPath) {

        try {

          this.photoPreviewUrl =
            await this.getPhotoPreviewUrl(
              this.photoPath
            );

        } catch (error) {

          console.error(
            'No se pudo cargar la fotografía guardada:',
            error
          );

          this.photoPreviewUrl = '';

          this.cameraMessage =
            'No se pudo cargar la fotografía guardada.';
        }

      }

      this.latitude =
        task.latitude;

      this.longitude =
        task.longitude;

      this.accuracy =
        task.accuracy;

      this.locationRemoved = false;

      if (this.hasLocation) {

        this.locationMessage =
          'Ubicación guardada en esta tarea.';

      }

      if (task.scheduledAt) {

        const date =
          new Date(
            task.scheduledAt
          );

        if (
          !Number.isNaN(
            date.getTime()
          )
        ) {

          const pad =
            (value: number) =>
              String(value)
                .padStart(2, '0');

          this.scheduledDate =
            `${date.getFullYear()}-${pad(
              date.getMonth() + 1
            )}-${pad(
              date.getDate()
            )}`;

          this.scheduledTime =
            `${pad(
              date.getHours()
            )}:${pad(
              date.getMinutes()
            )}`;
        }
      }
    }

    this.changeDetector.markForCheck();
  }

  async takePhoto() {

    this.cameraMessage = '';

    this.isTakingPhoto = true;

    try {

      const photo =
        await Camera.takePhoto({
          quality: 85,
          correctOrientation: true,
          saveToGallery: false,
          includeMetadata: true
        });

      /*
       * Guardamos primero el archivo
       * en almacenamiento permanente.
       */
      const savedPath =
        await this.savePhotoLocally(
          photo
        );

      this.revokePhotoPreview();

      this.photoPath =
        savedPath;

      /*
       * Obtenemos una URL adecuada
       * solamente para mostrar la imagen.
       */
      this.photoPreviewUrl =
        await this.getPhotoPreviewUrl(
          savedPath
        );

      this.cameraMessage =
        'Fotografía guardada correctamente.';

    } catch (error) {

      console.error(
        'No se pudo obtener o guardar la fotografía:',
        error
      );

      this.cameraMessage =
        'No se pudo guardar la fotografía.';

    } finally {

      this.isTakingPhoto = false;

      this.changeDetector.markForCheck();
    }

  }

  removePhoto() {

    this.revokePhotoPreview();

    this.photoPath = '';

    this.photoPreviewUrl = '';

    this.cameraMessage =
      'Fotografía eliminada del formulario.';

  }

  async getCurrentLocation() {

    this.locationMessage = '';

    this.isGettingLocation = true;

    try {

      const position =
        await Geolocation
          .getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0
          });

      this.latitude =
        position.coords.latitude;

      this.longitude =
        position.coords.longitude;

      this.accuracy =
        position.coords.accuracy;

      this.locationRemoved = false;

      this.locationMessage =
        'Ubicación obtenida correctamente.';

    } catch (error) {

      console.error(
        'No se pudo obtener la ubicación:',
        error
      );

      this.locationMessage =
        'No se pudo obtener la ubicación. Revisa los permisos de localización.';

    } finally {

      this.isGettingLocation = false;

      this.changeDetector
        .markForCheck();
    }

  }

  removeLocation() {

    this.latitude = undefined;

    this.longitude = undefined;

    this.accuracy = undefined;

    this.locationRemoved = true;

    this.locationMessage =
      'Ubicación eliminada del formulario.';

  }

  saveTask() {

    this.validationAttempted = true;

    this.formControls()
      .forEach(
        field =>
          field.control
            .markAsTouched()
      );

    if (
      !this.newTitle.trim() ||
      !this.newDescription.trim() ||
      !!this.scheduleMessage
    ) {
      return;
    }

    const scheduledAt =
      this.selectedSchedule
        ?.toISOString() ?? '';

    const saved =
      this.editingId === null

        ? this.taskService.addTask(
            this.newTitle,
            this.newDescription,
            this.photoPath,
            scheduledAt,
            this.latitude,
            this.longitude,
            this.accuracy
          )

        : this.taskService.updateTask(
            this.editingId,
            this.newTitle,
            this.newDescription,
            this.photoPath,
            scheduledAt,
            this.latitude,
            this.longitude,
            this.accuracy,
            this.locationRemoved
          );

    if (saved) {

      this.clearForm();

      void this.nav.navigateBack(
        '/home',
        {
          replaceUrl: true
        }
      );

    }

  }

  cancelEdit() {

    this.clearForm();

    void this.nav.navigateBack(
      '/home',
      {
        replaceUrl: true
      }
    );

  }

  /*
   * Guarda físicamente la fotografía.
   *
   * WEB:
   * Camera.thumbnail contiene la imagen
   * completa codificada en Base64.
   *
   * ANDROID / iOS:
   * Camera.uri apunta al archivo temporal
   * que podemos leer con Filesystem.
   */
  private async savePhotoLocally(
    photo:
      Awaited<
        ReturnType<
          typeof Camera.takePhoto
        >
      >
  ): Promise<string> {

    const format =
      photo.metadata?.format
        ?.toLowerCase() ?? 'jpeg';

    const extension =
      format === 'png'
        ? 'png'
        : format === 'gif'
          ? 'gif'
          : 'jpg';

    const randomPart =
      Math.random()
        .toString(36)
        .slice(2, 10);

    const path =
      `task-photos/${Date.now()}-${randomPart}.${extension}`;

    let base64Data: string;

    /*
     * En navegador no existe photo.uri.
     * Capacitor 8 entrega la imagen
     * completa en photo.thumbnail.
     */
    if (
      Capacitor.getPlatform() === 'web'
    ) {

      if (!photo.thumbnail) {
        throw new Error(
          'La cámara web no entregó los datos de la fotografía.'
        );
      }

      base64Data =
        this.removeDataUrlPrefix(
          photo.thumbnail
        );

    } else {

      /*
       * En Android/iOS leemos
       * el archivo temporal entregado
       * por Camera.
       */
      if (!photo.uri) {
        throw new Error(
          'La cámara no entregó una URI válida.'
        );
      }

      const originalPhoto =
        await Filesystem.readFile({
          path: photo.uri
        });

      if (
        typeof originalPhoto.data !==
        'string'
      ) {
        throw new Error(
          'No se pudo leer la fotografía como Base64.'
        );
      }

      base64Data =
        originalPhoto.data;
    }

    /*
     * Sin "encoding", Filesystem
     * interpreta el string como Base64
     * y guarda el archivo binario.
     */
    await Filesystem.writeFile({
      path,
      data: base64Data,
      directory: Directory.Data,
      recursive: true
    });

    return path;
  }

  /*
   * Convierte la ruta almacenada
   * en algo que <img> pueda mostrar.
   */
  private async getPhotoPreviewUrl(
    path: string
  ): Promise<string> {

    if (!path) {
      return '';
    }

    /*
     * Compatibilidad temporal con
     * fotografías antiguas que todavía
     * pudieran tener blob:, data: o http.
     */
    if (
      path.startsWith('data:') ||
      path.startsWith('blob:') ||
      path.startsWith('http://') ||
      path.startsWith('https://')
    ) {
      return path;
    }

    if (
      path.startsWith('file://')
    ) {
      return Capacitor.convertFileSrc(
        path
      );
    }

    /*
     * En navegador leemos la fotografía
     * de Filesystem y construimos una
     * URL mostrable.
     */
    if (
      Capacitor.getPlatform() === 'web'
    ) {

      const file =
        await Filesystem.readFile({
          path,
          directory: Directory.Data
        });

      if (
        file.data instanceof Blob
      ) {
        return URL.createObjectURL(
          file.data
        );
      }

      return (
        `data:${this.getPhotoMimeType(path)};base64,` +
        file.data
      );
    }

    /*
     * Android / iOS:
     * obtenemos la URI física y la
     * convertimos a una ruta que el
     * WebView de Capacitor puede leer.
     */
    const {
      uri
    } = await Filesystem.getUri({
      path,
      directory: Directory.Data
    });

    return Capacitor.convertFileSrc(
      uri
    );
  }

  private removeDataUrlPrefix(
    value: string
  ): string {

    const marker = 'base64,';

    const markerPosition =
      value.indexOf(marker);

    return markerPosition >= 0
      ? value.substring(
          markerPosition +
          marker.length
        )
      : value;
  }

  private getPhotoMimeType(
    path: string
  ): string {

    const lowerPath =
      path.toLowerCase();

    if (
      lowerPath.endsWith('.png')
    ) {
      return 'image/png';
    }

    if (
      lowerPath.endsWith('.gif')
    ) {
      return 'image/gif';
    }

    return 'image/jpeg';
  }

  private revokePhotoPreview() {

    if (
      this.photoPreviewUrl
        .startsWith('blob:')
    ) {
      URL.revokeObjectURL(
        this.photoPreviewUrl
      );
    }

  }

  private clearForm() {

    this.revokePhotoPreview();

    this.validationAttempted =
      false;

    this.formControls()
      .forEach(
        field =>
          field.control
            .markAsUntouched()
      );

    this.newTitle = '';

    this.newDescription = '';

    this.photoPath = '';

    this.photoPreviewUrl = '';

    this.scheduledDate = '';

    this.scheduledTime = '';

    this.cameraMessage = '';

    this.isTakingPhoto = false;

    this.latitude = undefined;

    this.longitude = undefined;

    this.accuracy = undefined;

    this.locationMessage = '';

    this.isGettingLocation = false;

    this.locationRemoved = false;

    this.editingId = null;
  }

}
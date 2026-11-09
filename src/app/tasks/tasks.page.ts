import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AlertController,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButtons,
  IonButton,
  IonIcon,
  IonList,
  IonItem,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonLabel
} from '@ionic/angular';

import { addIcons } from 'ionicons';

import {
  addOutline,
  checkmarkCircleOutline,
  ellipseOutline,
  pencilOutline,
  trashOutline,
  arrowBackOutline,
  arrowForwardOutline,
  layersOutline
} from 'ionicons/icons';

import { TaskService } from '../task.service';
import { Task } from '../task.model';

@Component({
  selector: 'app-tasks',
  templateUrl: 'tasks.page.html',
  styleUrls: ['tasks.page.scss'],
  imports: [
    FormsModule,
    RouterLink,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonButton,
    IonIcon,
    IonList,
    IonItem,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
    IonLabel
  ]
})
export class TasksPage {

  readonly taskService = inject(TaskService);

  private readonly changeDetector = inject(ChangeDetectorRef);

  private readonly alertController = inject(AlertController);

  searchQuery = '';

  statusFilter: 'all' | 'pending' | 'completed' = 'all';

  selectedDate = this.dateKey(new Date());

  weekStart = this.startOfWeek(new Date());

  currentPage = 1;

  readonly tasksPerPage = 5;

  private lastTaskCount = this.taskService.totalTasks();

  constructor() {
    addIcons({
      addOutline,
      checkmarkCircleOutline,
      ellipseOutline,
      pencilOutline,
      trashOutline,
      arrowBackOutline,
      arrowForwardOutline,
      layersOutline
    });
  }

  ionViewWillEnter() {
    if (this.taskService.totalTasks() > this.lastTaskCount) {
      const newest = this.tasks.reduce((latest, task) => task.id > latest.id ? task : latest);
      const index = this.filteredTasks.findIndex(task => task.id === newest.id);
      this.currentPage = index < 0 ? 1 : Math.floor(index / this.tasksPerPage) + 1;
    }

    this.resetInvalidPage();

    this.lastTaskCount = this.taskService.totalTasks();

    this.changeDetector.markForCheck();
  }

  ionViewWillLeave() {
    this.lastTaskCount = this.taskService.totalTasks();
  }

  get tasks(): readonly Task[] {
    return this.taskService.tasks();
  }

  get filteredTasks(): Task[] {
    const query = (this.searchQuery ?? '')
      .trim()
      .toLocaleLowerCase();

    return this.tasks.filter(task => {

      const matchesStatus =
        this.statusFilter === 'all' ||
        (this.statusFilter === 'pending' && task.completed === false) ||
        (this.statusFilter === 'completed' && task.completed === true);

      return (
        matchesStatus &&
        (!task.scheduledAt || this.scheduledDay(task.scheduledAt) === this.selectedDate) &&
        (
          task.title
            .toLocaleLowerCase()
            .includes(query) ||

          task.description
            .toLocaleLowerCase()
            .includes(query)
        )
      );
    }).sort((a, b) => {
      const first = this.scheduleTimestamp(a.scheduledAt);
      const second = this.scheduleTimestamp(b.scheduledAt);
      return first === second ? 0 : first < second ? -1 : 1;
    });
  }

  private dateKey(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  private startOfWeek(date: Date): Date {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    return monday;
  }

  private scheduledDay(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : this.dateKey(date);
  }

  get weekDays() {
    const labels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    return labels.map((label, index) => {
      const date = new Date(this.weekStart);
      date.setDate(date.getDate() + index);
      return { key: this.dateKey(date), label, number: String(date.getDate()).padStart(2, '0'),
        accessibleLabel: date.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
    });
  }

  get selectedDayLabel(): string {
    return new Date(this.selectedDate + 'T12:00:00').toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  get weekLabel(): string {
    const end = new Date(this.weekStart);
    end.setDate(end.getDate() + 6);
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    return this.weekStart.toLocaleDateString('es-CL', options) + ' – ' + end.toLocaleDateString('es-CL', options);
  }

  selectDay(key: string) {
    this.selectedDate = key;
    this.currentPage = 1;
  }

  changeWeek(direction: number) {
    const date = new Date(this.selectedDate + 'T12:00:00');
    date.setDate(date.getDate() + direction * 7);
    this.weekStart = this.startOfWeek(date);
    this.selectDay(this.dateKey(date));
  }

  showCurrentWeek() {
    const today = new Date();
    this.weekStart = this.startOfWeek(today);
    this.selectDay(this.dateKey(today));
  }

  get taskGroups() {
    const tasks = this.paginatedTasks;
    return [
      { key: 'scheduled', label: 'Tareas del día', tasks: tasks.filter(task => !!task.scheduledAt) },
      { key: 'unscheduled', label: 'Sin programar', tasks: tasks.filter(task => !task.scheduledAt) }
    ];
  }

  get hasScheduledResults(): boolean {
    return this.filteredTasks.some(task => !!task.scheduledAt);
  }

  taskNumber(task: Task): number {
    return this.filteredTasks.findIndex(item => item.id === task.id) + 1;
  }

  formatScheduledTime(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  private scheduleTimestamp(value?: string): number {
    const timestamp = value ? Date.parse(value) : NaN;
    return Number.isNaN(timestamp) ? Infinity : timestamp;
  }

  formatScheduledAt(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  get totalPages(): number {
    return Math.max(
      1,
      Math.ceil(
        this.filteredTasks.length / this.tasksPerPage
      )
    );
  }

  get paginatedTasks(): Task[] {
    const start =
      (this.currentPage - 1) * this.tasksPerPage;

    return this.filteredTasks.slice(
      start,
      start + this.tasksPerPage
    );
  }

  resetInvalidPage() {
    if (this.currentPage > this.totalPages) {
      this.currentPage = 1;
    }
  }

  toggleTask(task: Task) {
    this.taskService.toggleTask(task.id);

    this.resetInvalidPage();
  }

  async confirmDeleteTask(task: Task) {

    const alert = await this.alertController.create({

      header: '¿Eliminar tarea?',

      subHeader: task.title,

      message:
        'La tarea se eliminará de la lista. Esta acción no se puede deshacer.',

      cssClass: 'task-delete-alert',

      buttons: [

        {
          text: 'Cancelar',
          role: 'cancel',
          cssClass: 'cancel-delete'
        },

        {
          text: 'Eliminar',
          role: 'destructive',
          cssClass: 'confirm-delete',

          handler: () =>
            this.deleteTask(task.id)
        }

      ]

    });

    await alert.present();

    alert
      .querySelector<HTMLButtonElement>(
        '.cancel-delete'
      )
      ?.focus();
  }

  deleteTask(id: number) {

    this.taskService.deleteTask(id);

    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }

    this.lastTaskCount =
      this.taskService.totalTasks();
  }

  formatCreatedAt(createdAt: string): string {

    const date = new Date(createdAt);

    if (Number.isNaN(date.getTime())) {
      return 'Fecha no disponible';
    }

    return date.toLocaleDateString(
      'es-CL',
      {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }
    );
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }
}
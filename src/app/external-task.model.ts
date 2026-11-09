export interface ExternalTask {
  id: number;
  userId: number;
  title: string;
  completed: boolean;
}

export function isExternalTask(value: unknown): value is ExternalTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<ExternalTask>;
  return Number.isSafeInteger(task.id) && task.id! > 0 &&
    Number.isSafeInteger(task.userId) && task.userId! > 0 &&
    typeof task.title === 'string' && task.title.trim().length > 0 &&
    typeof task.completed === 'boolean';
}

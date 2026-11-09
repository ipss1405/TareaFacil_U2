export interface Task {
  id: number;
  userId: string;
  remoteId?: string;
  syncStatus?: 'pending' | 'synced';
  updatedAt?: string;
  lastSyncedAt?: string;
  deletedAt?: string;
  remoteRevision?: number;
  localRevision?: number;
  originDeviceId?: string;
  externalSource?: 'jsonplaceholder';
  externalId?: number;
  title: string;
  description: string;
  completed: boolean;
  createdAt?: string;
  scheduledAt?: string;
  photoPath?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

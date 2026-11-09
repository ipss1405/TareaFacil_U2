export interface User {
  id: string;
  remoteUserId?: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

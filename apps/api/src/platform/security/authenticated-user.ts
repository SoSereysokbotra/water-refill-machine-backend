export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'operator' | 'viewer';
  enabled: boolean;
}

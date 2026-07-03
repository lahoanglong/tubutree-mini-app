import { api } from './api';

export type StaffRole = 'STAFF' | 'ADMIN';

export interface StaffMember {
  id: string;
  phone: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: StaffRole;
  createdAt: string;
}
export interface PendingInvite {
  phone: string;
  role: StaffRole;
  createdAt: string;
}
export interface StaffListResponse {
  members: StaffMember[];
  pendingInvites: PendingInvite[];
}

export const listStaff = () => api.get<StaffListResponse>('/admin/staff').then((r) => r.data);

export const grantStaff = (phone: string, role: StaffRole) =>
  api
    .post<{ granted: StaffRole; applied: boolean }>('/admin/staff/grant', { phone, role })
    .then((r) => r.data);

export const revokeStaff = (phone: string) =>
  api
    .post<{ revoked: number; downgraded: boolean }>('/admin/staff/revoke', { phone })
    .then((r) => r.data);

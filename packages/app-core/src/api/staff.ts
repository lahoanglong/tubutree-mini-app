import type { HttpClient } from '../http';

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

export const listStaff = (http: HttpClient) => http.get<StaffListResponse>('/admin/staff');

export const grantStaff = (http: HttpClient, phone: string, role: StaffRole) =>
    http.post<{ granted: StaffRole; applied: boolean }>('/admin/staff/grant', { phone, role });

export const revokeStaff = (http: HttpClient, phone: string) =>
    http.post<{ revoked: number; downgraded: boolean; storeBlocked?: boolean }>('/admin/staff/revoke', { phone });

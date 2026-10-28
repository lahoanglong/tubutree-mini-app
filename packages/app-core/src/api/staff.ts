import type { HttpClient } from '../http';

export type StaffRole = 'STAFF' | 'ADMIN';

export interface StaffMember {
  id: string;
  phone: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: StaffRole;
  /** Nhóm việc (chỉ có nghĩa với STAFF): CSKH, KHO, MARKETING, KE_TOAN. */
  staffPermissions: string[];
  createdAt: string;
}
export interface PendingInvite {
  phone: string;
  role: StaffRole;
  /** Nhóm việc đã chọn cho lời mời (chỉ có nghĩa với STAFF), áp khi họ mở app lần đầu. */
  staffPermissions?: string[];
  createdAt: string;
}
export interface StaffListResponse {
  members: StaffMember[];
  pendingInvites: PendingInvite[];
}

export const listStaff = (http: HttpClient) => http.get<StaffListResponse>('/admin/staff');

/** `permissions` chỉ gửi khi có (cấp STAFF): không gửi = không đổi nhóm việc đã lưu. */
export const grantStaff = (http: HttpClient, phone: string, role: StaffRole, permissions?: string[]) =>
    http.post<{ granted: StaffRole; applied: boolean }>('/admin/staff/grant', { phone, role, ...(permissions ? { permissions } : {}) });

export const revokeStaff = (http: HttpClient, phone: string) =>
    http.post<{ revoked: number; downgraded: boolean; storeBlocked?: boolean }>('/admin/staff/revoke', { phone });

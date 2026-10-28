import { api } from './api';

export type StaffRole = 'STAFF' | 'ADMIN';

/** Nhóm việc của nhân viên (chỉ có nghĩa với STAFF), theo thứ tự máy chủ lưu. Tên ngắn trùng web admin. */
export const STAFF_PERMISSION_LABELS = {
  CSKH: 'Chăm sóc khách',
  KHO: 'Kho',
  MARKETING: 'Nội dung và khuyến mãi',
  KE_TOAN: 'Kế toán',
} as const;
export type StaffPermission = keyof typeof STAFF_PERMISSION_LABELS;
export const STAFF_PERMISSIONS = Object.keys(STAFF_PERMISSION_LABELS) as StaffPermission[];

export interface StaffMember {
  id: string;
  phone: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: StaffRole;
  staffPermissions: string[];
  createdAt: string;
}
export interface PendingInvite {
  phone: string;
  role: StaffRole;
  staffPermissions?: string[];
  createdAt: string;
}
export interface StaffListResponse {
  members: StaffMember[];
  pendingInvites: PendingInvite[];
}

export const listStaff = () => api.get<StaffListResponse>('/admin/staff').then((r) => r.data);

/** `permissions` chỉ gửi khi có (cấp STAFF): không gửi = không đổi nhóm việc đã lưu. */
export const grantStaff = (phone: string, role: StaffRole, permissions?: StaffPermission[]) =>
  api
    .post<{ granted: StaffRole; applied: boolean }>('/admin/staff/grant', { phone, role, ...(permissions ? { permissions } : {}) })
    .then((r) => r.data);

export const revokeStaff = (phone: string) =>
  api
    .post<{ revoked: number; downgraded: boolean; storeBlocked?: boolean }>('/admin/staff/revoke', { phone })
    .then((r) => r.data);

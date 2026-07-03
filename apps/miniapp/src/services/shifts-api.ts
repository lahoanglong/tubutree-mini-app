import { api } from './api';

export type ShiftStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface ShiftTemplate {
  id: string;
  name: string;
  startMin: number;
  endMin: number;
  active: boolean;
  sortOrder: number;
}

export interface Shift {
  id: string;
  staffId: string;
  workDate: string;
  startAt: string;
  endAt: string;
  templateId: string | null;
  status: ShiftStatus;
  approvedStart: string | null;
  approvedEnd: string | null;
  rejectReason: string | null;
  cancelReason: string | null;
  isEmergency: boolean;
  evidenceUrl: string | null;
  cancelPenalty: boolean;
}

export interface AdminShift extends Shift {
  staff: { id: string; fullName: string | null; phone: string | null; avatarUrl: string | null };
}

export interface ShiftItemInput {
  workDate: string; // 'YYYY-MM-DD'
  startAt: string; // ISO
  endAt: string; // ISO
  templateId?: string;
}

// ── Self (nhân viên) ──
export const getShiftTemplates = () =>
  api.get<ShiftTemplate[]>('/staff/shift-templates').then((r) => r.data);

export const getShifts = (fromISO: string, toISO: string) =>
  api.get<Shift[]>('/staff/shifts', { params: { from: fromISO, to: toISO } }).then((r) => r.data);

export const createShifts = (items: ShiftItemInput[]) =>
  api.post<{ created: number }>('/staff/shifts', { items }).then((r) => r.data);

export const updateShift = (id: string, patch: { startAt?: string; endAt?: string }) =>
  api.patch<Shift>(`/staff/shifts/${id}`, patch).then((r) => r.data);

export const deleteShift = (id: string) =>
  api.delete<{ deleted: boolean }>(`/staff/shifts/${id}`).then((r) => r.data);

export const copyWeek = (sourceWeekStart: string, targetWeekStart: string) =>
  api
    .post<{ created: number; skipped: number }>('/staff/shifts/copy-week', {
      sourceWeekStart,
      targetWeekStart,
    })
    .then((r) => r.data);

export const cancelShift = (
  id: string,
  body: { reason: string; isEmergency?: boolean; evidenceUrl?: string },
) => api.post<{ cancelled: boolean; penalty: boolean }>(`/staff/shifts/${id}/cancel`, body).then((r) => r.data);

// ── Admin ──
export const adminGetShifts = (fromISO: string, toISO: string, staffId?: string) =>
  api
    .get<AdminShift[]>('/admin/shifts', { params: { from: fromISO, to: toISO, staffId } })
    .then((r) => r.data);

export const approveShift = (id: string, times?: { approvedStart?: string; approvedEnd?: string }) =>
  api.post<{ approved: boolean }>(`/admin/shifts/${id}/approve`, times ?? {}).then((r) => r.data);

export const rejectShift = (id: string, reason: string) =>
  api.post<{ rejected: boolean }>(`/admin/shifts/${id}/reject`, { reason }).then((r) => r.data);

export const bulkApproveShifts = (ids: string[]) =>
  api.post<{ approved: number }>('/admin/shifts/bulk-approve', { ids }).then((r) => r.data);

export const adminGetTemplates = () =>
  api.get<ShiftTemplate[]>('/admin/shift-templates').then((r) => r.data);

export const createTemplate = (data: { name: string; startMin: number; endMin: number; sortOrder?: number }) =>
  api.post<ShiftTemplate>('/admin/shift-templates', data).then((r) => r.data);

export const updateTemplate = (
  id: string,
  data: { name?: string; startMin?: number; endMin?: number; active?: boolean; sortOrder?: number },
) => api.patch<{ updated: boolean }>(`/admin/shift-templates/${id}`, data).then((r) => r.data);

export const deleteTemplate = (id: string) =>
  api.delete<{ deleted: boolean }>(`/admin/shift-templates/${id}`).then((r) => r.data);

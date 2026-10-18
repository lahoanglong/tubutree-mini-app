import type { HttpClient } from '../http';

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
export const getShiftTemplates = (http: HttpClient) =>
  http.get<ShiftTemplate[]>('/staff/shift-templates');

export const getShifts = (http: HttpClient, fromISO: string, toISO: string) =>
  http.get<Shift[]>('/staff/shifts', { query: { from: fromISO, to: toISO } });

export const createShifts = (http: HttpClient, items: ShiftItemInput[]) =>
  http.post<{ created: number }>('/staff/shifts', { items });

export const updateShift = (http: HttpClient, id: string, patch: { startAt?: string; endAt?: string }) =>
  http.patch<Shift>(`/staff/shifts/${id}`, patch);

export const deleteShift = (http: HttpClient, id: string) =>
  http.delete<{ deleted: boolean }>(`/staff/shifts/${id}`);

export const copyWeek = (http: HttpClient, sourceWeekStart: string, targetWeekStart: string) =>
    http.post<{ created: number; skipped: number }>('/staff/shifts/copy-week', {
      sourceWeekStart,
      targetWeekStart,
    });

export const cancelShift = (
  http: HttpClient,
  id: string,
  body: { reason: string; isEmergency?: boolean; evidenceUrl?: string },
) => http.post<{ cancelled: boolean; penalty: boolean }>(`/staff/shifts/${id}/cancel`, body);

// ── Admin ──
export const adminGetShifts = (http: HttpClient, fromISO: string, toISO: string, staffId?: string) =>
    http.get<AdminShift[]>('/admin/shifts', { query: { from: fromISO, to: toISO, staffId } });

export const approveShift = (http: HttpClient, id: string, times?: { approvedStart?: string; approvedEnd?: string }) =>
  http.post<{ approved: boolean }>(`/admin/shifts/${id}/approve`, times ?? {});

export const rejectShift = (http: HttpClient, id: string, reason: string) =>
  http.post<{ rejected: boolean }>(`/admin/shifts/${id}/reject`, { reason });

export const bulkApproveShifts = (http: HttpClient, ids: string[]) =>
  http.post<{ approved: number }>('/admin/shifts/bulk-approve', { ids });

export const adminGetTemplates = (http: HttpClient) =>
  http.get<ShiftTemplate[]>('/admin/shift-templates');

export const createTemplate = (http: HttpClient, data: { name: string; startMin: number; endMin: number; sortOrder?: number }) =>
  http.post<ShiftTemplate>('/admin/shift-templates', data);

export const deleteTemplate = (http: HttpClient, id: string) =>
  http.delete<{ deleted: boolean }>(`/admin/shift-templates/${id}`);

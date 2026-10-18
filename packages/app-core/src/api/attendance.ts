import type { HttpClient } from '../http';
import type { Shift } from './shifts';

export interface OpenSession {
  id: string;
  shiftId: string;
  staffId: string;
  checkinAt: string;
  checkoutAt: string | null;
  isLate: boolean;
  lastHeartbeatAt: string;
}

export interface AttendanceStatus {
  shifts: Shift[];
  openSession: OpenSession | null;
}

export interface LocationPayload {
  lat?: number;
  lng?: number;
  locationToken?: string;
  zaloAccessToken?: string;
}

export const getAttendanceStatus = (http: HttpClient) =>
  http.get<AttendanceStatus>('/staff/attendance/status');

export const checkin = (http: HttpClient, payload: LocationPayload & { shiftId: string }) =>
  http.post<{ sessionId: string; isLate: boolean }>('/staff/attendance/checkin', payload);

export const checkout = (http: HttpClient, at?: string) =>
  http.post<{ checkedOut: boolean }>('/staff/attendance/checkout', at ? { at } : {});

export const heartbeat = (http: HttpClient, payload: LocationPayload) =>
  http.post<{ open: boolean; closed?: boolean; reason?: string }>('/staff/attendance/heartbeat', payload);

export interface SessionHistory {
  id: string;
  shiftId: string;
  checkinAt: string;
  checkoutAt: string | null;
  isLate: boolean;
  closeReason: string | null;
}

export const getHistory = (http: HttpClient, fromISO: string, toISO: string) =>
  http.get<SessionHistory[]>('/staff/attendance/history', { query: { from: fromISO, to: toISO } });

// ── Admin sửa/thêm phiên ──
export const adminEditSession = (http: HttpClient, id: string, patch: { checkinAt?: string; checkoutAt?: string }) =>
  http.post<{ updated: boolean }>(`/admin/attendance/session/${id}/edit`, patch);

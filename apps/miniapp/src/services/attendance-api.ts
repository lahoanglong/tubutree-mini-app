import { api } from './api';
import { requestZaloLocation, getZaloAccessToken } from './zmp-bridge';
import type { Shift } from './shifts-api';

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

/**
 * Lấy dữ liệu vị trí để gửi backend: ưu tiên token Zalo getLocation (chính thống),
 * fallback navigator.geolocation (dev / một số webview). Rỗng nếu không lấy được.
 */
export async function acquireLocationPayload(): Promise<LocationPayload> {
  try {
    const loc = await requestZaloLocation();
    if (loc?.token) {
      const { accessToken } = await getZaloAccessToken();
      if (accessToken) return { locationToken: loc.token, zaloAccessToken: accessToken };
    }
  } catch {
    /* rơi xuống fallback */
  }
  try {
    const pos = await new Promise<GeolocationPosition>((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, enableHighAccuracy: true }),
    );
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return {};
  }
}

export const getAttendanceStatus = () =>
  api.get<AttendanceStatus>('/staff/attendance/status').then((r) => r.data);

export const checkin = (payload: LocationPayload & { shiftId: string }) =>
  api.post<{ sessionId: string; isLate: boolean }>('/staff/attendance/checkin', payload).then((r) => r.data);

export const checkout = (at?: string) =>
  api.post<{ checkedOut: boolean }>('/staff/attendance/checkout', at ? { at } : {}).then((r) => r.data);

export const heartbeat = (payload: LocationPayload) =>
  api
    .post<{ open: boolean; closed?: boolean; reason?: string }>('/staff/attendance/heartbeat', payload)
    .then((r) => r.data);

export interface SessionHistory {
  id: string;
  shiftId: string;
  checkinAt: string;
  checkoutAt: string | null;
  isLate: boolean;
  closeReason: string | null;
}

export const getHistory = (fromISO: string, toISO: string) =>
  api.get<SessionHistory[]>('/staff/attendance/history', { params: { from: fromISO, to: toISO } }).then((r) => r.data);

// ── Admin sửa/thêm phiên ──
export const adminEditSession = (id: string, patch: { checkinAt?: string; checkoutAt?: string }) =>
  api.post<{ updated: boolean }>(`/admin/attendance/session/${id}/edit`, patch).then((r) => r.data);

export const adminAddSession = (body: { shiftId: string; checkinAt: string; checkoutAt: string }) =>
  api.post<{ added: boolean }>('/admin/attendance/session', body).then((r) => r.data);

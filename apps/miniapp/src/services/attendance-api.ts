import { api } from './api';
import { requestZaloLocationStrict, getZaloAccessToken } from './zmp-bridge';
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

const LOCATION_FAIL_PREFIX = 'Không lấy được vị trí';
const LOCATION_FAIL_MSG = {
  denied: `${LOCATION_FAIL_PREFIX}: bạn chưa cấp quyền vị trí cho Zalo. Hãy bật quyền vị trí trong phần cài đặt rồi thử lại.`,
  timeout: `${LOCATION_FAIL_PREFIX}: hết thời gian chờ tín hiệu GPS. Hãy ra nơi thoáng hoặc bật GPS rồi thử lại.`,
  unavailable: `${LOCATION_FAIL_PREFIX}: thiết bị chưa xác định được vị trí. Hãy bật GPS/dịch vụ vị trí rồi thử lại.`,
} as const;

function locationFailureMessage(geoError: unknown, zaloError: unknown): string {
  // GeolocationPositionError.code: 1 PERMISSION_DENIED (cả khi origin không an toàn), 2 POSITION_UNAVAILABLE, 3 TIMEOUT
  const code = (geoError as { code?: number } | undefined)?.code;
  if (code === 1) return LOCATION_FAIL_MSG.denied;
  if (code === 3) return LOCATION_FAIL_MSG.timeout;
  if (code === 2) return LOCATION_FAIL_MSG.unavailable;
  // Không có geolocation (webview Zalo): chỉ còn lỗi của Zalo SDK để suy ra lý do.
  const zaloText = `${(zaloError as { message?: string } | undefined)?.message ?? ''}`;
  if (/denied|permission|reject|từ chối|quyền/i.test(zaloText)) return LOCATION_FAIL_MSG.denied;
  return LOCATION_FAIL_MSG.unavailable;
}

/**
 * Lấy dữ liệu vị trí để gửi backend: ưu tiên token Zalo getLocation (chính thống),
 * fallback navigator.geolocation (dev / một số webview). Rỗng nếu không lấy được —
 * backend vẫn là nơi quyết định; `onFailure` nhận đúng một thông báo lý do khi cả hai đều hỏng.
 */
export async function acquireLocationPayload(onFailure?: (message: string) => void): Promise<LocationPayload> {
  let zaloError: unknown;
  try {
    const loc = await requestZaloLocationStrict();
    if (loc?.token) {
      const { accessToken } = await getZaloAccessToken();
      if (accessToken) return { locationToken: loc.token, zaloAccessToken: accessToken };
    }
  } catch (e) {
    zaloError = e;
  }
  let geoError: unknown;
  try {
    const pos = await new Promise<GeolocationPosition>((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, enableHighAccuracy: true }),
    );
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (e) {
    geoError = e;
  }
  onFailure?.(locationFailureMessage(geoError, zaloError));
  return {};
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

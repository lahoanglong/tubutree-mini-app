import type { HttpClient } from '../http';

export type RefillStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface RefillHistoryItem {
  id: string;
  quantity: number;
  seedsAwarded: number;
  status: RefillStatus;
  createdAt: string;
  /** Có khi nhân viên ghi nhận ít vỏ hơn khách khai: số khách khai ban đầu (`quantity` lúc này là số thực nhận). */
  declaredQuantity?: number | null;
  rejectionReason?: string | null;
  /** Điểm khách đã chọn lúc gửi; null/thiếu ở yêu cầu cũ. Các trường sau tên chỉ có ở API mới (kể cả điểm admin đã tắt). */
  pickupLocation?: RefillHistoryLocation | null;
}

/** Điểm gắn với một yêu cầu trong lịch sử. `isActive=false`: admin đã tắt điểm sau khi khách gửi (không còn trong danh sách chọn). */
export interface RefillHistoryLocation {
  id: string;
  name: string;
  address?: string | null;
  hours?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

/** Điểm nhận vỏ do admin điền ở Cấu hình hệ thống; trường nào trống thì null. */
export interface RefillPickupPoint {
  address: string | null;
  hours: string | null;
  phone: string | null;
}

/** Một điểm nhận vỏ đang mở do admin quản lý (theo thứ tự hiển thị). */
export interface RefillLocation {
  id: string;
  name: string;
  address: string;
  hours: string | null;
  phone: string | null;
}

export interface RefillSummary {
  /** Optional: API cũ chưa trả. Dạng một điểm (= điểm đầu tiên của `pickupLocations`), giữ cho bản app cũ. */
  pickup?: RefillPickupPoint;
  /** Optional: API cũ chưa trả. Rỗng = admin chưa cấu hình điểm nào, hiện `pickup` dự phòng. */
  pickupLocations?: RefillLocation[];
  perBottle: number;
  monthlyCap: number;
  monthlyUsed: number;
  monthlyRemaining: number;
  totalRecycled: number;
  history: RefillHistoryItem[];
}

export interface RefillResult {
  id: string;
  quantity: number;
  seedsAwarded: number;
  status: RefillStatus;
  monthlyRemaining: number;
  totalRecycled: number;
}

export interface PendingRefillItem {
  id: string;
  quantity: number;
  seedsAwarded: number;
  status: RefillStatus;
  createdAt: string;
  user: {
    id: string;
    fullName: string;
    phone?: string;
    avatarUrl?: string;
  };
  /** Nơi khách sẽ mang vỏ tới; null ở yêu cầu cũ. */
  pickupLocation?: { id: string; name: string; address: string } | null;
}

export const getRefillSummary = (http: HttpClient) => http.get<RefillSummary>('/refill/me');
/** Đổi vỏ chai kèm Idempotency-Key: double-tap/mất mạng-retry không tạo thêm 1 yêu cầu đổi vỏ nữa
 * (double-credit nước tưới Vườn Xanh khi duyệt). */
export const returnBottles = (http: HttpClient, quantity: number, idempotencyKey: string, pickupLocationId?: string) =>
  http.post<RefillResult>('/refill/return', pickupLocationId ? { quantity, pickupLocationId } : { quantity }, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export const getPendingRefillReturns = (http: HttpClient) => http.get<PendingRefillItem[]>('/refill/admin/pending');
/** `receivedQuantity`: số vỏ nhân viên đếm được tại điểm nhận (≤ số khách khai); bỏ trống = đủ số khai. */
export const approveRefillReturn = (http: HttpClient, id: string, receivedQuantity?: number) =>
  http.post<{ ok: boolean }>(`/refill/admin/${id}/approve`, receivedQuantity === undefined ? {} : { receivedQuantity });
export const rejectRefillReturn = (http: HttpClient, id: string, reason?: string) =>
  http.post<{ ok: boolean }>(`/refill/admin/${id}/reject`, reason ? { reason } : {});

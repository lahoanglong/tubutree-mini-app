import { api } from './api';

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
  /** Điểm khách đã chọn lúc gửi; null/thiếu ở yêu cầu cũ hoặc API cũ. */
  pickupLocation?: { id: string; name: string } | null;
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

export const getRefillSummary = () => api.get<RefillSummary>('/refill/me').then((r) => r.data);
/** Đổi vỏ chai kèm Idempotency-Key: double-tap/mất mạng-retry không tạo thêm 1 yêu cầu đổi vỏ nữa
 * (double-credit nước tưới Vườn Xanh khi duyệt). */
export const returnBottles = (quantity: number, idempotencyKey: string, pickupLocationId?: string) =>
  api
    .post<RefillResult>('/refill/return', pickupLocationId ? { quantity, pickupLocationId } : { quantity }, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    .then((r) => r.data);

export const getPendingRefillReturns = () => api.get<PendingRefillItem[]>('/refill/admin/pending').then((r) => r.data);
/** `receivedQuantity`: số vỏ nhân viên đếm được tại điểm nhận (≤ số khách khai); bỏ trống = đủ số khai. */
export const approveRefillReturn = (id: string, receivedQuantity?: number) =>
  api.post<{ ok: boolean }>(`/refill/admin/${id}/approve`, receivedQuantity === undefined ? {} : { receivedQuantity }).then((r) => r.data);
export const rejectRefillReturn = (id: string, reason?: string) =>
  api.post<{ ok: boolean }>(`/refill/admin/${id}/reject`, reason ? { reason } : {}).then((r) => r.data);

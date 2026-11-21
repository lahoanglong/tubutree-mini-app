import { apiFetch } from './client-api';

/** Trần mỗi lượt đổi hàng loạt (`BULK_STATUS_MAX` ở `apps/api/src/modules/admin/bulk-ops/order-bulk-status.ts`). */
export const BULK_STATUS_MAX = 50;
export type BulkStatusTarget = 'PACKED' | 'CANCELLED';

export interface BulkStatusResult {
  /** Đúng chuỗi đã gửi (id đơn). */
  id: string;
  code: string | null;
  from: string | null;
  ok: boolean;
  reason: string | null;
}

/** `POST /admin/orders/bulk-status`: cùng một luật cho xem trước (`dryRun`) và đổi thật; đơn lỗi không chặn đơn hợp lệ. */
export interface BulkStatusResponse {
  dryRun: boolean;
  targetStatus: BulkStatusTarget;
  total: number;
  okCount: number;
  failedCount: number;
  results: BulkStatusResult[];
  auditLogId: string | null;
  auditError: string | null;
}

/**
 * Lượt đổi thật gửi từng nhóm `BULK_RUN_CHUNK` đơn: mỗi đơn huỷ còn hỏi Pancake trước (tới hai lần, mỗi lần chờ tối đa 5 giây), nên 50 đơn
 * trong một yêu cầu vượt xa hạn chờ 20 giây mặc định và người bấm mất kết quả từng đơn. Mỗi nhóm có hạn chờ riêng `BULK_RUN_TIMEOUT_MS`.
 * Nhóm 5 đơn (tối đa ~50 giây) vẫn nằm dưới `Timeout` 60 giây mặc định của Apache (`ProxyPass` của vhost API không đặt `timeout=`; máy chủ hiện
 * đặt 600 giây), nên proxy không cắt yêu cầu giữa chừng trong khi API vẫn đổi tiếp phía sau.
 */
export const BULK_RUN_CHUNK = 5;
export const BULK_RUN_TIMEOUT_MS = 120_000;

export const bulkOrderStatus = (body: { orderIds: string[]; targetStatus: BulkStatusTarget; dryRun: boolean; note?: string }, opts: { timeoutMs?: number } = {}) =>
  apiFetch<BulkStatusResponse>('/admin/orders/bulk-status', { method: 'POST', body, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });

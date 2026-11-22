import { apiFetch } from './client-api';

/** Trần mỗi lượt (`STALE_BATCH_MAX` ở `apps/api/src/modules/external-points/external-claims-stale-batch.service.ts`). */
export const STALE_BATCH_MAX = 50;
/** Lượt duyệt thật gửi từng nhóm 5 claim: mỗi claim một transaction cộng điểm, nhóm nhỏ giữ kết quả từng claim khi mạng chập chờn. */
export const STALE_BATCH_CHUNK = 5;
export const STALE_BATCH_TIMEOUT_MS = 60_000;

/** READY: xem trước, sẽ duyệt. APPROVED: lượt này đã duyệt. SKIPPED: người khác vừa xử lý. FAILED: không duyệt nhanh được, duyệt tay. */
export type StaleBatchOutcome = 'READY' | 'APPROVED' | 'SKIPPED' | 'FAILED';

export interface StaleBatchRow {
  id: string;
  maskedCode: string;
  userName: string | null;
  userPhoneMasked: string | null;
  points: number;
  deliveredAppOrders: number;
  ok: boolean;
  outcome: StaleBatchOutcome;
  reason: string | null;
}

export interface StaleBatchResponse {
  dryRun: boolean;
  total: number;
  okCount: number;
  skippedCount: number;
  failedCount: number;
  truncated: boolean;
  results: StaleBatchRow[];
  auditLogId: string | null;
  auditError: string | null;
}

/** Không kèm `claimIds` thì máy chủ quét lượt claim chờ duyệt vì SĐT cũ lâu nhất; lượt thật bắt buộc kèm đúng các claim đã xem trước. */
export const staleBatchApprove = (body: { dryRun: boolean; claimIds?: string[] }, opts: { timeoutMs?: number } = {}) =>
  apiFetch<StaleBatchResponse>('/admin/external-claims/stale-phone-batch', {
    method: 'POST',
    body,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });

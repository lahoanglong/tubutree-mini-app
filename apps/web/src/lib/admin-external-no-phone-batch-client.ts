import { apiFetch } from './client-api';
import type { AdminRecipientNameMatch } from './admin-client';
import type { StaleBatchOutcome } from './admin-external-stale-batch-client';

/** Một claim trong lượt "Duyệt nhanh đơn Lazada đủ điều kiện" (`external-claims-no-phone-batch.service.ts` của API). */
export interface NoPhoneBatchRow {
  id: string;
  maskedCode: string;
  userName: string | null;
  userPhoneMasked: string | null;
  points: number;
  /** Đơn app chính thành viên đặt, đã giao. */
  deliveredAppOrders: number;
  /** Claim đơn sàn khác của thành viên đã cộng điểm. */
  creditedClaims: number;
  recipientNameMatch: AdminRecipientNameMatch;
  ok: boolean;
  outcome: StaleBatchOutcome;
  reason: string | null;
}

export interface NoPhoneBatchResponse {
  dryRun: boolean;
  total: number;
  okCount: number;
  skippedCount: number;
  failedCount: number;
  truncated: boolean;
  results: NoPhoneBatchRow[];
  auditLogId: string | null;
  auditError: string | null;
}

/** Không kèm `claimIds` thì máy chủ quét lượt claim Lazada chờ duyệt vì thiếu SĐT lâu nhất; lượt thật bắt buộc kèm đúng các claim đã xem trước. */
export const noPhoneBatchApprove = (body: { dryRun: boolean; claimIds?: string[] }, opts: { timeoutMs?: number } = {}) =>
  apiFetch<NoPhoneBatchResponse>('/admin/external-claims/no-phone-batch', {
    method: 'POST',
    body,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });

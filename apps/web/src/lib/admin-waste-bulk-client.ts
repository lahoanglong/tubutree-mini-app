import type { WasteMethod, WasteRequestStatus } from '@tubutree/shared-types';
import { apiFetch } from './client-api';

/** Trần mỗi lượt (`WASTE_BULK_MAX` ở `apps/api/src/modules/waste-exchange/receiving/waste-bulk-action.ts`). */
export const WASTE_BULK_MAX = 50;
/** Lượt thật gửi từng nhóm 5 yêu cầu: mỗi yêu cầu một transaction và một tin báo khách, nhóm nhỏ giữ kết quả từng yêu cầu khi mạng chập chờn. */
export const WASTE_BULK_CHUNK = 5;
export const WASTE_BULK_TIMEOUT_MS = 60_000;

export type WasteBulkAction = 'MARK_RECEIVED' | 'CLOSE_LOST';
/** READY: xem trước, sẽ đổi. UPDATED: lượt này đã đổi. SKIPPED: đã ở trạng thái đích, không phải lỗi. FAILED: không đổi được. */
export type WasteBulkOutcome = 'READY' | 'UPDATED' | 'SKIPPED' | 'FAILED';

export interface WasteBulkResult {
  id: string;
  code: string | null;
  method: WasteMethod | null;
  from: WasteRequestStatus | null;
  ok: boolean;
  outcome: WasteBulkOutcome;
  reason: string | null;
  needsPhoneConfirm: boolean;
}

/** `POST /admin/waste/requests/bulk-action` (`WasteBulkResponse` ở `waste-bulk-action.service.ts`). */
export interface WasteBulkResponse {
  dryRun: boolean;
  action: WasteBulkAction;
  total: number;
  okCount: number;
  skippedCount: number;
  failedCount: number;
  results: WasteBulkResult[];
  auditLogId: string | null;
  auditError: string | null;
}

export const wasteBulkAction = (
  body: { action: WasteBulkAction; requestIds: string[]; dryRun: boolean; phoneMatchConfirmed?: boolean; reason?: string },
  opts: { timeoutMs?: number } = {},
) => apiFetch<WasteBulkResponse>('/admin/waste/requests/bulk-action', { method: 'POST', body, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });

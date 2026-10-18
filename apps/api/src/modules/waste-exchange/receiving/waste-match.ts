import type { Prisma } from '@prisma/client';
import type { WasteMatchBasis, WasteMatchInput, WasteMethod, WasteUnmatchedReason } from '@tubutree/shared-types';
import { normalizeWasteCode } from '../waste-codes';

export type WasteMatchOutcome =
  | { ok: true; basis: WasteMatchBasis }
  | { ok: false; reason: WasteUnmatchedReason; relatedRequestId?: string };

const MATCH_REASON_TEXT: Record<WasteUnmatchedReason, string> = {
  NO_MATCH: 'kiện không khớp yêu cầu nào',
  TRACKING_MULTI: 'mã vận đơn khớp nhiều yêu cầu',
  TR_TRACKING_CONFLICT: 'mã TR- trên kiện là của một yêu cầu khác',
  EXPIRED_REQUEST: 'yêu cầu đã hết hạn, cần admin mở lại',
  NOT_RECEIVABLE: 'yêu cầu này không nhận thêm kiện',
  MANUAL_ENTRY: 'kiện được ghi tay vào hàng không rõ chủ',
};

export function matchReasonText(reason: WasteUnmatchedReason): string {
  return MATCH_REASON_TEXT[reason];
}

/**
 * Decides only the matching basis; status rules belong to the caller, which holds the row lock and knows the route.
 * RECEIVED is counted in the tracking match so a receive replay of a request already received by tracking still finds itself.
 */
export async function evaluateMatch(
  tx: Prisma.TransactionClient,
  req: { id: string; code: string; method: WasteMethod; trackingNorm: string | null; orderId: string | null },
  match: WasteMatchInput | undefined,
): Promise<WasteMatchOutcome> {
  const n = match?.parcelCode !== undefined ? normalizeWasteCode(match.parcelCode) : '';
  if (n !== '') {
    if (n === req.code) return { ok: true, basis: 'TR_CODE' };
    const other = await tx.wasteRequest.findUnique({ where: { code: n }, select: { id: true } });
    return other ? { ok: false, reason: 'TR_TRACKING_CONFLICT', relatedRequestId: other.id } : { ok: false, reason: 'NO_MATCH' };
  }
  if (req.method === 'PICKUP') {
    return req.orderId ? { ok: true, basis: 'ORDER' } : { ok: false, reason: 'NOT_RECEIVABLE' };
  }
  if (req.method === 'MAIL_IN') {
    if (match?.phoneMatchConfirmed !== true || req.trackingNorm === null) return { ok: false, reason: 'NO_MATCH' };
    const count = await tx.wasteRequest.count({
      where: { trackingNorm: req.trackingNorm, method: 'MAIL_IN', status: { in: ['OPEN', 'IN_TRANSIT', 'RECEIVED'] } },
    });
    if (count === 1) return { ok: true, basis: 'TRACKING_PHONE' };
    return { ok: false, reason: count === 0 ? 'NO_MATCH' : 'TRACKING_MULTI' };
  }
  return { ok: false, reason: 'NOT_RECEIVABLE' };
}

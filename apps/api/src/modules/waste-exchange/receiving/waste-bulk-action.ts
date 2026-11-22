import type { OrderStatus, WasteCloseReason, WasteMethod, WasteRequestStatus } from '@prisma/client';

/** Trần yêu cầu mỗi lượt thao tác hàng loạt ở bảng Đổi rác: mỗi yêu cầu chạy một transaction riêng, 50 yêu cầu xong trong vài giây. */
export const WASTE_BULK_MAX = 50;

/**
 * Chỉ hai thao tác hàng loạt (PO A3, 22/11/2026): nhận kiện vào kho và đóng yêu cầu gửi kho thất lạc. Đếm vỏ và cộng điểm luôn làm từng kiện
 * ở chi tiết yêu cầu: một lượt cộng điểm hàng loạt bấm nhầm cộng điểm thật cho cả trang yêu cầu.
 */
export const WASTE_BULK_ACTIONS = ['MARK_RECEIVED', 'CLOSE_LOST'] as const;
export type WasteBulkAction = (typeof WASTE_BULK_ACTIONS)[number];

/** `admin_audit_logs.action` của mỗi lượt chạy thật. */
export const WASTE_BULK_AUDIT_ACTION = 'WASTE_BULK_ACTION';

/**
 * READY: xem trước, sẽ đổi. UPDATED: lượt thật này đổi yêu cầu. SKIPPED: yêu cầu đã ở trạng thái đích (từ trước hoặc do người khác vừa làm),
 * không phải lỗi. FAILED: không đổi được, `reason` nói vì sao và cách làm tay.
 */
export type WasteBulkOutcome = 'READY' | 'UPDATED' | 'SKIPPED' | 'FAILED';

export interface WasteBulkResult {
  /** Đúng chuỗi người gửi (id hoặc mã TR-). */
  id: string;
  code: string | null;
  method: WasteMethod | null;
  from: WasteRequestStatus | null;
  ok: boolean;
  outcome: WasteBulkOutcome;
  reason: string | null;
  /** Kiện gửi về kho/lấy tận nhà: chỉ nhận được khi người bấm xác nhận đã đối chiếu SĐT và mã vận đơn trên từng kiện. */
  needsPhoneConfirm: boolean;
}

export interface WasteBulkRow {
  code: string;
  method: WasteMethod;
  status: WasteRequestStatus;
  orderId: string | null;
  orderStatus: OrderStatus | null;
  trackingNorm: string | null;
  trackingConflict: boolean;
  inTransitAt: Date | null;
  closeReason: WasteCloseReason | null;
  customerBlocked: boolean;
}

export type WasteBulkDecision = { kind: 'OK'; needsPhoneConfirm: boolean } | { kind: 'SKIP'; reason: string } | { kind: 'FAIL'; reason: string };

export const BULK_TEXT = {
  NOT_FOUND: 'Không tìm thấy yêu cầu.',
  DUPLICATE: 'Yêu cầu này đã có ở dòng trên của lượt này.',
  ALREADY_RECEIVED: 'Kiện đã được nhận vào kho từ trước, lượt này không đổi.',
  DROP_OFF: 'Yêu cầu mang tới điểm nhận không nhận qua kho.',
  CUSTOMER_BLOCKED: 'Khách đang bị khoá đổi rác: nhận từng kiện ở chi tiết yêu cầu.',
  EXPIRED: 'Yêu cầu đã hết hạn: admin mở lại từng yêu cầu ở chi tiết.',
  NOT_RECEIVABLE: 'Yêu cầu không ở trạng thái chờ nhận kiện.',
  ORDER_MISSING: 'Túi thu kèm đơn chưa gắn đơn hàng.',
  ORDER_RETURNED: 'Đơn kèm túi đã hoàn: nhận từng kiện ở nút Nhận kiện.',
  ORDER_NOT_DELIVERED: 'Đơn kèm túi chưa giao xong, chưa nhận kiện được.',
  NO_TRACKING: 'Chưa có mã vận đơn để đối chiếu: nhận từng kiện bằng mã TR- trên kiện.',
  TRACKING_CONFLICT: 'Mã vận đơn trùng với yêu cầu của khách khác: nhận từng kiện.',
  TRACKING_MULTI: 'Mã vận đơn khớp nhiều yêu cầu: nhận từng kiện bằng mã TR- trên kiện.',
  PHONE_NOT_CONFIRMED: 'Chưa xác nhận đã đối chiếu SĐT người gửi và mã vận đơn trên kiện.',
  ALREADY_LOST: 'Yêu cầu đã đóng vì thất lạc từ trước, lượt này không đổi.',
  NOT_TRANSIT: 'Chỉ đóng hàng loạt yêu cầu gửi kho đang trên đường (hàng Gửi kho quá hạn xem lại).',
  RETRY: 'Yêu cầu vừa được thao tác khác đổi, lượt này không đổi. Tải lại rồi xem lại.',
} as const;

const RECEIVABLE: ReadonlySet<WasteRequestStatus> = new Set<WasteRequestStatus>(['OPEN', 'IN_TRANSIT']);

/**
 * Luật nhận kiện hàng loạt, chặt hơn nút Nhận kiện từng kiện: túi thu kèm đơn chỉ khi đơn đã giao (không nhận đơn đã hoàn), kiện gửi kho/lấy tận
 * nhà chỉ khi có mã vận đơn không trùng khách khác và người bấm xác nhận đã đối chiếu SĐT. Khách bị khoá thì làm từng kiện.
 * Mã vận đơn trùng nhiều yêu cầu do `evaluateMatch` (cùng hàm của nút từng kiện) xét sau, vì cần đọc DB.
 */
export function receiveDecision(r: WasteBulkRow, opts: { phoneMatchConfirmed: boolean; dryRun: boolean }): WasteBulkDecision {
  if (r.status === 'RECEIVED') return { kind: 'SKIP', reason: BULK_TEXT.ALREADY_RECEIVED };
  if (r.method === 'DROP_OFF') return { kind: 'FAIL', reason: BULK_TEXT.DROP_OFF };
  if (r.status === 'EXPIRED') return { kind: 'FAIL', reason: BULK_TEXT.EXPIRED };
  if (!RECEIVABLE.has(r.status)) return { kind: 'FAIL', reason: BULK_TEXT.NOT_RECEIVABLE };
  if (r.customerBlocked) return { kind: 'FAIL', reason: BULK_TEXT.CUSTOMER_BLOCKED };
  if (r.method === 'PICKUP') {
    if (r.orderId === null || r.orderStatus === null) return { kind: 'FAIL', reason: BULK_TEXT.ORDER_MISSING };
    if (r.orderStatus === 'RETURNED') return { kind: 'FAIL', reason: BULK_TEXT.ORDER_RETURNED };
    if (r.orderStatus !== 'DELIVERED') return { kind: 'FAIL', reason: BULK_TEXT.ORDER_NOT_DELIVERED };
    return { kind: 'OK', needsPhoneConfirm: false };
  }
  if (r.trackingNorm === null) return { kind: 'FAIL', reason: BULK_TEXT.NO_TRACKING };
  if (r.trackingConflict) return { kind: 'FAIL', reason: BULK_TEXT.TRACKING_CONFLICT };
  if (!opts.dryRun && !opts.phoneMatchConfirmed) return { kind: 'FAIL', reason: BULK_TEXT.PHONE_NOT_CONFIRMED };
  return { kind: 'OK', needsPhoneConfirm: true };
}

/** Mốc "gửi kho quá hạn xem lại": cùng điều kiện bộ lọc TRANSIT_OVERDUE (`wasteTransitOverdueWhere`). */
export const transitOverdue = (inTransitAt: Date | null, now: Date, reviewDays: number): boolean =>
  inTransitAt !== null && inTransitAt.getTime() < now.getTime() - reviewDays * 86_400_000;

/** Đóng thất lạc hàng loạt chỉ cho yêu cầu ở hàng "Gửi kho quá hạn xem lại". Kiện kho đã nhận rồi mất vẫn đóng từng kiện ở chi tiết. */
export function closeLostDecision(r: WasteBulkRow, ctx: { now: Date; reviewDays: number }): WasteBulkDecision {
  if (r.status === 'EXPIRED' && r.closeReason === 'LOST') return { kind: 'SKIP', reason: BULK_TEXT.ALREADY_LOST };
  if ((r.method !== 'MAIL_IN' && r.method !== 'HOME_PICKUP') || r.status !== 'IN_TRANSIT') return { kind: 'FAIL', reason: BULK_TEXT.NOT_TRANSIT };
  if (!transitOverdue(r.inTransitAt, ctx.now, ctx.reviewDays)) {
    return { kind: 'FAIL', reason: `Chưa quá ${ctx.reviewDays} ngày kể từ lúc khách gửi: chưa đóng thất lạc được.` };
  }
  return { kind: 'OK', needsPhoneConfirm: false };
}

/** Bỏ khoảng trắng hai đầu, bỏ trùng, giữ thứ tự người gửi. */
export function uniqueRequestIds(raw: readonly string[]): string[] {
  return [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
}

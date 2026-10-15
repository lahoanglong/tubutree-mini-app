/**
 * Cột của Order chỉ dùng nội bộ: phí sàn đối tác, hoa hồng CTV, khoá khách lên-hộ, khoá chống đặt trùng, mã đơn bên Pancake,
 * trạng thái đẩy/đồng bộ/đối soát Pancake, Gomdon, mốc hệ thống thôi tự huỷ đơn và cột tìm kiếm người nhận của admin. Không trả
 * cho người đặt — khách, đại lý, CTV lên đơn hộ (R2-MERCHANT-14, R3-MERCHANT-1).
 */
export const BUYER_HIDDEN_ORDER_FIELDS = [
  'idempotencyKey',
  'pancakeOrderId',
  'merchantCommissionPct',
  'commission',
  'endCustomerKey',
  'merchantSlaNotifiedAt',
  'reviewInvitedAt',
  'pancakeAttention',
  'pancakeAttentionAt',
  'autoCancelBlockedAt',
  'pancakePushStatus',
  'pancakeSyncError',
  'pancakePushAttempts',
  'pancakeLastAttemptAt',
  'pancakePushClaimedAt',
  'pancakePaymentSynced',
  'pancakePaidReported',
  'pancakeCancelStatus',
  'gomdonStatusAt',
  'gomdonAttempt',
  'gomdonCancelRetrySince',
  'recipientSearch',
] as const;
export type BuyerHiddenOrderField = (typeof BUYER_HIDDEN_ORDER_FIELDS)[number];

/**
 * Cột đồng bộ (pancake*, gomdon*) người mua được thấy: mã và trạng thái vận đơn Gomdon mà màn thu gom tái chế của khách đọc.
 * Cột đồng bộ không nằm ở đây cũng không nằm trong BUYER_HIDDEN_ORDER_FIELDS vẫn bị ẩn — cột mới thêm không tự lộ ra người mua
 * (buyer-order-fields.spec buộc xếp loại).
 */
export const BUYER_VISIBLE_SYNC_FIELDS = ['gomdonOrderId', 'gomdonPartnerCode', 'gomdonStatus', 'gomdonCancelStatus'] as const;

const SYNC_COLUMN = /^(pancake|gomdon)/;
const VISIBLE_SYNC = new Set<string>(BUYER_VISIBLE_SYNC_FIELDS);

export function forBuyer<T extends object>(order: T): Omit<T, BuyerHiddenOrderField> {
  const out = { ...order } as Record<string, unknown>;
  for (const k of BUYER_HIDDEN_ORDER_FIELDS) delete out[k];
  for (const k of Object.keys(out)) if (SYNC_COLUMN.test(k) && !VISIBLE_SYNC.has(k)) delete out[k];
  return out as Omit<T, BuyerHiddenOrderField>;
}

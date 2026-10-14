/**
 * Cột của Order chỉ dùng nội bộ: phí sàn đối tác, hoa hồng CTV, khoá khách lên-hộ, khoá chống đặt trùng, mã đơn bên Pancake,
 * trạng thái đẩy/đồng bộ Pancake, Gomdon, mốc hệ thống thôi tự huỷ đơn và cột tìm kiếm người nhận của admin. Không trả cho người
 * đặt — khách, đại lý, CTV lên đơn hộ (R2-MERCHANT-14, R3-MERCHANT-1). Mã và trạng thái vận đơn Gomdon (gomdonOrderId,
 * gomdonPartnerCode, gomdonStatus, gomdonCancelStatus) ở lại vì màn thu gom tái chế của khách đọc chúng.
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
  'pancakeCancelStatus',
  'gomdonStatusAt',
  'gomdonAttempt',
  'gomdonCancelRetrySince',
  'recipientSearch',
] as const;
export type BuyerHiddenOrderField = (typeof BUYER_HIDDEN_ORDER_FIELDS)[number];

export function forBuyer<T extends object>(order: T): Omit<T, BuyerHiddenOrderField> {
  const out = { ...order } as Record<string, unknown>;
  for (const k of BUYER_HIDDEN_ORDER_FIELDS) delete out[k];
  return out as Omit<T, BuyerHiddenOrderField>;
}

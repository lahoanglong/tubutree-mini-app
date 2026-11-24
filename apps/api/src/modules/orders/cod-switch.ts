import type { Order, Prisma } from '@prisma/client';
import type { CodSwitchRefusalReason } from '@tubutree/shared-types';
import { COD_MAX_PER_ORDER } from '../checkout/checkout-split';
import { PAYMENT_UNLINKED_HOLD_HOURS } from './pending-payment-hold';

/**
 * Đổi đơn chuyển khoản chưa trả sang trả tiền khi nhận (COD) bằng một chạm của khách. File không import service: service đổi, bản xem chi tiết đơn,
 * trang QR và webhook Pancake cùng đọc luật ở đây.
 */

/** Dòng lịch sử đơn của lần đổi: cũng là dấu để webhook Pancake biết đơn COD này từng là chuyển khoản (tiền về muộn vẫn được ghi nhận). */
export const COD_SWITCH_HISTORY_NOTE = 'Khách đổi từ chuyển khoản sang trả tiền khi nhận (COD)';

/** `code` trong body 409 của hai route đổi; `reason` cho biết vì sao. */
export const COD_SWITCH_REFUSED = 'COD_SWITCH_REFUSED';

/** Ghi kèm dòng lịch sử lật PAID khi tiền chuyển khoản về sau lần đổi: đơn trở lại chuyển khoản đã trả. */
export const COD_SWITCH_REVERTED_NOTE = 'Tiền chuyển khoản về sau khi khách đổi sang COD: đơn trở lại chuyển khoản đã trả, không thu COD';

export type CodSwitchRefusal = CodSwitchRefusalReason;

export type CodSwitchFacts = Pick<
  Order,
  | 'type'
  | 'status'
  | 'paymentStatus'
  | 'paymentMethod'
  | 'fulfiller'
  | 'total'
  | 'placedForCustomer'
  | 'autoCancelBlockedAt'
  | 'paymentUnlinkedAt'
  | 'paymentUnlinkedFirstAt'
  | 'pancakePaidReported'
>;

/**
 * Khoản Pancake báo mà chưa gắn đơn còn trong thời gian chờ Kế toán: phần bù của `paymentUnlinkedHoldOverWhere` (cùng mốc, cùng cách lấy
 * paymentUnlinkedAt khi dòng chưa có mốc đầu), đọc trên dòng đã tải dưới khoá.
 */
export function inPaymentUnlinkedHold(o: Pick<Order, 'paymentUnlinkedAt' | 'paymentUnlinkedFirstAt'>, now: Date): boolean {
  if (o.paymentUnlinkedAt === null) return false;
  const cutoff = now.getTime() - PAYMENT_UNLINKED_HOLD_HOURS * 3_600_000;
  return (o.paymentUnlinkedFirstAt ?? o.paymentUnlinkedAt).getTime() >= cutoff;
}

/**
 * Lý do không đổi được (null = đổi được). Thứ tự: kết cục rõ cho khách trước (đã trả, đã huỷ, đã là COD), rồi các rào tiền. Trần thu hộ là
 * `codMax` (khách đăng nhập: COD_MAX_PER_ORDER; khách vãng lai: trần COD của đặt hàng không đăng nhập), không bao giờ vượt COD_MAX_PER_ORDER.
 */
export function codSwitchRefusal(o: CodSwitchFacts, ctx: { attempts: number; codMax: number; now: Date }): CodSwitchRefusal | null {
  if (o.paymentStatus === 'PAID' || o.paymentStatus === 'REFUNDED') return 'ALREADY_PAID';
  if (o.status === 'CANCELLED' || o.status === 'RETURNED') return 'CLOSED';
  if (o.paymentMethod === 'COD') return 'ALREADY_COD';
  if (o.paymentMethod !== 'BANK_TRANSFER') return 'NOT_TRANSFER';
  if (o.status !== 'PENDING_PAYMENT' || o.paymentStatus !== 'UNPAID') return 'NOT_PENDING';
  // Đại lý (công nợ/trả trước), CTV đặt hộ người nhận, gian hàng tự giao: không phải đường COD của kho Tubu.
  if (o.type !== 'RETAIL' || o.fulfiller !== 'TUBU' || o.placedForCustomer) return 'NOT_ELIGIBLE';
  if (o.total > codCap(ctx.codMax)) return 'OVER_MAX';
  // Có dấu tiền đang về hay hàng đã đi: đổi lúc này có thể làm khách trả hai lần hoặc kho giao đơn chưa chốt.
  if (o.autoCancelBlockedAt !== null) return 'PAYMENT_IN_PROGRESS';
  if (inPaymentUnlinkedHold(o, ctx.now)) return 'PAYMENT_IN_PROGRESS';
  if ((o.pancakePaidReported ?? 0) > 0) return 'PAYMENT_IN_PROGRESS';
  if (ctx.attempts > 0) return 'PAYMENT_IN_PROGRESS';
  return null;
}

export const codCap = (codMax: number) => Math.min(codMax, COD_MAX_PER_ORDER);

/** Câu 409 cho khách theo lý do (máy khách hiện nguyên văn rồi tải lại đơn). */
export function codSwitchRefusalMessage(reason: CodSwitchRefusal, codMax: number): string {
  switch (reason) {
    case 'ALREADY_PAID':
      return 'Tubu đã nhận thanh toán của đơn này, bạn không cần đổi cách trả nữa.';
    case 'CLOSED':
      return 'Đơn đã huỷ nên không đổi cách trả được nữa.';
    case 'ALREADY_COD':
      return 'Đơn đã chuyển sang trả tiền khi nhận hàng.';
    case 'OVER_MAX':
      return `Trả tiền khi nhận chỉ nhận đơn tối đa ${codCap(codMax).toLocaleString('vi-VN')}đ. Bạn chuyển khoản giúp Tubu nhé.`;
    case 'PAYMENT_IN_PROGRESS':
      return 'Tubu đang đối soát một khoản chuyển khoản của đơn này nên chưa đổi được. Bạn liên hệ CSKH để được hỗ trợ nhé.';
    default:
      return 'Đơn này không đổi sang trả tiền khi nhận được.';
  }
}

/**
 * Khoá advisory theo đơn, giữ tới hết transaction của `tx`, dùng chung giữa hai bên của một cuộc đua hẹp: lần lật đơn đã đổi COD về lại chuyển khoản đã trả
 * (OrderStatusService.markPaid) và lần ghi vận đơn Gomdon vừa tạo (GomdonOrderService). Mỗi bên ghi phần của mình rồi đọc phần của bên kia dưới khoá, nên
 * đúng một bên thấy "đơn đã trả mà vận đơn còn thu hộ" và báo kho sửa thu hộ về 0đ: không bên nào bỏ sót, không báo đôi.
 */
export async function lockCodCollect(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, orderId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'order-cod-collect'}), hashtext(${orderId}))`;
}

/** Lời báo "Cần xử lý thu gom" khi vận đơn Gomdon thu hộ của đơn đã đổi COD mà tiền chuyển khoản về đủ (cùng chữ cho hai bên, báo động chống trùng theo chữ). */
export function codCollectAfterRevertMessage(total: number, waybill: string): string {
  return `Khách đã đổi sang COD rồi vẫn chuyển khoản đủ ${total.toLocaleString('vi-VN')}đ: vận đơn Gomdon ${waybill} còn thu hộ. Sửa tiền thu hộ về 0đ trên Gomdon.`;
}

/** Đơn COD này có từng là chuyển khoản rồi khách đổi không (dấu là dòng lịch sử của lần đổi). */
export async function switchedFromTransfer(
  prisma: { orderStatusHistory: Pick<Prisma.OrderStatusHistoryDelegate, 'findFirst'> },
  order: Pick<Order, 'id' | 'paymentMethod'>,
): Promise<boolean> {
  if (order.paymentMethod !== 'COD') return false;
  const row = await prisma.orderStatusHistory.findFirst({ where: { orderId: order.id, note: COD_SWITCH_HISTORY_NOTE }, select: { id: true } });
  return row !== null;
}

/**
 * Hàng chưa rời kho. Đơn đã đổi sang COD mà tiền chuyển khoản vẫn về trong lúc này thì đơn trở lại chuyển khoản đã trả (kho không thu COD).
 * Sau bàn giao, "đã trả" của Pancake có thể là tiền thu hộ COD của hãng, không tự lật được.
 */
export function beforeHandover(o: Pick<Order, 'status' | 'shippedAt'>): boolean {
  return o.shippedAt === null && o.status !== 'SHIPPING' && o.status !== 'DELIVERED' && o.status !== 'RETURNED';
}

/** Nút đổi có hiện cho đơn này không (chi tiết đơn, trang QR, trang theo dõi của khách vãng lai): cùng luật với lần đổi thật, không khoá. */
export async function codSwitchEligible(
  prisma: { paymentAttempt: Pick<Prisma.PaymentAttemptDelegate, 'count'> },
  order: CodSwitchFacts & Pick<Order, 'id'>,
  codMax: number = COD_MAX_PER_ORDER,
  now: Date = new Date(),
): Promise<boolean> {
  // Rẻ trước: đơn không còn chờ chuyển khoản thì khỏi đếm lệnh thanh toán.
  if (codSwitchRefusal(order, { attempts: 0, codMax, now }) !== null) return false;
  return (await prisma.paymentAttempt.count({ where: { orderId: order.id } })) === 0;
}

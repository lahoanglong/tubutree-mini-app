import type { Logger } from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { PANCAKE_ALERT_TEMPLATE, type GomdonAlertService } from '../gomdon/gomdon-alert.service';

/** Mở đầu lý do "Cần xử lý Pancake" do chiều Tubu → Pancake ghi — để tự gỡ khi lần thử sau thành công. */
export const ATTENTION_PUSH_FAILED = 'Chưa đẩy được đơn sang Pancake';
export const ATTENTION_CANCEL_PENDING = 'Đã huỷ ở Tubu nhưng CHƯA huỷ được trên Pancake';
export const ATTENTION_PAYMENT_PENDING = 'Chưa báo được "đã thanh toán, không thu COD" sang Pancake';
/** Pancake báo "Hoàn một phần" (15) cho đơn đã duyệt trả + hoàn tiền trên Tubu — chỉ còn chờ bấm "Đã nhận hàng về". */
export const ATTENTION_PARTIAL_RETURN_ACK = 'Pancake đã nhận phiếu hoàn một phần — đã hoàn trên Tubu';
/** Lệnh huỷ đã tới Pancake nhưng lần huỷ ở Tubu trượt/lỗi — kho không còn đơn, Tubu còn hiệu lực; xong việc khi đơn huỷ/trả. */
export const ATTENTION_CANCELLED_ON_PANCAKE_ONLY = 'Pancake đã huỷ nhưng đơn Tubu còn hiệu lực';
/** Pancake báo huỷ đơn đã bàn giao (processor) — xong việc khi đơn đã huỷ/trả theo luồng hoàn. */
export const ATTENTION_CANCEL_AFTER_HANDOVER = 'Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển';
/** Lời nhắc tạo phiếu trả trên Pancake lúc duyệt trả (OrderReturnsService.flagPancakeReturn). */
export const ATTENTION_RETURN_APPROVED = ['Khách trả một phần đơn', 'Khách trả cả đơn'];
/** Pancake báo khách mới chuyển một phần tiền — tự gỡ khi đơn đủ tiền hoặc số đã nhận đã thành khoản hoàn. */
export const ATTENTION_UNDERPAID = 'Khách chuyển thiếu';

/**
 * Hàng đợi "Cần xử lý Pancake": ghi lý do lên đơn + báo ADMIN in-app (cùng cơ chế PancakeProcessor.flagAttention).
 * Cùng lý do đang chờ thì không ghi/báo lại. Lỗi gửi báo động tự nuốt trong alert().
 */
export async function flagPancakeAttention(
  prisma: PrismaService,
  alerts: GomdonAlertService | undefined,
  order: { id: string; code: string },
  reason: string,
  logger?: Logger,
): Promise<void> {
  const r = await prisma.order.updateMany({
    where: { id: order.id, OR: [{ pancakeAttention: null }, { pancakeAttention: { not: reason } }] },
    data: { pancakeAttention: reason, pancakeAttentionAt: new Date() },
  });
  if (r.count === 0) return;
  logger?.warn(`Đơn ${order.code} cần xử lý (Pancake): ${reason}`);
  if (alerts) await alerts.alert(order.code, reason, PANCAKE_ALERT_TEMPLATE);
}

/** Đơn đã huỷ xong trên Pancake (hoặc chưa từng lên): việc đẩy/huỷ/báo thanh toán còn treo không còn ý nghĩa. */
export const ATTENTION_SETTLED_BY_CANCEL = [ATTENTION_PUSH_FAILED, ATTENTION_CANCEL_PENDING, ATTENTION_PAYMENT_PENDING];

/** Gỡ lý do do chính chiều outbound ghi (việc đã tự xong) — không đụng lý do khác (webhook, admin). */
export async function clearPancakeAttention(prisma: PrismaService, orderId: string, prefix: string | string[]): Promise<void> {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  await prisma.order.updateMany({
    where: { id: orderId, OR: prefixes.map((p) => ({ pancakeAttention: { startsWith: p } })) },
    data: { pancakeAttention: null, pancakeAttentionAt: null },
  });
}

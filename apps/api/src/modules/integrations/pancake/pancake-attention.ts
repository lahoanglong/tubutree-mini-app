import type { Logger } from '@nestjs/common';
import type { OrderStatus, Prisma } from '@prisma/client';
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
/**
 * Pancake báo "Đã hoàn" cho đơn COD đã giao mà Tubu chưa có bằng chứng thu COD (DELIVERED có thể do kho bấm "Đã nhận" nhầm):
 * đơn đã sang RETURNED nhưng tiền chưa hoàn Ví. Cùng lúc có một khoản hoàn RETURN chờ đối soát (UNVERIFIED) ở mục "Hoàn tiền
 * khách" của Kế toán — đó là nơi quyết định hoàn hay không, dòng này chỉ để kho/CSKH biết đơn đang chờ.
 */
export const ATTENTION_COD_RETURN_UNVERIFIED =
  'Pancake báo "Đã hoàn" cho đơn COD đã giao — đơn đã chuyển "Đã trả hàng", điểm/hoa hồng đã đảo, nhưng hệ thống KHÔNG tự hoàn tiền vào Ví vì chưa có bằng chứng hãng đã thu COD. ' +
  'Kế toán đối chiếu với hãng vận chuyển rồi xử lý ở mục "Hoàn tiền khách" (khoản "Trả hàng" chờ đối soát của đơn này): hãng đã thu COD thì xác nhận để hoàn cho khách, chưa thu thì bỏ qua kèm lý do.';
/** Lời nhắc tạo phiếu trả trên Pancake lúc duyệt trả (OrderReturnsService.flagPancakeReturn). */
export const ATTENTION_RETURN_APPROVED = ['Khách trả một phần đơn', 'Khách trả cả đơn'];
/** Pancake báo khách mới chuyển một phần tiền — tự gỡ khi đơn đủ tiền hoặc số đã nhận đã thành khoản hoàn. */
export const ATTENTION_UNDERPAID = 'Khách chuyển thiếu';
/** Tổng tiền đơn trên Pancake khác `order.total` (đơn bị sửa trên Pancake) — tự gỡ khi tổng trùng lại. */
export const ATTENTION_TOTAL_MISMATCH = 'Tổng tiền Pancake lệch với Tubu';

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
  const written = await writePancakeAttention(prisma, order.id, reason);
  if (!written) return;
  logger?.warn(`Đơn ${order.code} cần xử lý (Pancake): ${written}`);
  if (alerts) await alerts.alert(order.code, reason, PANCAKE_ALERT_TEMPLATE);
}

/**
 * Ghi lý do lên ô "Cần xử lý Pancake" (một ô cho mọi lý do). Dòng "COD chờ Kế toán" không bị ghi đè: nó chỉ gỡ khi Kế toán quyết,
 * nên lý do mới được nối sau nó. Đọc rồi ghi có điều kiện theo giá trị đã đọc (lý do vừa chen giữa không bị đè; thua thì đọc lại).
 * Trả chuỗi vừa ghi, hoặc null khi không đổi gì.
 */
export async function writePancakeAttention(
  db: Pick<Prisma.TransactionClient, 'order'>,
  orderId: string,
  reason: string,
  onlyReplacingPrefix?: string,
  /** Chỉ ghi khi đơn còn mở: lệnh ghi không được thắng một lần huỷ/trả vừa commit sau lúc đọc trạng thái. */
  onlyOpenOrder = false,
): Promise<string | null> {
  const open = onlyOpenOrder ? { status: { notIn: ['CANCELLED', 'RETURNED'] as OrderStatus[] } } : {};
  const changed = { OR: [{ pancakeAttention: null }, { pancakeAttention: { not: reason } }] };
  // NOT (NULL LIKE ..) ra NULL trong SQL: ô trống phải được nêu riêng, không thì dòng không khớp.
  const notCod = { OR: [{ pancakeAttention: null }, { NOT: { pancakeAttention: { contains: ATTENTION_COD_RETURN_UNVERIFIED } } }] };
  const first = await db.order.updateMany({
    where: onlyReplacingPrefix
      ? { id: orderId, ...open, AND: [changed, notCod, { OR: [{ pancakeAttention: null }, { pancakeAttention: { startsWith: onlyReplacingPrefix } }] }] }
      : { id: orderId, ...open, AND: [changed, notCod] },
    data: { pancakeAttention: reason, pancakeAttentionAt: new Date() },
  });
  if (first.count === 1) return reason;
  if (onlyReplacingPrefix) return null;
  // Không khớp: hoặc cùng lý do đang chờ, hoặc ô đang giữ dòng COD chờ Kế toán — trường hợp sau nối lý do mới vào sau dòng đó.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await db.order.findUnique({ where: { id: orderId }, select: { pancakeAttention: true } });
    const current = row?.pancakeAttention ?? null;
    if (current === null || !current.split(ATTENTION_SEPARATOR).includes(ATTENTION_COD_RETURN_UNVERIFIED)) return null;
    // Lý do đã nằm trong ô (ở bất kỳ vị trí nào, vd 'X | COD' do order-status nối) thì không đổi và không báo lại.
    if (current.split(ATTENTION_SEPARATOR).includes(reason)) return null;
    const next = `${current}${ATTENTION_SEPARATOR}${reason}`;
    const r = await db.order.updateMany({
      where: { id: orderId, ...open, pancakeAttention: current },
      data: { pancakeAttention: next, pancakeAttentionAt: new Date() },
    });
    if (r.count === 1) return next;
  }
  return null;
}

/** Đơn đã huỷ xong trên Pancake (hoặc chưa từng lên): việc đẩy/huỷ/báo thanh toán còn treo không còn ý nghĩa. */
export const ATTENTION_SETTLED_BY_CANCEL = [ATTENTION_PUSH_FAILED, ATTENTION_CANCEL_PENDING, ATTENTION_PAYMENT_PENDING];

/** Gỡ lý do do chính chiều outbound ghi (việc đã tự xong) — không đụng lý do khác (webhook, admin). */
export async function clearPancakeAttention(prisma: Pick<Prisma.TransactionClient, 'order'>, orderId: string, prefix: string | string[]): Promise<void> {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  await prisma.order.updateMany({
    where: { id: orderId, OR: prefixes.map((p) => ({ pancakeAttention: { startsWith: p } })) },
    data: { pancakeAttention: null, pancakeAttentionAt: null },
  });
}

const ATTENTION_SEPARATOR = ' | ';

/** Nối một lý do vào hàng cần xử lý mà không làm mất lý do đang có (cùng dấu nối với việc ghi dấu trạng thái bị chặn). */
export const appendAttentionReason = (current: string | null | undefined, reason: string): string =>
  current && !current.split(ATTENTION_SEPARATOR).includes(reason) ? `${current}${ATTENTION_SEPARATOR}${reason}` : reason;

/** Gỡ đúng một lý do khỏi hàng cần xử lý (khi việc đó đã có người quyết); hết lý do thì đơn rời hàng đợi. */
export async function removeAttentionReason(tx: Pick<Prisma.TransactionClient, 'order'>, orderId: string, reason: string): Promise<void> {
  const row = await tx.order.findUnique({ where: { id: orderId }, select: { pancakeAttention: true } });
  if (!row?.pancakeAttention) return;
  const all = row.pancakeAttention.split(ATTENTION_SEPARATOR);
  const rest = all.filter((part) => part !== reason);
  if (rest.length === all.length) return;
  await tx.order.updateMany({
    where: { id: orderId },
    data: rest.length > 0 ? { pancakeAttention: rest.join(ATTENTION_SEPARATOR) } : { pancakeAttention: null, pancakeAttentionAt: null },
  });
}

/**
 * Gỡ mọi lý do bắt đầu bằng một trong các tiền tố khỏi hàng cần xử lý, giữ lý do khác (clearPancakeAttention xoá cả hàng khi lý do
 * ĐẦU khớp). Đọc rồi ghi có điều kiện theo đúng giá trị đã đọc, nên lý do vừa được ghi chen giữa không bị ghi đè; thua thì đọc lại.
 */
export async function removeAttentionReasonsByPrefix(
  db: Pick<Prisma.TransactionClient, 'order'>,
  orderId: string,
  prefixes: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await db.order.findUnique({ where: { id: orderId }, select: { pancakeAttention: true } });
    if (!row?.pancakeAttention) return;
    const all = row.pancakeAttention.split(ATTENTION_SEPARATOR);
    const rest = all.filter((part) => !prefixes.some((prefix) => part.startsWith(prefix)));
    if (rest.length === all.length) return;
    const r = await db.order.updateMany({
      where: { id: orderId, pancakeAttention: row.pancakeAttention },
      data: rest.length > 0 ? { pancakeAttention: rest.join(ATTENTION_SEPARATOR) } : { pancakeAttention: null, pancakeAttentionAt: null },
    });
    if (r.count === 1) return;
  }
}

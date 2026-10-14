import type { Logger } from '@nestjs/common';
import type { CustomerRefundKind, Order, Prisma, PrismaClient } from '@prisma/client';
import { notifyAdmins } from '../../common/notify-admins';
import type { BankDetails } from './refund-destination';
import { formatVnd, maskedBank } from './refund-destination';

/** Phần của NotificationsService cần ở đây (khai báo cấu trúc: hàm tự do không kéo DI/vòng module). */
export interface RefundNotifier {
  notify(userId: string, templateCode: string, data: Record<string, string>): Promise<void>;
}

export const OPS_REFUND_TEMPLATE = 'OPS_REFUND_ALERT';
/** Báo admin tiền khách trả không khớp đơn (lệch số tiền ZaloPay). */
export const OPS_PAYMENT_TEMPLATE = 'OPS_PAYMENT_ALERT';

/**
 * Ghi một khoản Tubu phải chuyển khoản trả khách (D2) trong tx của caller. Caller giữ guard một lần (lật trạng thái
 * đơn / yêu cầu trả); unique (orderId, kind, refKey) là lớp hai.
 */
export async function createBankRefund(
  tx: Prisma.TransactionClient,
  input: {
    order: Pick<Order, 'id' | 'code' | 'userId'>;
    kind: CustomerRefundKind;
    refKey?: string;
    amount: number;
    bank: BankDetails | null;
    reason: string;
  },
) {
  return tx.orderCustomerRefund.create({
    data: {
      orderId: input.order.id,
      orderCode: input.order.code,
      kind: input.kind,
      refKey: input.refKey ?? '',
      userId: input.order.userId,
      amount: input.amount,
      method: 'MANUAL_TRANSFER',
      status: 'PENDING',
      reason: input.reason,
      bankName: input.bank?.bankName ?? null,
      bankAccountNo: input.bank?.accountNumber ?? null,
      bankAccountName: input.bank?.accountName ?? null,
    },
  });
}

/**
 * Báo khách + admin sau khi khoản chuyển khoản đã commit. Best-effort: lỗi gửi tin không đổi được sổ. Caller đã báo khách
 * bằng tin của chính sự kiện (huỷ đơn / duyệt trả kèm refund_note nói rõ số tiền và tài khoản) thì tắt `notifyCustomer` —
 * một lần huỷ chỉ một tin (R2-BUYERMINI-9).
 */
export async function announceBankRefund(
  ctx: { prisma: Pick<PrismaClient, 'user'>; notifications?: RefundNotifier; logger: Pick<Logger, 'warn'> },
  refund: { orderCode: string; amount: number; userId: string | null; bankName: string | null; bankAccountNo: string | null },
  opts: { notifyCustomer?: boolean } = {},
): Promise<void> {
  const amount = formatVnd(refund.amount);
  if ((opts.notifyCustomer ?? true) && refund.userId && refund.bankAccountNo) {
    await ctx.notifications
      ?.notify(refund.userId, 'REFUND_BANK_REQUESTED', {
        order_code: refund.orderCode,
        amount,
        bank: maskedBank(refund),
      })
      .catch(() => undefined);
  }
  await notifyAdmins(
    { prisma: ctx.prisma, notifications: ctx.notifications, logger: ctx.logger },
    {
      template: OPS_REFUND_TEMPLATE,
      subject: `khoản hoàn ${amount} đơn ${refund.orderCode}`,
      data: () => ({
        order_code: refund.orderCode,
        message: refund.bankAccountNo
          ? `khách chọn nhận ${amount} về ${maskedBank(refund)} — ở mục Hoàn tiền bấm "Bắt đầu chuyển khoản" để khoá nơi nhận, chuyển khoản, rồi bấm "Đã chuyển khoản".`
          : `cần hoàn ${amount}, đang chờ khách chọn nơi nhận.`,
      }),
    },
  ).catch((err) => ctx.logger.warn(`Không báo được admin khoản hoàn đơn ${refund.orderCode}: ${err instanceof Error ? err.message : err}`));
}

type LateCtx = {
  prisma: Pick<PrismaClient, 'user' | 'order' | '$transaction'>;
  notifications?: RefundNotifier;
  logger: Pick<Logger, 'warn' | 'log'>;
};
type LateOrder = Pick<Order, 'id' | 'code' | 'userId' | 'status' | 'paymentStatus'>;
type LateSource = 'PANCAKE' | 'ZALOPAY' | 'ADMIN';

/** refKey của khoản admin ghi tay: một đơn chỉ có một khoản như vậy (unique orderId+kind+refKey là lớp hai). */
export const ADMIN_LATE_PAYMENT_REF = 'manual';
const ADMIN_LATE_PREFIX = 'ADMIN:';

/**
 * Tiền chuyển khoản / ZaloPay về khi đơn đã huỷ hoặc hết hạn (BUYERMINI-7, MONEY-6): không "hồi sinh" đơn mà ghi một
 * khoản hoàn LATE_PAYMENT (chưa có nơi nhận — khách tự chọn Ví hay ngân hàng ở chi tiết đơn), báo khách và admin.
 * Webhook gửi lại cùng giao dịch (refKey) không tạo khoản thứ hai, không báo lại; đơn đã PAID/REFUNDED (tiền này đã vào đơn,
 * hoàn theo luồng huỷ/trả) không tạo khoản nào. Trả true khi vừa tạo.
 *
 * Một lần chuyển tiền không được thành hai khoản hoàn (khách chọn Ví là tiền rút được ngay): admin ghi tay (đối soát sao
 * kê, mã GD gõ tay có thể lệch) chỉ được khi đơn chưa có khoản tiền về muộn nào; webhook báo tiền về cho đơn đã có khoản
 * admin ghi tay thì không tạo thêm mà đưa vào "Cần xử lý Pancake" để người đối soát. Khoá dòng đơn để các đường ghi chen
 * nhau vẫn thấy nhau.
 */
export async function recordLatePaymentRefund(
  ctx: LateCtx,
  order: LateOrder,
  input: { amount: number; source: LateSource; refKey: string; note?: string },
): Promise<boolean> {
  if (!(input.amount > 0)) return false;
  if (order.paymentStatus !== 'UNPAID') return false;
  const viaAdmin = input.source === 'ADMIN';
  const refKey = `${input.source}:${viaAdmin ? ADMIN_LATE_PAYMENT_REF : input.refKey}`;
  const outcome = await ctx.prisma.$transaction(async (tx) => {
    await lockOrderRow(tx, order.id);
    const prior = await tx.orderCustomerRefund.findFirst({
      where: {
        orderId: order.id,
        kind: 'LATE_PAYMENT',
        refKey: viaAdmin ? undefined : { startsWith: ADMIN_LATE_PREFIX },
      },
      select: { id: true },
    });
    if (prior) return viaAdmin ? ('EXISTS' as const) : ('ADMIN_RECORDED' as const);
    const created = await tx.orderCustomerRefund.createMany({
      data: [lateRow(order, refKey, input.amount, input.note)],
      skipDuplicates: true,
    });
    return created.count === 0 ? ('EXISTS' as const) : ('CREATED' as const);
  });
  if (outcome === 'ADMIN_RECORDED') {
    await flagManualDuplicate(ctx, order, adminRecordedReason(order, input.amount, input.source));
    return false;
  }
  if (outcome === 'EXISTS') return false;
  await announceLatePayment(ctx, order, input.amount, input.source);
  return true;
}

/**
 * Pancake báo số đã trả của đơn dạng CỘNG DỒN (prepaid + bank_payment), không phải từng lần chuyển (R2-LIFECYCLE-3).
 * Khoản hoàn chỉ là phần tăng thêm so với tổng các khoản LATE_PAYMENT Pancake đã ghi của đơn — khoá dòng đơn để hai
 * webhook đồng thời không cùng tính trên một tổng cũ; số cộng dồn nằm trong refKey nên webhook gửi lại là no-op. Số báo
 * giảm (nhân viên sửa số nhập nhầm) không tạo gì. Đơn đã có khoản admin ghi tay thì không tạo thêm mà đưa vào "Cần xử lý
 * Pancake" như `recordLatePaymentRefund`. Trả số vừa ghi (0 khi không có gì mới).
 */
export async function recordCumulativeLatePayment(
  ctx: LateCtx,
  order: LateOrder,
  input: { reportedTotal: number; source: 'PANCAKE' },
): Promise<number> {
  if (!(input.reportedTotal > 0)) return 0;
  if (order.paymentStatus !== 'UNPAID') return 0;
  const prefix = `${input.source}:`;
  const outcome = await ctx.prisma.$transaction(async (tx) => {
    await lockOrderRow(tx, order.id);
    const manual = await tx.orderCustomerRefund.findFirst({
      where: { orderId: order.id, kind: 'LATE_PAYMENT', refKey: { startsWith: ADMIN_LATE_PREFIX } },
      select: { id: true },
    });
    if (manual) return 'ADMIN_RECORDED' as const;
    const recorded = await tx.orderCustomerRefund.aggregate({
      where: { orderId: order.id, kind: 'LATE_PAYMENT', refKey: { startsWith: prefix } },
      _sum: { amount: true },
    });
    const amount = input.reportedTotal - (recorded._sum.amount ?? 0);
    if (amount <= 0) return 0;
    const created = await tx.orderCustomerRefund.createMany({
      data: [lateRow(order, `${prefix}paid:${input.reportedTotal}`, amount)],
      skipDuplicates: true,
    });
    return created.count > 0 ? amount : 0;
  });
  if (outcome === 'ADMIN_RECORDED') {
    await flagManualDuplicate(ctx, order, adminRecordedReason(order, input.reportedTotal, input.source));
    return 0;
  }
  if (outcome > 0) await announceLatePayment(ctx, order, outcome, input.source);
  return outcome;
}

async function lockOrderRow(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "orders" WHERE "id" = ${orderId} FOR NO KEY UPDATE`;
}

function lateRow(order: LateOrder, refKey: string, amount: number, note?: string): Prisma.OrderCustomerRefundCreateManyInput {
  return {
    orderId: order.id,
    orderCode: order.code,
    kind: 'LATE_PAYMENT',
    refKey,
    userId: order.userId,
    amount,
    method: 'MANUAL_TRANSFER',
    status: 'PENDING',
    reason: order.status,
    adminNote: note ?? null,
  };
}

function channelOf(source: LateSource): string {
  return source === 'ZALOPAY' ? 'ZaloPay' : 'chuyển khoản';
}

function adminRecordedReason(order: LateOrder, rawAmount: number, source: LateSource): string {
  const amount = formatVnd(rawAmount);
  return `${source === 'ZALOPAY' ? 'ZaloPay' : 'Pancake'} báo nhận ${amount} ${channelOf(source)} cho đơn đã ${order.status === 'RETURNED' ? 'trả' : 'huỷ'}, nhưng admin đã ghi tay khoản tiền về muộn của đơn này — KHÔNG tạo thêm khoản hoàn. Đối soát sao kê: cùng một lần chuyển thì bỏ qua; khách chuyển thêm lần nữa thì hoàn tay phần chênh.`;
}

async function announceLatePayment(ctx: LateCtx, order: LateOrder, rawAmount: number, source: LateSource) {
  const amount = formatVnd(rawAmount);
  ctx.logger.warn(`Tiền ${source} ${amount} về cho đơn ${order.code} đã ${order.status} — đã tạo yêu cầu hoàn tiền.`);
  await ctx.notifications
    ?.notify(order.userId, 'REFUND_LATE_PAYMENT', { order_code: order.code, amount })
    .catch(() => undefined);
  await notifyAdmins(
    { prisma: ctx.prisma, notifications: ctx.notifications, logger: ctx.logger },
    {
      template: OPS_REFUND_TEMPLATE,
      subject: `tiền về muộn đơn ${order.code}`,
      data: () => ({
        order_code: order.code,
        message: `nhận ${amount} qua ${channelOf(source)} sau khi đơn đã huỷ — đã tạo yêu cầu hoàn tiền, chờ khách chọn nơi nhận.`,
      }),
    },
  ).catch((err) => ctx.logger.warn(`Không báo được admin tiền về muộn đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
}

/** Ghi vào "Cần xử lý Pancake" (trùng lý do thì thôi — webhook gửi lại không báo lại) và báo admin lần đầu. */
async function flagManualDuplicate(
  ctx: { prisma: Pick<PrismaClient, 'user' | 'order'>; notifications?: RefundNotifier; logger: Pick<Logger, 'warn' | 'log'> },
  order: Pick<Order, 'id' | 'code'>,
  reason: string,
): Promise<void> {
  const r = await ctx.prisma.order.updateMany({
    where: { id: order.id, OR: [{ pancakeAttention: null }, { pancakeAttention: { not: reason } }] },
    data: { pancakeAttention: reason, pancakeAttentionAt: new Date() },
  });
  if (r.count === 0) return;
  ctx.logger.warn(`Đơn ${order.code}: ${reason}`);
  await notifyAdmins(
    { prisma: ctx.prisma, notifications: ctx.notifications, logger: ctx.logger },
    { template: OPS_REFUND_TEMPLATE, subject: `tiền về muộn đơn ${order.code}`, data: () => ({ order_code: order.code, message: reason }) },
  ).catch((err) => ctx.logger.warn(`Không báo được admin tiền về muộn đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
}

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

/** Báo khách + admin sau khi khoản chuyển khoản đã commit. Best-effort: lỗi gửi tin không đổi được sổ. */
export async function announceBankRefund(
  ctx: { prisma: Pick<PrismaClient, 'user'>; notifications?: RefundNotifier; logger: Pick<Logger, 'warn'> },
  refund: { orderCode: string; amount: number; userId: string | null; bankName: string | null; bankAccountNo: string | null },
): Promise<void> {
  const amount = formatVnd(refund.amount);
  if (refund.userId && refund.bankAccountNo) {
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
          ? `khách chọn nhận ${amount} về ${maskedBank(refund)} — chuyển khoản rồi bấm "Đã chuyển khoản" ở mục Hoàn tiền.`
          : `cần hoàn ${amount}, đang chờ khách chọn nơi nhận.`,
      }),
    },
  ).catch((err) => ctx.logger.warn(`Không báo được admin khoản hoàn đơn ${refund.orderCode}: ${err instanceof Error ? err.message : err}`));
}

/** refKey của khoản admin ghi tay: một đơn chỉ có một khoản như vậy (unique orderId+kind+refKey là lớp hai). */
export const ADMIN_LATE_PAYMENT_REF = 'manual';

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
  ctx: {
    prisma: Pick<PrismaClient, 'user' | 'order' | '$transaction'>;
    notifications?: RefundNotifier;
    logger: Pick<Logger, 'warn' | 'log'>;
  },
  order: Pick<Order, 'id' | 'code' | 'userId' | 'status' | 'paymentStatus'>,
  input: { amount: number; source: 'PANCAKE' | 'ZALOPAY' | 'ADMIN'; refKey: string; note?: string },
): Promise<boolean> {
  if (!(input.amount > 0)) return false;
  if (order.paymentStatus !== 'UNPAID') return false;
  const viaAdmin = input.source === 'ADMIN';
  const refKey = `${input.source}:${viaAdmin ? ADMIN_LATE_PAYMENT_REF : input.refKey}`;
  const outcome = await ctx.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "orders" WHERE "id" = ${order.id} FOR NO KEY UPDATE`;
    const prior = await tx.orderCustomerRefund.findFirst({
      where: {
        orderId: order.id,
        kind: 'LATE_PAYMENT',
        refKey: viaAdmin ? undefined : { startsWith: 'ADMIN:' },
      },
      select: { id: true },
    });
    if (prior) return viaAdmin ? ('EXISTS' as const) : ('ADMIN_RECORDED' as const);
    const created = await tx.orderCustomerRefund.createMany({
      data: [
        {
          orderId: order.id,
          orderCode: order.code,
          kind: 'LATE_PAYMENT',
          refKey,
          userId: order.userId,
          amount: input.amount,
          method: 'MANUAL_TRANSFER',
          status: 'PENDING',
          reason: order.status,
          adminNote: input.note ?? null,
        },
      ],
      skipDuplicates: true,
    });
    return created.count === 0 ? ('EXISTS' as const) : ('CREATED' as const);
  });
  const amount = formatVnd(input.amount);
  const channel = input.source === 'ZALOPAY' ? 'ZaloPay' : 'chuyển khoản';
  if (outcome === 'ADMIN_RECORDED') {
    await flagManualDuplicate(ctx, order, `${input.source === 'ZALOPAY' ? 'ZaloPay' : 'Pancake'} báo nhận ${amount} ${channel} cho đơn đã ${order.status === 'RETURNED' ? 'trả' : 'huỷ'}, nhưng admin đã ghi tay khoản tiền về muộn của đơn này — KHÔNG tạo thêm khoản hoàn. Đối soát sao kê: cùng một lần chuyển thì bỏ qua; khách chuyển thêm lần nữa thì hoàn tay phần chênh.`);
    return false;
  }
  if (outcome === 'EXISTS') return false;
  ctx.logger.warn(`Tiền ${input.source} ${amount} về cho đơn ${order.code} đã ${order.status} — đã tạo yêu cầu hoàn tiền.`);
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
        message: `nhận ${amount} qua ${channel} sau khi đơn đã huỷ — đã tạo yêu cầu hoàn tiền, chờ khách chọn nơi nhận.`,
      }),
    },
  ).catch((err) => ctx.logger.warn(`Không báo được admin tiền về muộn đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
  return true;
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

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

/**
 * Tiền chuyển khoản / ZaloPay về khi đơn đã huỷ hoặc hết hạn (BUYERMINI-7, MONEY-6): không "hồi sinh" đơn mà ghi một
 * khoản hoàn LATE_PAYMENT (chưa có nơi nhận — khách tự chọn Ví hay ngân hàng ở chi tiết đơn), báo khách và admin.
 * Webhook gửi lại cùng giao dịch (refKey) không tạo khoản thứ hai, không báo lại. Trả true khi vừa tạo.
 */
export async function recordLatePaymentRefund(
  ctx: {
    prisma: Pick<PrismaClient, 'user' | 'orderCustomerRefund'>;
    notifications?: RefundNotifier;
    logger: Pick<Logger, 'warn' | 'log'>;
  },
  order: Pick<Order, 'id' | 'code' | 'userId' | 'status'>,
  input: { amount: number; source: 'PANCAKE' | 'ZALOPAY' | 'ADMIN'; refKey: string },
): Promise<boolean> {
  if (!(input.amount > 0)) return false;
  const created = await ctx.prisma.orderCustomerRefund.createMany({
    data: [
      {
        orderId: order.id,
        orderCode: order.code,
        kind: 'LATE_PAYMENT',
        refKey: `${input.source}:${input.refKey}`,
        userId: order.userId,
        amount: input.amount,
        method: 'MANUAL_TRANSFER',
        status: 'PENDING',
        reason: order.status,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 0) return false;
  const amount = formatVnd(input.amount);
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
        message: `nhận ${amount} qua ${input.source === 'ZALOPAY' ? 'ZaloPay' : 'chuyển khoản'} sau khi đơn đã huỷ — đã tạo yêu cầu hoàn tiền, chờ khách chọn nơi nhận.`,
      }),
    },
  ).catch((err) => ctx.logger.warn(`Không báo được admin tiền về muộn đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
  return true;
}

import type { Logger } from '@nestjs/common';
import type { CustomerRefundKind, CustomerRefundStatus, Order, Prisma, PrismaClient } from '@prisma/client';
import { notifyAdmins } from '../../common/notify-admins';
import { maskPhone } from '../../common/mask-pii';
import { toLocalPhone } from '../../common/phone';
import type { BankDetails } from './refund-destination';
import { formatVnd, maskedBank } from './refund-destination';
import { ATTENTION_UNDERPAID } from '../integrations/pancake/pancake-attention';

/** Phần của NotificationsService cần ở đây (khai báo cấu trúc: hàm tự do không kéo DI/vòng module). */
export interface RefundNotifier {
  notify(userId: string, templateCode: string, data: Record<string, string>): Promise<void>;
}

/**
 * Khoản chuyển khoản Tubu còn nợ khách: chưa ai chuyển (PENDING) hoặc admin đang chuyển (PROCESSING). Đơn đã lật REFUNDED
 * mà còn khoản này thì tiền chưa tới tay khách — "Đang hoàn tiền" ở CSV đơn admin, cùng luật với web (order-view.ts,
 * isRefundInProgress) cho danh sách đơn admin và chi tiết đơn của khách.
 */
export const BANK_REFUND_IN_PROGRESS = {
  method: 'MANUAL_TRANSFER',
  status: { in: ['PENDING', 'PROCESSING'] },
} satisfies Prisma.OrderCustomerRefundWhereInput;

/**
 * Khoản còn mở mà CSV đơn admin cần để ghi "Đang hoàn tiền": chuyển khoản Tubu Chờ/Đang chuyển (đơn REFUNDED), hoặc tiền về
 * muộn/chuyển dư Chờ/Đang chuyển (đơn còn UNPAID). Luật chọn nhãn nằm ở exportPaymentStatus, cùng luật web (order-view.ts).
 */
export const OPEN_REFUND_FOR_EXPORT = {
  OR: [BANK_REFUND_IN_PROGRESS, { kind: { in: ['LATE_PAYMENT', 'OVERPAYMENT'] }, status: { in: ['PENDING', 'PROCESSING'] } }],
} satisfies Prisma.OrderCustomerRefundWhereInput;

/**
 * Khoản hoàn còn việc cho admin: chờ đối soát (UNVERIFIED), chờ chuyển khoản (PENDING), đang chuyển khoản (PROCESSING). Một
 * nguồn cho số trên thẻ "Hoàn tiền khách" (OpsInboxService), huy hiệu tab và bộ lọc "Đang mở" của hàng đợi.
 */
export const OPEN_CUSTOMER_REFUND_STATUSES = ['UNVERIFIED', 'PENDING', 'PROCESSING'] as const satisfies readonly CustomerRefundStatus[];

export const OPS_REFUND_TEMPLATE = 'OPS_REFUND_ALERT';
/** Báo admin tiền khách trả không khớp đơn (lệch số tiền ZaloPay). */
export const OPS_PAYMENT_TEMPLATE = 'OPS_PAYMENT_ALERT';

/**
 * Người nhận tiền hoàn của đơn CTV lên hộ: khách cuối, chỉ có SĐT (endCustomerKey; đơn hộ cũ chưa có thì đọc snapshot địa chỉ)
 * và tên người nhận — không có tài khoản trên đơn. Dùng chung cho mọi khoản hoàn của đơn hộ (huỷ/trả, tiền về muộn, trả dư).
 */
export function endCustomerPayee(order: Pick<Order, 'endCustomerKey' | 'shippingAddress'>): { phone: string | null; recipientName: string | null } {
  const snapshot = (order.shippingAddress ?? {}) as { phone?: unknown; recipient?: unknown };
  return {
    phone: order.endCustomerKey ?? (typeof snapshot.phone === 'string' ? toLocalPhone(snapshot.phone) : null),
    recipientName: typeof snapshot.recipient === 'string' ? snapshot.recipient : null,
  };
}

/**
 * refKey của khoản hoàn COD trả hàng chờ kế toán đối soát (UNVERIFIED): một đơn chỉ có một khoản như vậy (Pancake "Đã hoàn" trên
 * đơn COD đã giao khi Tubu chưa có bằng chứng hãng thu COD). Loại RETURN nhưng không có yêu cầu trả hàng đứng sau.
 */
export const COD_RETURN_UNVERIFIED_REF = 'cod-return-unverified';

/** Khoản chờ đối soát do Pancake báo (tiền khách trả dư) hoặc do hệ thống giữ lại (hoàn COD chưa rõ đã thu) — cùng đường xác nhận/bỏ qua. */
export const isUnverifiedRefundRow = (row: { kind: CustomerRefundKind; status: CustomerRefundStatus; refKey: string }): boolean =>
  row.status === 'UNVERIFIED' && (row.kind === 'OVERPAYMENT' || (row.kind === 'RETURN' && row.refKey === COD_RETURN_UNVERIFIED_REF));

type RefundOwnerFacts = Pick<Order, 'userId' | 'placedForCustomer' | 'endCustomerKey' | 'shippingAddress'>;

/**
 * Ai là chủ khoản hoàn tiền về muộn / trả dư. Đơn thường: người đặt (thấy khoản ở chi tiết đơn và tự chọn nơi nhận). Đơn CTV
 * lên hộ: userId là CTV nhưng tiền là của khách cuối (C-001) — khoản không có chủ tài khoản, mang SĐT + tên người nhận, CTV không
 * thấy và không chọn được nơi nhận (chọn Ví sẽ cộng tiền khách cuối vào Ví CTV).
 */
function refundOwner(order: RefundOwnerFacts): { userId: string | null; phone?: string | null; recipientName?: string | null } {
  return order.placedForCustomer ? { userId: null, ...endCustomerPayee(order) } : { userId: order.userId };
}

/**
 * Đơn COD đã giao bị Pancake báo "Đã hoàn" mà chưa có bằng chứng hãng thu COD: ghi số tiền có thể phải hoàn thành khoản chờ đối
 * soát (UNVERIFIED) trong tx lật trạng thái. Khách không thấy, không được báo; Kế toán xác nhận (→ PENDING, khách chọn nơi nhận)
 * hoặc bỏ qua kèm lý do. Gọi lại cùng đơn không tạo khoản thứ hai (unique orderId+kind+refKey).
 */
export async function recordCodReturnUnverified(
  tx: Prisma.TransactionClient,
  order: Pick<Order, 'id' | 'code'> & RefundOwnerFacts,
  amount: number,
): Promise<void> {
  await tx.orderCustomerRefund.createMany({
    data: [
      {
        orderId: order.id,
        orderCode: order.code,
        kind: 'RETURN',
        refKey: COD_RETURN_UNVERIFIED_REF,
        ...refundOwner(order),
        amount,
        method: 'MANUAL_TRANSFER',
        status: 'UNVERIFIED',
        reason: 'RETURNED',
      },
    ],
    skipDuplicates: true,
  });
}

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
 * Dòng vết của khoản đã hoàn thẳng vào Ví khi huỷ/trả (R2-LIFECYCLE-5): chi tiết đơn của khách (web, mini app) đọc hàng
 * này để nói "đã hoàn X vào Ví Tubu" như với khoản chuyển khoản. Không phải việc của admin (method WALLET, COMPLETED).
 */
export async function recordWalletRefund(
  tx: Prisma.TransactionClient,
  input: { order: Pick<Order, 'id' | 'code' | 'userId'>; kind: 'CANCEL' | 'RETURN'; refKey?: string; amount: number; reason: string },
): Promise<void> {
  await tx.orderCustomerRefund.createMany({
    data: [
      {
        orderId: input.order.id,
        orderCode: input.order.code,
        kind: input.kind,
        refKey: input.refKey ?? '',
        userId: input.order.userId,
        customerUserId: input.order.userId,
        amount: input.amount,
        method: 'WALLET',
        status: 'COMPLETED',
        completedAt: new Date(),
        reason: input.reason,
      },
    ],
    skipDuplicates: true,
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
type LateOrder = Pick<Order, 'id' | 'code' | 'userId' | 'status' | 'paymentStatus'> & RefundOwnerFacts;
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
    await flagRefundAttention(ctx, order, adminRecordedReason(order, input.amount, input.source));
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
  opts: { notifyCustomer?: boolean } = {},
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
    await flagRefundAttention(ctx, order, adminRecordedReason(order, input.reportedTotal, input.source));
    return 0;
  }
  // Số Pancake báo đã nằm trọn trong khoản hoàn: cảnh báo "khách chuyển thiếu" của đơn đã huỷ không còn việc gì.
  await ctx.prisma.order.updateMany({
    where: { id: order.id, pancakeAttention: { startsWith: ATTENTION_UNDERPAID } },
    data: { pancakeAttention: null, pancakeAttentionAt: null },
  });
  if (outcome > 0) await announceLatePayment(ctx, order, outcome, input.source, opts.notifyCustomer ?? true);
  return outcome;
}

/** Tổng các khoản hoàn "chuyển thiếu" Pancake đã ghi cho đơn (kể cả do lần chạy trước), để tin huỷ nói đúng số dù lần này ghi được 0. */
export async function recordedPancakeUnderpayment(prisma: Pick<PrismaClient, 'orderCustomerRefund'>, orderId: string): Promise<number> {
  const r = await prisma.orderCustomerRefund.aggregate({
    where: { orderId, kind: 'LATE_PAYMENT', refKey: { startsWith: 'PANCAKE:' } },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

/**
 * Đơn chuyển khoản bị huỷ khi Pancake đã báo khách chuyển một phần (R3-MONEY-5): hoàn ngay số đã nhận (cùng khoá với
 * webhook Pancake báo lại số đó sau này, nên không thành hai khoản). Mặc định caller báo khách trong chính tin huỷ đơn
 * (`receivedRefundNote`) — một lần huỷ một tin. Trả số vừa ghi.
 */
export async function refundReportedUnderpayment(ctx: LateCtx, orderId: string, opts: { notifyCustomer?: boolean } = {}): Promise<number> {
  const order = await ctx.prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== 'CANCELLED' || order.paymentMethod !== 'BANK_TRANSFER' || order.paymentStatus !== 'UNPAID') return 0;
  const reported = order.pancakePaidReported ?? 0;
  if (!(reported > 0)) return 0;
  return recordCumulativeLatePayment(ctx, order, { reportedTotal: reported, source: 'PANCAKE' }, { notifyCustomer: opts.notifyCustomer ?? false });
}

/**
 * Câu thêm vào tin huỷ khi đã ghi khoản hoàn cho số tiền khách chuyển thiếu. Đơn CTV lên hộ: tin đi tới CTV, còn tiền là của
 * khách cuối do admin chuyển khoản tay — không mời CTV "chọn nhận về Ví".
 */
export function receivedRefundNote(amount: number, toEndCustomer = false): string {
  if (!(amount > 0)) return '';
  return toEndCustomer
    ? ` Tubu đã nhận ${formatVnd(amount)} chuyển khoản của đơn này và sẽ hoàn lại cho người nhận hàng.`
    : ` Tubu đã nhận ${formatVnd(amount)} chuyển khoản của đơn này — vào chi tiết đơn để chọn nhận lại về Ví Tubu (ngay) hoặc tài khoản ngân hàng.`;
}

type OverOrder = Pick<Order, 'id' | 'code' | 'userId' | 'status' | 'total'> & RefundOwnerFacts;

/**
 * Khách trả thêm cho đơn đã nhận đủ tiền qua ZaloPay (R3-MONEY-1): lệnh thứ hai cũng thành công (callback lần đầu thất lạc,
 * khách bấm thanh toán lại). Cổng đã xác thực khoản này (MAC, đúng số tiền, lệnh khác lệnh đã lật PAID) nên ghi thẳng khoản
 * hoàn OVERPAYMENT chờ khách chọn Ví hay ngân hàng, báo khách và admin. Một khoản mỗi lệnh (refKey = kênh + mã lệnh); trả
 * true khi vừa tạo.
 */
export async function recordOverpaymentRefund(
  ctx: LateCtx,
  order: OverOrder,
  input: { amount: number; source: 'ZALOPAY'; refKey: string },
): Promise<boolean> {
  if (!(input.amount > 0)) return false;
  const created = await ctx.prisma.$transaction((tx) =>
    tx.orderCustomerRefund.createMany({
      data: [overRow(order, `${input.source}:${input.refKey}`, input.amount, 'PENDING')],
      skipDuplicates: true,
    }),
  );
  if (created.count === 0) return false;
  await announceOverpayment(ctx, order, input.amount);
  return true;
}

/**
 * Pancake báo số đã trả vượt tổng đơn đã nhận đủ tiền: CHƯA phải bằng chứng khách chuyển dư — hợp đồng field
 * prepaid/bank_payment chưa đối chiếu được với payload thật, Tubu tự ghi transfer_money lên chính đơn đó, nhân viên có thể
 * sửa đơn trên Pancake (thêm món, phụ phí) mà tổng đơn Tubu không đổi. Nên chỉ ghi khoản OVERPAYMENT ở trạng thái
 * UNVERIFIED: khách không thấy, không chọn nơi nhận được, không được báo; admin đối chiếu sao kê rồi xác nhận
 * (CustomerRefundsService.verifyOverpayment) hoặc bỏ qua. Như `recordCumulativeLatePayment`, chỉ ghi phần tăng thêm so với
 * các khoản dư Pancake đã ghi (kể cả khoản đã bỏ qua — báo lại cùng số không đẻ việc mới); khoá dòng đơn, số cộng dồn nằm
 * trong refKey nên webhook gửi lại là no-op. Trả số vừa ghi.
 */
export async function recordCumulativeOverpayment(
  ctx: LateCtx,
  order: OverOrder,
  input: { reportedTotal: number; source: 'PANCAKE' },
): Promise<number> {
  const excess = input.reportedTotal - order.total;
  if (!(excess > 0)) return 0;
  const prefix = `${input.source}:`;
  const amount = await ctx.prisma.$transaction(async (tx) => {
    await lockOrderRow(tx, order.id);
    const recorded = await tx.orderCustomerRefund.aggregate({
      where: { orderId: order.id, kind: 'OVERPAYMENT', refKey: { startsWith: prefix } },
      _sum: { amount: true },
    });
    const add = excess - (recorded._sum.amount ?? 0);
    if (add <= 0) return 0;
    const created = await tx.orderCustomerRefund.createMany({
      data: [overRow(order, `${prefix}paid:${input.reportedTotal}`, add, 'UNVERIFIED')],
      skipDuplicates: true,
    });
    return created.count > 0 ? add : 0;
  });
  if (amount > 0) await announceUnverifiedOverpayment(ctx, order, amount, input.reportedTotal);
  return amount;
}

function overRow(
  order: OverOrder,
  refKey: string,
  amount: number,
  status: 'PENDING' | 'UNVERIFIED',
): Prisma.OrderCustomerRefundCreateManyInput {
  return {
    orderId: order.id,
    orderCode: order.code,
    kind: 'OVERPAYMENT',
    refKey,
    ...refundOwner(order),
    amount,
    method: 'MANUAL_TRANSFER',
    status,
    reason: order.status,
  };
}

async function announceOverpayment(ctx: LateCtx, order: OverOrder, rawAmount: number) {
  const amount = formatVnd(rawAmount);
  ctx.logger.warn(`Khách trả thêm ${amount} qua ZaloPay cho đơn ${order.code} đã nhận đủ tiền — đã tạo khoản hoàn tiền trả dư.`);
  // Đơn CTV lên hộ: người trả là khách cuối, CTV không có quyền chọn nơi nhận nên không báo CTV.
  if (!order.placedForCustomer) {
    await ctx.notifications
      ?.notify(order.userId, 'REFUND_OVERPAYMENT', { order_code: order.code, amount })
      .catch(() => undefined);
  }
  await notifyAdmins(
    { prisma: ctx.prisma, notifications: ctx.notifications, logger: ctx.logger },
    {
      template: OPS_REFUND_TEMPLATE,
      subject: `tiền trả dư đơn ${order.code}`,
      data: () => ({
        order_code: order.code,
        message:
          `ZaloPay xác nhận khách trả thêm ${amount} (một lệnh thanh toán khác) cho đơn đã nhận đủ ${formatVnd(order.total)} — đã tạo khoản hoàn "Tiền trả dư", ` +
          (order.placedForCustomer ? endCustomerQueueNote(order) : 'chờ khách chọn nơi nhận.'),
      }),
    },
  ).catch((err) => ctx.logger.warn(`Không báo được admin tiền trả dư đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
}

async function announceUnverifiedOverpayment(ctx: LateCtx, order: OverOrder, rawAmount: number, reportedTotal: number) {
  const amount = formatVnd(rawAmount);
  ctx.logger.warn(`Pancake báo đơn ${order.code} đã nhận ${formatVnd(reportedTotal)} (tổng đơn ${formatVnd(order.total)}) — khoản dư ${amount} chờ admin đối soát.`);
  await notifyAdmins(
    { prisma: ctx.prisma, notifications: ctx.notifications, logger: ctx.logger },
    {
      template: OPS_REFUND_TEMPLATE,
      subject: `tiền trả dư chờ đối soát đơn ${order.code}`,
      data: () => ({
        order_code: order.code,
        message:
          `Pancake báo đã nhận ${formatVnd(reportedTotal)} cho đơn đã nhận đủ ${formatVnd(order.total)} — có thể khách chuyển dư ${amount}. ` +
          'Khách CHƯA được báo. Đối chiếu sao kê: đúng là khách chuyển dư thì ở mục Hoàn tiền khách, bộ lọc "Chờ đối soát", bấm ' +
          (order.placedForCustomer
            ? `"Xác nhận tiền dư" (đơn CTV lên hộ: khoản là của khách cuối ${maskPhone(endCustomerPayee(order).phone)}, không ai được báo — admin chuyển khoản tay theo SĐT); `
            : '"Xác nhận tiền dư" (khách được báo để chọn nhận về Ví hay ngân hàng); ') +
          'cùng một lần chuyển hoặc nhân viên sửa đơn trên Pancake thì bấm "Không phải tiền dư".',
      }),
    },
  ).catch((err) => ctx.logger.warn(`Không báo được admin tiền trả dư đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
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
    ...refundOwner(order),
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

/** Lời cho admin: khoản của khách cuối đơn CTV lên hộ nằm ở hàng đợi chuyển khoản tay, không ai chọn nơi nhận. */
function endCustomerQueueNote(order: RefundOwnerFacts): string {
  return `khoản của khách cuối ${maskPhone(endCustomerPayee(order).phone)} (đơn CTV lên hộ, không phải của CTV) — liên hệ khách xin tài khoản, chuyển khoản tay rồi xác nhận ở mục Hoàn tiền khách.`;
}

function adminRecordedReason(order: LateOrder, rawAmount: number, source: LateSource): string {
  const amount = formatVnd(rawAmount);
  return `${source === 'ZALOPAY' ? 'ZaloPay' : 'Pancake'} báo nhận ${amount} ${channelOf(source)} cho đơn đã ${order.status === 'RETURNED' ? 'trả' : 'huỷ'}, nhưng admin đã ghi tay khoản tiền về muộn của đơn này — KHÔNG tạo thêm khoản hoàn. Đối soát sao kê: cùng một lần chuyển thì bỏ qua; khách chuyển thêm lần nữa thì hoàn tay phần chênh.`;
}

async function announceLatePayment(ctx: LateCtx, order: LateOrder, rawAmount: number, source: LateSource, notifyCustomer = true) {
  const amount = formatVnd(rawAmount);
  ctx.logger.warn(`Tiền ${source} ${amount} về cho đơn ${order.code} đã ${order.status} — đã tạo yêu cầu hoàn tiền.`);
  // Đơn CTV lên hộ: tiền là của khách cuối, CTV không được mời chọn Ví hay ngân hàng cho khoản này.
  if (notifyCustomer && !order.placedForCustomer) {
    await ctx.notifications
      ?.notify(order.userId, 'REFUND_LATE_PAYMENT', { order_code: order.code, amount })
      .catch(() => undefined);
  }
  await notifyAdmins(
    { prisma: ctx.prisma, notifications: ctx.notifications, logger: ctx.logger },
    {
      template: OPS_REFUND_TEMPLATE,
      subject: `tiền về muộn đơn ${order.code}`,
      data: () => ({
        order_code: order.code,
        message:
          `nhận ${amount} qua ${channelOf(source)} sau khi đơn đã huỷ — đã tạo yêu cầu hoàn tiền, ` +
          (order.placedForCustomer ? endCustomerQueueNote(order) : 'chờ khách chọn nơi nhận.'),
      }),
    },
  ).catch((err) => ctx.logger.warn(`Không báo được admin tiền về muộn đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
}

/** Ghi vào "Cần xử lý Pancake" (trùng lý do thì thôi — webhook gửi lại không báo lại) và báo admin lần đầu. */
export async function flagRefundAttention(
  ctx: { prisma: Pick<PrismaClient, 'user' | 'order'>; notifications?: RefundNotifier; logger: Pick<Logger, 'warn' | 'log'> },
  order: Pick<Order, 'id' | 'code'>,
  reason: string,
  subject = `tiền về muộn đơn ${order.code}`,
): Promise<void> {
  const r = await ctx.prisma.order.updateMany({
    where: { id: order.id, OR: [{ pancakeAttention: null }, { pancakeAttention: { not: reason } }] },
    data: { pancakeAttention: reason, pancakeAttentionAt: new Date() },
  });
  if (r.count === 0) return;
  ctx.logger.warn(`Đơn ${order.code}: ${reason}`);
  await notifyAdmins(
    { prisma: ctx.prisma, notifications: ctx.notifications, logger: ctx.logger },
    { template: OPS_REFUND_TEMPLATE, subject, data: () => ({ order_code: order.code, message: reason }) },
  ).catch((err) => ctx.logger.warn(`Không báo được admin tiền về muộn đơn ${order.code}: ${err instanceof Error ? err.message : err}`));
}

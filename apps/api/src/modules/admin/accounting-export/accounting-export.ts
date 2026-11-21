import type { Prisma } from '@prisma/client';
import { invoiceBreakdownOf } from '@tubutree/shared-types';
import type { PrismaService } from '../../../prisma/prisma.service';
import { formatVnDateTime } from '../../../common/vn-time';
import { OPEN_REFUND_FOR_EXPORT } from '../../orders/refund-queue';
import { EXPORT_BATCH, ORDER_STATUS_CSV_LABEL, PAYMENT_METHOD_CSV_LABEL, exportPaymentStatus, row } from '../admin-export';
import type { ReportRange } from '../report-range';

/**
 * File đối soát doanh thu và hoàn tiền cho kế toán (`GET /admin/reports/accounting-export`): mỗi đơn đặt trong khoảng ngày (giờ VN) một dòng,
 * mọi trạng thái. Không có SĐT, tên hay ghi chú của khách. Cột tiền là số nguyên VNĐ (Excel cộng được), mọi ô chữ đi qua csvCell nên chuỗi mở đầu
 * bằng = + - @ không thành công thức.
 *
 * Mỗi dòng: Tiền hàng − CK thương mại − Giảm voucher − Giảm Điểm Xanh + Phí giao = Khách trả sau giảm (cột `total` của đơn).
 * "Doanh thu ghi nhận" theo đúng định nghĩa của báo cáo Doanh thu (admin-revenue.ts): cộng cột này trên cùng khoảng ngày ra đúng số "Doanh thu" ở
 * tab Báo cáo. Doanh thu đã trừ phần trả hàng đã duyệt, nên với đơn còn tính doanh thu: Khách trả − Đã hoàn − Hoàn đang chờ = Doanh thu ghi nhận
 * (không lấy Doanh thu trừ tiếp cột hoàn). Tiền khách chuyển thừa hoặc chuyển sau khi đơn đã huỷ không thuộc `total` nên nằm cột riêng.
 */
export const ACCOUNTING_CSV_HEADERS = [
  'Mã đơn',
  'Ngày đặt (giờ VN)',
  'Loại đơn',
  'Trạng thái đơn',
  'Phương thức TT',
  'Trạng thái TT',
  'Tiền hàng (VNĐ)',
  'CK thương mại (VNĐ)',
  'Giảm voucher (VNĐ)',
  'Giảm Điểm Xanh (VNĐ)',
  'Phí giao (VNĐ)',
  'Khách trả sau giảm (VNĐ)',
  'Đã hoàn khách (VNĐ)',
  'Hoàn đang chờ chi (VNĐ)',
  'Trả lại tiền chuyển thừa/về muộn (VNĐ)',
  'Doanh thu ghi nhận (VNĐ)',
] as const;

export const ACCOUNTING_ORDER_SELECT = {
  id: true,
  code: true,
  createdAt: true,
  type: true,
  status: true,
  fulfiller: true,
  paymentMethod: true,
  paymentStatus: true,
  subtotal: true,
  discount: true,
  couponDiscount: true,
  comboDiscount: true,
  tierDiscount: true,
  pointsDiscount: true,
  pointsUsed: true,
  shippingFee: true,
  total: true,
  customerRefunds: { where: OPEN_REFUND_FOR_EXPORT, select: { method: true, kind: true, status: true } },
} satisfies Prisma.OrderSelect;

export type AccountingOrder = Prisma.OrderGetPayload<{ select: typeof ACCOUNTING_ORDER_SELECT }>;

/**
 * Theo đơn: tiền của đơn đã trả lại khách (chuyển khoản xong hoặc đã cộng Ví) và còn nợ khách (chờ / đang chuyển khoản), do huỷ, trả hàng hay
 * hoàn cho khách cuối của đơn CTV; `extra` là tiền khách chuyển thừa hoặc chuyển sau khi đơn đã huỷ (không nằm trong `total`), mọi trạng thái còn hiệu lực.
 */
export interface RefundSums {
  completed: number;
  pending: number;
  extra: number;
}

const EXTRA_MONEY_KINDS: ReadonlySet<string> = new Set(['LATE_PAYMENT', 'OVERPAYMENT']);

/**
 * Bản sao bằng JS của REVENUE_ORDER_WHERE (admin-revenue.ts): đơn không huỷ/trả, không bị lật hoàn tiền, và đã thanh toán hoặc là COD kho Tubu
 * đã giao. COD của gian hàng tự giao do đối tác thu nên không phải doanh thu của Tubu.
 */
export function countsAsRevenue(o: Pick<AccountingOrder, 'status' | 'paymentStatus' | 'paymentMethod' | 'fulfiller'>): boolean {
  if (o.status === 'CANCELLED' || o.status === 'RETURNED') return false;
  if (o.paymentStatus === 'REFUNDED') return false;
  return o.paymentStatus === 'PAID' || (o.status === 'DELIVERED' && o.paymentMethod === 'COD' && o.fulfiller !== 'MERCHANT');
}

/**
 * Tách tổng giảm của đơn thành ba cột: Giảm Điểm Xanh (tiền quy đổi điểm), Giảm voucher (mã giảm giá) và CK thương mại (combo, hạng, bậc đại lý và
 * phần giảm không gán được vào khoản nào). Ba cột cộng lại luôn bằng `discount` của đơn.
 */
export function discountColumns(o: Pick<AccountingOrder, 'subtotal' | 'discount' | 'couponDiscount' | 'comboDiscount' | 'tierDiscount' | 'pointsDiscount' | 'pointsUsed' | 'shippingFee'>): {
  commercial: number;
  voucher: number;
  points: number;
} {
  const { tradeDiscountAmount: trade, pointsDiscountAmount: points } = invoiceBreakdownOf(o);
  const voucher = Math.min(Math.max(0, Math.trunc(o.couponDiscount)), trade);
  return { commercial: trade - voucher, voucher, points };
}

export function accountingRow(o: AccountingOrder, refunds: RefundSums | undefined, partialReturnRefund: number): string {
  const d = discountColumns(o);
  return row([
    o.code,
    formatVnDateTime(o.createdAt),
    o.type === 'DEALER' ? 'Đại lý' : 'Bán lẻ',
    ORDER_STATUS_CSV_LABEL[o.status] ?? o.status,
    PAYMENT_METHOD_CSV_LABEL[o.paymentMethod] ?? o.paymentMethod,
    exportPaymentStatus({ ...o, openRefunds: o.customerRefunds }),
    o.subtotal,
    d.commercial,
    d.voucher,
    d.points,
    o.shippingFee,
    o.total,
    refunds?.completed ?? 0,
    refunds?.pending ?? 0,
    refunds?.extra ?? 0,
    countsAsRevenue(o) ? o.total - partialReturnRefund : 0,
  ]);
}

/** Tổng tiền hoàn theo đơn của một lô: COMPLETED là đã trả lại khách; PENDING/PROCESSING là còn nợ. Khoản chờ đối soát hay đã bỏ qua không tính. */
export async function refundSumsFor(prisma: PrismaService, orderIds: readonly string[]): Promise<Map<string, RefundSums>> {
  const out = new Map<string, RefundSums>();
  if (orderIds.length === 0) return out;
  const rows = await prisma.orderCustomerRefund.groupBy({
    by: ['orderId', 'status', 'kind'],
    where: { orderId: { in: [...orderIds] }, status: { in: ['COMPLETED', 'PENDING', 'PROCESSING'] } },
    _sum: { amount: true },
  });
  for (const r of rows) {
    const cur = out.get(r.orderId) ?? { completed: 0, pending: 0, extra: 0 };
    const amount = r._sum.amount ?? 0;
    if (EXTRA_MONEY_KINDS.has(r.kind)) cur.extra += amount;
    else if (r.status === 'COMPLETED') cur.completed += amount;
    else cur.pending += amount;
    out.set(r.orderId, cur);
  }
  return out;
}

/** Phần đã hoàn của các lần trả hàng đã duyệt (tiền hàng + phí giao), cùng số báo cáo Doanh thu trừ khỏi đơn còn tính doanh thu. */
export async function partialReturnRefundsFor(prisma: PrismaService, orderIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (orderIds.length === 0) return out;
  const rows = await prisma.returnRequest.findMany({
    where: { orderId: { in: [...orderIds] }, status: 'APPROVED' },
    select: { orderId: true, refundAmount: true, shippingRefund: true },
  });
  for (const r of rows) out.set(r.orderId, (out.get(r.orderId) ?? 0) + (r.refundAmount ?? 0) + r.shippingRefund);
  return out;
}

/** Ghi dần từng lô 500 đơn (cũ trước), không dựng cả file trong bộ nhớ. */
export async function* accountingCsvChunks(prisma: PrismaService, range: Pick<ReportRange, 'start' | 'end'>): AsyncGenerator<string> {
  yield row([...ACCOUNTING_CSV_HEADERS]);
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.order.findMany({
      where: { createdAt: { gte: range.start, lt: range.end } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: EXPORT_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: ACCOUNTING_ORDER_SELECT,
    });
    if (batch.length === 0) return;
    const ids = batch.map((o) => o.id);
    const [refunds, returns] = await Promise.all([refundSumsFor(prisma, ids), partialReturnRefundsFor(prisma, ids)]);
    yield batch.map((o) => accountingRow(o, refunds.get(o.id), returns.get(o.id) ?? 0)).join('');
    if (batch.length < EXPORT_BATCH) return;
    cursor = batch[batch.length - 1]!.id;
  }
}

import { once } from 'node:events';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { PrismaService } from '../../prisma/prisma.service';
import { formatVnDateTime } from '../../common/vn-time';
import { maskPhoneKeepLast3 } from '../../common/mask-pii';
import { OPEN_REFUND_FOR_EXPORT } from '../orders/refund-queue';
import { orderPlatformLabel, orderSourceLabel } from './order-channel';

/** Số dòng đọc mỗi lượt khi xuất CSV: đủ lớn để nhanh, đủ nhỏ để không giữ cả bảng trong bộ nhớ. */
export const EXPORT_BATCH = 500;

/** Ký tự mở đầu khiến Excel/Google Sheets coi ô là CÔNG THỨC (ghi chú khách nhập có thể là `=HYPERLINK(...)`). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** Một ô CSV. Chuỗi bắt đầu bằng ký tự công thức được thêm dấu nháy đơn để Excel đọc như văn bản. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  let str = String(value);
  if (FORMULA_START.test(str)) str = `'${str}`;
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Chỉ gồm chữ số (có thể có + đầu): Excel đọc thành số và bỏ số 0 đầu của SĐT, mã vận đơn. */
const DIGITS_ONLY = /^\+?\d+$/;

/**
 * Ô phải giữ nguyên dạng chữ (SĐT, mã vận đơn, mã đơn Pancake): chuỗi toàn số được ghi thành công thức văn bản
 * `="0910087109"` — Excel và Google Sheets hiện đúng 0910087109 thay vì 910087109. Chuỗi khác đi như csvCell.
 */
export function csvText(value: string | null | undefined): string {
  if (value && DIGITS_ONLY.test(value)) return `"=""${value}"""`;
  return csvCell(value);
}

/** Ô đã mã hoá sẵn bằng csvText — row() ghi nguyên. */
class EncodedCell {
  constructor(readonly encoded: string) {}
}
export const text = (value: string | null | undefined) => new EncodedCell(csvText(value));

export const row = (cells: unknown[]) => `${cells.map((c) => (c instanceof EncodedCell ? c.encoded : csvCell(c))).join(',')}\r\n`;

const ORDER_STATUS: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đã đóng gói',
  SHIPPING: 'Đang vận chuyển',
  DELIVERED: 'Đã giao hàng',
  CANCELLED: 'Đã hủy',
  RETURNED: 'Đã trả hàng',
};
const PAYMENT_METHOD: Record<string, string> = {
  COD: 'COD (Tiền mặt)',
  ZALOPAY: 'ZaloPay',
  BANK_TRANSFER: 'Chuyển khoản',
  WALLET: 'Ví Tubu',
  XU: 'Xu cũ',
};
const PAYMENT_STATUS: Record<string, string> = {
  UNPAID: 'Chưa thanh toán',
  PAID: 'Đã thanh toán',
  REFUNDED: 'Đã hoàn tiền',
  FAILED: 'Thanh toán lỗi',
};

/**
 * Trạng thái thanh toán ghi vào CSV, cùng luật với giao diện admin (web/src/lib/order-view.ts, codCollected và
 * isRefundInProgress): đơn COD đã giao giữ paymentStatus = UNPAID vì order-reversal dùng nó làm chốt hoàn tiền một lần,
 * nhưng bưu tá đã thu tiền mặt nên ghi "Đã thu COD" chứ không phải "Chưa thanh toán". Đơn đã lật REFUNDED mà khoản chuyển
 * khoản trả khách còn Chờ/Đang chuyển thì tiền chưa về khách: "Đang hoàn tiền". Đơn còn UNPAID mà khách đã chuyển tiền về
 * muộn/chuyển dư (LATE_PAYMENT, OVERPAYMENT) đang chờ hoàn cũng là "Đang hoàn tiền", không phải "Chưa thanh toán".
 */
export function exportPaymentStatus(o: {
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  openRefunds?: readonly { method: string; kind: string }[];
}): string {
  if (o.paymentMethod === 'COD' && o.status === 'DELIVERED' && o.paymentStatus === 'UNPAID') return 'Đã thu COD';
  const open = o.openRefunds ?? [];
  if (o.paymentStatus === 'REFUNDED' && open.some((r) => r.method === 'MANUAL_TRANSFER')) return 'Đang hoàn tiền';
  if (o.paymentStatus === 'UNPAID' && open.some((r) => r.kind === 'LATE_PAYMENT' || r.kind === 'OVERPAYMENT')) return 'Đang hoàn tiền';
  return PAYMENT_STATUS[o.paymentStatus] ?? o.paymentStatus;
}

export const ORDER_CSV_HEADERS = [
  'Mã đơn',
  'Ngày đặt',
  'Khách hàng',
  'SĐT khách',
  'Người nhận',
  'SĐT người nhận',
  'Loại đơn',
  'Nơi giao',
  'Phương thức TT',
  'Trạng thái TT',
  'Trạng thái đơn',
  'Tạm tính (VNĐ)',
  'Giảm giá (VNĐ)',
  'Phí ship (VNĐ)',
  'Điểm đã dùng',
  'Tổng tiền (VNĐ)',
  'Số sản phẩm',
  'Hãng vận chuyển',
  'Mã vận đơn',
  'Mã đơn Pancake',
  'Ngày giao',
  'Thu gom tái chế',
  'Ghi chú',
  // Cột nguồn nằm cuối để bảng tính kế toán đang tham chiếu cột theo vị trí không bị lệch.
  'Nền tảng',
  'Nguồn đơn',
  'CTV giới thiệu',
  'SĐT CTV',
  'Gian hàng',
];

const ORDER_SELECT = {
  id: true,
  code: true,
  createdAt: true,
  status: true,
  type: true,
  fulfiller: true,
  paymentMethod: true,
  paymentStatus: true,
  subtotal: true,
  discount: true,
  shippingFee: true,
  pointsUsed: true,
  total: true,
  platform: true,
  source: true,
  referrerUserId: true,
  storefront: { select: { title: true } },
  shippingCode: true,
  shippingPartner: true,
  pancakeOrderId: true,
  note: true,
  hasRecyclingPickup: true,
  gomdonStatus: true,
  gomdonPartnerCode: true,
  deliveredAt: true,
  shippingAddress: true,
  user: { select: { fullName: true, phone: true } },
  fulfillerStorefront: { select: { title: true } },
  items: { select: { quantity: true } },
  customerRefunds: { where: OPEN_REFUND_FOR_EXPORT, select: { method: true, kind: true } },
} satisfies Prisma.OrderSelect;

type ExportOrder = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;
type Referrer = { fullName: string | null; phone: string | null };

function orderRow(o: ExportOrder, referrers: ReadonlyMap<string, Referrer>, maskPhones: boolean): string {
  const referrer = o.referrerUserId ? referrers.get(o.referrerUserId) : undefined;
  const addr = (o.shippingAddress ?? {}) as { recipient?: string; phone?: string };
  const phone = (p: string | null | undefined) => (maskPhones ? text(maskPhoneKeepLast3(p)) : text(p));
  return row([
    o.code,
    formatVnDateTime(o.createdAt),
    o.user?.fullName ?? 'Khách lẻ',
    phone(o.user?.phone),
    addr.recipient ?? '',
    phone(addr.phone),
    o.type === 'DEALER' ? 'Đại lý' : 'Bán lẻ',
    o.fulfiller === 'MERCHANT' ? `Gian hàng tự giao: ${o.fulfillerStorefront?.title ?? ''}` : 'Kho Tubu',
    PAYMENT_METHOD[o.paymentMethod] ?? o.paymentMethod,
    exportPaymentStatus({ ...o, openRefunds: o.customerRefunds }),
    ORDER_STATUS[o.status] ?? o.status,
    o.subtotal,
    o.discount,
    o.shippingFee,
    o.pointsUsed,
    o.total,
    o.items.reduce((s, it) => s + it.quantity, 0),
    o.shippingPartner ?? '',
    text(o.shippingCode),
    text(o.pancakeOrderId),
    o.deliveredAt ? formatVnDateTime(o.deliveredAt) : '',
    o.hasRecyclingPickup ? ['Có', o.gomdonStatus ?? '', o.gomdonPartnerCode ?? ''].filter(Boolean).join(' · ') : '',
    o.note ?? '',
    orderPlatformLabel(o.platform),
    orderSourceLabel(o.source),
    referrer?.fullName ?? '',
    phone(referrer?.phone),
    o.storefront?.title ?? '',
  ]);
}

/** Tên và SĐT CTV của cả lô trong một câu truy vấn (Order.referrerUserId không có quan hệ Prisma). */
export async function loadReferrers(prisma: PrismaService, orders: readonly { referrerUserId?: string | null }[]) {
  const ids = [...new Set(orders.flatMap((o) => (o.referrerUserId ? [o.referrerUserId] : [])))];
  if (ids.length === 0) return new Map<string, Referrer>();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, phone: true } });
  return new Map(users.map((u) => [u.id, { fullName: u.fullName, phone: u.phone }]));
}

/**
 * Lần lượt từng lô theo con trỏ (createdAt giảm dần, id làm mốc), đẩy ra từng đoạn CSV — không dựng cả file trong
 * bộ nhớ và không giới hạn số dòng. Cùng `where` với danh sách đơn đang lọc (AdminService.adminOrderWhere).
 * `maskPhones`: người xuất không phải quản trị viên (kế toán) chỉ thấy 3 số cuối SĐT khách, người nhận, CTV — đối soát
 * tiền không cần SĐT đầy đủ, file CSV dễ bị chuyển tiếp ra ngoài.
 */
export async function* orderCsvChunks(
  prisma: PrismaService,
  where: Prisma.OrderWhereInput,
  opts: { maskPhones?: boolean } = {},
): AsyncGenerator<string> {
  yield row(ORDER_CSV_HEADERS);
  let cursor: string | undefined;
  for (;;) {
    const batch: ExportOrder[] = await prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: ORDER_SELECT,
    });
    if (batch.length === 0) return;
    const referrers = await loadReferrers(prisma, batch);
    yield batch.map((o) => orderRow(o, referrers, opts.maskPhones === true)).join('');
    if (batch.length < EXPORT_BATCH) return;
    cursor = batch[batch.length - 1]!.id;
  }
}

export const USER_CSV_HEADERS = [
  'User ID',
  'Họ và tên',
  'Số điện thoại',
  'Vai trò',
  'Điểm Xanh',
  'Trong đó không hết hạn',
  'Số dư ví (VNĐ)',
  'Trạng thái',
  'Ngày tham gia',
];

const USER_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  role: true,
  pointsBalance: true,
  pointsConvertedBalance: true,
  walletBalance: true,
  isBlocked: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type ExportUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export async function* userCsvChunks(
  prisma: PrismaService,
  where: Prisma.UserWhereInput | undefined,
): AsyncGenerator<string> {
  yield row(USER_CSV_HEADERS);
  let cursor: string | undefined;
  for (;;) {
    const batch: ExportUser[] = await prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: USER_SELECT,
    });
    if (batch.length === 0) return;
    yield batch
      .map((u) =>
        row([
          u.id,
          u.fullName ?? '',
          text(u.phone),
          u.role,
          u.pointsBalance + u.pointsConvertedBalance,
          u.pointsConvertedBalance,
          u.walletBalance,
          u.isBlocked ? 'Đã khoá' : 'Hoạt động',
          formatVnDateTime(u.createdAt),
        ]),
      )
      .join('');
    if (batch.length < EXPORT_BATCH) return;
    cursor = batch[batch.length - 1]!.id;
  }
}

/** Ghi CSV (BOM UTF-8 để Excel đọc đúng tiếng Việt) theo từng đoạn, tôn trọng backpressure của kết nối. */
export async function streamCsv(res: Response, filename: string, chunks: AsyncGenerator<string>) {
  const first = await chunks.next();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.write('\uFEFF');
  if (!first.done) res.write(first.value);
  try {
    for await (const chunk of chunks) {
      if (!res.write(chunk)) await once(res, 'drain');
    }
    res.end();
  } catch (err) {
    res.destroy(err instanceof Error ? err : new Error(String(err)));
  }
}

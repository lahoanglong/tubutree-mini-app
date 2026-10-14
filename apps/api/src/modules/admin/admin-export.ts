import { once } from 'node:events';
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { PrismaService } from '../../prisma/prisma.service';
import { formatVnDateTime } from '../../common/vn-time';

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

const row = (cells: unknown[]) => `${cells.map(csvCell).join(',')}\r\n`;

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
} satisfies Prisma.OrderSelect;

type ExportOrder = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

function orderRow(o: ExportOrder): string {
  const addr = (o.shippingAddress ?? {}) as { recipient?: string; phone?: string };
  return row([
    o.code,
    formatVnDateTime(o.createdAt),
    o.user?.fullName ?? 'Khách lẻ',
    o.user?.phone ?? '',
    addr.recipient ?? '',
    addr.phone ?? '',
    o.type === 'DEALER' ? 'Đại lý' : 'Bán lẻ',
    o.fulfiller === 'MERCHANT' ? `Gian hàng tự giao: ${o.fulfillerStorefront?.title ?? ''}` : 'Kho Tubu',
    PAYMENT_METHOD[o.paymentMethod] ?? o.paymentMethod,
    PAYMENT_STATUS[o.paymentStatus] ?? o.paymentStatus,
    ORDER_STATUS[o.status] ?? o.status,
    o.subtotal,
    o.discount,
    o.shippingFee,
    o.pointsUsed,
    o.total,
    o.items.reduce((s, it) => s + it.quantity, 0),
    o.shippingPartner ?? '',
    o.shippingCode ?? '',
    o.pancakeOrderId ?? '',
    o.deliveredAt ? formatVnDateTime(o.deliveredAt) : '',
    o.hasRecyclingPickup ? ['Có', o.gomdonStatus ?? '', o.gomdonPartnerCode ?? ''].filter(Boolean).join(' · ') : '',
    o.note ?? '',
  ]);
}

/**
 * Lần lượt từng lô theo con trỏ (createdAt giảm dần, id làm mốc), đẩy ra từng đoạn CSV — không dựng cả file trong
 * bộ nhớ và không giới hạn số dòng. Cùng `where` với danh sách đơn đang lọc (AdminService.adminOrderWhere).
 */
export async function* orderCsvChunks(prisma: PrismaService, where: Prisma.OrderWhereInput): AsyncGenerator<string> {
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
    yield batch.map(orderRow).join('');
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
          u.phone ?? '',
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

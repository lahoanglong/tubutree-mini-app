import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { formatVnDateTime } from '../../common/vn-time';
import { EXPORT_BATCH, loadReferrers, row, text } from './admin-export';
import { orderPlatformLabel, orderSourceLabel } from './order-channel';

const ORDER_STATUS: Record<string, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  PACKED: 'Đã đóng gói',
  SHIPPING: 'Đang vận chuyển',
  DELIVERED: 'Đã giao hàng',
  CANCELLED: 'Đã huỷ',
  RETURNED: 'Đã trả hàng',
};

/** Một dòng hàng một dòng CSV (đơn nhiều dòng lặp lại các cột của đơn) để kế toán/marketing lọc theo sản phẩm, SKU, kênh. */
export const ORDER_ITEM_CSV_HEADERS = [
  'Mã đơn',
  'Ngày đặt',
  'Trạng thái đơn',
  'Loại đơn',
  'Nền tảng',
  'Nguồn đơn',
  'CTV giới thiệu',
  'Gian hàng',
  'SKU',
  'Sản phẩm',
  'Phân loại',
  'Số lượng',
  'Đơn giá (VNĐ)',
  'Thành tiền dòng (VNĐ)',
  'Khách trả cho dòng (VNĐ)',
];

const ORDER_SELECT = {
  id: true,
  code: true,
  createdAt: true,
  status: true,
  type: true,
  platform: true,
  source: true,
  referrerUserId: true,
  storefront: { select: { title: true } },
  items: {
    orderBy: { id: 'asc' },
    select: { productName: true, variationName: true, variationId: true, quantity: true, unitPrice: true, total: true, paidTotal: true },
  },
} satisfies Prisma.OrderSelect;

/**
 * Lần lượt từng lô đơn (cùng con trỏ và cùng bộ lọc với file CSV đơn: orderCsvChunks), mỗi lô tra SKU và CTV bằng một
 * câu truy vấn. Đơn không có dòng hàng không sinh dòng nào.
 */
export async function* orderItemCsvChunks(prisma: PrismaService, where: Prisma.OrderWhereInput): AsyncGenerator<string> {
  yield row(ORDER_ITEM_CSV_HEADERS);
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: ORDER_SELECT,
    });
    if (batch.length === 0) return;
    const variationIds = [...new Set(batch.flatMap((o) => o.items.map((i) => i.variationId)))];
    const [referrers, variations] = await Promise.all([
      loadReferrers(prisma, batch),
      variationIds.length
        ? prisma.variation.findMany({ where: { id: { in: variationIds } }, select: { id: true, sku: true } })
        : Promise.resolve([]),
    ]);
    const skuOf = new Map(variations.map((v) => [v.id, v.sku]));
    const chunk = batch
      .flatMap((o) => {
        const referrer = o.referrerUserId ? referrers.get(o.referrerUserId) : undefined;
        return o.items.map((it) =>
          row([
            o.code,
            formatVnDateTime(o.createdAt),
            ORDER_STATUS[o.status] ?? o.status,
            o.type === 'DEALER' ? 'Đại lý' : 'Bán lẻ',
            orderPlatformLabel(o.platform),
            orderSourceLabel(o.source),
            referrer?.fullName ?? '',
            o.storefront?.title ?? '',
            text(skuOf.get(it.variationId)),
            it.productName,
            it.variationName,
            it.quantity,
            it.unitPrice,
            it.total,
            it.paidTotal ?? '',
          ]),
        );
      })
      .join('');
    if (chunk) yield chunk;
    if (batch.length < EXPORT_BATCH) return;
    cursor = batch[batch.length - 1]!.id;
  }
}

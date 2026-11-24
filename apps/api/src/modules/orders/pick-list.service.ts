import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildPickList, PICK_LIST_ID_MAX_LEN, PICK_LIST_MAX, type PickListResponse, type PickRedeemedGift } from './pick-list';

/** `?ids=a,b,c` → danh sách mã đã cắt khoảng trắng, bỏ phần rỗng. Sai số lượng hay độ dài là 400 tiếng Việt. */
export function parsePickListIds(raw: string | undefined): string[] {
  const ids = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) throw new BadRequestException('Chọn ít nhất một đơn để in phiếu soạn hàng.');
  if (ids.length > PICK_LIST_MAX) throw new BadRequestException(`Mỗi lượt in tối đa ${PICK_LIST_MAX} đơn.`);
  if (ids.some((id) => id.length > PICK_LIST_ID_MAX_LEN)) throw new BadRequestException('Mã đơn không hợp lệ.');
  return ids;
}

/**
 * Phiếu soạn hàng cho kho: Phần 1 gộp số cần nhặt theo biến thể, Phần 2 phiếu đóng gói từng đơn. Chỉ đọc, không đổi trạng thái đơn
 * (đóng gói xong vẫn bấm «Đã đóng gói» ở thanh thao tác hàng loạt).
 */
@Injectable()
export class PickListService {
  constructor(private readonly prisma: PrismaService) {}

  async build(rawIds: string | undefined, now = new Date()): Promise<PickListResponse> {
    const ids = parsePickListIds(rawIds);
    const orders = await this.prisma.order.findMany({
      where: { OR: [{ id: { in: ids } }, { code: { in: ids } }] },
      select: {
        id: true,
        code: true,
        status: true,
        type: true,
        fulfiller: true,
        paymentMethod: true,
        paymentStatus: true,
        total: true,
        shippingAddress: true,
        note: true,
        hasRecyclingPickup: true,
        createdAt: true,
        items: {
          orderBy: { id: 'asc' },
          select: { variationId: true, productName: true, variationName: true, unitPrice: true, quantity: true, isGift: true, backorderedQty: true },
        },
      },
    });
    const variationIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.variationId)))];
    const dealerIds = orders.filter((o) => o.type === 'DEALER').map((o) => o.id);
    const orderIds = orders.map((o) => o.id);
    const [variations, debits, redemptions] = await Promise.all([
      variationIds.length ? this.prisma.variation.findMany({ where: { id: { in: variationIds } }, select: { id: true, sku: true } }) : [],
      // Cùng điều kiện "Ghi công nợ" với danh sách đơn admin và lần đẩy Pancake: có dòng sổ công nợ refType=ORDER.
      dealerIds.length ? this.prisma.dealerCreditLedger.findMany({ where: { refType: 'ORDER', refId: { in: dealerIds } }, select: { refId: true } }) : [],
      // Cùng truy vấn với ghi chú quà của đơn Pancake (PancakeOrderService.buildGiftNote): mọi quà đổi điểm đang gắn vào đơn.
      orderIds.length
        ? this.prisma.wasteGiftRedemption.findMany({
            where: { attachedOrderId: { in: orderIds } },
            select: { attachedOrderId: true, code: true, giftName: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : [],
    ]);
    const redeemedGifts = new Map<string, PickRedeemedGift[]>();
    for (const r of redemptions) {
      if (!r.attachedOrderId) continue;
      redeemedGifts.set(r.attachedOrderId, [...(redeemedGifts.get(r.attachedOrderId) ?? []), { code: r.code, giftName: r.giftName }]);
    }
    return buildPickList(ids, orders, {
      skuByVariation: new Map(variations.map((v) => [v.id, v.sku])),
      onCredit: new Set(debits.map((d) => d.refId).filter((id): id is string => !!id)),
      redeemedGifts,
      now,
    });
  }
}

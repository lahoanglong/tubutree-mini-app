import { Injectable } from '@nestjs/common';
import type { Order, OrderItem, Prisma } from '@prisma/client';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { CouponsService } from '../coupons/coupons.service';

type OrderWithItems = Order & { items: OrderItem[] };

/**
 * Đảo ngược tác động tài chính + tồn kho của một đơn hàng khi CANCELLED/RETURNED.
 *
 * Trước đây khối "hoàn ví/xu + restock + release flash quota" bị chép tay 2 lần
 * (orders.service.cancel, admin.service.reviewReturn) và HOÀN TOÀN THIẾU ở 3 nơi
 * khác cũng có thể đưa đơn về CANCELLED/RETURNED: admin.updateOrderStatus (generic),
 * merchant.updateMerchantOrderStatus, và pancake.processor (webhook hủy đơn từ POS).
 * Kết quả: đơn bị POS hủy → điểm/hoa hồng được đảo nhưng KHÔNG hoàn tiền, KHÔNG restock
 * (xem docs/2026-09-08-review-progress.md P0-4). Class này là nơi DUY NHẤT thực hiện
 * khối này — mọi caller (kể cả cái cũ) phải gọi qua đây.
 *
 * BẮT BUỘC gọi trong transaction, SAU KHI đã atomic-flip status thành công (updateMany
 * guard count===1) — method này không tự flip status, không tự guard race; caller chịu
 * trách nhiệm đó (xem OrderStatusService.setStatus và orders.service.cancel).
 */
@Injectable()
export class OrderReversalService {
  constructor(
    private readonly flashSale: FlashSaleService,
    private readonly coupons: CouponsService,
  ) {}

  async reverseFinancials(tx: Prisma.TransactionClient, order: OrderWithItems): Promise<void> {
    // Hoàn tiền — guard paymentStatus:'PAID' bằng updateMany, count=1 mới thực sự chi tiền,
    // tránh hoàn 2 lần nếu bị gọi lại (dù caller đã guard status, phòng thủ 2 lớp cho tiền).
    const isRefundableChannel =
      order.paymentStatus === 'PAID' &&
      (order.paymentMethod === 'WALLET' ||
        order.paymentMethod === 'ZALOPAY' ||
        order.paymentMethod === 'BANK_TRANSFER' ||
        order.paymentMethod === 'VNPAY' ||
        order.paymentMethod === 'XU' ||
        // COD đã thu hộ (paymentStatus PAID lúc DELIVERED) — trả hàng vẫn phải hoàn ví.
        order.paymentMethod === 'COD');
    if (isRefundableChannel) {
      const refunded = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: 'PAID' },
        data: { paymentStatus: 'REFUNDED' },
      });
      if (refunded.count === 1) {
        if (order.paymentMethod === 'XU') {
          await tx.user.update({
            where: { id: order.userId },
            data: { coinsBalance: { increment: order.total } },
          });
          await tx.coinTransaction.create({
            data: {
              userId: order.userId,
              delta: order.total,
              reason: `ORDER_REFUND:${order.code}`,
              refType: 'ORDER',
              refId: order.id,
            },
          });
        } else {
          await tx.user.update({
            where: { id: order.userId },
            data: { walletBalance: { increment: order.total } },
          });
        }
      }
    }

    // Hoàn stock + release quota flash-sale — không có guard idempotency riêng ở đây vì
    // caller (status flip atomic) đảm bảo hàm này chỉ chạy đúng 1 lần cho mỗi đơn.
    for (const item of order.items) {
      await tx.variation.update({
        where: { id: item.variationId },
        data: { stock: { increment: item.quantity } },
      });
      if (item.flashSaleItemId) {
        await this.flashSale.restore(tx, item.flashSaleItemId, order.userId, item.quantity);
      }
    }

    // Hoàn coupon — trước đây thiếu bước này: voucher usageLimit=1 (birthday/welcome/referral)
    // bị đốt vĩnh viễn cho một đơn đã hủy/trả (P1, docs/2026-09-08-review-progress.md).
    await this.coupons.release(order.couponCode, order.id, tx);

    // Đảo công nợ đại lý. Đơn đại lý "Ghi công nợ" tạo dòng DealerCreditLedger dương lúc đặt;
    // huỷ/trả đơn mà không đảo thì đại lý vẫn NỢ tiền một đơn không còn tồn tại, và khoản nợ ảo
    // đó tiếp tục ăn vào hạn mức nên chặn luôn các đơn sau. Không dùng delete để giữ vết sổ sách.
    await this.reverseDealerCredit(tx, order);
  }

  /**
   * Idempotent nhờ unique (userId, refType, refId) trên DealerCreditLedger: dòng đối ứng dùng
   * refType='ORDER_CANCEL' + refId=order.id nên gọi lại không thể tạo dòng thứ hai.
   * Đơn "Trả trước" không có dòng ghi nợ nào → không đụng sổ.
   */
  private async reverseDealerCredit(tx: Prisma.TransactionClient, order: OrderWithItems): Promise<void> {
    if (order.type !== 'DEALER') return;
    const already = await tx.dealerCreditLedger.findFirst({
      where: { userId: order.userId, refType: 'ORDER_CANCEL', refId: order.id },
    });
    if (already) return;
    const debit = await tx.dealerCreditLedger.findFirst({
      where: { userId: order.userId, refType: 'ORDER', refId: order.id },
    });
    if (!debit || debit.delta === 0) return;
    await tx.dealerCreditLedger.create({
      data: {
        userId: order.userId,
        delta: -debit.delta,
        refType: 'ORDER_CANCEL',
        refId: order.id,
        note: `Huỷ đơn ${order.code}`,
      },
    });
  }
}

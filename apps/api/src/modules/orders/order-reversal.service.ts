import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma, type Order, type OrderItem } from '@prisma/client';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { CouponsService } from '../coupons/coupons.service';
import { DealerService } from '../dealer/dealer.service';
import { releaseVariationStock } from '../catalog/variation-stock';

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
  private readonly logger = new Logger(OrderReversalService.name);
  private dealer?: DealerService;

  constructor(
    private readonly flashSale: FlashSaleService,
    private readonly coupons: CouponsService,
    // DealerService (thu hồi thưởng quý) nằm ở DealerModule, mà DealerModule → PancakeModule →
    // OrdersModule: import thẳng DealerModule vào OrdersModule thành vòng module. Lấy lười qua
    // ModuleRef (strict:false) lúc chạy. @Optional để các test dựng tay `new OrderReversalService(
    // flash, coupons)` vẫn chạy — khi đó thiếu DealerService sẽ log lỗi to (xem resolveDealer).
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async reverseFinancials(tx: Prisma.TransactionClient, order: OrderWithItems): Promise<void> {
    // Hoàn tiền — guard paymentStatus:'PAID' bằng updateMany, count=1 mới thực sự chi tiền,
    // tránh hoàn 2 lần nếu bị gọi lại (dù caller đã guard status, phòng thủ 2 lớp cho tiền).
    //
    // KHÔNG xét ảnh chụp `order.paymentStatus`: mọi caller đọc đơn NGOÀI tx (orders.cancel/detail,
    // OrderStatusService.setStatus, admin.reviewReturn), và giữa lần đọc đó với tx huỷ, admin xác nhận
    // chuyển khoản (POST /admin/dealer-orders/:id/confirm-payment) hoặc webhook Pancake/ZaloPay có thể
    // đã lật UNPAID → PAID. Bản cũ chỉ thử hoàn khi ảnh chụp là PAID → đơn bị huỷ mà tiền khách đã trả
    // KHÔNG được hoàn. Giờ LUÔN thử guard PAID→REFUNDED trong tx: DB (không phải ảnh chụp) quyết định có
    // hoàn hay không; đơn thật sự UNPAID thì count=0, không chi gì.
    const isRefundableChannel =
      order.paymentMethod === 'WALLET' ||
      order.paymentMethod === 'ZALOPAY' ||
      order.paymentMethod === 'BANK_TRANSFER' ||
      order.paymentMethod === 'VNPAY' ||
      order.paymentMethod === 'XU' ||
      // COD đã thu hộ (paymentStatus PAID lúc DELIVERED) — trả hàng vẫn phải hoàn ví.
      order.paymentMethod === 'COD';
    // Đơn có THỰC SỰ đang PAID ngay trước lần đảo không — guard PAID→REFUNDED thắng (count=1) là
    // bằng chứng trong CÙNG tx; ảnh chụp `order.paymentStatus` đọc trước đó có thể đã cũ. Dùng cho
    // thu hồi thưởng quý đại lý (đơn trả trước chỉ được tính doanh số khi đã PAID). Phương thức lạ
    // (ngoài danh sách hoàn tự động) chỉ còn ảnh chụp để dựa vào.
    let paidBeforeReversal = !isRefundableChannel && order.paymentStatus === 'PAID';
    if (isRefundableChannel) {
      const refunded = await tx.order.updateMany({
        where: { id: order.id, paymentStatus: 'PAID' },
        data: { paymentStatus: 'REFUNDED' },
      });
      paidBeforeReversal = refunded.count === 1;
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
    // Dòng đặt trước: ĐỌC LẠI backorderedQty dưới khoá dòng. Ảnh chụp `order.items` của caller có
    // thể cũ — cron DealerBackorderService.reconcile vừa lấp hàng (giữ kho + giảm backorderedQty)
    // sau lúc caller đọc đơn; dùng số cũ thì phần vừa giữ không bao giờ được hoàn → kẹt kho. Khoá
    // FOR UPDATE còn làm guard `backorderedQty = <đã đọc>` của cron chờ rồi trượt (tự trả phần giữ).
    const boIds = order.items.filter((i) => i.backorderedQty > 0).map((i) => i.id);
    const freshBackorder = new Map<string, number>();
    if (boIds.length > 0) {
      const rows = await tx.$queryRaw<{ id: string; backorderedQty: number }[]>`
        SELECT "id", "backorderedQty" FROM "order_items" WHERE "id" IN (${Prisma.join(boIds)}) FOR UPDATE`;
      for (const r of rows) freshBackorder.set(r.id, Number(r.backorderedQty));
    }

    for (const item of order.items) {
      // Đơn đại lý đặt trước (backorder) có thể còn `backorderedQty` > 0 — phần đó CHƯA BAO
      // GIỜ được giữ từ kho thật (xem DealerService.placeOrder), nên chỉ hoàn đúng phần đã
      // giữ (`quantity - backorderedQty`). Hoàn nguyên `quantity` sẽ CỘNG KHỐNG phần chưa từng
      // trừ — tồn kho tăng ảo đúng bằng số đặt trước của đơn bị huỷ.
      const backordered = freshBackorder.get(item.id) ?? item.backorderedQty;
      const reserved = item.quantity - backordered;
      if (reserved > 0) await releaseVariationStock(tx, item.variationId, reserved);
      // Đơn đã chết thì không còn nhu cầu backorder nữa — xoá cờ để DealerBackorderService
      // (quét theo `backorderedQty > 0`) không tốn công lấp hàng cho một đơn không tồn tại nữa.
      if (backordered > 0) {
        await tx.orderItem.update({ where: { id: item.id }, data: { backorderedQty: 0 } });
      }
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

    // Thu hồi thưởng doanh số quý nếu quý của đơn đã được trả thưởng (cron ngày 10 quý sau) — chạy
    // SAU CÙNG để dealerVolume (đọc qua tx) thấy đơn đã lật trạng thái/REFUNDED. `order` là ảnh chụp
    // TRƯỚC lần lật (status cũ) — DealerService dùng nó + paidBeforeReversal để biết đơn có đang được
    // tính vào doanh số đã chốt không (chỉ thu phần biên của đơn đó). Lỗi DB ở đây phải ném ra:
    // transaction Postgres đã hỏng thì cả lần huỷ đơn rollback, không để tiền lệch.
    if (order.type === 'DEALER') {
      const dealer = this.resolveDealer();
      if (dealer) {
        await dealer.clawbackQuarterBonusForOrder(tx, order, { paidBeforeReversal });
      } else {
        this.logger.error(
          `DealerService chưa wiring — KHÔNG thu hồi được thưởng quý cho đơn đại lý ${order.code} bị huỷ/trả. Cần đối soát tay.`,
        );
      }
    }
  }

  private resolveDealer(): DealerService | undefined {
    if (this.dealer) return this.dealer;
    try {
      this.dealer = this.moduleRef?.get(DealerService, { strict: false });
    } catch {
      this.dealer = undefined; // provider không có trong app (test dựng module thiếu) → caller log lỗi
    }
    return this.dealer;
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

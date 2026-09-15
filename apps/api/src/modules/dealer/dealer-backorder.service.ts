import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import { reserveAvailableVariationStock, releaseVariationStock } from '../catalog/variation-stock';

/**
 * Đối soát đơn đại lý đặt trước (backorder) — xem DealerService.placeOrder.
 *
 * Khi tồn kho về (Pancake sync tăng `stock`, hoặc merchant nhập hàng thủ công), job này lấp
 * dần các dòng còn thiếu, THEO THỨ TỰ đơn cũ trước (FIFO công bằng giữa các đại lý). Đơn nào
 * lấp đủ 100% mới được đẩy sang Pancake — trước đó kho vật lý chưa đủ hàng để soạn/xuất.
 */
@Injectable()
export class DealerBackorderService {
  private readonly logger = new Logger(DealerBackorderService.name);
  /** Trần số dòng xử lý mỗi lượt — mirror các cron đối soát khác (không kéo dài vô hạn 1 lượt). */
  private static readonly MAX_ITEMS_PER_RUN = 200;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly pancakeOrder?: PancakeOrderService,
  ) {}

  // Lệch 30s sau mốc Pancake sync (0 */15 phút) để chạy NGAY SAU khi stock vừa được cập nhật —
  // không bắt buộc đúng thứ tự (chạy trước cũng không sai), chỉ để giảm độ trễ lấp hàng.
  @Cron('30 */15 * * * *')
  async reconcile(): Promise<number> {
    // Toàn thân bọc try/catch: 1 lỗi DB tạm thời (Prisma timeout/connection) không được phép
    // thoát ra khỏi hàm cron — Node 20 coi unhandledRejection là lỗi chết tiến trình, và job này
    // chạy lại mỗi 15 phút nên bỏ qua 1 lượt là an toàn hơn nhiều so với sập cả API.
    try {
      const items = await this.prisma.orderItem.findMany({
        where: {
          backorderedQty: { gt: 0 },
          order: { status: { notIn: ['CANCELLED', 'RETURNED'] } },
        },
        select: { id: true, orderId: true, variationId: true, backorderedQty: true },
        orderBy: { order: { createdAt: 'asc' } }, // FIFO: đơn đặt trước cũ nhất được lấp trước
        take: DealerBackorderService.MAX_ITEMS_PER_RUN,
      });
      if (items.length === 0) return 0;

      let filled = 0;
      const touchedOrders = new Set<string>();
      for (const item of items) {
        // reserveAvailableVariationStock + updateMany (+ release khi thua race) PHẢI atomic:
        // nếu process bị kill giữa 2 lệnh (restart deploy), giữ chỗ đã trừ ở "variations" nhưng
        // backorderedQty chưa giảm ⇒ lượt cron sau giữ kho THÊM 1 lần nữa cho cùng nhu cầu ⇒ giữ
        // kho ảo vĩnh viễn. Bọc trong 1 transaction, truyền tx xuyên suốt để hoặc cả hai cùng
        // commit, hoặc cả hai cùng rollback.
        const got = await this.prisma.$transaction(async (tx) => {
          const reserved = await reserveAvailableVariationStock(tx, item.variationId, item.backorderedQty);
          if (reserved === 0) return 0; // vẫn chưa có hàng cho variation này

          // Guard atomic: chỉ ghi nếu backorderedQty CHƯA bị lượt reconcile khác đổi từ lúc đọc
          // ở findMany — 2 cron instance chạy chồng (mirror mọi cron đối soát khác trong repo).
          const res = await tx.orderItem.updateMany({
            where: { id: item.id, backorderedQty: item.backorderedQty },
            data: { backorderedQty: item.backorderedQty - reserved },
          });
          if (res.count === 0) {
            // Thua race — trả lại phần vừa giữ, không thì tồn kho biến mất vào hư không (đã giữ
            // nhưng không dòng nào ghi nhận đã nhận).
            await releaseVariationStock(tx, item.variationId, reserved);
            return 0;
          }
          return reserved;
        });
        if (got === 0) continue;
        filled += got;
        touchedOrders.add(item.orderId);
      }

      // Đơn nào vừa lấp đủ 100% (không còn dòng nào backorderedQty > 0) → đẩy Pancake lần đầu.
      for (const orderId of touchedOrders) {
        const remaining = await this.prisma.orderItem.count({
          where: { orderId, backorderedQty: { gt: 0 } },
        });
        if (remaining > 0) continue;
        const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { pancakeOrderId: true } });
        if (order?.pancakeOrderId) continue; // đã đẩy (không nên xảy ra — phòng thủ)
        if (this.pancakeOrder) {
          await this.pancakeOrder
            .enqueuePush(orderId)
            .catch((err) =>
              this.logger.error(
                `Đơn ${orderId} đã đủ hàng nhưng xếp hàng đẩy Pancake lỗi: ${err instanceof Error ? err.message : err}`,
              ),
            );
          this.logger.log(`Đơn đại lý ${orderId} đã lấp đủ hàng đặt trước — đẩy Pancake.`);
        } else {
          this.logger.warn(`PancakeOrderService chưa wiring — đơn ${orderId} đủ hàng nhưng KHÔNG được đẩy.`);
        }
      }

      if (filled) {
        this.logger.log(`Đối soát đặt trước: lấp ${filled} đơn vị cho ${touchedOrders.size} đơn.`);
      }
      return filled;
    } catch (err) {
      this.logger.error(
        `Đối soát đặt trước lỗi — bỏ qua lượt này, cron sau tự thử lại: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      return 0;
    }
  }
}

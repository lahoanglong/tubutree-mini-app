import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CRON_TZ } from '../../common/cron-tz';
import { isPublicProduct } from '../catalog/public-product';

/** Giảm dưới 5% không đáng báo; admin đổi bằng SystemConfig wishlist.price_drop_min_pct (phân số 0..1). */
const DEFAULT_PRICE_DROP_MIN_PCT = 0.05;
const DEFAULT_PRICE_DROP_COOLDOWN_DAYS = 7;

const formatDong = (n: number): string => `${Math.round(n).toLocaleString('vi-VN')}đ`;

interface ReorderRow {
  userId: string;
  variationId: string;
  productName: string;
  /** Snapshot slug tại đơn mua gần nhất — nullable (đơn cũ trước khi OrderItem có cột này, xem
   * schema.prisma OrderItem.productSlug). Không có slug thì payload bỏ qua field này thay vì gửi
   * chuỗi rỗng (CTA "Mua lại ngay" ở notifications.tsx phải coi thiếu field = ẩn nút, không phải
   * link hỏng tới `/product/`). */
  productSlug: string | null;
  lastOrderAt: Date;
}

/**
 * Lifecycle Reminder (§6.14.7): nhắc mua lại khi đã qua ~chu kỳ tiêu dùng kể từ
 * đơn DELIVERED cuối của (user × sản phẩm). Tính thuần từ lịch sử đơn; remindedAt
 * chống spam (nhắc lại chỉ khi có đơn mới hơn). Push qua NotificationsService
 * (luôn lưu INAPP; ZNS khi OA cấu hình).
 */
@Injectable()
export class LifecycleService {
  /** Trần người nhận mỗi lần báo giảm giá — hàm chạy trong cron đồng bộ nên không được kéo dài. */
  private static readonly PRICE_DROP_MAX_RECIPIENTS = 2_000;

  /**
   * Trần số cặp (user×variation) THỰC SỰ xử lý (claim+notify)/lượt chạy — giữ nguyên 500 như cũ.
   * Audit A2-07=A3-03=A6-31: trước đây đây CŨNG là LIMIT của câu SQL, không ORDER BY, không loại
   * cặp đã nhắc trong SQL → khi backlog vượt 500, cùng 500 dòng (có thể toàn cặp cũ) được trả về
   * MỖI LẦN chạy, khách mới không bao giờ tới lượt. Nay tách hẳn khỏi QUERY_FETCH_CAP bên dưới.
   */
  private static readonly BATCH_SIZE = 500;

  /**
   * Trần phòng thủ cho SQL fetch (KHÔNG phải trần xử lý) — SQL giờ ORDER BY quá hạn nhất trước +
   * loại cặp đã nhắc ngay trong WHERE, nên phần dư ra ngoài BATCH_SIZE chỉ dùng để BÁO CÁO backlog
   * (log), không xử lý trong lượt này; lượt cron kế tiếp (chạy hằng ngày) tự động lấy tiếp phần
   * còn lại vì các cặp vừa claim ở lượt này đã có remindedAt mới, bị SQL loại khỏi lượt sau —
   * remindedAt đóng vai trò con trỏ (cursor) tự nhiên, không cần bảng cursor riêng.
   */
  private static readonly QUERY_FETCH_CAP = 5_000;

  private readonly logger = new Logger(LifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Cron 4h sáng: gửi nhắc mua lại cho các sản phẩm đã tới hạn.
   *
   * Toàn thân bọc try/catch: @Cron không tự bắt lỗi — bất kỳ lỗi nào ném ra ngoài (query raw lỗi,
   * hoặc `throw err` ở nhánh create P2002 bên dưới) là unhandledRejection, Node 20 mặc định crash
   * cả process. Lỗi gửi từng user đã được cô lập ở try/catch trong vòng lặp; lớp ngoài này bắt
   * phần còn lại.
   */
  @Cron('0 4 * * *', { timeZone: CRON_TZ })
  async sendReorderReminders(): Promise<void> {
    try {
      // Mặc định mới 30 ngày × 0,8 = nhắc ở ngày 24: SP tiêu dùng phổ thông (dầu gội/tắm/tẩy rửa
      // — phần lớn danh mục hiện tại) thường dùng hết trong ~30 ngày; nhắc ở 80% chu kỳ chừa ~6
      // ngày để khách đặt lại TRƯỚC khi hết cửa sổ north-star "đơn thứ 2 trong 30 ngày" (mặc định
      // cũ 60×0,85≈51 ngày đã trễ hơn chính cửa sổ cần đo). Chưa có field per-product/category
      // "chu kỳ tiêu dùng" nào trong Product/Variation (đã kiểm tra schema.prisma) nên vẫn 1 hằng
      // số toàn cục — nhưng nay đọc thật từ SystemConfig (seed.ts, createOnly) thay vì chỉ là
      // fallback không ai set, để business tinh chỉnh theo dữ liệu tiêu dùng thật mà không cần
      // redeploy.
      const cycleDays = await this.config.get<number>('reorder.default_cycle_days', 30);
      const ratio = await this.config.get<number>('reorder.remind_ratio', 0.8);
      const threshold = new Date(Date.now() - cycleDays * ratio * 864e5);

      // Chỉ đơn bán lẻ khách tự mua: đơn CTV lên hộ mang userId của CTV (người dùng SP là khách của họ) và đơn đại lý là hàng buôn,
      // người nhận "mua lại" không phải người dùng SP (cùng lọc với ReviewInviteService).
      // Đơn DELIVERED cuối của mỗi (user, variation) đã cũ hơn ngưỡng, CHƯA từng nhắc cho chu kỳ
      // này. Trước đây việc loại cặp đã nhắc chỉ làm ở JS SAU KHI fetch (dưới), nên LIMIT 500
      // (không ORDER BY) có thể toàn bộ là cặp cũ đã nhắc — lãng phí cả lô, cặp mới ngoài 500 dòng
      // đó không bao giờ tới lượt (A2-07=A3-03=A6-31). Nay LEFT JOIN reorder_reminders + loại
      // ngay trong HAVING, và ORDER BY quá hạn nhất trước để backlog được xử lý FIFO thay vì tuỳ
      // ý. LIMIT dùng QUERY_FETCH_CAP (>> BATCH_SIZE thật sự xử lý) để còn biết size backlog cho
      // log — xem slice bên dưới.
      const dueRows = await this.prisma.$queryRaw<ReorderRow[]>`
        SELECT o."userId",
               oi."variationId",
               (ARRAY_AGG(oi."productName" ORDER BY o."createdAt" DESC))[1] AS "productName",
               (ARRAY_AGG(oi."productSlug" ORDER BY o."createdAt" DESC))[1] AS "productSlug",
               MAX(o."createdAt") AS "lastOrderAt"
        FROM order_items oi
        JOIN orders o ON o.id = oi."orderId"
        JOIN variations v ON v.id = oi."variationId"
        JOIN products p ON p.id = v."productId"
        LEFT JOIN reorder_reminders rr
          ON rr."userId" = o."userId" AND rr."variationId" = oi."variationId"
        WHERE o.status::text = 'DELIVERED'
          AND o.type::text = 'RETAIL'
          AND o."placedForCustomer" = false
          -- Nhắc mua lại hàng ngừng bán thì khách bấm vào trang 404 (cùng điều kiện với SELLABLE_VARIATION_WHERE).
          AND v."isActive" = true
          AND p."isActive" = true
          AND p."approvalStatus"::text = 'APPROVED'
        GROUP BY o."userId", oi."variationId"
        HAVING MAX(o."createdAt") <= ${threshold}
           AND (MAX(rr."remindedAt") IS NULL OR MAX(rr."remindedAt") < MAX(o."createdAt"))
        ORDER BY MAX(o."createdAt") ASC
        LIMIT ${LifecycleService.QUERY_FETCH_CAP}`;

      // Chỉ THỰC SỰ xử lý (claim+notify) BATCH_SIZE cặp quá hạn nhất/lượt — phần còn lại (nếu có)
      // để lượt cron ngày mai (remindedAt mới ghi ở lượt này tự loại chúng khỏi truy vấn trên,
      // đóng vai trò cursor) chứ không xử lý dồn trong 1 lượt để tránh job chạy quá lâu.
      const rows = dueRows.slice(0, LifecycleService.BATCH_SIZE);

      let sent = 0;
      for (const r of rows) {
        const lastOrderAt = new Date(r.lastOrderAt);
        const existing = await this.prisma.reorderReminder.findUnique({
          where: { userId_variationId: { userId: r.userId, variationId: r.variationId } },
        });
        // Đã nhắc cho chu kỳ này (remindedAt sau đơn cuối) → bỏ qua (chống spam).
        if (existing?.remindedAt && existing.remindedAt >= lastOrderAt) continue;

        // Claim atomic chống double-send khi 2 cron instance chạy chồng (mirror RemarketingService):
        // - đã có bản ghi → chỉ update nếu remindedAt vẫn còn cũ hơn lastOrderAt tại thời điểm ghi
        //   (updateMany guard — nếu instance khác đã claim trước, count=0).
        // - chưa có bản ghi → create; unique(userId,variationId) tự chặn instance thứ hai (P2002).
        const claimedAt = new Date();
        let claimed: boolean;
        if (existing) {
          const res = await this.prisma.reorderReminder.updateMany({
            where: {
              userId: r.userId,
              variationId: r.variationId,
              OR: [{ remindedAt: null }, { remindedAt: { lt: lastOrderAt } }],
            },
            data: { productName: r.productName, lastOrderAt, remindedAt: claimedAt },
          });
          claimed = res.count > 0;
        } else {
          try {
            await this.prisma.reorderReminder.create({
              data: { userId: r.userId, variationId: r.variationId, productName: r.productName, lastOrderAt, remindedAt: claimedAt },
            });
            claimed = true;
          } catch (err) {
            if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
              claimed = false;
            } else {
              throw err;
            }
          }
        }
        if (!claimed) continue;

        try {
          // A1-01=A2-06=A3-02: trước đây payload chỉ có product (tên) → notifications.tsx không
          // nhánh CTA nào khớp được (không slug/variationId thì không dựng nổi link "Mua lại
          // ngay"). product_slug bỏ qua hẳn field (không gửi chuỗi rỗng) khi đơn cũ chưa có slug
          // (OrderItem.productSlug nullable) — nhánh render phải coi thiếu field = ẩn nút, không
          // phải link hỏng tới `/product/`.
          const data: Record<string, string> = { product: r.productName, variation_id: r.variationId };
          if (r.productSlug) data.product_slug = r.productSlug;
          await this.notifications.notify(r.userId, 'REORDER_REMINDER', data);
          sent++;
        } catch (err) {
          // Đã CLAIM trước khi gửi (mirror RemarketingService) — nuốt lỗi ở đây là mất hẳn lần
          // nhắc đó: guard đầu hàm coi remindedAt đã set là "đã nhắc cho chu kỳ này", không bao
          // giờ thử lại. Trả cờ về null để lượt sau thử lại (cùng where cho cả 2 nhánh create/
          // update — nhánh create không có bản ghi cũ để revert kiểu update, nhưng row vừa tạo
          // vẫn khớp where này).
          this.logger.error(
            `Nhắc mua lại lỗi (user=${r.userId}, variation=${r.variationId}): ${err instanceof Error ? err.message : err}`,
          );
          await this.prisma.reorderReminder
            .updateMany({
              where: { userId: r.userId, variationId: r.variationId, remindedAt: claimedAt },
              data: { remindedAt: null },
            })
            .catch(() => undefined);
        }
      }
      // A2-07=A3-03=A6-31: lý do lỗi cũ không ai phát hiện là "không log gì cả" khi backlog vượt
      // trần. Luôn báo cáo số đã xử lý/tổng thấy được + phần còn lại (nếu QUERY_FETCH_CAP bị chạm,
      // backlog thật có thể còn NHIỀU HƠN số này — ghi rõ để không hiểu lầm là "hết backlog").
      if (dueRows.length > 0) {
        const backlog = Math.max(0, dueRows.length - rows.length);
        const cappedNote =
          dueRows.length === LifecycleService.QUERY_FETCH_CAP
            ? ' (đã chạm trần truy vấn — backlog thật có thể còn nhiều hơn)'
            : '';
        this.logger.log(
          `Reorder reminders: xử lý ${rows.length}/${dueRows.length} cặp tới hạn (gửi thành công ${sent}); còn lại ${backlog} cặp chưa xử lý${cappedNote}.`,
        );
      }
    } catch (err) {
      this.logger.error(`sendReorderReminders lỗi: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Price Drop Alert (§6.14.10): sản phẩm giảm giá → báo cho user đã ❤️ wishlist.
   * Gọi từ Pancake sync khi giá biến thể giảm và từ cron khi flash sale bắt đầu. Lỗi gửi từng user không
   * chặn cả lô (notify đã nuốt lỗi).
   *
   * `price` có thì: giảm dưới `wishlist.price_drop_min_pct` (mặc định 5%) không báo — giá Pancake nhích 1đ cũng từng
   * gửi cho cả nghìn người — và nội dung ghi giá cũ/mới. Mỗi user chỉ nhận một thông báo cho một sản phẩm trong
   * `wishlist.price_drop_cooldown_days` (mặc định 7, 0 = tắt) để giá dao động 100→90→100→90 không nhắc lặp.
   */
  async notifyWishlistPriceDrop(
    productId: string,
    productName: string,
    price?: { oldPrice: number; newPrice: number },
  ): Promise<void> {
    if (price) {
      const minPct = await this.fractionConfig('wishlist.price_drop_min_pct', DEFAULT_PRICE_DROP_MIN_PCT);
      const dropPct = price.oldPrice > 0 ? (price.oldPrice - price.newPrice) / price.oldPrice : 0;
      if (!(dropPct > 0) || dropPct < minPct) return;
    }
    // Trần số người nhận: hàm này chạy NGAY TRONG cron đồng bộ Pancake (15 phút/lần). Một sản
    // phẩm hot giảm giá với 20 nghìn lượt yêu thích sẽ gửi 20 nghìn thông báo tuần tự, chặn
    // đứng phần còn lại của lượt đồng bộ và có thể để lượt kế chạy chồng lên.
    const product = await this.prisma.product
      .findUnique({ where: { id: productId }, select: { slug: true, isActive: true, approvalStatus: true } })
      .catch(() => null);
    // Đồng bộ Pancake vẫn cập nhật giá của hàng admin đã tắt: báo "giảm giá" cho hàng không mua được là sai.
    if (product && !isPublicProduct(product)) return;
    const items = await this.prisma.wishlist.findMany({
      where: { productId },
      orderBy: { id: 'asc' },
      take: LifecycleService.PRICE_DROP_MAX_RECIPIENTS,
      select: { userId: true },
    });
    if (items.length === 0) return;
    const alerted = await this.recentlyAlertedUsers(
      productId,
      items.map((w) => w.userId),
    );
    const recipients = items.filter((w) => !alerted.has(w.userId));
    if (recipients.length === 0) return;
    const data: Record<string, string> = {
      product: productName,
      product_id: productId,
      price_note: price ? ` từ ${formatDong(price.oldPrice)} xuống ${formatDong(price.newPrice)}` : '',
    };
    if (product?.slug) data.product_slug = product.slug;
    for (const w of recipients) {
      await this.notifications.notify(w.userId, 'PRICE_DROP_ALERT', data).catch(() => undefined);
    }
    const capped = items.length === LifecycleService.PRICE_DROP_MAX_RECIPIENTS ? ' (đã chạm trần)' : '';
    this.logger.log(
      `Price-drop alert: ${productName} → ${recipients.length}/${items.length} user${capped} (còn lại đang trong cooldown).`,
    );
  }

  /** User đã nhận PRICE_DROP_ALERT của đúng sản phẩm này trong cửa sổ cooldown (đọc từ notification_logs). */
  private async recentlyAlertedUsers(productId: string, userIds: string[]): Promise<Set<string>> {
    const raw = await this.config.get<unknown>('wishlist.price_drop_cooldown_days', DEFAULT_PRICE_DROP_COOLDOWN_DAYS);
    const days =
      typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 90 ? raw : DEFAULT_PRICE_DROP_COOLDOWN_DAYS;
    if (days === 0) return new Set();
    const since = new Date(Date.now() - days * 864e5);
    const logs = await this.prisma.notificationLog.findMany({
      where: {
        templateCode: 'PRICE_DROP_ALERT',
        userId: { in: userIds },
        sentAt: { gte: since },
        payload: { path: ['data', 'product_id'], equals: productId },
      },
      select: { userId: true },
    });
    return new Set(logs.map((l) => l.userId));
  }

  private async fractionConfig(key: string, fallback: number): Promise<number> {
    const v = await this.config.get<unknown>(key, fallback);
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
  }
}

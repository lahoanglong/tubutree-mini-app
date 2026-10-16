import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LifecycleService } from '../lifecycle/lifecycle.service';
import { CRON_TZ } from '../../common/cron-tz';

export const FLASH_SOLD_OUT_MSG = 'Hết suất ưu đãi.';
export const FLASH_OVER_LIMIT_MSG = 'Vượt giới hạn mua ưu đãi.';
export const FLASH_ALREADY_STARTED_MSG = 'Ưu đãi đã bắt đầu.';
export const FLASH_START_LOCKED_MSG = 'Đợt flash sale đã bắt đầu, không đổi được giờ bắt đầu. Chỉ sửa được tên, giờ kết thúc hoặc tắt đợt.';
export const FLASH_ITEM_CLASH_MSG = 'Sản phẩm đã có trong đợt flash khác.';

/** Chốt chặn gõ nhầm (R4-ADMIN-11): giá flash 1đ, đợt kéo dài 10 năm vì gõ sai năm. */
export const FLASH_MAX_DISCOUNT_KEY = 'flashsale.max_discount_pct';
export const FLASH_MAX_DISCOUNT_DEFAULT = 0.9;
export const FLASH_MAX_DURATION_KEY = 'flashsale.max_duration_days';
export const FLASH_MAX_DURATION_DEFAULT_DAYS = 31;

export interface EffectivePrice {
  flashPrice: number;
  itemId: string;
  endAt: Date;
  soldCount: number;
  quota: number;
  /** Chỉ có khi tra theo khách: số suất giờ vàng khách còn mua được = min(quotaLeft, perUserLeft). */
  allowance?: number;
  quotaLeft?: number;
  perUserLeft?: number;
}

/**
 * Giá niêm yết có thể bị hạ sau khi tạo đợt (đồng bộ Pancake, sửa tay) làm giá flash không còn rẻ hơn. Giỏ hàng vẫn tính
 * min(flash, giá đang bán) nên khách không trả cao hơn, nhưng quảng bá món đó là "giờ vàng" kèm % âm là sai (BUYERMINI-12).
 */
function isStillDiscounted(it: { flashPrice: number; variation: { salePrice: number | null; retailPrice: number } }): boolean {
  return it.flashPrice < (it.variation.salePrice ?? it.variation.retailPrice);
}

/**
 * Khung giờ đợt flash: đọc được, bắt đầu trước kết thúc, không dài quá `maxDays` ngày và (khi đặt endAt mới) chưa kết
 * thúc.
 */
function assertSaleWindow(startAt: Date, endAt: Date, maxDays: number, checkEndInFuture = true): void {
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    throw new BadRequestException('Thời gian bắt đầu/kết thúc không hợp lệ.');
  }
  if (!(startAt < endAt)) throw new BadRequestException('Thời gian bắt đầu phải trước thời gian kết thúc.');
  if (endAt.getTime() - startAt.getTime() > maxDays * 86_400_000) {
    throw new BadRequestException(
      `Đợt flash sale dài tối đa ${maxDays} ngày — kiểm tra lại năm/tháng của thời gian kết thúc. ` +
        `Cần đợt dài hơn thì nâng "${FLASH_MAX_DURATION_KEY}" ở trang Cấu hình.`,
    );
  }
  if (checkEndInFuture && endAt.getTime() <= Date.now()) throw new BadRequestException('Thời gian kết thúc phải ở tương lai.');
}

const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

@Injectable()
export class FlashSaleService {
  private readonly logger = new Logger(FlashSaleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly notifications: NotificationsService,
    private readonly lifecycle: LifecycleService,
  ) {}

  /**
   * Trả giá flash hiệu lực cho các variation ĐANG có FlashSale active + còn quota.
   * Chỉ chứa variation có flash; caller tự fallback salePrice ?? retailPrice cho phần còn lại.
   * Lưu ý: Prisma không so 2 cột trong where (soldCount<quota) → lọc bằng JS sau khi lấy item active.
   */
  async resolveEffective(
    variationIds: string[],
    now: Date = new Date(),
    userId?: string,
  ): Promise<Map<string, EffectivePrice>> {
    const map = new Map<string, EffectivePrice>();
    if (variationIds.length === 0) return map;
    const items = await this.prisma.flashSaleItem.findMany({
      where: {
        variationId: { in: variationIds },
        variation: { isActive: true },
        flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
      },
      include: { flashSale: { select: { endAt: true } } },
    });
    const open = items.filter((it) => it.soldCount < it.quota);
    // Cùng hai giới hạn consumeQuota kiểm lúc đặt đơn: giỏ/báo giá tính trước để khách không bị chặn ở bước cuối
    // với một giá giỏ không bao giờ đặt được (ENGAGE-4).
    const bought = new Map<string, number>();
    if (userId && open.length > 0) {
      const purchases = await this.prisma.flashSalePurchase.findMany({
        where: { userId, flashSaleItemId: { in: open.map((it) => it.id) } },
        select: { flashSaleItemId: true, quantity: true },
      });
      for (const p of purchases) bought.set(p.flashSaleItemId, p.quantity);
    }
    for (const it of open) {
      const entry: EffectivePrice = {
        flashPrice: it.flashPrice,
        itemId: it.id,
        endAt: it.flashSale.endAt,
        soldCount: it.soldCount,
        quota: it.quota,
      };
      if (userId) {
        entry.quotaLeft = it.quota - it.soldCount;
        entry.perUserLeft = Math.max(0, it.perUserLimit - (bought.get(it.id) ?? 0));
        entry.allowance = Math.min(entry.quotaLeft, entry.perUserLeft);
      }
      map.set(it.variationId, entry);
    }
    return map;
  }

  /** Danh sách item flash đang active còn quota — cho FE trang chủ. */
  async listActive(now: Date = new Date()) {
    const items = await this.prisma.flashSaleItem.findMany({
      where: {
        variation: { isActive: true },
        flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } },
      },
      include: {
        flashSale: { select: { endAt: true } },
        variation: { include: { product: { select: { slug: true, name: true, thumbnail: true } } } },
      },
    });
    return items
      .filter((it) => it.soldCount < it.quota && isStillDiscounted(it))
      .map((it) => ({
        itemId: it.id,
        variationId: it.variationId,
        productSlug: it.variation.product.slug,
        productName: it.variation.product.name,
        thumbnail: it.variation.product.thumbnail,
        flashPrice: it.flashPrice,
        retailPrice: it.variation.retailPrice,
        salePrice: it.variation.salePrice,
        soldCount: it.soldCount,
        quota: it.quota,
        endAt: it.flashSale.endAt,
      }));
  }

  /**
   * Trừ 1 suất flash ATOMIC trong tx đặt đơn. Guard kép:
   *  (a) soldCount+qty<=quota + flash còn active → raw SQL (Prisma không so 2 cột); rows=0 → hết suất.
   *  (b) FlashSalePurchase.quantity+qty<=perUserLimit → chống vượt giới hạn mua.
   * Fail bất kỳ guard nào → throw (caller rollback toàn bộ đơn). Nếu (b) fail sau khi (a) đã trừ,
   * hoàn lại soldCount để không "khoá" suất.
   */
  async consumeQuota(
    tx: Prisma.TransactionClient,
    itemId: string,
    userId: string,
    qty: number,
    now: Date = new Date(),
  ): Promise<void> {
    // (a) trừ soldCount atomic (raw — so 2 cột + kiểm tra flash còn active).
    const sold = await tx.$executeRaw`
      UPDATE flash_sale_items AS fsi
      SET "soldCount" = fsi."soldCount" + ${qty}
      WHERE fsi.id = ${itemId}
        AND fsi."soldCount" + ${qty} <= fsi."quota"
        AND EXISTS (
          SELECT 1 FROM flash_sales fs
          WHERE fs.id = fsi."flashSaleId"
            AND fs."isActive" = true
            AND fs."startAt" <= ${now}
            AND fs."endAt" > ${now}
        )`;
    if (sold === 0) throw new BadRequestException(FLASH_SOLD_OUT_MSG);

    // (b) perUserLimit
    // KEY SHARE dòng users (đúng khoá mà khoá ngoại của đơn sắp chèn sẽ lấy) TRƯỚC khi đọc/chèn dòng suất: gộp phiên khách giữ
    // FOR UPDATE users của tài khoản đích rồi chuyển dòng suất của khách sang khoá (suất, đích). Chèn dòng (suất, đích) mới
    // trước rồi mới chờ users là giữ mục chỉ mục unique mà gộp đang chờ ⇒ 40P01 (r13-merge-checkout-lock.race-spec). Chờ ở
    // đây thì gộp xong trước và lần đọc bên dưới thấy dòng vừa chuyển sang, cộng dồn vào đó.
    await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId} FOR KEY SHARE`;
    const item = await tx.flashSaleItem.findUnique({ where: { id: itemId }, select: { perUserLimit: true } });
    const limit = item?.perUserLimit ?? 0;
    const existing = await tx.flashSalePurchase.findUnique({
      where: { flashSaleItemId_userId: { flashSaleItemId: itemId, userId } },
    });
    if (existing) {
      const bumped = await tx.flashSalePurchase.updateMany({
        where: { flashSaleItemId: itemId, userId, quantity: { lte: limit - qty } },
        data: { quantity: { increment: qty } },
      });
      if (bumped.count === 0) {
        await tx.flashSaleItem.updateMany({ where: { id: itemId }, data: { soldCount: { decrement: qty } } });
        throw new BadRequestException(FLASH_OVER_LIMIT_MSG);
      }
    } else {
      if (qty > limit) {
        await tx.flashSaleItem.updateMany({ where: { id: itemId }, data: { soldCount: { decrement: qty } } });
        throw new BadRequestException(FLASH_OVER_LIMIT_MSG);
      }
      await tx.flashSalePurchase.create({ data: { flashSaleItemId: itemId, userId, quantity: qty } });
    }
  }

  /** Hoàn suất flash khi huỷ/hoàn đơn (mirror khôi phục stock). Guard gte để không âm. */
  async restore(tx: Prisma.TransactionClient, itemId: string, userId: string, qty: number): Promise<void> {
    await tx.flashSaleItem.updateMany({
      where: { id: itemId, soldCount: { gte: qty } },
      data: { soldCount: { decrement: qty } },
    });
    await tx.flashSalePurchase.updateMany({
      where: { flashSaleItemId: itemId, userId, quantity: { gte: qty } },
      data: { quantity: { decrement: qty } },
    });
  }

  /** Tạo đợt flash sale mới (admin). */
  async createSale(adminId: string, dto: { title: string; startAt: string; endAt: string }) {
    const startAt = new Date(dto.startAt),
      endAt = new Date(dto.endAt);
    assertSaleWindow(startAt, endAt, await this.maxSaleDays());
    return this.prisma.flashSale.create({ data: { title: dto.title, startAt, endAt, createdBy: adminId } });
  }

  /**
   * Cập nhật đợt flash sale (admin). Đợt đã bắt đầu không đổi được giờ bắt đầu: đẩy sang tương lai thì giá flash biến mất
   * khỏi khách đang xem rồi đợt xoá được như đợt chưa bắt đầu (R3-UI-5). Đổi khung giờ cũng không được làm một biến thể
   * nằm trong hai đợt trùng giờ — addItem chặn điều đó lúc thêm, ở đây chặn lúc dời giờ.
   */
  async updateSale(id: string, dto: { title?: string; startAt?: string; endAt?: string; isActive?: boolean }) {
    if (dto.startAt !== undefined || dto.endAt !== undefined) {
      const current = await this.prisma.flashSale.findUniqueOrThrow({ where: { id }, include: { items: { select: { variationId: true } } } });
      const start = dto.startAt ? new Date(dto.startAt) : current.startAt;
      const end = dto.endAt ? new Date(dto.endAt) : current.endAt;
      assertSaleWindow(start, end, await this.maxSaleDays(), dto.endAt !== undefined);
      if (current.startAt.getTime() <= Date.now() && start.getTime() !== current.startAt.getTime()) {
        throw new BadRequestException(FLASH_START_LOCKED_MSG);
      }
      await this.assertNoItemClash(id, current.items?.map((it) => it.variationId) ?? [], start, end);
    }
    return this.prisma.flashSale.update({
      where: { id },
      data: {
        title: dto.title,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        isActive: dto.isActive,
      },
    });
  }

  private maxSaleDays(): Promise<number> {
    return this.config.get<number>(FLASH_MAX_DURATION_KEY, FLASH_MAX_DURATION_DEFAULT_DAYS);
  }

  /** Không biến thể nào của đợt `saleId` nằm trong đợt khác trùng khung giờ [start, end). */
  private async assertNoItemClash(saleId: string, variationIds: string[], start: Date, end: Date): Promise<void> {
    if (variationIds.length === 0) return;
    const from = new Date(Math.max(start.getTime(), Date.now()));
    const clash = await this.prisma.flashSaleItem.findFirst({
      where: { variationId: { in: variationIds }, flashSale: { id: { not: saleId }, startAt: { lt: end }, endAt: { gt: from } } },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(FLASH_ITEM_CLASH_MSG);
  }

  /**
   * Xoá đợt flash sale CHƯA bắt đầu (admin): gõ nhầm tên/giờ thì tạo lại được. Đợt đã bắt đầu có thể đã có người xem giá
   * và đặt hàng nên chỉ cho tắt. Item, lượt mua và nhắc tôi xoá theo cascade.
   */
  async deleteSale(id: string) {
    const sale = await this.prisma.flashSale.findUnique({ where: { id }, include: { items: { select: { soldCount: true } } } });
    if (!sale) throw new BadRequestException('Không tìm thấy đợt flash sale.');
    if (sale.startAt.getTime() <= Date.now()) {
      throw new BadRequestException('Đợt flash sale đã bắt đầu, chỉ có thể tắt chứ không xoá.');
    }
    if (sale.items.some((it) => it.soldCount > 0)) {
      throw new BadRequestException('Đợt flash sale đã phát sinh đơn, chỉ có thể tắt chứ không xoá.');
    }
    await this.prisma.flashSale.delete({ where: { id } });
    return { ok: true };
  }

  /** Danh sách toàn bộ đợt flash sale kèm item (admin). */
  async listSales() {
    return this.prisma.flashSale.findMany({
      orderBy: { startAt: 'desc' },
      include: {
        items: {
          select: { id: true, variationId: true, flashPrice: true, quota: true, soldCount: true, perUserLimit: true },
        },
      },
    });
  }

  /**
   * Thêm variation vào đợt flash sale (admin). Validate:
   *  - đợt flash tồn tại; variation tồn tại; flashPrice < giá đang bán (salePrice ?? retailPrice)
   *    (kèm % giảm tối thiểu theo config).
   *  - quota không vượt tồn kho.
   *  - variation chưa nằm trong đợt flash khác trùng khung giờ.
   */
  async addItem(saleId: string, dto: { variationId: string; flashPrice: number; quota: number; perUserLimit?: number }) {
    const sale = await this.prisma.flashSale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Đợt flash không tồn tại.');
    const variation = await this.prisma.variation.findUnique({ where: { id: dto.variationId } });
    if (!variation) throw new BadRequestException('Variation không tồn tại.');
    const standing = variation.salePrice ?? variation.retailPrice;
    if (dto.flashPrice >= standing) throw new BadRequestException('Giá flash phải thấp hơn giá đang bán.');
    const minPct = await this.config.get<number>('flashsale.min_discount_pct', 0);
    if (minPct > 0 && dto.flashPrice > standing * (1 - minPct)) {
      throw new BadRequestException(`Mức giảm phải ≥ ${Math.round(minPct * 100)}%.`);
    }
    const maxPct = await this.config.get<number>(FLASH_MAX_DISCOUNT_KEY, FLASH_MAX_DISCOUNT_DEFAULT);
    const floor = Math.ceil(standing * (1 - maxPct) - 1e-6);
    if (maxPct < 1 && dto.flashPrice < floor) {
      throw new BadRequestException(
        `Giá flash ${vnd(dto.flashPrice)} giảm quá ${Math.round(maxPct * 100)}% so với giá đang bán ${vnd(standing)} — ` +
          `giá flash thấp nhất là ${vnd(floor)}. Kiểm tra lại số 0; muốn bán sâu hơn thì nâng "${FLASH_MAX_DISCOUNT_KEY}" ở trang Cấu hình.`,
      );
    }
    if (dto.quota > variation.stock) throw new BadRequestException('Quota vượt tồn kho.');
    // Chỉ chặn đợt TRÙNG khung giờ (hai giá flash cùng lúc cho một SKU); đợt kế tiếp không trùng giờ thì xếp được.
    const from = new Date(Math.max(sale.startAt.getTime(), Date.now()));
    const clash = await this.prisma.flashSaleItem.findFirst({
      where: { variationId: dto.variationId, flashSale: { startAt: { lt: sale.endAt }, endAt: { gt: from } } },
    });
    if (clash) throw new BadRequestException(FLASH_ITEM_CLASH_MSG);
    const perUserLimit = dto.perUserLimit ?? (await this.config.get<number>('flashsale.default_per_user_limit', 5));
    return this.prisma.flashSaleItem.create({
      data: { flashSaleId: saleId, variationId: dto.variationId, flashPrice: dto.flashPrice, quota: dto.quota, perUserLimit },
    });
  }

  /** Xoá item khỏi đợt flash sale (admin). Chặn xoá nếu đã phát sinh đơn (soldCount>0). */
  async removeItem(itemId: string) {
    const item = await this.prisma.flashSaleItem.findUnique({ where: { id: itemId }, select: { soldCount: true } });
    if (!item) throw new BadRequestException('Không tìm thấy sản phẩm flash.');
    if (item.soldCount > 0) {
      throw new BadRequestException('Không thể xoá sản phẩm đã phát sinh đơn giờ vàng. Hãy tắt đợt flash thay vì xoá.');
    }
    await this.prisma.flashSaleItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  /** Danh sách item flash SẮP diễn ra (chưa bắt đầu) — cho FE mục "Sắp diễn ra" + nút Nhắc tôi. */
  async listUpcoming(userId: string, now: Date = new Date()) {
    const items = await this.prisma.flashSaleItem.findMany({
      where: {
        flashSale: { isActive: true, startAt: { gt: now }, endAt: { gt: now } },
      },
      include: {
        flashSale: { select: { startAt: true } },
        variation: { include: { product: { select: { slug: true, name: true, thumbnail: true } } } },
        reminders: { where: { userId }, select: { id: true } },
      },
      orderBy: { flashSale: { startAt: 'asc' } },
    });
    return items.filter(isStillDiscounted).map((it) => ({
      itemId: it.id,
      variationId: it.variationId,
      productSlug: it.variation.product.slug,
      productName: it.variation.product.name,
      thumbnail: it.variation.product.thumbnail,
      flashPrice: it.flashPrice,
      retailPrice: it.variation.retailPrice,
      salePrice: it.variation.salePrice,
      startAt: it.flashSale.startAt,
      reminded: it.reminders.length > 0,
    }));
  }

  /** Đặt nhắc khi flash sale sắp mở bán. Chỉ cho phép khi sale CHƯA bắt đầu. */
  async setReminder(userId: string, itemId: string, now: Date = new Date()) {
    const item = await this.prisma.flashSaleItem.findUnique({
      where: { id: itemId },
      select: { flashSale: { select: { startAt: true } } },
    });
    if (!item) throw new BadRequestException('Không tìm thấy sản phẩm flash.');
    if (item.flashSale.startAt <= now) throw new BadRequestException(FLASH_ALREADY_STARTED_MSG);
    return this.prisma.flashSaleReminder.upsert({
      where: { userId_flashSaleItemId: { userId, flashSaleItemId: itemId } },
      update: {},
      create: { userId, flashSaleItemId: itemId },
    });
  }

  /** Huỷ nhắc flash sale. */
  async cancelReminder(userId: string, itemId: string): Promise<{ ok: boolean }> {
    await this.prisma.flashSaleReminder.deleteMany({ where: { userId, flashSaleItemId: itemId } });
    return { ok: true };
  }

  /**
   * Cron mỗi phút (nhắc "đã bắt đầu" phải tới ngay đầu giờ vàng, không đợi giờ tròn): quét reminder chưa notify,
   * item nào sale ĐÃ bắt đầu (startAt<=now<endAt, isActive)
   * thì claim atomic (updateMany guard notifiedAt: null) rồi notify FLASH_STARTING. notify() nuốt lỗi
   * để 1 lần gửi hỏng không chặn cả lô.
   */
  @Cron('* * * * *', { timeZone: CRON_TZ })
  async notifyStartedFlashSales(now: Date = new Date()): Promise<void> {
    try {
      // Lọc cửa sổ sale NGAY TRONG TRUY VẤN. Trước đây chỉ lọc `notifiedAt: null` rồi mới xét
      // trong JS: nhắc của những sale đã kết thúc/đã tắt nằm lại vĩnh viễn ở notifiedAt = null
      // (không có đường dọn), tích tụ dần cho tới khi lấp hết hạn mức 500 — mà truy vấn lại
      // không có orderBy, nên 500 dòng lấy ra có thể không chứa dòng nào thuộc sale đang chạy.
      // Kết quả: không ai được nhắc, không lỗi, không log.
      const reminders = await this.prisma.flashSaleReminder.findMany({
        where: {
          notifiedAt: null,
          item: { flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } } },
        },
        include: {
          item: {
            include: {
              flashSale: { select: { isActive: true, startAt: true, endAt: true } },
              variation: { include: { product: { select: { name: true } } } },
            },
          },
        },
        orderBy: { id: 'asc' },
        take: 500,
      });

      let sent = 0;
      for (const r of reminders) {
        const sale = r.item.flashSale;
        const started = sale.isActive && sale.startAt <= now && sale.endAt > now;
        if (!started) continue;

        // Atomic claim chống double-send khi cron chạy chồng.
        const claimed = await this.prisma.flashSaleReminder.updateMany({
          where: { id: r.id, notifiedAt: null },
          data: { notifiedAt: now },
        });
        if (claimed.count === 0) continue;

        try {
          await this.notifications.notify(r.userId, 'FLASH_STARTING', { product: r.item.variation.product.name });
          sent++;
        } catch (err) {
          // Claim đã ghi trước khi gửi: nuốt lỗi ở đây là mất luôn cơ hội giờ vàng của khách đó,
          // và không có dấu vết nào. Trả cờ về để lượt cron sau thử lại.
          this.logger.error(`Nhắc giờ vàng lỗi (reminder=${r.id}): ${err instanceof Error ? err.message : err}`);
          await this.prisma.flashSaleReminder
            .updateMany({ where: { id: r.id, notifiedAt: now }, data: { notifiedAt: null } })
            .catch(() => undefined);
        }
      }
      if (sent) this.logger.log(`Flash-starting reminders sent: ${sent}`);

      // Đóng sổ những nhắc KHÔNG CÒN CƠ HỘI nào — chỉ theo `endAt` đã qua.
      //
      // Cố ý KHÔNG đóng theo `isActive: false`: đó là cờ bật/tắt admin sửa bất cứ lúc nào. Sale
      // chạy 20:00, 18:30 admin tắt để sửa giá, cron 19:00 sẽ đánh dấu TOÀN BỘ nhắc là đã-nhắc,
      // 19:30 admin bật lại — tới giờ vàng thì không một ai được nhắc, và log chỉ có dòng "đã đóng
      // sổ N nhắc hết hạn". Sale đang tắt thì điều kiện truy vấn bên trên đã tự lọc rồi.
      const stale = await this.prisma.flashSaleReminder.updateMany({
        where: { notifiedAt: null, item: { flashSale: { endAt: { lte: now } } } },
        data: { notifiedAt: now },
      });
      if (stale.count > 0) this.logger.log(`Đóng sổ ${stale.count} nhắc giờ vàng đã hết hạn.`);
    } catch (err) {
      this.logger.error(err);
    }
  }

  /**
   * Cron :10 mỗi giờ: sale vừa bắt đầu (trong 2 giờ qua, còn chạy) → báo user đã ❤️ wishlist sản phẩm, như khi giá
   * Pancake giảm. Mỗi sản phẩm một lần, theo biến thể giảm sâu nhất. Cửa sổ 2 giờ để một lượt cron lỡ không làm mất báo;
   * lượt thứ hai trong cửa sổ không gửi lại vì notifyWishlistPriceDrop có cooldown theo user × sản phẩm.
   */
  @Cron('10 * * * *', { timeZone: CRON_TZ })
  async notifyWishlistOfStartedSales(now: Date = new Date()): Promise<void> {
    try {
      const sales = await this.prisma.flashSale.findMany({
        where: { isActive: true, startAt: { gt: new Date(now.getTime() - 2 * 3600e3), lte: now }, endAt: { gt: now } },
        include: {
          items: {
            select: {
              id: true,
              flashPrice: true,
              quota: true,
              soldCount: true,
              variation: { select: { retailPrice: true, salePrice: true, product: { select: { id: true, name: true } } } },
            },
          },
        },
        orderBy: { startAt: 'asc' },
        take: 20,
      });
      for (const sale of sales) {
        const best = new Map<string, { name: string; oldPrice: number; newPrice: number }>();
        for (const it of sale.items) {
          const base = it.variation.salePrice ?? it.variation.retailPrice;
          if (it.soldCount >= it.quota || !(it.flashPrice < base)) continue;
          const cur = best.get(it.variation.product.id);
          if (!cur || (base - it.flashPrice) / base > (cur.oldPrice - cur.newPrice) / cur.oldPrice) {
            best.set(it.variation.product.id, { name: it.variation.product.name, oldPrice: base, newPrice: it.flashPrice });
          }
        }
        for (const [productId, b] of best) {
          await this.lifecycle
            .notifyWishlistPriceDrop(productId, b.name, { oldPrice: b.oldPrice, newPrice: b.newPrice })
            .catch((err) =>
              this.logger.error(`Báo wishlist flash sale lỗi (product=${productId}): ${err instanceof Error ? err.message : err}`),
            );
        }
      }
    } catch (err) {
      this.logger.error(err);
    }
  }
}

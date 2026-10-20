import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LifecycleService } from '../lifecycle/lifecycle.service';
import { CRON_TZ } from '../../common/cron-tz';
import { isSellableVariation, SELLABLE_VARIATION_WHERE } from '../cart/sellable';
import { assertStaffDailyBudget, loadStaffCouponCaps, type CouponActor } from '../admin/coupon-input-rules';

export const FLASH_SOLD_OUT_MSG = 'Hết suất ưu đãi.';
export const FLASH_OVER_LIMIT_MSG = 'Vượt giới hạn mua ưu đãi.';
export const FLASH_ALREADY_STARTED_MSG = 'Ưu đãi đã bắt đầu.';
export const FLASH_START_LOCKED_MSG = 'Đợt flash sale đã bắt đầu, không đổi được giờ bắt đầu. Chỉ sửa được tên, giờ kết thúc hoặc tắt đợt.';
export const FLASH_ITEM_CLASH_MSG = 'Sản phẩm đã có trong đợt flash khác.';
export const FLASH_ADMIN_SALE_MSG = 'Đợt flash sale do quản trị viên hoặc hệ thống tạo — nhân viên không sửa được, nhờ quản trị viên.';

export interface FlashQuotaLine {
  flashSaleItemId: string;
  quantity: number;
}

/** Kết quả trừ suất của một dòng: SOLD_OUT = hết suất hoặc hết giờ, OVER_LIMIT = vượt giới hạn mua của khách. */
export type FlashQuotaOutcome = 'OK' | 'SOLD_OUT' | 'OVER_LIMIT';

/** Lỗi hạ tầng khi trừ suất (DB, tranh khoá), kèm vị trí trong `lines` của dòng đang xử lý. */
export class FlashQuotaLineError extends Error {
  constructor(
    readonly lineIndex: number,
    readonly original: unknown,
  ) {
    super(original instanceof Error ? original.message : String(original));
    this.name = 'FlashQuotaLineError';
  }
}

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
  /** Người mua là người tạo đợt (không phải ADMIN): allowance = 0 và giá thường, giữ dòng này để giỏ nói lý do thay vì lặng lẽ bỏ giá. */
  ownSale?: boolean;
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
      include: { flashSale: { select: { endAt: true, createdBy: true } } },
    });
    // Người tạo đợt không mua giá flash của đợt mình (cùng luật mã giảm giá, isOwnStaffCoupon): nhân viên tự đặt giá rồi tự mua.
    // ADMIN được miễn như với mã giảm giá; chỉ tra vai trò khi người mua thật sự là người tạo một đợt đang xét.
    let ownSalesBlocked = false;
    if (userId && items.some((it) => it.flashSale.createdBy === userId)) {
      const buyer = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      ownSalesBlocked = buyer?.role !== 'ADMIN';
    }
    const isOwn = (it: (typeof items)[number]) => ownSalesBlocked && it.flashSale.createdBy === userId;
    const open = items.filter((it) => it.soldCount < it.quota && !isOwn(it));
    // Cùng hai giới hạn consumeQuotas kiểm lúc đặt đơn: giỏ/báo giá tính trước để khách không bị chặn ở bước cuối
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
    for (const it of items) {
      if (it.soldCount >= it.quota || !isOwn(it)) continue;
      map.set(it.variationId, {
        flashPrice: it.flashPrice,
        itemId: it.id,
        endAt: it.flashSale.endAt,
        soldCount: it.soldCount,
        quota: it.quota,
        quotaLeft: it.quota - it.soldCount,
        perUserLeft: 0,
        allowance: 0,
        ownSale: true,
      });
    }
    return map;
  }

  /** Danh sách item flash đang active còn quota — cho FE trang chủ. */
  async listActive(now: Date = new Date()) {
    const items = await this.prisma.flashSaleItem.findMany({
      where: {
        variation: SELLABLE_VARIATION_WHERE,
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
        // App đếm ngược theo giờ máy chủ chứ không theo đồng hồ điện thoại (điện thoại khách hay lệch vài phút).
        serverNow: now.toISOString(),
      }));
  }

  /**
   * Trừ suất giờ vàng của mọi dòng một lần đặt, trong tx đặt đơn. Mỗi dòng có guard kép:
   *  (a) soldCount+qty<=quota + flash còn active → raw SQL (Prisma không so 2 cột); rows=0 → SOLD_OUT.
   *  (b) FlashSalePurchase.quantity+qty<=perUserLimit → OVER_LIMIT, hoàn lại soldCount vừa trừ để không "khoá" suất.
   * Trả kết quả theo đúng thứ tự `lines`; caller báo lỗi của dòng hỏng đầu tiên (tx rollback cả đơn). Lỗi hạ tầng ném
   * FlashQuotaLineError kèm dòng đang xử lý.
   *
   * Khoá theo pha, không theo dòng: (1) mọi dòng suất flash_sale_items theo id, (2) mọi dòng suất của khách đã có theo
   * flashSaleItemId, (3) chỉ khi còn dòng chưa có: một lần KEY SHARE users rồi đọc lại và chèn. Duyệt trả hoàn suất (khoá
   * flash_sale_items) rồi khoá người mời FOR UPDATE, gộp phiên khách khoá dòng suất rồi mới khoá users: lấy users giữa chừng
   * (khi một dòng trước cần chèn) rồi mới khoá suất của dòng sau là vòng chờ ⇒ 40P01 (r13-flash-existing-row-lock,
   * r13-merge-checkout-lock). KEY SHARE users trước khi chèn vì gộp chuyển dòng suất của khách sang (suất, đích) dưới khoá
   * FOR UPDATE users của đích: chèn trước rồi mới chờ users (khoá ngoại của đơn) là giữ mục chỉ mục unique gộp đang chờ.
   */
  async consumeQuotas(
    tx: Prisma.TransactionClient,
    userId: string,
    lines: readonly FlashQuotaLine[],
    now: Date = new Date(),
  ): Promise<FlashQuotaOutcome[]> {
    const outcomes: FlashQuotaOutcome[] = lines.map(() => 'OK');
    if (lines.length === 0) return outcomes;
    const byItem = lines
      .map((_, i) => i)
      .sort((a, b) => {
        const x = lines[a]!.flashSaleItemId;
        const y = lines[b]!.flashSaleItemId;
        return x < y ? -1 : x > y ? 1 : a - b;
      });
    let at = byItem[0]!;
    try {
      for (const i of byItem) {
        at = i;
        const { flashSaleItemId: itemId, quantity: qty } = lines[i]!;
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
        if (sold === 0) outcomes[i] = 'SOLD_OUT';
      }
      const live = byItem.filter((i) => outcomes[i] === 'OK');
      if (live.length === 0) return outcomes;
      at = live[0]!;
      const ids = [...new Set(live.map((i) => lines[i]!.flashSaleItemId))];
      const items = await tx.flashSaleItem.findMany({ where: { id: { in: ids } }, select: { id: true, perUserLimit: true } });
      const limits = new Map(items.map((it) => [it.id, it.perUserLimit]));
      const lockOwn = async (itemIds: string[]) => {
        const rows = await tx.$queryRaw<{ flashSaleItemId: string }[]>`
          SELECT "flashSaleItemId" FROM "flash_sale_purchases"
           WHERE "userId" = ${userId} AND "flashSaleItemId" IN (${Prisma.join(itemIds)})
           ORDER BY "flashSaleItemId"
           FOR NO KEY UPDATE`;
        return new Set(rows.map((r) => r.flashSaleItemId));
      };
      const overLimit = async (i: number) => {
        const { flashSaleItemId: itemId, quantity: qty } = lines[i]!;
        await tx.flashSaleItem.updateMany({ where: { id: itemId }, data: { soldCount: { decrement: qty } } });
        outcomes[i] = 'OVER_LIMIT';
      };
      const bump = async (i: number) => {
        const { flashSaleItemId: itemId, quantity: qty } = lines[i]!;
        const limit = limits.get(itemId) ?? 0;
        const bumped = await tx.flashSalePurchase.updateMany({
          where: { flashSaleItemId: itemId, userId, quantity: { lte: limit - qty } },
          data: { quantity: { increment: qty } },
        });
        if (bumped.count === 0) await overLimit(i);
      };

      const own = await lockOwn(ids);
      const missing: number[] = [];
      for (const i of live) {
        at = i;
        if (own.has(lines[i]!.flashSaleItemId)) await bump(i);
        else missing.push(i);
      }
      if (missing.length === 0) return outcomes;

      at = missing[0]!;
      await tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId} FOR KEY SHARE`;
      for (const id of await lockOwn([...new Set(missing.map((i) => lines[i]!.flashSaleItemId))])) own.add(id);
      for (const i of missing) {
        at = i;
        const { flashSaleItemId: itemId, quantity: qty } = lines[i]!;
        if (own.has(itemId)) await bump(i);
        else if (qty > (limits.get(itemId) ?? 0)) await overLimit(i);
        else {
          await tx.flashSalePurchase.create({ data: { flashSaleItemId: itemId, userId, quantity: qty } });
          own.add(itemId);
        }
      }
      return outcomes;
    } catch (e) {
      throw new FlashQuotaLineError(at, e);
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
  async updateSale(id: string, dto: { title?: string; startAt?: string; endAt?: string; isActive?: boolean }, actor?: CouponActor) {
    if (actor?.staff) {
      const sale = await this.prisma.flashSale.findUnique({ where: { id }, select: { createdBy: true } });
      if (!sale) throw new BadRequestException('Không tìm thấy đợt flash sale.');
      await this.assertStaffCreated(sale.createdBy);
    }
    const timeChanged = dto.startAt !== undefined || dto.endAt !== undefined;
    const data = {
      title: dto.title,
      startAt: dto.startAt ? new Date(dto.startAt) : undefined,
      endAt: dto.endAt ? new Date(dto.endAt) : undefined,
      isActive: dto.isActive,
    };
    if (!timeChanged) return this.prisma.flashSale.update({ where: { id }, data });

    const current = await this.prisma.flashSale.findUniqueOrThrow({ where: { id }, include: { items: { select: { variationId: true } } } });
    const start = dto.startAt ? new Date(dto.startAt) : current.startAt;
    const end = dto.endAt ? new Date(dto.endAt) : current.endAt;
    assertSaleWindow(start, end, await this.maxSaleDays(), dto.endAt !== undefined);
    if (current.startAt.getTime() <= Date.now() && start.getTime() !== current.startAt.getTime()) {
      throw new BadRequestException(FLASH_START_LOCKED_MSG);
    }
    const staffCreated = await this.isStaffCreator(current.createdBy);
    const maxAmount = staffCreated ? (await loadStaffCouponCaps(this.config)).maxAmount : 0;
    // Tra trùng biến thể và ghi giờ mới cùng giao dịch, dưới khoá của addItem: không thì addItem chen một dòng vào giữa lúc tra và lúc ghi.
    return this.prisma.$transaction(async (tx) => {
      await this.lockItemClash(tx);
      const fresh = await tx.flashSale.findUniqueOrThrow({ where: { id }, include: { items: { select: { variationId: true } } } });
      await this.assertNoItemClash(tx, id, fresh.items?.map((it) => it.variationId) ?? [], start, end);
      if (staffCreated) {
        // Dời giờ có thể làm hai đợt của cùng nhân viên chồng giờ, nên trần đơn (addItem chỉ kiểm lúc thêm dòng) phải kiểm lại ở đây, dưới cùng
        // khoá với addItem. Chỉ chặn khi lần dời làm TĂNG mức giảm một đơn: đợt đã vượt trần từ trước (quản trị viên thêm dòng) vẫn được thu
        // hẹp hay sửa tiêu đề giờ, không thì chẳng ai gỡ được đợt đó bằng cách dời giờ.
        const creator = fresh.createdBy!;
        await this.lockStaffOrderCap(tx, creator);
        const before = await this.staffOrderExposure(tx, creator, fresh.startAt, fresh.endAt, id);
        const total = await this.staffOrderExposure(tx, creator, start, end, id);
        if (total > maxAmount && total > before) {
          throw new BadRequestException(
            `Một đơn mua đủ các sản phẩm flash của nhân viên này cùng khung giờ chỉ được giảm tối đa ${vnd(maxAmount)}: ` +
              `sau khi dời giờ, các đợt chồng nhau giảm tới ${vnd(total)}.` +
              (actor?.staff ? ' Cần mức cao hơn thì nhờ quản trị viên tạo đợt.' : ''),
          );
        }
      }
      return tx.flashSale.update({ where: { id }, data });
    });
  }

  private async isStaffCreator(createdBy: string | null): Promise<boolean> {
    if (!createdBy) return false;
    const creator = await this.prisma.user.findUnique({ where: { id: createdBy }, select: { role: true } });
    return creator?.role === 'STAFF';
  }

  /** Nhân viên chỉ đụng đợt do nhân viên tạo; đợt của quản trị viên, hệ thống hay không rõ người tạo giữ cho quản trị viên. */
  private async assertStaffCreated(createdBy: string | null): Promise<void> {
    const creator = createdBy ? await this.prisma.user.findUnique({ where: { id: createdBy }, select: { role: true } }) : null;
    if (creator?.role !== 'STAFF') throw new ForbiddenException(FLASH_ADMIN_SALE_MSG);
  }

  private maxSaleDays(): Promise<number> {
    return this.config.get<number>(FLASH_MAX_DURATION_KEY, FLASH_MAX_DURATION_DEFAULT_DAYS);
  }

  /**
   * Khoá chung cho mọi đường ghi có thể làm một biến thể nằm trong hai đợt trùng giờ (addItem, dời giờ): hai đường chạy song song
   * mỗi bên chỉ thấy bản chưa có dòng của bên kia nên cùng lọt kiểm tra. Luôn lấy TRƯỚC khoá trần của nhân viên để không khoá chéo.
   */
  private async lockItemClash(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'flash.item_clash'}))`;
  }

  /** Không biến thể nào của đợt `saleId` nằm trong đợt khác trùng khung giờ [start, end). */
  private async assertNoItemClash(tx: Prisma.TransactionClient, saleId: string, variationIds: string[], start: Date, end: Date): Promise<void> {
    if (variationIds.length === 0) return;
    const from = new Date(Math.max(start.getTime(), Date.now()));
    const clash = await tx.flashSaleItem.findFirst({
      where: { variationId: { in: variationIds }, flashSale: { id: { not: saleId }, startAt: { lt: end }, endAt: { gt: from } } },
      select: { id: true },
    });
    if (clash) throw new BadRequestException(FLASH_ITEM_CLASH_MSG);
  }

  /**
   * Xoá đợt flash sale CHƯA bắt đầu (admin): gõ nhầm tên/giờ thì tạo lại được. Đợt đã bắt đầu có thể đã có người xem giá
   * và đặt hàng nên chỉ cho tắt. Item, lượt mua và nhắc tôi xoá theo cascade.
   */
  async deleteSale(id: string, actor?: CouponActor) {
    const sale = await this.prisma.flashSale.findUnique({ where: { id }, include: { items: { select: { soldCount: true } } } });
    if (!sale) throw new BadRequestException('Không tìm thấy đợt flash sale.');
    if (actor?.staff) await this.assertStaffCreated(sale.createdBy);
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
  async addItem(
    saleId: string,
    dto: { variationId: string; flashPrice: number; quota: number; perUserLimit?: number },
    actor?: CouponActor,
  ) {
    const sale = await this.prisma.flashSale.findUnique({ where: { id: saleId } });
    if (!sale) throw new BadRequestException('Đợt flash không tồn tại.');
    if (actor?.staff) await this.assertStaffCreated(sale.createdBy);
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
    const perUserLimit = dto.perUserLimit ?? (await this.config.get<number>('flashsale.default_per_user_limit', 5));
    const data = { flashSaleId: saleId, variationId: dto.variationId, flashPrice: dto.flashPrice, quota: dto.quota, perUserLimit };

    // Cùng ba trần với mã do nhân viên tạo (coupon.staff_*): % mỗi đơn vị, tiền mỗi khách, tổng tiền cả ngày.
    const caps = actor?.staff ? await loadStaffCouponCaps(this.config) : null;
    const perUnit = standing - dto.flashPrice;
    if (caps) {
      const deny = (msg: string) => new BadRequestException(`${msg} Cần mức cao hơn thì nhờ quản trị viên tạo đợt.`);
      if (perUnit * 100 > caps.maxPercent * standing) throw deny(`Nhân viên đặt giá flash giảm tối đa ${caps.maxPercent}%.`);
      if (perUnit * perUserLimit > caps.maxAmount) {
        throw deny(`Mỗi khách được giảm tối đa ${vnd(caps.maxAmount)} (giảm mỗi sản phẩm ${vnd(perUnit)} × ${perUserLimit} suất mỗi khách).`);
      }
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockItemClash(tx);
      // Chỉ chặn đợt TRÙNG khung giờ (hai giá flash cùng lúc cho một SKU); đợt kế tiếp không trùng giờ thì xếp được. Tra dưới khoá và đọc
      // lại khung giờ của đợt: updateSale có thể vừa dời giờ giữa lúc đọc đợt ở trên và lúc giữ khoá.
      const fresh = await tx.flashSale.findUnique({ where: { id: saleId }, select: { startAt: true, endAt: true } });
      if (!fresh) throw new BadRequestException('Đợt flash không tồn tại.');
      const from = new Date(Math.max(fresh.startAt.getTime(), Date.now()));
      const clash = await tx.flashSaleItem.findFirst({
        where: { variationId: dto.variationId, flashSale: { startAt: { lt: fresh.endAt }, endAt: { gt: from } } },
      });
      if (clash) throw new BadRequestException(FLASH_ITEM_CLASH_MSG);
      if (caps) {
        // Trừ vào ngân sách của người tạo đợt, không của người thêm: nhân viên được sửa đợt của nhau (assertStaffCreated) nên tính
        // theo người thêm thì đổ item vào đợt của người khác là qua mặt trần ngày. assertStaffCreated đã bảo đảm createdBy là STAFF.
        await assertStaffDailyBudget(tx, sale.createdBy!, sale.createdAt, perUnit * dto.quota, caps);
        await this.assertStaffOrderCap(tx, { ...sale, createdBy: sale.createdBy! }, perUnit * perUserLimit, caps.maxAmount);
      }
      return tx.flashSaleItem.create({ data });
    });
  }

  /**
   * Trần mỗi đơn của nhân viên (coupon.staff_max_amount_vnd) áp cho CẢ ĐƠN, không cho từng dòng: một khách mua đủ mọi sản
   * phẩm flash của các đợt cùng người tạo đang chạy cùng lúc, mỗi sản phẩm đủ số suất mỗi khách, được giảm bằng tổng của
   * (giá gốc − giá flash) × suất mỗi khách. Tính cả dòng quản trị viên thêm vào đợt của nhân viên vì chưa lưu được người thêm
   * dòng; đợt đã tắt vẫn tính vì nhân viên bật lại được. Gộp theo người tạo (không toàn hệ thống) để nhân viên này không
   * chiếm hết trần của nhân viên khác; khoá theo người tạo để hai lần thêm song song không cùng lọt.
   */
  private async assertStaffOrderCap(
    tx: Prisma.TransactionClient,
    sale: { id: string; createdBy: string },
    added: number,
    maxAmount: number,
  ): Promise<void> {
    await this.lockStaffOrderCap(tx, sale.createdBy);
    // Đọc lại khung giờ dưới khoá: updateSale có thể vừa dời giờ đợt này giữa lúc addItem đọc đợt và lúc giữ khoá.
    const fresh = await tx.flashSale.findUnique({ where: { id: sale.id }, select: { startAt: true, endAt: true } });
    if (!fresh) throw new BadRequestException('Đợt flash không tồn tại.');
    const existing = await this.staffOrderExposure(tx, sale.createdBy, fresh.startAt, fresh.endAt);
    if (existing + added > maxAmount) {
      throw new BadRequestException(
        `Một đơn mua đủ các sản phẩm flash của nhân viên này cùng khung giờ chỉ được giảm tối đa ${vnd(maxAmount)}: ` +
          `các sản phẩm đang có đã giảm tới ${vnd(existing)}, sản phẩm này thêm ${vnd(added)}. Cần mức cao hơn thì nhờ quản trị viên tạo đợt.`,
      );
    }
  }

  private async lockStaffOrderCap(tx: Prisma.TransactionClient, createdBy: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`flash.staff_order_cap:${createdBy}`}))`;
  }

  /** Tổng (giá gốc − giá flash) × suất mỗi khách của mọi dòng thuộc đợt của `createdBy` chồng khung [start, end), cộng cả đợt `alsoSaleId`. */
  private async staffOrderExposure(tx: Prisma.TransactionClient, createdBy: string, start: Date, end: Date, alsoSaleId?: string): Promise<number> {
    const from = new Date(Math.max(start.getTime(), Date.now()));
    const rows = await tx.$queryRaw<{ exposure: bigint | number | null }[]>`
      SELECT COALESCE(SUM(GREATEST(COALESCE(v."salePrice", v."retailPrice") - fsi."flashPrice", 0)::bigint * fsi."perUserLimit"), 0)::bigint AS exposure
      FROM "flash_sale_items" fsi
      JOIN "flash_sales" fs ON fs."id" = fsi."flashSaleId"
      JOIN "variations" v ON v."id" = fsi."variationId"
      WHERE fs."createdBy" = ${createdBy} AND ((fs."startAt" < ${end} AND fs."endAt" > ${from}) OR fs."id" = ${alsoSaleId ?? null})`;
    return Number(rows[0]?.exposure ?? 0);
  }

  /** Xoá item khỏi đợt flash sale (admin). Chặn xoá nếu đã phát sinh đơn (soldCount>0). */
  async removeItem(itemId: string, actor?: CouponActor) {
    const item = await this.prisma.flashSaleItem.findUnique({
      where: { id: itemId },
      select: { soldCount: true, flashSale: { select: { createdBy: true } } },
    });
    if (!item) throw new BadRequestException('Không tìm thấy sản phẩm flash.');
    if (actor?.staff) await this.assertStaffCreated(item.flashSale.createdBy);
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
        variation: SELLABLE_VARIATION_WHERE,
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
      select: {
        flashSale: { select: { startAt: true } },
        variation: { select: { isActive: true, product: { select: { isActive: true, approvalStatus: true } } } },
      },
    });
    if (!item || !isSellableVariation(item.variation)) throw new BadRequestException('Không tìm thấy sản phẩm flash.');
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
          // Hàng ngừng bán giữa chừng: không nhắc; dòng nhắc nằm lại tới khi đợt kết thúc rồi được đóng sổ bên dưới.
          item: { variation: SELLABLE_VARIATION_WHERE, flashSale: { isActive: true, startAt: { lte: now }, endAt: { gt: now } } },
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
            where: { variation: SELLABLE_VARIATION_WHERE },
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

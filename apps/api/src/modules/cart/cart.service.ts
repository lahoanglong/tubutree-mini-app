import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CouponMinOrderError, CouponsService, normalizeCouponCode } from '../coupons/coupons.service';
import { CouponClaimService } from '../coupons/coupon-claim.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { calcTierDiscount, freeShipThreshold, tierDiscountPctOf } from '../pricing/pricing.service';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { priceFlashLine } from '../flash-sale/flash-line-price';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { ComboService, goodsAfterComboOf } from '../storefront/combo.service';
import { resolvePublishedStorefront } from '../storefront/resolve-storefront';
import { AffiliateService } from '../affiliate/affiliate.service';
import { resolveAttribution } from '../checkout/attribution';
import { AddItemDto } from './dto/cart.dto';
import { isSellableVariation, productDiscontinuedError } from './sellable';
import { isPartnerOwnedVariation } from './partner-goods';
import {
  COUPON_ZERO_DISCOUNT_REASON,
  couponFlashExcludedNotice,
  couponNotAppliedNotice,
  couponRejectReason,
  couponRejectedWithFlash,
} from '../coupons/coupon-notice';
import { fulfillerOf, merchantStoreUnavailableReason, storeUnavailableOnAddMessage } from '../checkout/checkout-split';
import { isPartnerStore } from '../merchant/partner-store';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coupons: CouponsService,
    private readonly config: SystemConfigService,
    private readonly flashSale: FlashSaleService,
    private readonly analytics: AnalyticsEventsService,
    private readonly combo: ComboService,
    // @Optional: test dựng tay không truyền (không có thì không tra "chạm" giới thiệu); AffiliateModule là @Global.
    @Optional() private readonly affiliate?: AffiliateService,
    // @Optional: như trên (không có thì mã thẻ hộp hàng phải nhận qua link trước); CouponsModule là @Global.
    @Optional() private readonly claims?: CouponClaimService,
  ) {}

  private async ensureCart(userId: string): Promise<string> {
    const cart = await this.prisma.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return cart.id;
  }

  /**
   * Gian hàng ghi công hiệu lực của khách: slug khách gửi, rơi về "chạm" giới thiệu còn hạn khi không gửi/không khớp — cùng hàm
   * với báo giá và đặt đơn (checkout/attribution.ts), nên cùng khách ra cùng combo ở cả ba nơi.
   */
  async attributedSlug(userId: string, storefrontSlug?: string): Promise<string | undefined> {
    if (!this.affiliate) return storefrontSlug;
    const { storefront } = await resolveAttribution(this.prisma, this.affiliate, userId, { storefrontSlug });
    return storefront?.slug;
  }

  /**
   * `storefrontSlug`: gian hàng đang ghi công (cùng chuỗi FE gửi cho báo giá). Có thì giỏ trừ combo của gian hàng đó và tính mã trên
   * phần hàng sau combo, đúng như checkout; không có thì rơi về "chạm" giới thiệu như checkout. `null` = không tra ghi công
   * (đường nội bộ của checkout đã tự resolve).
   */
  async getCart(userId: string, storefrontSlug?: string | null) {
    return this.priceCart(userId, storefrontSlug === null ? undefined : await this.attributedSlug(userId, storefrontSlug));
  }

  /**
   * Giá của MỘT PHẦN giỏ (khách chọn vài dòng để mua): combo, mã và giảm hạng tính trên đúng các dòng đã chọn, cùng hàm và cùng
   * thứ tự với báo giá/đặt đơn có `itemIds` (combo chỉ áp khi đủ bộ trong phần chọn). Chỉ xem giá: không gỡ mã khỏi giỏ dù phần chọn
   * không đạt điều kiện của mã — mã vẫn thuộc cả giỏ.
   */
  async getCartSelection(userId: string, storefrontSlug: string | undefined, itemIds: string[]) {
    return this.priceCart(userId, await this.attributedSlug(userId, storefrontSlug), itemIds);
  }

  private async priceCart(userId: string, storefrontSlug: string | undefined, itemIds?: string[]) {
    const selection = itemIds && itemIds.length > 0 ? new Set(itemIds) : null;
    const cartId = await this.ensureCart(userId);
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: {
        user: { select: { tierId: true } },
        items: {
          include: {
            variation: {
              include: {
                product: {
                  include: {
                    storefront: {
                      select: {
                        title: true,
                        ownerUserId: true,
                        type: true,
                        ordersPausedAt: true,
                        isPartner: true,
                        owner: { select: { role: true, isBlocked: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // Q-14: dòng SP đã ngừng bán/chưa duyệt vẫn giữ trong DB (SP mở bán lại thì tự hiện lại) nhưng
    // không được tính tiền hay đặt — tách riêng để FE báo "đã ngừng bán" và cho khách xoá.
    const sellable = cart.items.filter((it) => isSellableVariation(it.variation));
    const unavailableItems = cart.items
      .filter((it) => !isSellableVariation(it.variation))
      .map((it) => ({
        id: it.id,
        variationId: it.variationId,
        productId: it.variation.productId,
        productName: it.variation.product.name,
        variationName: it.variation.name,
        slug: it.variation.product.slug,
        thumbnail: it.variation.product.thumbnail,
        quantity: it.quantity,
      }));

    // Giá một phần giỏ phải từ chối đúng như báo giá/đặt đơn khi khách chọn đích danh dòng đã ngừng bán (checkoutLines).
    const droppedSelected = selection ? unavailableItems.filter((l) => selection.has(l.id)) : [];
    if (droppedSelected.length > 0) throw productDiscontinuedError(droppedSelected[0]!.productName);

    const now = new Date();
    const flashMap = await this.flashSale.resolveEffective(
      sellable.map((it) => it.variationId),
      now,
      userId,
    );
    const lines = (selection ? sellable.filter((it) => selection.has(it.id)) : sellable).map((it) => {
      const { unitPrice, flash, flashLimitNotice } = priceFlashLine(
        it.variation.salePrice ?? it.variation.retailPrice,
        it.quantity,
        flashMap.get(it.variationId),
      );
      return {
        id: it.id,
        variationId: it.variationId,
        productId: it.variation.productId,
        productName: it.variation.product.name,
        variationName: it.variation.name,
        slug: it.variation.product.slug,
        thumbnail: it.variation.product.thumbnail,
        unitPrice,
        quantity: it.quantity,
        stock: it.variation.stock,
        weight: it.variation.weight ?? null,
        total: unitPrice * it.quantity,
        isFlash: !!flash,
        flashSaleItemId: flash?.itemId ?? null,
        flashEndAt: flash?.endAt ?? null,
        soldPct: flash ? (flash.quota > 0 ? Math.round((flash.soldCount / flash.quota) * 100) : 0) : null,
        flashLimitNotice,
        // Nơi giao (docs/2026-10-14-merchant-fulfilment-design.md mục 3): giỏ chia nhóm theo đây, checkout tách đơn theo đây.
        fulfiller: fulfillerOf(it.variation),
        // Hàng của gian hàng đối tác: checkout không cho trả bằng Điểm Xanh (partner-goods.ts).
        partnerOwned: isPartnerOwnedVariation(it.variation),
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    // Coupon base LOẠI flash item (giá flash là giá cuối, không stack coupon) và TRỪ combo → giảm hiển thị khớp checkout.
    const { combo, goodsAfterCombo: couponBase, couponLines } = await this.couponBaseAfterCombo(lines, userId, storefrontSlug);

    let discount = 0;
    let freeship = false;
    let couponCode = cart.couponCode;
    let couponNotice: string | null = null;
    // Mã vừa bị gỡ khỏi giỏ ở lần đọc này (hết hạn, bị tắt, hết lượt): checkout nói đúng lý do khi tổng tăng vì mất mã.
    let couponRemoved: { code: string; reason: string } | null = null;
    const applyCoupon = async (code: string) => {
      const r = await this.coupons.validateAndCompute(code, userId, couponBase, couponLines);
      // Coupon PERCENT không tự giới hạn ở subtotal khi value>100% và không set maxDiscount
      // (coupons.service.ts) — checkout đã clamp bằng Math.min(..., goodsAfterCombo), cart
      // trước đây thiếu clamp này nên có thể hiển thị discount > couponBase.
      discount = Math.min(r.discount, couponBase);
      freeship = r.freeship;
      if (lines.length > 0 && discount === 0 && !freeship) {
        couponNotice = couponNotAppliedNotice(COUPON_ZERO_DISCOUNT_REASON, lines.some((l) => l.isFlash), combo.total > 0);
      } else if (discount > 0 && lines.some((l) => l.isFlash)) {
        couponNotice = couponFlashExcludedNotice(couponBase);
      }
    };
    if (couponCode) {
      try {
        await applyCoupon(couponCode);
      } catch (err) {
        // Chỉ coi là "coupon không hợp lệ" khi CouponsService từ chối bằng business rule
        // (luôn ném BadRequestException — coupons.service.ts). Lỗi hạ tầng khác (DB timeout,
        // connection blip...) KHÔNG được nuốt ở đây — nếu không, một trục trặc tạm thời sẽ bị
        // hiểu nhầm thành "coupon invalid" và xoá mã hợp lệ khỏi giỏ hàng của khách.
        if (!(err instanceof BadRequestException)) throw err;
        if (selection) {
          // Phần chọn không đạt mã: báo như báo giá (giảm 0đ kèm lý do), không đụng tới mã của cả giỏ.
          discount = 0;
          freeship = false;
          couponNotice = couponNotAppliedNotice(couponRejectReason(err, lines), lines.some((l) => l.isFlash), combo.total > 0);
        } else {
          // Có thể flash tạm thời kéo couponBase xuống dưới minOrder. Nếu coupon vẫn hợp lệ trên
          // TOÀN giỏ (gồm flash) → GIỮ mã (chờ flash kết thúc), tạm không giảm. Nếu hỏng cả trên
          // toàn giỏ (hết hạn/hết lượt/không đạt minOrder thật) → gỡ như cũ.
          try {
            await this.coupons.validateAndCompute(couponCode, userId, subtotal, lines);
            discount = 0;
            freeship = false;
            couponNotice = couponNotAppliedNotice(couponRejectReason(err, lines), lines.some((l) => l.isFlash), combo.total > 0);
          } catch (err2) {
            if (!(err2 instanceof BadRequestException)) throw err2;
            // Chỉ gỡ đúng mã đã đọc: giữa lúc đọc và ghi, tab khác có thể đã áp mã mới — không được xoá nhầm mã đó.
            const cleared = await this.prisma.cart.updateMany({ where: { id: cartId, couponCode }, data: { couponCode: null } });
            if (cleared.count > 0) {
              couponRemoved = { code: couponCode, reason: err2.message };
              couponCode = null;
            } else {
              // Tab khác vừa áp mã mới: trả mã đó cùng mức giảm của chính nó (tính một lần, không gỡ, không lặp lại), để mã và số giảm khớp nhau.
              couponCode = (await this.prisma.cart.findUnique({ where: { id: cartId }, select: { couponCode: true } }))?.couponCode ?? null;
              discount = 0;
              freeship = false;
              couponNotice = null;
              if (couponCode) {
                try {
                  await applyCoupon(couponCode);
                } catch (err3) {
                  if (!(err3 instanceof BadRequestException)) throw err3;
                  couponNotice = couponNotAppliedNotice(couponRejectReason(err3, lines), lines.some((l) => l.isFlash), combo.total > 0);
                }
              }
            }
          }
        }
      }
    }

    // Giảm theo hạng đặt SAU combo và mã, trên phần còn lại, đúng thứ tự và cách làm tròn của checkout (combo → mã → hạng).
    const tierDiscount = calcTierDiscount(
      Math.max(0, couponBase - discount),
      await tierDiscountPctOf(this.prisma, cart.user?.tierId),
    );

    // Ngưỡng freeship theo hạng của khách — cùng ngưỡng checkout tính phí giao kho Tubu — để FE hiển thị tiến độ.
    const freeshipThreshold = await freeShipThreshold(this.config, cart.user?.tierId);

    return {
      items: lines,
      couponCode,
      couponNotice,
      couponRemoved,
      subtotal,
      comboDiscount: combo.total,
      discount,
      tierDiscount,
      freeship,
      freeshipThreshold,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      unavailableItems,
    };
  }

  /** Phần hàng tính mã của giỏ: loại giờ vàng, trừ combo của gian hàng ghi công (cùng hàm với checkout). */
  private async couponBaseAfterCombo(
    lines: { variationId: string; productId: string; total: number; isFlash: boolean }[],
    userId: string,
    storefrontSlug: string | undefined,
  ) {
    const nonFlash = lines.filter((l) => !l.isFlash);
    const storefront = await resolvePublishedStorefront(this.prisma, storefrontSlug);
    const combo = storefront
      ? await this.combo.computeForStorefront(
          storefront.slug,
          nonFlash.map((l) => ({ variationId: l.variationId, productId: l.productId, total: l.total })),
          userId,
        )
      : { total: 0, perLine: {} };
    return { combo, ...goodsAfterComboOf(nonFlash, combo) };
  }

  async addItem(userId: string, dto: AddItemDto, storefrontSlug?: string) {
    const cartId = await this.ensureCart(userId);
    const variation = await this.prisma.variation.findUnique({
      where: { id: dto.variationId },
      include: {
        product: {
          select: {
            isActive: true,
            approvalStatus: true,
            name: true,
            fulfilment: true,
            storefront: {
              select: { title: true, type: true, ordersPausedAt: true, isPartner: true, owner: { select: { role: true, isBlocked: true } } },
            },
          },
        },
      },
    });
    // P0 A2-03=A5-06=A6-04 (phần còn sót ngoài catalog, xem CatalogService): SP đối tác chưa
    // duyệt/bị từ chối không còn tìm thấy qua catalog/search/related/for-you, nhưng ai đã có sẵn
    // variationId (link cũ lưu trước khi bị từ chối, đơn "lên đơn hộ"...) vẫn thêm được vào giỏ
    // nếu chỉ kiểm isActive — phải kiểm cả approvalStatus của Product cha.
    if (!variation || !isSellableVariation(variation)) {
      throw new NotFoundException('Sản phẩm không khả dụng.');
    }
    // Gian hàng tạm nghỉ/ngừng bán: báo ngay thay vì để khách bỏ hàng vào giỏ rồi mới bị chặn lúc đặt (R3-MERCHANT-3).
    const store = variation.product.fulfilment === 'MERCHANT' ? variation.product.storefront : null;
    const storeReason = store && isPartnerStore(store) ? merchantStoreUnavailableReason(store) : null;
    if (store && storeReason) {
      throw new BadRequestException(storeUnavailableOnAddMessage(variation.product.name, store.title, storeReason));
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variationId: { cartId, variationId: dto.variationId } },
    });
    const newQty = (existing?.quantity ?? 0) + dto.quantity;
    if (newQty > variation.stock) {
      throw new BadRequestException(`Chỉ còn ${variation.stock} sản phẩm trong kho.`);
    }

    // Tăng ATOMIC bằng increment (không set giá trị tuyệt đối newQty) — 2 request add-to-cart
    // đồng thời (double-tap/2 tab) cho cùng variation đều đọc `existing` trước khi request kia
    // ghi xong sẽ mất 1 lần cộng dồn nếu dùng `update: { quantity: newQty }`. Cùng pattern với
    // refill.service.ts / flash-sale.service.ts.
    // Bọc upsert + sự kiện add_to_cart trong CÙNG transaction nhỏ (Task 11) — ghi event ATOMIC
    // với thay đổi giỏ hàng, không dùng recordBestEffort (best-effort ngoài tx sẽ ghi sự kiện dù
    // upsert rollback nếu có lỗi hạ tầng giữa chừng).
    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.upsert({
        where: { cartId_variationId: { cartId, variationId: dto.variationId } },
        update: { quantity: { increment: dto.quantity } },
        create: { cartId, variationId: dto.variationId, quantity: dto.quantity },
      });
      await this.analytics.record(tx, {
        eventName: 'add_to_cart',
        userId,
        platform: 'miniapp',
        props: {
          variationId: dto.variationId,
          quantity: dto.quantity,
          addSource: dto.addSource ?? 'pdp',
        },
      });
    });
    return this.getCart(userId, storefrontSlug);
  }

  async updateItem(userId: string, itemId: string, quantity: number, storefrontSlug?: string) {
    const cartId = await this.ensureCart(userId);
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { variation: true },
    });
    if (!item || item.cartId !== cartId) throw new NotFoundException('Không tìm thấy mục giỏ hàng.');
    if (quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      if (quantity > item.variation.stock) {
        throw new BadRequestException(`Chỉ còn ${item.variation.stock} sản phẩm trong kho.`);
      }
      await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    }
    return this.getCart(userId, storefrontSlug);
  }

  async removeItem(userId: string, itemId: string, storefrontSlug?: string) {
    const cartId = await this.ensureCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
    return this.getCart(userId, storefrontSlug);
  }

  /** Xoá nhiều dòng (dùng sau khi đặt đơn checkout TẬP CON — chỉ dọn món đã mua, giữ phần còn lại). */
  async removeItems(userId: string, itemIds: string[], db: Prisma.TransactionClient = this.prisma): Promise<void> {
    if (itemIds.length === 0) return;
    const cart = await db.cart.findUnique({ where: { userId } });
    if (!cart) return;
    await db.cartItem.deleteMany({ where: { cartId: cart.id, id: { in: itemIds } } });
  }

  /**
   * Khoá giỏ của user tới hết transaction đặt đơn rồi đọc lại các dòng: mọi lần đặt của cùng một giỏ xếp hàng sau nhau, và
   * lần đến sau thấy giỏ đã được lần trước dọn (đặt đơn dọn giỏ ngay trong transaction đó), không đặt lại từ bản giỏ đã đọc.
   * NO KEY UPDATE: không chặn thêm dòng giỏ (khoá KEY SHARE của khoá ngoại cart_items → carts).
   */
  async lockForCheckout(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ id: string; variationId: string; quantity: number }[]> {
    await tx.$queryRaw`SELECT "id" FROM "carts" WHERE "userId" = ${userId} FOR NO KEY UPDATE`;
    return tx.cartItem.findMany({
      where: { cart: { userId } },
      select: { id: true, variationId: true, quantity: true },
    });
  }

  async applyCoupon(userId: string, code: string, storefrontSlug?: string) {
    const slug = await this.attributedSlug(userId, storefrontSlug);
    const cart = await this.priceCart(userId, undefined);
    // Validate trên base KHÔNG flash và TRỪ combo (khớp getCart và checkout) — tránh apply rồi bị strip ngay, hoặc báo "đã áp
    // dụng" cho mã không giảm được đồng nào.
    const { combo, goodsAfterCombo: couponBase, couponLines } = await this.couponBaseAfterCombo(cart.items, userId, slug);
    const normalized = normalizeCouponCode(code);
    // Mã in trên thẻ hộp hàng (CLAIM) gõ tay ở giỏ: nhận vào ví trước, không thì mã ẩn bị xét như mã của người khác.
    await this.claims?.claimHiddenForCart(userId, normalized);
    try {
      await this.coupons.validateAndCompute(normalized, userId, couponBase, couponLines);
    } catch (err) {
      // Combo chỉ áp khi giỏ đủ bộ sản phẩm của nó: mua một phần giỏ ("Mua ngay", bỏ chọn món) phần hàng tính mã có thể CAO hơn cả giỏ.
      // Mã chỉ hụt đơn tối thiểu vì combo (trước combo vẫn đạt) thì giữ lại, giỏ báo giảm 0đ kèm lời báo như mã đang giữ.
      if (err instanceof CouponMinOrderError && combo.total > 0 && (await this.meetsMinOrderBeforeCombo(normalized, userId, cart.items))) {
        await this.prisma.cart.update({ where: { userId }, data: { couponCode: normalized } });
        return this.priceCart(userId, slug);
      }
      if (err instanceof CouponMinOrderError && (await this.meetsMinOrderWithFlash(normalized, userId, cart, combo.total > 0))) {
        if (combo.total > 0) {
          const hasFlash = cart.items.some((l) => l.isFlash);
          throw new BadRequestException(couponNotAppliedNotice(couponRejectReason(err, cart.items), hasFlash, true));
        }
        throw new BadRequestException(couponRejectedWithFlash(err.message, err.base));
      }
      if (err instanceof BadRequestException) {
        const reason = couponRejectReason(err, cart.items);
        if (reason !== err.message) throw new BadRequestException(reason);
      }
      throw err;
    }
    await this.prisma.cart.update({ where: { userId }, data: { couponCode: normalized } });
    return this.priceCart(userId, slug);
  }

  /** Phần hàng thường (loại giờ vàng) trước khi trừ combo đã đạt điều kiện của mã: chỉ combo làm mã hụt. */
  private async meetsMinOrderBeforeCombo(
    code: string,
    userId: string,
    items: { productId: string; total: number; isFlash: boolean }[],
  ): Promise<boolean> {
    const nonFlash = items.filter((l) => !l.isFlash).map((l) => ({ productId: l.productId, total: l.total }));
    try {
      await this.coupons.validateAndCompute(code, userId, nonFlash.reduce((s, l) => s + l.total, 0), nonFlash);
      return true;
    } catch (err) {
      if (err instanceof BadRequestException) return false;
      throw err;
    }
  }

  /** Hàng giờ vàng hoặc phần giảm combo mới là lý do chưa đạt đơn tối thiểu: tính cả hai thì mã hợp lệ. */
  private async meetsMinOrderWithFlash(
    code: string,
    userId: string,
    cart: { subtotal: number; items: { productId: string; total: number; isFlash: boolean }[] },
    hasCombo: boolean,
  ): Promise<boolean> {
    if (!hasCombo && !cart.items.some((l) => l.isFlash)) return false;
    try {
      await this.coupons.validateAndCompute(code, userId, cart.subtotal, cart.items.map((l) => ({ productId: l.productId, total: l.total })));
      return true;
    } catch (err) {
      if (err instanceof BadRequestException) return false;
      throw err;
    }
  }

  async removeCoupon(userId: string, storefrontSlug?: string) {
    // updateMany (không phải update) — user chưa từng thao tác giỏ hàng thì chưa có row Cart,
    // `update({ where: { userId } })` sẽ ném P2025 (record not found) và trả 500 cho một thao
    // tác lẽ ra vô hại (không có coupon nào để gỡ). updateMany no-op an toàn khi 0 dòng khớp.
    await this.prisma.cart.updateMany({ where: { userId }, data: { couponCode: null } });
    return this.getCart(userId, storefrontSlug);
  }

  /**
   * Dọn giỏ sau khi đặt CẢ giỏ: chỉ xoá các dòng đã vào đơn (không xoá cả giỏ) vì giỏ có thể nhận dòng mới sau lần đọc của
   * checkout (gộp phiên khách chuyển giỏ khách sang, thêm vào giỏ ở tab khác); bỏ mã giảm giá như trước.
   */
  async clearOrdered(userId: string, itemIds: string[], db: Prisma.TransactionClient = this.prisma): Promise<void> {
    const cart = await db.cart.findUnique({ where: { userId } });
    if (!cart) return;
    await db.cartItem.deleteMany({ where: { cartId: cart.id, id: { in: itemIds } } });
    await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
  }
}

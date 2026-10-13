import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { generateUniqueOrderCode } from '../../common/order-code';
import { CartService } from '../cart/cart.service';
import { CouponsService } from '../coupons/coupons.service';
import { PricingService } from '../pricing/pricing.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import { GomdonOrderService } from '../integrations/gomdon/gomdon-order.service';
import { AffiliateService } from '../affiliate/affiliate.service';
import { ComboService } from '../storefront/combo.service';
import { FlashSaleService, FLASH_OVER_LIMIT_MSG } from '../flash-sale/flash-sale.service';
import { PlaceOrderDto, QuoteDto } from './dto/checkout.dto';
import { reserveVariationStock } from '../catalog/variation-stock';
import { assertVariationsSellable, productDiscontinuedError } from '../cart/sellable';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { classifyOrderError } from '../analytics/order-error-classifier';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { applyPointsDelta } from '../loyalty/points-ledger';
import { couponNotAppliedNotice } from '../coupons/coupon-notice';

/**
 * `JSON.stringify` sắp khoá theo thứ tự chèn — Postgres `jsonb` thì KHÔNG (tự sắp lại theo độ
 * dài + alphabet nội bộ khi lưu). So sánh 2 giá trị JSON "có đổi gì không" mà một bên đọc từ cột
 * `Json`/`jsonb` phải qua hàm này, không được `JSON.stringify` thẳng (xem comment
 * `replayIdempotentOrder`). Dùng cho object phẳng (không mảng lồng object) là đủ cho snapshot
 * địa chỉ hiện tại; mở rộng đệ quy sẵn cho an toàn nếu sau này snapshot thêm trường lồng.
 */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly coupons: CouponsService,
    private readonly pricing: PricingService,
    private readonly loyalty: LoyaltyService,
    private readonly notifications: NotificationsService,
    private readonly pancakeOrder: PancakeOrderService,
    private readonly gomdonOrder: GomdonOrderService,
    private readonly affiliate: AffiliateService,
    private readonly combo: ComboService,
    private readonly flashSale: FlashSaleService,
    private readonly analytics: AnalyticsEventsService,
  ) {}

  /** Map mã giới thiệu → userId CTV (khác người mua). */
  /**
   * P0 A5-01 (đường CHÍNH — không phải fallback touch 3 ngày): slug gian hàng CTV mở trong Zalo
   * là referralCode viết THƯỜNG (storefront.service.ts sinh slug = referralCode.toLowerCase()),
   * còn User.referralCode luôn lưu HOA. Postgres so khớp `=` phân biệt hoa/thường nên trước đây
   * referrer luôn null — CTV không bao giờ được ghi hoa hồng cho khách mua ngay trong Zalo (chỉ
   * fallback touch 3 ngày ở dưới còn hoạt động). Chuẩn hoá HOA trước khi tra, mirror đúng
   * auth.service.ts:resolveReferrerId().
   */
  private async resolveReferrer(referralCode: string | undefined, buyerId: string): Promise<string | null> {
    if (!referralCode) return null;
    const ref = await this.prisma.user.findUnique({ where: { referralCode: referralCode.toUpperCase() } });
    if (!ref || ref.id === buyerId) return null;
    return ref.id;
  }

  /** Tính tạm đơn (ship + giảm + điểm) cho màn checkout. */
  async quote(userId: string, dto: QuoteDto) {
    try {
      return await this.quoteInner(userId, dto);
    } catch (err) {
      if (err instanceof BadRequestException) {
        const message = typeof err.getResponse() === 'string'
          ? (err.getResponse() as string)
          : (err.getResponse() as { message?: string }).message ?? err.message;
        // quote() không tạo đơn — chỉ tín hiệu chất lượng, không phải dữ liệu tiền, nên
        // platform cố định 'miniapp' là đủ (không cần truyền xuống từ controller).
        await this.analytics.recordBestEffort({
          eventName: 'order_place_failed',
          userId,
          platform: 'miniapp',
          props: { step: 'quote', errorCode: classifyOrderError(message) },
        });
      }
      throw err;
    }
  }

  private async quoteInner(userId: string, dto: QuoteDto) {
    const { cart, user, computed } = await this.compute(userId, dto.addressId, dto.pointsToUse, dto.storefrontSlug, dto.itemIds);
    if (cart.items.length === 0) throw new BadRequestException('Chưa chọn sản phẩm để thanh toán.');
    return {
      subtotal: cart.subtotal,
      discount: computed.discount,
      couponApplied: computed.couponApplied,
      couponNotice: computed.couponNotice,
      comboDiscount: computed.comboDiscount,
      tierDiscount: computed.tierDiscount,
      pointsUsed: computed.pointsUsed,
      pointsUsedConverted: computed.pointsUsedConverted,
      pointsDiscount: computed.pointsDiscount,
      shippingFee: computed.shippingFee,
      total: computed.total,
      pointsEarned: computed.pointsEarned,
      pointsBalance: user.pointsBalance,
      pointsConvertedBalance: user.pointsConvertedBalance,
      // Trần điểm FE được phép đề nghị: số dư − điểm đơn còn có thể bị đảo (cùng luật đổi quà).
      // placeOrder kẹp theo đúng số này + guard trong tx, nên UI không bao giờ hứa số điểm bị từ chối.
      redeemablePoints: computed.redeemablePoints,
      // Lô quy đổi không bị khoá (không có điểm đơn nào trong lô) và không bị trần 20%.
      redeemableConvertedPoints: user.pointsConvertedBalance,
      lockedPoints: computed.lockedPoints,
      items: cart.items,
    };
  }

  async placeOrder(
    userId: string,
    dto: PlaceOrderDto,
    idempotencyKey?: string,
    platform: 'miniapp' | 'web' = 'miniapp',
  ) {
    try {
      return await this.placeOrderInner(userId, dto, idempotencyKey, platform);
    } catch (err) {
      if (err instanceof BadRequestException) {
        const message = typeof err.getResponse() === 'string'
          ? (err.getResponse() as string)
          : (err.getResponse() as { message?: string }).message ?? err.message;
        await this.analytics.recordBestEffort({
          eventName: 'order_place_failed',
          userId,
          platform,
          props: { step: 'place', errorCode: classifyOrderError(message) },
        });
      }
      throw err;
    }
  }

  private async placeOrderInner(
    userId: string,
    dto: PlaceOrderDto,
    idempotencyKey?: string,
    platform: 'miniapp' | 'web' = 'miniapp',
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } });
      if (existing) return this.replayIdempotentOrder(existing, userId, dto);
    }

    // PD-3 (Q-03): TubuXu đã gộp vào Điểm Xanh. DTO đã từ chối XU; chặn thêm ở đây cho mọi lối gọi
    // service trực tiếp, vì không còn đường trừ xu nào và đơn XU mới sẽ là đơn PAID không ai trả tiền.
    if ((dto.paymentMethod as string) === 'XU') {
      throw new BadRequestException('Phương thức thanh toán này đã ngừng. Vui lòng chọn phương thức khác.');
    }

    // Thu gom tái chế chỉ nhận khi tính năng đang bật (Gomdon đã cấu hình + admin bật công tắc) —
    // FE cũ/tự gửi hasRecyclingPickup=true khi tính năng tắt không được hứa thu gom mà không ai đi thu.
    if (dto.hasRecyclingPickup === true && !(await this.gomdonOrder.isRecyclingEnabled())) {
      throw new BadRequestException('Tính năng gửi lại vật liệu tái chế hiện chưa mở, vui lòng tải lại trang.');
    }

    // Attribution: ưu tiên referralCode/slug của phiên hiện tại; nếu phiên mất nhưng còn
    // "chạm" giới thiệu trong hạn (3 ngày) → fallback. Resolve TRƯỚC compute() để combo +
    // storefrontSlug dùng đúng slug hiệu lực.
    let referrerUserId = await this.resolveReferrer(dto.referralCode, userId);
    let storefrontSlug = dto.storefrontSlug ?? null;
    if (!referrerUserId || !storefrontSlug) {
      const touch = await this.affiliate.getActiveTouch(userId);
      if (touch) {
        if (!referrerUserId) referrerUserId = touch.referrerUserId;
        // chỉ lấy slug từ touch kind=ctv (brand không gắn storefrontSlug — tránh ô nhiễm analytics)
        if (!storefrontSlug && touch.kind === 'ctv') storefrontSlug = touch.storefrontSlug;
      }
    }

    const { cart, user, address, computed } = await this.compute(
      userId,
      dto.addressId,
      dto.pointsToUse,
      storefrontSlug ?? undefined,
      dto.itemIds,
    );
    if (cart.items.length === 0) throw new BadRequestException('Chưa chọn sản phẩm để thanh toán.');

    // PD-3 (spec 2.3): đơn 0đ (Điểm Xanh/mã giảm giá phủ hết hàng, freeship) không có gì để thu.
    // BANK_TRANSFER/ZALOPAY sẽ treo PENDING_PAYMENT rồi bị cron huỷ; WALLET sẽ thành PAID không trừ gì.
    // Ép COD (CONFIRMED, không thu tiền) cho mọi phương thức.
    if (dto.quotedZeroTotal === true && computed.total > 0) {
      throw new BadRequestException(
        'Số Điểm Xanh hoặc mã giảm giá của bạn vừa thay đổi nên đơn không còn 0đ. Vui lòng tải lại trang thanh toán.',
      );
    }
    const paymentMethod = computed.total === 0 ? 'COD' : dto.paymentMethod;
    if (paymentMethod === 'WALLET' && user.walletBalance < computed.total) {
      throw new BadRequestException('Số dư Ví Tubu không đủ.');
    }
    const codMax = 5_000_000;
    if (paymentMethod === 'COD' && computed.total > codMax) {
      throw new BadRequestException('Đơn vượt hạn mức COD, vui lòng chọn phương thức khác.');
    }

    // WALLET thanh toán ngay (đơn CONFIRMED + PAID).
    const paid = paymentMethod === 'WALLET';
    const status = paymentMethod === 'COD' || paid ? 'CONFIRMED' : 'PENDING_PAYMENT';
    // Phần trả bằng Điểm Xanh (cả lô quy đổi) đã bị trừ khỏi goodsAfterAll nên không sinh điểm mới.
    const pointsEarned = computed.pointsEarned;
    const orderSource = storefrontSlug ? 'ctv_assisted' : dto.itemIds?.length ? 'buy_now' : 'checkout';
    const code = await generateUniqueOrderCode(this.prisma, 'RETAIL');

    const usedStandard = computed.pointsUsed - computed.pointsUsedConverted;
    // Cửa sổ đổi/trả cho lockedOrderPoints trong tx, đọc NGOÀI tx: lần trượt cache cấu hình trong tx xin kết nối pool thứ
    // hai khi tx đang giữ một và đang khoá dòng user (đặt đơn dồn dập lúc cache hết hạn có thể cạn pool, P2024).
    // null khi không tiêu điểm thường: nhánh trừ điểm trong tx chỉ chạy khi windowDays khác null (kiểu của lockedOrderPoints
    // bắt buộc có số trong tx).
    const windowDays = usedStandard > 0 ? await this.loyalty.returnWindowDays() : null;

    let order: Awaited<ReturnType<typeof this.prisma.order.create>>;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        // Giữ chỗ tồn kho ATOMIC từng line — chống oversell khi flash-sale/hàng giới hạn:
        // 2 đơn cùng grab variation cuối → chỉ 1 câu UPDATE sửa được dòng; thua thì throw rollback.
        // Đặt TRƯỚC order.create để fail-fast, không tốn resource ghi Order/Item rồi rollback.
        // SP có thể bị gỡ/từ chối giữa lúc tính giá (compute) và lúc ghi đơn — kiểm lại ở đây.
        await assertVariationsSellable(tx, cart.items);
        for (const line of cart.items) {
          const reserved = await reserveVariationStock(tx, line.variationId, line.quantity);
          if (!reserved) {
            throw new BadRequestException(`Sản phẩm "${line.productName}" không đủ tồn kho.`);
          }
          const fid = line.flashSaleItemId;
          if (fid) {
            try {
              await this.flashSale.consumeQuota(tx, fid, userId, line.quantity, new Date());
            } catch (e) {
              // Vượt giới hạn mua = lỗi hợp lệ, giữ nguyên message. Hết suất/hết giờ → PRICE_CHANGED
              // để FE hỏi lại giá mới (không âm thầm tính giá flash đã hết).
              if (e instanceof BadRequestException && e.message === FLASH_OVER_LIMIT_MSG) throw e;
              // Log trước khi remap: lỗi hạ tầng (DB timeout, bug) bị che dưới thông báo
              // "giá đã đổi" cho khách — vẫn cần log để vận hành chẩn đoán được nguyên nhân thật.
              this.logger.error(
                `consumeQuota lỗi cho đơn ${code}, flashSaleItemId=${fid}: ${e instanceof Error ? e.message : e}`,
              );
              throw new BadRequestException('PRICE_CHANGED');
            }
          }
        }
        const created = await tx.order.create({
          data: {
            code,
            idempotencyKey: idempotencyKey ?? null,
            userId,
            type: 'RETAIL',
            status,
            subtotal: cart.subtotal,
            // P0 A3-05: gồm cả tierDiscount (giảm hạng tự động) — 4 nguồn giảm giá đã tách riêng
            // (combo/coupon/hạng/điểm) đều cộng vào cùng 1 cột Order.discount để hiển thị/đối soát.
            discount: computed.discount + computed.comboDiscount + computed.pointsDiscount + computed.tierDiscount,
            shippingFee: computed.shippingFee,
            total: computed.total,
            pointsEarned,
            pointsUsed: computed.pointsUsed,
            pointsUsedConverted: computed.pointsUsedConverted,
            paymentMethod,
            paymentStatus: paid ? 'PAID' : 'UNPAID',
            shippingAddress: this.addressSnapshot(address),
            referrerUserId,
            storefrontSlug,
            source: orderSource,
            platform,
            paidAt: paid ? new Date() : null,
            // Chỉ gắn coupon khi THỰC SỰ áp (subset không đạt điều kiện → couponApplied=false).
            couponCode: computed.couponApplied ? cart.couponCode : null,
            invoiceRequest: dto.invoiceRequest ? (dto.invoiceRequest as object) : undefined,
            invoiceStatus: dto.invoiceRequest ? 'REQUESTED' : 'NOT_REQUESTED',
            note: dto.note,
            hasRecyclingPickup: dto.hasRecyclingPickup === true,
            recyclingNote: dto.hasRecyclingPickup === true ? dto.recyclingNote?.trim() || null : null,
            items: {
              // Combo: trừ phần giảm phân bổ vào total từng dòng → hoa hồng (đọc OrderItem.total)
              // tính trên giá thực trả sau giảm combo (§7.2).
              create: cart.items.map((l) => ({
                variationId: l.variationId,
                productName: l.productName,
                // Snapshot slug để từ chi tiết đơn mở được trang SP (đánh giá / mua lại).
                productSlug: l.slug,
                variationName: l.variationName,
                unitPrice: l.unitPrice,
                quantity: l.quantity,
                total: l.total - (computed.comboPerLine[l.variationId] ?? 0),
                flashSaleItemId: l.flashSaleItemId ?? null,
              })),
            },
          },
        });

        if (computed.pointsUsed > 0) {
          // Khoá dòng user (FOR UPDATE) TRƯỚC khi tính phần khoá (creditOrderPoints/reverseOrderPoints/
          // redeemReward đều ghi CHÍNH dòng này) và trước khi trừ bất kỳ lô nào.
          await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
        }
        if (windowDays !== null) {
          // Trừ điểm ATOMIC (gte) — chống TOCTOU khi đặt nhiều đơn đồng thời tiêu cùng điểm.
          // CHỈ tiêu điểm DÙNG ĐƯỢC — cùng luật LoyaltyService.redeemReward (lockedOrderPoints): điểm
          // đơn vừa giao còn trong hạn đổi/trả / đang có yêu cầu đổi-trả thì chưa tiêu được, không thì
          // nhận điểm đơn A → tiêu vào đơn B → trả đơn A là giữ giảm giá miễn phí. Guard
          // `pointsBalance >= dùng + khoá` tính trên phần khoá đọc dưới khoá dòng.
          const lock = await this.loyalty.lockedOrderPoints(userId, new Date(), tx, windowDays);
          const dec = await tx.user.updateMany({
            where: { id: userId, pointsBalance: { gte: usedStandard + lock.locked } },
            data: { pointsBalance: { decrement: usedStandard } },
          });
          if (dec.count === 0) {
            const cur = await tx.user.findUnique({ where: { id: userId }, select: { pointsBalance: true } });
            const balance = cur?.pointsBalance ?? 0;
            if (lock.locked > 0 && balance >= usedStandard) {
              const usable = Math.max(0, balance - lock.locked);
              throw new BadRequestException(
                `Đơn này dùng ${usedStandard} Điểm Xanh nhưng hiện bạn chỉ dùng được ${usable}/${balance} điểm: ${this.loyalty.lockedPointsMessage(lock)}. Vui lòng tải lại trang thanh toán.`,
              );
            }
            throw new BadRequestException(`Số điểm Xanh không đủ (hiện có ${balance} điểm).`);
          }
          await tx.pointsTransaction.create({
            data: {
              userId,
              delta: -usedStandard,
              lot: 'STANDARD',
              reason: `ORDER_REDEEM:${code}`,
              refType: 'ORDER',
              refId: created.id,
            },
          });
        }
        if (computed.pointsUsedConverted > 0) {
          // Lô quy đổi (spec 2.3): guard gte trên pointsConvertedBalance; thiếu → rollback cả đơn.
          const conv = await applyPointsDelta(tx, {
            userId,
            delta: -computed.pointsUsedConverted,
            lot: 'CONVERTED',
            reason: `ORDER_REDEEM_CONVERTED:${code}`,
            refType: 'ORDER',
            refId: created.id,
          });
          if (!conv.applied) {
            throw new BadRequestException(
              `Số Điểm Xanh không hết hạn của bạn đã thay đổi (đơn này cần ${computed.pointsUsedConverted} điểm). Vui lòng tải lại trang thanh toán.`,
            );
          }
        }
        if (paymentMethod === 'WALLET' && computed.total > 0) {
          // Trừ ví dưới khoá dòng user — chống overdraft khi 2 đơn WALLET chạy đồng thời; không đủ
          // → throw, rollback toàn bộ đơn/stock/điểm.
          await applyWalletDelta(tx, {
            userId,
            delta: -computed.total,
            type: 'ORDER_PAY',
            refType: 'ORDER',
            refId: created.id,
            reason: `Thanh toán đơn ${code}`,
            insufficientMessage: 'Số dư Ví Tubu không đủ.',
          });
        }
        // B4: redeem coupon ATOMIC trong cùng tx — chống race usageLimit/perUserLimit khi 2 đơn
        // đồng thời cùng dùng 1 mã (đặc biệt voucher giới thiệu usageLimit=1). Nếu hết lượt
        // sẽ throw → rollback toàn bộ order/stock/ví/điểm, đảm bảo không bị "đặt nửa".
        if (cart.couponCode && computed.couponApplied) {
          await this.coupons.redeem(cart.couponCode, userId, created.id, tx);
          await this.analytics.record(tx, {
            eventName: 'coupon_applied',
            userId,
            platform,
            props: {
              couponCode: cart.couponCode,
              orderId: created.id,
              discount: computed.discount,
            },
          });
        }

        await this.analytics.record(tx, {
          eventName: 'order_placed',
          userId,
          platform,
          storefrontSlug: storefrontSlug ?? null,
          refCode: dto.referralCode ?? null,
          props: {
            orderId: created.id,
            total: computed.total,
            subtotal: cart.subtotal,
            discount: computed.discount + computed.comboDiscount + computed.pointsDiscount + computed.tierDiscount,
            shippingFee: computed.shippingFee,
            itemCount: cart.items.length,
            paymentMethod,
            couponCode: computed.couponApplied ? cart.couponCode : null,
            pointsUsed: computed.pointsUsed,
            pointsUsedConverted: computed.pointsUsedConverted,
            orderSource,
          },
        });
        if (paid) {
          await this.analytics.record(tx, {
            eventName: 'order_paid',
            userId,
            platform,
            props: { orderId: created.id, method: paymentMethod, amount: computed.total, secsFromPlaced: 0 },
          });
        }
        if (referrerUserId) await this.affiliate.createCommissionForOrder(created.id, tx);
        return created;
      });
    } catch (err) {
      // Race idempotency: 2 request cùng Idempotency-Key chạy đồng thời — request thua
      // cuộc ăn unique-violation (P2002). Trả lại đơn mà request thắng đã tạo.
      if (idempotencyKey && this.isUniqueViolation(err)) {
        const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } });
        if (existing) return this.replayIdempotentOrder(existing, userId, dto);
      }
      throw err;
    }

    // Dọn giỏ + đẩy Pancake (ngoài transaction chính). Coupon redeem đã chạy trong tx ở trên.
    // Checkout TẬP CON: chỉ xoá món ĐÃ mua, giữ phần còn lại (không clear coupon toàn giỏ).
    // Đơn + thanh toán đã commit ở tx trên — lỗi dọn giỏ (DB blip) không được làm hỏng response
    // (nhất quán với Pancake/notification bên dưới).
    try {
      if (Array.isArray(dto.itemIds) && dto.itemIds.length > 0) {
        await this.cart.removeItems(userId, cart.items.map((l) => l.id));
      } else {
        await this.cart.clear(userId);
      }
    } catch (err) {
      this.logger.error(`Dọn giỏ lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`);
    }
    // Qua queue (retry+backoff, xem PancakePushProcessor) thay vì gọi pushOrder() trực tiếp —
    // trước đây Pancake lỗi/timeout 1 lần là log rồi MẤT VĨNH VIỄN: đơn vẫn CONFIRMED, đã trừ
    // kho + trừ tiền khách, nhưng kho vật lý không bao giờ thấy đơn (P0-2,
    // docs/2026-09-08-review-progress.md). enqueuePush() chỉ thêm job vào Redis — nếu việc
    // ĐÓ cũng lỗi (Redis blip), cron PancakePushReconcileService quét lại sau.
    //
    // Đơn thu gom tái chế → queue Gomdon (GomdonOrderService.pushOrder tự quyết: đơn chưa thanh toán thì
    // đẩy Pancake ngay và CHỜ tiền về mới đặt bưu tá; đã thanh toán/COD thì tạo vận đơn rồi mới đẩy
    // Pancake kèm mã). Enqueue lỗi: KHÔNG đẩy thẳng Pancake (trước đây làm vậy: nếu job Gomdon thực ra
    // đã vào Redis thì vừa có vận đơn Gomdon vừa có note "tạo vận đơn tay" → giao 2 lần). Cron
    // GomdonReconcileService quét đơn thu gom gomdonStatus=null và enqueue lại; quá 60 phút thì
    // PancakePushReconcileService chốt FAILED rồi đẩy Pancake.
    if (order.hasRecyclingPickup) {
      try {
        await this.gomdonOrder.enqueuePush(order.id);
      } catch (err) {
        this.logger.error(`Xếp hàng đẩy Gomdon lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      try {
        await this.pancakeOrder.enqueuePush(order.id);
      } catch (err) {
        this.logger.error(`Xếp hàng đẩy Pancake lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`);
      }
    }
    // Thông báo là side-effect — lỗi gửi không được làm hỏng đơn đã đặt (nhất quán với Pancake).
    try {
      await this.notifications.notify(userId, 'ORDER_CONFIRMED', { order_code: code });
    } catch (err) {
      this.logger.error(`Gửi thông báo lỗi cho đơn ${code}: ${err instanceof Error ? err.message : err}`);
    }
    // CTV nhận tin có đơn mới từ link của mình — gửi sau commit vì hoa hồng được tạo trong tx của đơn.
    if (referrerUserId) {
      try {
        await this.affiliate.notifyCommissionCreated(order.id);
      } catch (err) {
        this.logger.error(`Báo hoa hồng mới cho CTV lỗi, đơn ${code}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return this.findOrderResponse(order.id);
  }

  // ── Helpers ────────────────────────────────────────
  /**
   * Idempotency-Key trùng → trả lại đơn ĐÃ tạo thay vì tạo đơn mới, nhưng chỉ khi an toàn:
   *
   * 1) Chống IDOR: `idempotencyKey` unique TOÀN CỤC (không compound theo userId ở DB) — user B
   *    đoán/dùng lại key mà user A đã dùng KHÔNG được trả đơn của A ra (lộ địa chỉ/tổng tiền/
   *    phương thức thanh toán của A). Bắt thử lại với key mới — mirror wallet.service.ts
   *    (convertToXu/withdraw đã làm đúng theo pattern này).
   * 2) Chống trả nhầm đơn CŨ khi lần gọi lại KHÔNG PHẢI cùng một yêu cầu: khách bấm đặt hàng,
   *    mất mạng SAU KHI server đã tạo đơn thành công (COD/địa chỉ A), tưởng thất bại nên đổi
   *    sang WALLET + địa chỉ B rồi bấm lại CÙNG key → phải từ chối rõ ràng, không được âm thầm
   *    trả đơn A ra như thể vừa đặt đơn mới (đơn trả về vẫn COD/địa chỉ A, không phải điều
   *    khách vừa yêu cầu).
   *
   * KHÔNG đổi schema Order để lưu hash payload: so trực tiếp `paymentMethod` (có sẵn trên
   * Order) + so JSON snapshot địa chỉ (Order không lưu addressId, chỉ lưu snapshot
   * `shippingAddress` — dựng lại snapshot từ addressId mới rồi so với snapshot đã lưu lúc tạo).
   *
   * So bằng `stableStringify` (sắp khoá trước khi stringify), KHÔNG so `JSON.stringify` thô:
   * cột `shippingAddress` kiểu `Json` map sang Postgres `jsonb`, và `jsonb` KHÔNG giữ thứ tự
   * khoá gốc khi ghi (đã kiểm chứng trên Postgres thật — ghi object theo thứ tự
   * recipient/phone/.../wardCode, đọc lại ra thứ tự khác hẳn, Postgres tự sắp theo độ dài tên
   * khoá). `JSON.stringify` thô so object JS mới dựng (giữ đúng thứ tự viết code) với giá trị
   * đọc lại từ cột (đã bị Postgres xáo thứ tự) sẽ LUÔN LUÔN lệch chuỗi dù địa chỉ giống hệt —
   * vô hiệu hoá hẳn tính năng "thử lại an toàn" cho MỌI lần gọi lại hợp lệ (network timeout,
   * double-tap), không chỉ ca race hiếm gặp: khách luôn thấy "vui lòng tải lại trang" dù chưa
   * đổi gì. Test cũ (checkout.service.spec.ts) không bắt được lỗi này vì mock `prisma.order.findUnique`
   * trả thẳng object JS (giữ nguyên thứ tự đã viết), không đi qua Postgres thật.
   */
  private async replayIdempotentOrder(
    existing: {
      id: string;
      userId: string;
      paymentMethod: string;
      total?: number;
      shippingAddress: Prisma.JsonValue;
      hasRecyclingPickup?: boolean;
    },
    userId: string,
    dto: PlaceOrderDto,
  ) {
    if (existing.userId !== userId) {
      throw new BadRequestException('Idempotency-Key không hợp lệ.');
    }
    // Đơn 0đ đã bị ép COD (placeOrderInner): khách gửi lại đúng phương thức đã chọn lúc đầu vẫn là
    // cùng một yêu cầu.
    const forcedCod = existing.paymentMethod === 'COD' && existing.total === 0;
    const paymentChanged = existing.paymentMethod !== dto.paymentMethod && !forcedCod;
    // Bật/tắt thu gom tái chế giữa 2 lần gửi cùng key cũng là "yêu cầu khác" — không trả đơn cũ.
    const recyclingChanged = Boolean(existing.hasRecyclingPickup) !== (dto.hasRecyclingPickup === true);
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    const addressChanged =
      !address || stableStringify(this.addressSnapshot(address)) !== stableStringify(existing.shippingAddress);
    if (paymentChanged || addressChanged || recyclingChanged) {
      throw new BadRequestException('Yêu cầu trước đó với thông tin khác đã được xử lý, vui lòng tải lại trang.');
    }
    return this.findOrderResponse(existing.id);
  }

  /** Lỗi vi phạm ràng buộc unique của Prisma (P2002). */
  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
  }

  private async compute(userId: string, addressId: string, pointsToUse?: number, storefrontSlug?: string, itemIds?: string[]) {
    const fullCart = await this.cart.getCart(userId);
    // Checkout TẬP CON: chỉ tính trên các dòng được chọn, tính lại subtotal từ subset (combo/
    // coupon/điểm/ship đều dựa subtotal này). Rỗng/thiếu itemIds = toàn giỏ (tương thích ngược).
    const subset = Array.isArray(itemIds) && itemIds.length > 0;
    // getCart đã loại dòng ngừng bán khỏi `items`. Toàn giỏ: bỏ qua chúng (giỏ đã báo khách). Nhưng
    // khách CHỌN đích danh dòng đó (mua ngay/tập con), hoặc giỏ chỉ còn toàn dòng ngừng bán, thì
    // phải báo rõ thay vì âm thầm đặt thiếu hay báo "chưa chọn sản phẩm".
    const droppedSelected = subset
      ? fullCart.unavailableItems.filter((l) => itemIds!.includes(l.id))
      : fullCart.items.length === 0
        ? fullCart.unavailableItems
        : [];
    if (droppedSelected.length > 0) throw productDiscontinuedError(droppedSelected[0]!.productName);
    const items = subset ? fullCart.items.filter((l) => itemIds!.includes(l.id)) : fullCart.items;
    const subtotal = subset ? items.reduce((s, l) => s + l.total, 0) : fullCart.subtotal;
    const cart = { ...fullCart, items, subtotal };
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) {
      throw new BadRequestException('Địa chỉ giao hàng không hợp lệ.');
    }

    // Thứ tự áp giảm TUẦN TỰ (mỗi mức trên phần còn lại) để KHÔNG giảm chồng và KHÔNG vượt
    // giá trị hàng (giữ invariant subtotal - tổng-giảm = goods):
    //   1) Combo (shop tài trợ) — phân bổ vào từng dòng → cũng ghi vào OrderItem.total (§7.2, hoa hồng trên giá thực trả).
    //   2) Coupon (Tubu tài trợ) — tính lại trên base SAU combo (đơn không-combo: base = subtotal → y hệt cũ).
    //   3) Điểm Xanh — trên phần còn lại sau coupon (lô STANDARD có trần %, lô quy đổi thì không).
    const nonFlash = cart.items.filter((l) => !l.isFlash);
    const flashSubtotal = cart.items
      .filter((l) => l.isFlash)
      .reduce((s, l) => s + l.total, 0);

    // Combo CHỈ áp trên line KHÔNG flash (flash không gộp combo).
    const combo = await this.combo.computeForStorefront(
      storefrontSlug,
      nonFlash.map((l) => ({ variationId: l.variationId, productId: l.productId, total: l.total })),
      userId,
    );
    const nonFlashSubtotal = nonFlash.reduce((s, l) => s + l.total, 0);
    const goodsAfterCombo = Math.max(0, nonFlashSubtotal - combo.total); // = coupon base (loại flash)

    let discount = 0; // coupon (sau combo)
    let freeship = false;
    let couponApplied = false; // coupon có THỰC SỰ áp không → placeOrder chỉ redeem khi true
    let couponNotice: string | null = null;
    if (cart.couponCode) {
      try {
        const couponLines = nonFlash.map((l) => ({
          productId: l.productId,
          total: Math.max(0, l.total - (combo.perLine[l.variationId] ?? 0)),
        }));
        const r = await this.coupons.validateAndCompute(cart.couponCode, userId, goodsAfterCombo, couponLines);
        discount = Math.min(r.discount, goodsAfterCombo);
        freeship = r.freeship;
        couponApplied = true;
      } catch (err) {
        // Mã không đạt điều kiện trên phần hàng được tính (đã loại flash, trừ combo; hoặc tập con đã
        // chọn) → KHÔNG giảm và KHÔNG redeem, kể cả khi đặt toàn giỏ: trước đây toàn giỏ rơi về
        // cart.discount (0đ khi flash kéo phần còn lại dưới minOrder) mà vẫn redeem → đốt mất mã một lần
        // của khách cho đơn không được giảm đồng nào (MONEY-3). Lỗi hạ tầng thì báo lỗi, không âm thầm bỏ mã.
        if (!(err instanceof BadRequestException)) throw err;
        couponNotice = couponNotAppliedNotice(err.message, flashSubtotal > 0, combo.total > 0);
      }
    }
    const goodsAfterCoupon = Math.max(0, goodsAfterCombo - discount);

    // 3) Quyền lợi hạng thành viên (P0 A3-05, docs/audit-2026-09/03-retention-loops.md): hạng hứa
    // "giảm X% mọi đơn" (VD Cổ Thụ 5%, seed.ts TIERS[].perks + MembershipTier.discountPct) phải TỰ
    // ĐỘNG áp — khác coupon (cần mã, Tubu tài trợ) và điểm (khách tự chọn tiêu). Đặt SAU coupon,
    // KHÔNG đặt trước combo/coupon: coupon.validateAndCompute nhận goodsAfterCombo làm base kiểm
    // minOrder — nếu trừ giảm-hạng TRƯỚC coupon, base đó bị thu nhỏ và có thể đánh rớt minOrder một
    // coupon lẽ ra hợp lệ (đổi hành vi coupon đã có, ngoài phạm vi fix này). Đặt TRƯỚC điểm Xanh vì
    // điểm là lựa chọn TỰ NGUYỆN của khách tại checkout, quy ước tính SAU CÙNG trên phần còn lại nhỏ
    // nhất (giữ nguyên vị trí đã có từ trước fix này). Thứ tự cuối: combo → coupon → hạng → điểm.
    // Loại flash khỏi base (đồng bộ combo/coupon ở trên): giá flash là giá đặc biệt
    // server-authoritative, không cộng dồn thêm giảm giá hạng lên trên nó.
    const tier = user.tierId
      ? await this.prisma.membershipTier.findUnique({ where: { id: user.tierId }, select: { discountPct: true } })
      : null;
    const tierDiscountPct = tier ? Number(tier.discountPct) : 0;
    const tierDiscount = this.pricing.calcTierDiscount(goodsAfterCoupon, tierDiscountPct);
    const goodsAfterTierDiscount = Math.max(0, goodsAfterCoupon - tierDiscount);

    // Điểm áp trên TOÀN đơn (gồm flash): base = phần non-flash sau coupon+hạng + flashSubtotal.
    const redeemBase = goodsAfterTierDiscount + flashSubtotal;
    // Trần điểm = số DÙNG ĐƯỢC (số dư − điểm đơn còn có thể bị đảo), không phải số dư — cùng luật
    // LoyaltyService.redeemReward. Đọc ngoài tx ở đây chỉ để báo giá/kẹp; placeOrder kiểm lại trong tx.
    const lockedPoints =
      user.pointsBalance > 0 ? (await this.loyalty.lockedOrderPoints(userId, new Date())).locked : 0;
    const redeemablePoints = Math.max(0, user.pointsBalance - lockedPoints);
    // PD-3: STANDARD (trần max_redeem_pct) trước, phần còn lại từ lô quy đổi (không trần), spec 2.3.
    const redemption = await this.pricing.resolvePointsRedemptionByLot(
      pointsToUse ?? 0,
      redeemablePoints,
      user.pointsConvertedBalance,
      redeemBase,
    );
    const goodsAfterAll = Math.max(0, redeemBase - redemption.discount);

    let shippingFee = await this.pricing.calcShippingFee({
      subtotal: cart.subtotal,
      tierId: user.tierId,
    });
    if (freeship) shippingFee = 0;

    const multiplier = await this.loyalty.getTierMultiplier(user.tierId);
    const pointsEarned = await this.pricing.calcPointsEarned(goodsAfterAll, multiplier);

    const total = goodsAfterAll + shippingFee;
    return {
      cart,
      user,
      address,
      computed: {
        discount,
        couponApplied,
        couponNotice,
        comboDiscount: combo.total,
        comboPerLine: combo.perLine,
        tierDiscount,
        pointsUsed: redemption.pointsUsed,
        pointsUsedConverted: redemption.pointsUsedConverted,
        pointsDiscount: redemption.discount,
        redeemablePoints,
        lockedPoints,
        shippingFee,
        total,
        pointsEarned,
      },
    };
  }

  private addressSnapshot(a: {
    recipient: string;
    phone: string;
    province: string;
    district: string;
    ward: string;
    street: string;
    provinceCode: string;
    districtCode: string;
    wardCode: string;
  }): Prisma.InputJsonValue {
    return {
      recipient: a.recipient,
      phone: a.phone,
      province: a.province,
      district: a.district,
      ward: a.ward,
      street: a.street,
      provinceCode: a.provinceCode,
      districtCode: a.districtCode,
      wardCode: a.wardCode,
    };
  }

  private async findOrderResponse(orderId: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
  }
}

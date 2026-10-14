import { BadRequestException, Injectable, InternalServerErrorException, Logger, Optional } from '@nestjs/common';
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
import {
  COUPON_FREESHIP_NOTHING_REASON,
  COUPON_ZERO_DISCOUNT_REASON,
  couponFlashExcludedNotice,
  couponNotAppliedNotice,
  couponRejectReason,
} from '../coupons/coupon-notice';
import { GeoService } from '../integrations/pancake/geo.service';
import { assertDeliverableAddress } from '../integrations/pancake/address-geo';
import { SystemConfigService } from '../system-config/system-config.service';
import { readPendingPaymentTtlHours } from '../orders/pending-payment-ttl';
import { formatVnd } from '../orders/refund-destination';
import { formatVnDateTime } from '../../common/vn-time';
import {
  allocateGroupAmounts,
  allocationError,
  groupByFulfiller,
  PAYMENT_METHOD_NOT_ALLOWED,
  pointsRedeemBase,
  paymentMethodBlockReason,
  publicFulfiller,
  QUOTED_PAYMENT_METHODS,
  TUBU_FULFILLER_NAME,
  unavailableLineMessage,
  type GroupAmounts,
  type LineFulfiller,
} from './checkout-split';
import { PARTNER_POINTS_NOTE } from '../cart/partner-goods';
import { DEFAULT_MERCHANT_COMMISSION_PCT, DEFAULT_MERCHANT_SHIPPING_FEE } from '../merchant/merchant-config';
import { forBuyer } from '../orders/buyer-order-fields';
import { totalChangedError, totalChangedMessage } from './total-changed';

const DEFAULT_TTL_CONFIG: Pick<SystemConfigService, 'get'> = { get: async <T>(_key: string, fallback?: T) => fallback as T };

export { TOTAL_CHANGED, TOTAL_CHANGED_MESSAGE_PREFIX, totalChangedMessage } from './total-changed';

/** Mã lỗi ổn định: giỏ đổi giữa lúc tính tiền và lúc ghi đơn (tab khác sửa giỏ, hoặc lần bấm trước vừa đặt xong). */
export const CART_CHANGED = 'CART_CHANGED';
const CART_CHANGED_MESSAGE =
  'Giỏ hàng vừa thay đổi trong lúc đặt đơn. Vui lòng xem lại giỏ hàng và mục Đơn hàng trước khi đặt lại.';

/**
 * Lần bấm "Đặt hàng" đến sau khi giỏ đã thành đơn (app báo lỗi mạng/quá thời gian rồi khách bấm lại, có khi với key mới) nhận
 * lại đơn đó nếu đơn mới tạo trong khoảng này và cùng địa chỉ, cách trả tiền, thu gom.
 */
const RECENT_ORDER_REPLAY_MS = 2 * 60_000;

/** Giỏ đã bị đổi khi lần đặt này giành được khoá giỏ; `consumed` = dòng định mua đã biến mất (thường do lần đặt trước). */
class CartChangedError extends Error {
  constructor(readonly consumed: boolean) {
    super(CART_CHANGED);
  }
}

/** Lời báo trong báo giá khi số Điểm Xanh khách chọn bị kẹp vì giỏ có hàng của gian hàng đối tác. */
export function partnerPointsNotice(pointsMax: number): string {
  return pointsMax > 0
    ? `Đơn này dùng được tối đa ${pointsMax.toLocaleString('vi-VN')} Điểm Xanh. ${PARTNER_POINTS_NOTE}.`
    : `Đơn này không dùng được Điểm Xanh. ${PARTNER_POINTS_NOTE}.`;
}

function cartChangeSince(
  read: { id: string; variationId: string; quantity: number }[],
  fresh: { id: string; variationId: string; quantity: number }[],
): 'consumed' | 'changed' | null {
  const byId = new Map(fresh.map((l) => [l.id, l]));
  let changed = false;
  for (const l of read) {
    const now = byId.get(l.id);
    if (!now) return 'consumed';
    if (now.variationId !== l.variationId || now.quantity !== l.quantity) changed = true;
  }
  return changed ? 'changed' : null;
}

/** Một kiện của lần đặt (một nơi giao) — thành một đơn khi đặt. */
export interface CheckoutShipment extends GroupAmounts {
  key: string;
  fulfiller: LineFulfiller;
  lineIds: string[];
  shippingFee: number;
  total: number;
  pointsEarned: number;
  /** Phí sàn chốt cho đơn đối tác (phân số); null với kiện Tubu. */
  commissionPct: number | null;
}

/** Gian hàng ghi công resolve phía server (SELLER-4/5). */
interface ResolvedStorefront {
  id: string;
  slug: string;
  type: string;
  ownerUserId: string | null;
}

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
    @Optional() private readonly geo?: GeoService,
    // Optional: test dựng tay không truyền; thiếu thì hạn thanh toán dùng TTL mặc định như cron tự huỷ, phí/hoa hồng
    // gian hàng tự giao dùng mặc định.
    @Optional() private readonly config?: SystemConfigService,
  ) {}

  /**
   * Gian hàng đang được ghi công: slug, subdomain hoặc tên miền riêng → gian hàng (đang xuất bản). Đơn lưu slug CHUẨN và id
   * gian hàng, không lưu chuỗi khách gửi (SELLER-5) — subdomain đổi chủ được, slug thì không.
   */
  private async resolveStorefront(identifier: string | null | undefined): Promise<ResolvedStorefront | null> {
    const value = identifier?.trim().toLowerCase();
    if (!value) return null;
    return this.prisma.storefront.findFirst({
      where: { isPublished: true, OR: [{ slug: value }, { subdomain: value }, { customDomain: value }] },
      select: { id: true, slug: true, type: true, ownerUserId: true },
    });
  }

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
    const storefront = await this.resolveStorefront(dto.storefrontSlug);
    const { cart, user, computed } = await this.compute(userId, dto.addressId, dto.pointsToUse, storefront?.slug, dto.itemIds);
    if (cart.items.length === 0) throw new BadRequestException('Chưa chọn sản phẩm để thanh toán.');
    const blockedPaymentMethods: Record<string, string> = {};
    for (const method of QUOTED_PAYMENT_METHODS) {
      const reason = paymentMethodBlockReason(computed.shipments, method);
      if (reason) blockedPaymentMethods[method] = reason;
    }
    return {
      // Mỗi kiện thành một đơn riêng khi đặt (nơi giao, phí giao, tổng riêng) — FE chia nhóm theo đây.
      shipments: computed.shipments.map((s) => ({
        key: s.key,
        fulfiller: { kind: s.fulfiller.kind, name: s.fulfiller.name, storefrontId: s.fulfiller.storefrontId },
        itemIds: s.lineIds,
        subtotal: s.subtotal,
        discount: s.discount,
        shippingFee: s.shippingFee,
        total: s.total,
      })),
      blockedPaymentMethods,
      subtotal: cart.subtotal,
      discount: computed.discount,
      couponApplied: computed.couponApplied,
      couponNotice: computed.couponNotice,
      comboDiscount: computed.comboDiscount,
      tierDiscount: computed.tierDiscount,
      pointsUsed: computed.pointsUsed,
      pointsUsedConverted: computed.pointsUsedConverted,
      pointsDiscount: computed.pointsDiscount,
      // Số Điểm Xanh tối đa dùng được cho lần đặt này (số dư dùng được, trần %, chỉ trên hàng Tubu) và câu giải thích khi giỏ
      // có hàng của gian hàng đối tác; pointsNotice khi số khách chọn bị kẹp vì hàng đó.
      pointsMax: computed.pointsMax,
      pointsPartnerNote: computed.pointsPartnerNote,
      pointsNotice: computed.pointsNotice,
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
      items: cart.items.map((it) => ({ ...it, fulfiller: publicFulfiller(it.fulfiller) })),
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
    let storefront = await this.resolveStorefront(dto.storefrontSlug);
    // Khách đang mua trong gian hàng CTV mà mã giới thiệu phiên không khớp ai (web suy mã từ subdomain, SELLER-4): chủ gian
    // hàng là người giới thiệu — trước khi rơi về "chạm" cũ có thể của CTV khác.
    if (!referrerUserId && storefront?.type === 'CTV' && storefront.ownerUserId && storefront.ownerUserId !== userId) {
      referrerUserId = storefront.ownerUserId;
    }
    if (!referrerUserId || !storefront) {
      const touch = await this.affiliate.getActiveTouch(userId);
      if (touch) {
        if (!referrerUserId) referrerUserId = touch.referrerUserId;
        // chỉ lấy slug từ touch kind=ctv (brand không gắn storefrontSlug — tránh ô nhiễm analytics)
        if (!storefront && touch.kind === 'ctv') storefront = await this.resolveStorefront(touch.storefrontSlug);
      }
    }
    const storefrontSlug = storefront?.slug ?? null;

    const { cart, user, address, computed } = await this.compute(
      userId,
      dto.addressId,
      dto.pointsToUse,
      storefrontSlug ?? undefined,
      dto.itemIds,
    );
    if (cart.items.length === 0) {
      const recent = await this.recentlyPlacedOrder(userId, dto);
      if (recent) return recent;
      throw new BadRequestException('Chưa chọn sản phẩm để thanh toán.');
    }

    // PD-3 (spec 2.3): đơn 0đ (Điểm Xanh/mã giảm giá phủ hết hàng, freeship) không có gì để thu.
    // BANK_TRANSFER/ZALOPAY sẽ treo PENDING_PAYMENT rồi bị cron huỷ; WALLET sẽ thành PAID không trừ gì.
    // Ép COD (CONFIRMED, không thu tiền) cho mọi phương thức.
    if (dto.quotedZeroTotal === true && computed.total > 0) {
      throw new BadRequestException(
        'Số Điểm Xanh hoặc mã giảm giá của bạn vừa thay đổi nên đơn không còn 0đ. Vui lòng tải lại trang thanh toán.',
      );
    }
    // Chỉ chặn khi ĐẮT HƠN số khách đã thấy; rẻ hơn (giảm giá vừa áp) thì có lợi cho khách, không hỏi lại.
    if (dto.expectedTotal != null && computed.total > dto.expectedTotal) {
      throw totalChangedError(
        totalChangedMessage(dto.expectedTotal, computed.total, {
          removed: cart.couponRemoved ?? null,
          notAppliedNotice: cart.couponCode && !computed.couponApplied ? computed.couponNotice : null,
        }),
      );
    }
    const paymentMethod = computed.total === 0 ? 'COD' : dto.paymentMethod;
    const blocked = paymentMethodBlockReason(computed.shipments, paymentMethod);
    if (blocked) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: PAYMENT_METHOD_NOT_ALLOWED, message: blocked });
    }
    if (paymentMethod === 'WALLET' && user.walletBalance < computed.total) {
      throw new BadRequestException('Số dư Ví Tubu không đủ.');
    }
    // Bưu tá thu gom vỏ đi cùng kiện kho Tubu (vận đơn Gomdon đổi hàng) — không có kiện Tubu thì không ai đi thu.
    const tubuShipment = computed.shipments.find((s) => s.fulfiller.kind === 'TUBU');
    if (dto.hasRecyclingPickup === true && !tubuShipment) {
      throw new BadRequestException(
        'Thu gom vật liệu tái chế chỉ đi cùng hàng do Tubu Tree giao. Vui lòng bỏ chọn thu gom hoặc thêm hàng Tubu Tree vào đơn.',
      );
    }

    // WALLET thanh toán ngay (đơn CONFIRMED + PAID).
    const paid = paymentMethod === 'WALLET';
    const status = paymentMethod === 'COD' || paid ? 'CONFIRMED' : 'PENDING_PAYMENT';
    const orderSource = storefrontSlug ? 'ctv_assisted' : dto.itemIds?.length ? 'buy_now' : 'checkout';
    const codes: string[] = [];
    while (codes.length < computed.shipments.length) {
      const next = await generateUniqueOrderCode(this.prisma, 'RETAIL');
      if (!codes.includes(next)) codes.push(next);
    }
    const code = codes[0]!;
    // Lần đặt bị tách theo nơi giao: mọi đơn mang mã đơn đầu để khách/admin thấy chúng đi cùng nhau.
    const checkoutGroup = computed.shipments.length > 1 ? code : null;
    const linesById = new Map(cart.items.map((l) => [l.id, l]));

    const usedStandard = computed.pointsUsed - computed.pointsUsedConverted;
    // Cửa sổ đổi/trả cho lockedOrderPoints trong tx, đọc NGOÀI tx: lần trượt cache cấu hình trong tx xin kết nối pool thứ
    // hai khi tx đang giữ một và đang khoá dòng user (đặt đơn dồn dập lúc cache hết hạn có thể cạn pool, P2024).
    // null khi không tiêu điểm thường: nhánh trừ điểm trong tx chỉ chạy khi windowDays khác null (kiểu của lockedOrderPoints
    // bắt buộc có số trong tx).
    const windowDays = usedStandard > 0 ? await this.loyalty.returnWindowDays() : null;

    let orders: Awaited<ReturnType<typeof this.prisma.order.create>>[];
    try {
      orders = await this.prisma.$transaction(async (tx) => {
        // Mọi lần đặt của cùng giỏ chạy nối tiếp từ đây, và giỏ được dọn trong chính tx này: lần bấm lại (key khác) đang chờ
        // khoá sẽ thấy dòng đã mua biến mất thay vì đặt thêm một đơn từ bản giỏ đã đọc trước đó (R2-MONEY-2).
        const change = cartChangeSince(cart.items, await this.cart.lockForCheckout(tx, userId));
        if (change) throw new CartChangedError(change === 'consumed');

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

        const created: Awaited<ReturnType<typeof tx.order.create>>[] = [];
        for (const [i, shipment] of computed.shipments.entries()) {
          const isPrimary = i === 0;
          const isTubu = shipment.fulfiller.kind === 'TUBU';
          const orderCode = codes[i]!;
          created.push(
            await tx.order.create({
              data: {
                code: orderCode,
                // Idempotency-Key + lượt dùng mã giảm giá gắn vào đơn đầu; gửi lại cùng key trả lại cả nhóm.
                idempotencyKey: isPrimary ? idempotencyKey ?? null : null,
                userId,
                type: 'RETAIL',
                status,
                subtotal: shipment.subtotal,
                // P0 A3-05: gồm cả tierDiscount (giảm hạng tự động) — 4 nguồn giảm giá đã tách riêng
                // (combo/coupon/hạng/điểm) đều cộng vào cùng 1 cột Order.discount để hiển thị/đối soát.
                discount: shipment.discount,
                couponDiscount: shipment.couponDiscount,
                comboDiscount: shipment.comboDiscount,
                tierDiscount: shipment.tierDiscount,
                pointsDiscount: shipment.pointsDiscount,
                shippingFee: shipment.shippingFee,
                total: shipment.total,
                pointsEarned: shipment.pointsEarned,
                pointsUsed: shipment.pointsUsed,
                pointsUsedConverted: shipment.pointsUsedConverted,
                paymentMethod,
                paymentStatus: paid ? 'PAID' : 'UNPAID',
                shippingAddress: this.addressSnapshot(address),
                referrerUserId,
                storefrontSlug,
                storefrontId: storefront?.id ?? null,
                fulfiller: shipment.fulfiller.kind === 'MERCHANT' ? 'MERCHANT' : 'TUBU',
                fulfillerStorefrontId: shipment.fulfiller.storefrontId,
                merchantCommissionPct: shipment.commissionPct,
                checkoutGroup,
                source: orderSource,
                platform,
                paidAt: paid ? new Date() : null,
                // Chỉ gắn coupon khi THỰC SỰ áp (subset không đạt điều kiện → couponApplied=false).
                couponCode: isPrimary && computed.couponApplied ? cart.couponCode : null,
                invoiceRequest: dto.invoiceRequest ? (dto.invoiceRequest as object) : undefined,
                invoiceStatus: dto.invoiceRequest ? 'REQUESTED' : 'NOT_REQUESTED',
                note: dto.note,
                hasRecyclingPickup: isTubu && dto.hasRecyclingPickup === true,
                recyclingNote: isTubu && dto.hasRecyclingPickup === true ? dto.recyclingNote?.trim() || null : null,
                items: {
                  // Combo: trừ phần giảm phân bổ vào total từng dòng → hoa hồng (đọc OrderItem.total)
                  // tính trên giá thực trả sau giảm combo (§7.2).
                  create: shipment.lineIds.map((lineId, idx) => {
                    const l = linesById.get(lineId)!;
                    return {
                      variationId: l.variationId,
                      productName: l.productName,
                      // Snapshot slug để từ chi tiết đơn mở được trang SP (đánh giá / mua lại).
                      productSlug: l.slug,
                      variationName: l.variationName,
                      unitPrice: l.unitPrice,
                      quantity: l.quantity,
                      total: l.total - (computed.comboPerLine[l.variationId] ?? 0),
                      // Tiền khách thực trả cho dòng (mỗi khoản giảm chỉ vào dòng được hưởng) — nền hoàn tiền, hoa hồng,
                      // đối soát đối tác.
                      paidTotal: shipment.linePaid[idx] ?? null,
                      pointsDiscount: shipment.linePoints[idx] ?? null,
                      flashSaleItemId: l.flashSaleItemId ?? null,
                    };
                  }),
                },
              },
            }),
          );
        }

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
          // Sổ điểm theo từng đơn: huỷ một đơn của lần đặt bị tách chỉ hoàn đúng phần điểm của đơn đó.
          for (const [i, shipment] of computed.shipments.entries()) {
            const standard = shipment.pointsUsed - shipment.pointsUsedConverted;
            if (standard <= 0) continue;
            await tx.pointsTransaction.create({
              data: {
                userId,
                delta: -standard,
                lot: 'STANDARD',
                reason: `ORDER_REDEEM:${codes[i]}`,
                refType: 'ORDER',
                refId: created[i]!.id,
              },
            });
          }
        }
        for (const [i, shipment] of computed.shipments.entries()) {
          if (shipment.pointsUsedConverted <= 0) continue;
          // Lô quy đổi (spec 2.3): guard gte trên pointsConvertedBalance; thiếu → rollback cả đơn.
          const conv = await applyPointsDelta(tx, {
            userId,
            delta: -shipment.pointsUsedConverted,
            lot: 'CONVERTED',
            reason: `ORDER_REDEEM_CONVERTED:${codes[i]}`,
            refType: 'ORDER',
            refId: created[i]!.id,
          });
          if (!conv.applied) {
            throw new BadRequestException(
              `Số Điểm Xanh không hết hạn của bạn đã thay đổi (đơn này cần ${computed.pointsUsedConverted} điểm). Vui lòng tải lại trang thanh toán.`,
            );
          }
        }
        if (paymentMethod === 'WALLET') {
          for (const [i, order] of created.entries()) {
            if (order.total <= 0) continue;
            // Trừ ví dưới khoá dòng user — chống overdraft khi 2 đơn WALLET chạy đồng thời; không đủ
            // → throw, rollback toàn bộ đơn/stock/điểm.
            await applyWalletDelta(tx, {
              userId,
              delta: -order.total,
              type: 'ORDER_PAY',
              refType: 'ORDER',
              refId: order.id,
              reason: `Thanh toán đơn ${codes[i]}`,
              insufficientMessage: 'Số dư Ví Tubu không đủ.',
            });
          }
        }
        // B4: redeem coupon ATOMIC trong cùng tx — chống race usageLimit/perUserLimit khi 2 đơn
        // đồng thời cùng dùng 1 mã (đặc biệt voucher giới thiệu usageLimit=1). Nếu hết lượt
        // sẽ throw → rollback toàn bộ order/stock/ví/điểm, đảm bảo không bị "đặt nửa".
        if (cart.couponCode && computed.couponApplied) {
          await this.coupons.redeem(cart.couponCode, userId, created[0]!.id, tx);
          await this.analytics.record(tx, {
            eventName: 'coupon_applied',
            userId,
            platform,
            props: {
              couponCode: cart.couponCode,
              orderId: created[0]!.id,
              discount: computed.discount,
            },
          });
        }

        for (const [i, order] of created.entries()) {
          const shipment = computed.shipments[i]!;
          await this.analytics.record(tx, {
            eventName: 'order_placed',
            userId,
            platform,
            storefrontSlug: storefrontSlug ?? null,
            refCode: dto.referralCode ?? null,
            props: {
              orderId: order.id,
              total: order.total,
              subtotal: order.subtotal,
              discount: order.discount,
              shippingFee: order.shippingFee,
              itemCount: shipment.lineIds.length,
              paymentMethod,
              couponCode: i === 0 && computed.couponApplied ? cart.couponCode : null,
              pointsUsed: order.pointsUsed,
              pointsUsedConverted: order.pointsUsedConverted,
              orderSource,
            },
          });
          if (paid) {
            await this.analytics.record(tx, {
              eventName: 'order_paid',
              userId,
              platform,
              props: { orderId: order.id, method: paymentMethod, amount: order.total, secsFromPlaced: 0 },
            });
          }
          if (referrerUserId) await this.affiliate.createCommissionForOrder(order.id, tx);
        }
        // Dọn giỏ cùng tx với đơn (vẫn dưới khoá giỏ). Checkout TẬP CON: chỉ xoá món ĐÃ mua, giữ phần còn lại và mã giảm giá.
        if (Array.isArray(dto.itemIds) && dto.itemIds.length > 0) {
          await this.cart.removeItems(userId, cart.items.map((l) => l.id), tx);
        } else {
          await this.cart.clear(userId, tx);
        }
        return created;
      });
    } catch (err) {
      // Cùng Idempotency-Key gửi chồng: lần đến sau hoặc ăn unique-violation (P2002), hoặc chờ khoá giỏ rồi thấy giỏ đã
      // thành đơn. Trả lại đơn mà lần thắng đã tạo.
      if (idempotencyKey && (this.isUniqueViolation(err) || err instanceof CartChangedError)) {
        const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } });
        if (existing) return this.replayIdempotentOrder(existing, userId, dto);
      }
      if (err instanceof CartChangedError) {
        if (err.consumed) {
          const recent = await this.recentlyPlacedOrder(userId, dto);
          if (recent) return recent;
        }
        throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: CART_CHANGED, message: CART_CHANGED_MESSAGE });
      }
      throw err;
    }

    // Đẩy Pancake + thông báo (ngoài transaction chính). Coupon redeem và dọn giỏ đã chạy trong tx ở trên.
    for (const [i, order] of orders.entries()) {
      const shipment = computed.shipments[i]!;
      if (shipment.fulfiller.kind === 'MERCHANT') {
        // Đơn đối tác tự giao không đi Pancake: báo chủ gian hàng vào xử lý ở /merchant.
        const ownerId = shipment.fulfiller.ownerUserId;
        if (ownerId) {
          try {
            await this.notifications.notify(ownerId, 'MERCHANT_ORDER_NEW', {
              order_code: order.code,
              total: order.total.toLocaleString('vi-VN'),
            });
          } catch (err) {
            this.logger.error(`Báo đối tác đơn mới ${order.code} lỗi: ${err instanceof Error ? err.message : err}`);
          }
        }
        continue;
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
          this.logger.error(`Xếp hàng đẩy Gomdon lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
        }
      } else {
        try {
          await this.pancakeOrder.enqueuePush(order.id);
        } catch (err) {
          this.logger.error(`Xếp hàng đẩy Pancake lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    for (const order of orders) {
      // Thông báo là side-effect — lỗi gửi không được làm hỏng đơn đã đặt (nhất quán với Pancake).
      try {
        if (order.status === 'PENDING_PAYMENT') {
          // Đơn trả trước chưa có tiền: "đã xác nhận" làm khách tưởng xong và không chuyển khoản (BUYERMINI-8).
          const hours = await readPendingPaymentTtlHours(this.config ?? DEFAULT_TTL_CONFIG);
          await this.notifications.notify(userId, 'ORDER_AWAITING_PAYMENT', {
            order_code: order.code,
            amount: formatVnd(order.total),
            deadline: formatVnDateTime(new Date((order.createdAt ?? new Date()).getTime() + hours * 3_600_000)),
          });
        } else {
          await this.notifications.notify(userId, 'ORDER_CONFIRMED', { order_code: order.code });
        }
      } catch (err) {
        this.logger.error(`Gửi thông báo lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
      }
      // CTV nhận tin có đơn mới từ link của mình — gửi sau commit vì hoa hồng được tạo trong tx của đơn.
      if (referrerUserId) {
        try {
          await this.affiliate.notifyCommissionCreated(order.id);
        } catch (err) {
          this.logger.error(`Báo hoa hồng mới cho CTV lỗi, đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    return this.findOrderResponse(orders[0]!.id);
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
    if (!(await this.isSameRequest(existing, dto))) {
      throw new BadRequestException('Yêu cầu trước đó với thông tin khác đã được xử lý, vui lòng tải lại trang.');
    }
    return this.findOrderResponse(existing.id);
  }

  /** Đơn đã có và lần gửi này cùng địa chỉ, cách trả tiền, thu gom (so snapshot địa chỉ bằng stableStringify, xem trên). */
  private async isSameRequest(
    existing: { paymentMethod: string; total?: number; shippingAddress: Prisma.JsonValue; hasRecyclingPickup?: boolean },
    dto: PlaceOrderDto,
  ): Promise<boolean> {
    // Đơn 0đ đã bị ép COD (placeOrderInner): khách gửi lại đúng phương thức đã chọn lúc đầu vẫn là
    // cùng một yêu cầu.
    const forcedCod = existing.paymentMethod === 'COD' && existing.total === 0;
    if (existing.paymentMethod !== dto.paymentMethod && !forcedCod) return false;
    // Bật/tắt thu gom tái chế giữa 2 lần gửi cũng là "yêu cầu khác" — không trả đơn cũ.
    if (Boolean(existing.hasRecyclingPickup) !== (dto.hasRecyclingPickup === true)) return false;
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    return !!address && stableStringify(this.addressSnapshot(address)) === stableStringify(existing.shippingAddress);
  }

  /**
   * Đơn khách vừa tự đặt (lần đặt gần nhất trong RECENT_ORDER_REPLAY_MS, chưa huỷ) mà lần gửi này trùng thông tin — dùng khi
   * giỏ đã thành đơn trước khi lần gửi này kịp đặt. Lần đặt bị tách thì trả đơn đầu nhóm như lần đặt gốc.
   */
  private async recentlyPlacedOrder(userId: string, dto: PlaceOrderDto) {
    const select = {
      id: true,
      code: true,
      checkoutGroup: true,
      paymentMethod: true,
      total: true,
      shippingAddress: true,
      hasRecyclingPickup: true,
    } as const;
    const latest = await this.prisma.order.findFirst({
      where: {
        userId,
        type: 'RETAIL',
        subscriptionId: null,
        placedForCustomer: false,
        status: { not: 'CANCELLED' },
        createdAt: { gte: new Date(Date.now() - RECENT_ORDER_REPLAY_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select,
    });
    if (!latest) return null;
    const primary =
      latest.checkoutGroup && latest.checkoutGroup !== latest.code
        ? await this.prisma.order.findFirst({ where: { userId, code: latest.checkoutGroup }, select })
        : latest;
    if (!primary || !(await this.isSameRequest(primary, dto))) return null;
    return this.findOrderResponse(primary.id);
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
    // Lưới an toàn cho giá 0đ/âm (dữ liệu đồng bộ lỗi, nhập tay nhầm) — không bao giờ bán hàng miễn phí.
    const unpriced = items.find((l) => !(l.unitPrice > 0));
    if (unpriced) {
      this.logger.error(`Chặn đặt đơn: biến thể ${unpriced.variationId} có đơn giá ${unpriced.unitPrice}.`);
      throw new BadRequestException(
        `Sản phẩm "${unpriced.productName}" đang được cập nhật giá, tạm thời chưa đặt được. Vui lòng bỏ khỏi đơn hoặc thử lại sau.`,
      );
    }
    const subtotal = subset ? items.reduce((s, l) => s + l.total, 0) : fullCart.subtotal;
    const cart = { ...fullCart, items, subtotal };
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) {
      throw new BadRequestException('Địa chỉ giao hàng không hợp lệ.');
    }
    await assertDeliverableAddress(this.geo, address);

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
    let couponProductIds: string[] | null = null;
    let freeship = false;
    let couponValid = false;
    let couponNotice: string | null = null;
    if (cart.couponCode) {
      try {
        const couponLines = nonFlash.map((l) => ({
          productId: l.productId,
          total: Math.max(0, l.total - (combo.perLine[l.variationId] ?? 0)),
        }));
        const r = await this.coupons.validateAndCompute(cart.couponCode, userId, goodsAfterCombo, couponLines);
        discount = Math.min(r.discount, goodsAfterCombo);
        couponProductIds = r.productIds ?? null;
        freeship = r.freeship;
        couponValid = true;
      } catch (err) {
        // Mã không đạt điều kiện trên phần hàng được tính (đã loại flash, trừ combo; hoặc tập con đã
        // chọn) → KHÔNG giảm và KHÔNG redeem, kể cả khi đặt toàn giỏ: trước đây toàn giỏ rơi về
        // cart.discount (0đ khi flash kéo phần còn lại dưới minOrder) mà vẫn redeem → đốt mất mã một lần
        // của khách cho đơn không được giảm đồng nào (MONEY-3). Lỗi hạ tầng thì báo lỗi, không âm thầm bỏ mã.
        if (!(err instanceof BadRequestException)) throw err;
        couponNotice = couponNotAppliedNotice(couponRejectReason(err, cart.items), flashSubtotal > 0, combo.total > 0);
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

    // Điểm Xanh chỉ trả cho hàng Tubu (gồm flash): nền = hàng Tubu sau combo, mã, hạng + hàng Tubu flash. Hàng của gian hàng
    // đối tác chỉ trả bằng tiền (cart/partner-goods.ts). Giỏ chỉ hàng Tubu: nền đúng bằng goodsAfterTierDiscount + flashSubtotal.
    const hasPartnerLines = cart.items.some((l) => l.partnerOwned || l.fulfiller.kind === 'MERCHANT');
    // Một kiện cho mỗi nơi giao (docs/2026-10-14-merchant-fulfilment-design.md mục 3). Trần điểm và phép chia về từng dòng đi
    // trên cùng các kiện này (cùng thứ tự dòng) nên dùng đủ trần không làm dòng nào âm.
    const groups = groupByFulfiller(cart.items);
    const redeemBase = pointsRedeemBase(groups, {
      comboPerLine: combo.perLine,
      comboTotal: combo.total,
      couponDiscount: discount,
      couponProductIds,
      tierDiscount,
    });
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
    const pointsMax = (
      await this.pricing.resolvePointsRedemptionByLot(
        redeemablePoints + user.pointsConvertedBalance,
        redeemablePoints,
        user.pointsConvertedBalance,
        redeemBase,
      )
    ).pointsUsed;
    // Báo khách khi chính hàng của gian hàng đối tác làm số điểm dùng được ít hơn số khách chọn (không báo khi chỉ vì số dư/trần %).
    let pointsNotice: string | null = null;
    if (hasPartnerLines && (pointsToUse ?? 0) > redemption.pointsUsed) {
      const withPartner = await this.pricing.resolvePointsRedemptionByLot(
        pointsToUse ?? 0,
        redeemablePoints,
        user.pointsConvertedBalance,
        goodsAfterTierDiscount + flashSubtotal,
      );
      if (withPartner.pointsUsed > redemption.pointsUsed) pointsNotice = partnerPointsNotice(pointsMax);
    }

    // Giảm giá tính trên cả lần đặt ở trên rồi phân bổ về từng dòng và từng kiện; phí giao tính riêng từng kiện. Giỏ chỉ hàng
    // Tubu = một kiện = đúng số tiền như trước.
    const unavailable = cart.items.find((l) => l.fulfiller.kind === 'UNAVAILABLE');
    if (unavailable && unavailable.fulfiller.kind === 'UNAVAILABLE') {
      throw new BadRequestException(unavailableLineMessage(unavailable.productName, unavailable.fulfiller));
    }
    const amounts = allocateGroupAmounts(groups, {
      comboPerLine: combo.perLine,
      comboTotal: combo.total,
      couponDiscount: discount,
      couponProductIds,
      tierDiscount,
      pointsDiscount: redemption.discount,
      pointsUsed: redemption.pointsUsed,
      pointsUsedConverted: redemption.pointsUsedConverted,
    });
    const broken = allocationError(amounts);
    if (broken) {
      this.logger.error(
        `Chặn đặt đơn của ${userId}: phép chia tiền lỗi (${broken}) — ${JSON.stringify({ lines: cart.items.map((l) => [l.variationId, l.total, l.isFlash, l.fulfiller.kind, l.partnerOwned === true]), comboTotal: combo.total, discount, couponProductIds, tierDiscount, points: redemption.discount })}`,
      );
      throw new InternalServerErrorException('Không tính được số tiền của đơn hàng. Vui lòng thử lại sau hoặc liên hệ Tubu Tree.');
    }
    const terms = await this.shipmentTerms(groups, amounts, user.tierId, freeship);
    // Mã không có đơn tối thiểu vẫn "hợp lệ" trên base 0đ (giỏ/tập con toàn hàng giờ vàng, combo phủ hết) → giảm 0đ; mã
    // freeship chỉ miễn phí giao kiện Tubu, nên giỏ toàn hàng gian hàng tự giao hoặc kiện Tubu đã miễn phí giao thì không
    // được gì. Coi là chưa áp để placeOrder không redeem, tránh đốt mã một lần cho đơn không được giảm.
    const freeshipSaved = terms.reduce((s, t) => s + t.freeshipWaived, 0);
    // couponApplied: coupon có THỰC SỰ áp không → placeOrder chỉ redeem khi true.
    const couponApplied = couponValid && (discount > 0 || freeshipSaved > 0);
    if (couponValid && !couponApplied) {
      const reason = freeship && discount === 0 ? COUPON_FREESHIP_NOTHING_REASON : COUPON_ZERO_DISCOUNT_REASON;
      couponNotice = couponNotAppliedNotice(reason, flashSubtotal > 0, combo.total > 0);
    } else if (couponApplied && discount > 0 && flashSubtotal > 0) {
      couponNotice = couponFlashExcludedNotice(goodsAfterCombo);
    }
    const multiplier = await this.loyalty.getTierMultiplier(user.tierId);
    const shipments: CheckoutShipment[] = [];
    for (const [i, g] of groups.entries()) {
      const a = amounts[i]!;
      const shipping = terms[i]!.shippingFee;
      shipments.push({
        ...a,
        key: g.key,
        fulfiller: g.fulfiller,
        lineIds: g.lines.map((l) => l.id),
        shippingFee: shipping,
        total: a.goodsAfterAll + shipping,
        pointsEarned: await this.pricing.calcPointsEarned(a.goodsAfterAll, multiplier),
        commissionPct: terms[i]!.commissionPct,
      });
    }
    const shippingFee = shipments.reduce((s, x) => s + x.shippingFee, 0);
    const pointsEarned = shipments.reduce((s, x) => s + x.pointsEarned, 0);
    const total = shipments.reduce((s, x) => s + x.total, 0);
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
        pointsMax,
        pointsNotice,
        pointsPartnerNote: hasPartnerLines ? PARTNER_POINTS_NOTE : null,
        redeemablePoints,
        lockedPoints,
        shippingFee,
        total,
        pointsEarned,
        shipments,
      },
    };
  }

  /**
   * Phí giao và phí sàn từng kiện. Kiện Tubu: luật phí giao hiện có trên tiền hàng của kiện. Kiện đối tác: phí gian hàng tự
   * đặt (trống thì merchant.default_shipping_fee), miễn khi tiền hàng của kiện đạt freeShipFrom. Mã freeship (Tubu tài trợ)
   * chỉ miễn kiện Tubu; `freeshipWaived` là số mã thực sự miễn được.
   */
  private async shipmentTerms(
    groups: { fulfiller: LineFulfiller }[],
    amounts: GroupAmounts[],
    tierId: string | null,
    freeship: boolean,
  ): Promise<{ shippingFee: number; commissionPct: number | null; freeshipWaived: number }[]> {
    const merchantIds = groups.flatMap((g) => (g.fulfiller.kind === 'MERCHANT' ? [g.fulfiller.storefrontId] : []));
    const [stores, defaultFee, defaultPct] = merchantIds.length
      ? await Promise.all([
          this.prisma.storefront.findMany({
            where: { id: { in: merchantIds } },
            select: { id: true, shippingFee: true, freeShipFrom: true, commissionPct: true },
          }),
          this.config?.get<number>('merchant.default_shipping_fee', DEFAULT_MERCHANT_SHIPPING_FEE) ?? DEFAULT_MERCHANT_SHIPPING_FEE,
          this.config?.get<number>('merchant.commission_pct', DEFAULT_MERCHANT_COMMISSION_PCT) ?? DEFAULT_MERCHANT_COMMISSION_PCT,
        ])
      : [[], DEFAULT_MERCHANT_SHIPPING_FEE, DEFAULT_MERCHANT_COMMISSION_PCT];
    const byId = new Map(stores.map((sf) => [sf.id, sf]));
    const out: { shippingFee: number; commissionPct: number | null; freeshipWaived: number }[] = [];
    for (const [i, g] of groups.entries()) {
      if (g.fulfiller.kind !== 'MERCHANT') {
        const fee = await this.pricing.calcShippingFee({ subtotal: amounts[i]!.subtotal, tierId });
        out.push({ shippingFee: freeship ? 0 : fee, commissionPct: null, freeshipWaived: freeship ? fee : 0 });
        continue;
      }
      const sf = byId.get(g.fulfiller.storefrontId);
      const freeByShop = sf?.freeShipFrom != null && amounts[i]!.subtotal >= sf.freeShipFrom;
      out.push({
        // Mã freeship là Tubu tài trợ phí kho Tubu; phí giao của đối tác là tiền của đối tác nên chỉ miễn theo ngưỡng của shop.
        shippingFee: freeByShop ? 0 : sf?.shippingFee ?? defaultFee,
        commissionPct: sf?.commissionPct != null ? Number(sf.commissionPct) : defaultPct,
        freeshipWaived: 0,
      });
    }
    return out;
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

  /** Đơn vừa đặt; lần đặt bị tách theo nơi giao thì kèm `splitOrders` (mọi đơn cùng lần đặt, kể cả đơn này). */
  private async findOrderResponse(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order.checkoutGroup) return forBuyer(order);
    const group = await this.prisma.order.findMany({
      where: { checkoutGroup: order.checkoutGroup, userId: order.userId },
      orderBy: [{ fulfiller: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        total: true,
        pointsEarned: true,
        status: true,
        fulfiller: true,
        fulfillerStorefront: { select: { title: true } },
      },
    });
    return {
      ...forBuyer(order),
      splitOrders: group.map((o) => ({
        id: o.id,
        code: o.code,
        total: o.total,
        pointsEarned: o.pointsEarned,
        status: o.status,
        fulfiller: o.fulfiller,
        fulfillerName: o.fulfiller === 'MERCHANT' ? o.fulfillerStorefront?.title ?? 'Gian hàng đối tác' : TUBU_FULFILLER_NAME,
      })),
    };
  }
}

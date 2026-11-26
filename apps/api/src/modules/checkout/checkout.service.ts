import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RECYCLE_PICKUP,
  type CheckoutPickupQuote,
  type CouponPreviewDTO,
  type CouponPreviewsResponse,
  type PickupOptionsResponse,
  type ReturnPackagingSuggestion,
} from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { generateUniqueOrderCode } from '../../common/order-code';
import { CartService } from '../cart/cart.service';
import { CouponMinOrderError, CouponsService } from '../coupons/coupons.service';
import {
  FIRST_ORDER_FREESHIP_TAKEN_MSG,
  firstOrderFreeShipFrom,
  firstOrderShippingFee,
  freeShipThreshold,
  PricingService,
  tierDiscountPctOf,
} from '../pricing/pricing.service';
import { combinedRedeemCap, COUPON_CAP_ZERO_REASON, couponCapNote, loadRedeemPct, pointsCapNote } from '../pricing/redeem-cap';
import { assertFirstOrderInTx } from '../../common/first-order';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { orderConfirmedData } from '../notifications/order-confirmed-data';
import { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import { GomdonOrderService } from '../integrations/gomdon/gomdon-order.service';
import { DEFAULT_GOMDON_WEIGHT_FALLBACK, isGomdonRecyclingEnabled, loadGomdonConfig } from '../integrations/gomdon/gomdon-config';
import {
  attachPickupRequest,
  buildPickupRecyclingNote,
  lockPickupRequestForCheckout,
  PICKUP_REQUEST_GONE_MESSAGE,
  readPickupGate,
} from '../waste-exchange/pickup/waste-pickup-attach';
import { WasteGiftAttachService } from '../waste-exchange/catalog/waste-gift-attach.service';
import { WasteRequestsService, type InlinePickupPrepared } from '../waste-exchange/customer/waste-requests.service';
import { WasteReturnPackagingService } from '../waste-exchange/customer/waste-return-packaging.service';
import { WasteHoldService } from '../waste-exchange/core/waste-hold.service';
import { WASTE_MESSAGES } from '../waste-exchange/core/waste-messages';
import { assertPickupItemsAllowedForProvince, isHcmProvince } from '../waste-exchange/core/waste-pickup-rules';
import { AffiliateService } from '../affiliate/affiliate.service';
import { LINK_CODE_RE } from '../affiliate/affiliate-link-stats';
import { normalizeZaloPhone } from '../../common/phone';
import { ComboService, goodsAfterComboOf } from '../storefront/combo.service';
import { applyGreenBox, comboKeyIds, greenBoxLineOf, loadGreenBoxSettings, yieldGreenBoxToCoupon, type GreenBoxResult } from '../bundles/green-box';
import { resolveAttribution } from './attribution';
import {
  FlashQuotaLineError,
  FlashSaleService,
  type FlashQuotaLine,
  type FlashQuotaOutcome,
} from '../flash-sale/flash-sale.service';
import { buyerFlashLimitKeys, writableFlashKeys } from '../flash-sale/flash-buyer-keys';
import { isLockBusy, LOCK_BUSY_MESSAGE } from '../../common/lock-busy';
import { formatPoints } from '../../common/format-points';
import { formatVndText } from '../../common/format-vnd';
import { CouponPreviewDto, PickupOptionsQueryDto, PlaceOrderDto, QuoteDto } from './dto/checkout.dto';
import {
  COUPON_FREESHIP_RECYCLE_REASON,
  COUPON_FREESHIP_TUBU_PART_RECYCLE_REASON,
  giftAttachDecision,
  hasPickupRequest,
  PICKUP_CHANGED_MESSAGE,
  PICKUP_GATE_CLOSED,
  PICKUP_NEEDS_TUBU,
  pausedReason,
  pickupInputOf,
  pickupWeights,
  returnWeightProblem,
  sameInlineLines,
  type PickupRequestInput,
} from './checkout-pickup';
import { lockVariationsInIdOrder, reserveVariationStock } from '../catalog/variation-stock';
import { assertVariationsSellable, productDiscontinuedError, SELLABLE_PANCAKE_VARIATION_WHERE } from '../cart/sellable';
import { GiftTrialService } from '../gift-tiers/gift-trial.service';
import { giftTrialUnavailableError, resolveGiftTrial } from '../gift-tiers/gift-trial';
import { AnalyticsEventsService } from '../analytics/analytics-events.service';
import { classifyOrderError } from '../analytics/order-error-classifier';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { applyPointsDelta } from '../loyalty/points-ledger';
import {
  COUPON_FREESHIP_ALREADY_FREE_REASON,
  COUPON_FREESHIP_FIRST_ORDER_REASON,
  COUPON_FREESHIP_NOTHING_REASON,
  COUPON_ZERO_DISCOUNT_REASON,
  couponFlashExcludedNotice,
  couponFreeshipThresholdReason,
  couponFreeshipTubuPartReason,
  couponNotAppliedNotice,
  couponRejectReason,
  couponShortfallOf,
} from '../coupons/coupon-notice';
import { GeoService } from '../integrations/pancake/geo.service';
import { assertDeliverableAddress } from '../integrations/pancake/address-geo';
import { SystemConfigService } from '../system-config/system-config.service';
import { orderEditHistoryWhere } from '../orders/order-customer-edit';
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
import { isPartnerStore } from '../merchant/partner-store';
import { forBuyer } from '../orders/buyer-order-fields';
import { totalChangedError, totalChangedMessage } from './total-changed';
import { WALLET_SHORT_MESSAGE, walletNegativeMessage } from './wallet-notice';
import { MssOrderEventRecorder } from '../integrations/mss/mss-order-event.recorder';
import { GUEST_COD_OVER_MAX, guestCodOverMaxMessage } from './guest/guest-checkout.config';
import { notifyRecipientZaloOf } from './notify-recipient';

const DEFAULT_TTL_CONFIG: Pick<SystemConfigService, 'get'> = { get: async <T>(_key: string, fallback?: T) => fallback as T };

export { TOTAL_CHANGED, TOTAL_CHANGED_MESSAGE_PREFIX, totalChangedMessage } from './total-changed';

/** Mã lỗi ổn định: giỏ đổi giữa lúc tính tiền và lúc ghi đơn (tab khác sửa giỏ, hoặc lần bấm trước vừa đặt xong). */
export const CART_CHANGED = 'CART_CHANGED';
const CART_CHANGED_MESSAGE =
  'Giỏ hàng vừa thay đổi trong lúc đặt đơn. Bạn xem lại giỏ hàng và mục Đơn hàng trước khi đặt lại nhé.';
/** Gian hàng đối tác vừa thôi là đối tác giữa lúc tính tiền và lúc ghi đơn (admin tắt cờ): 409; tải lại giỏ thì thấy tình trạng mới. */
export const STORE_CHANGED_MESSAGE = 'Gian hàng vừa thay đổi, bạn đặt lại nhé.';

/**
 * Lần bấm "Đặt hàng" đến sau khi giỏ đã thành đơn (app báo lỗi mạng/quá thời gian rồi khách bấm lại, có khi với key mới) nhận
 * lại đơn đó nếu đơn mới tạo trong khoảng này và cùng địa chỉ, cách trả tiền, thu kèm rác (wasteRequestId).
 */
const RECENT_ORDER_REPLAY_MS = 2 * 60_000;

const INLINE_PICKUP_NOT_READY = 'Gói thu kèm đơn chưa đủ điều kiện, bạn chọn lại món rác nhé.';
const PICKUP_UNAVAILABLE_MESSAGE = 'Thu kèm rác tạm chưa dùng được, bạn bỏ chọn thu kèm rác hoặc thử lại sau nhé.';

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
  /** Phí giao miễn nhờ thu rác kèm đơn (RECYCLE_PICKUP); 0 khi không miễn. */
  shippingFeeWaived: number;
}

/**
 * Báo giá của khách vãng lai trên web: IP đã băm của lần gửi, để giới hạn Giờ vàng còn đếm theo IP (flash-buyer-keys.ts).
 */
export interface GuestPricingContext {
  ipHash: string | null;
}

/**
 * Lần đặt của khách vãng lai trên web (checkout/guest, cờ web.guest_checkout_enabled). Tính tiền đúng đường của tài khoản thường, chỉ khác
 * đầu vào: không mã giảm giá, không hạng, không Điểm Xanh (dùng hay tích), không ghi công giới thiệu, không thu kèm rác. Giá Giờ vàng như
 * mọi khách, giới hạn mua mỗi suất đếm thêm theo SĐT nhận hàng và IP (flash-buyer-keys.ts).
 */
export interface GuestCheckoutContext {
  /** SĐT khách gõ, dạng 0xxxxxxxxx: chỉ ghi lên đơn (orders.guestPhone), không ghi vào users.phone. */
  phone: string;
  /** sha256 (hex) của khoá theo dõi đơn. */
  tokenHash: string;
  ipHash: string | null;
  /** Trần COD (checkout.guest_cod_max): đơn lớn hơn chỉ nhận chuyển khoản. */
  codMax: number;
  /** Kiểm trần chống lạm dụng ngay đầu tx đặt đơn (dưới khoá theo SĐT); ném lỗi khi chạm trần. */
  assertCaps: (tx: Prisma.TransactionClient) => Promise<void>;
}

/** Kết quả đánh giá phần thu rác kèm đơn của một lần tính tiền (báo giá và đặt đơn dùng chung). */
interface PickupEvaluation {
  quote: CheckoutPickupQuote | null;
  freeShip: boolean;
  returnWeightGrams: number | null;
  /** Cấu hình giữ chỗ đọc ngoài tx cho đường tạo phiếu ngay trong placeOrder; null khi cổng đóng. */
  prepared: InlinePickupPrepared | null;
}

/** Dòng hàng của lần đặt như CartService.getCart trả về. */
type CheckoutLine = Awaited<ReturnType<CartService['getCart']>>['items'][number];

type CouponPreviewItem = CouponPreviewDTO;

function assertNoUnavailableLine(items: CheckoutLine[]): void {
  const unavailable = items.find((l) => l.fulfiller.kind === 'UNAVAILABLE');
  if (unavailable && unavailable.fulfiller.kind === 'UNAVAILABLE') {
    throw new BadRequestException(unavailableLineMessage(unavailable.productName, unavailable.fulfiller));
  }
}

function groupSubtotal(lines: { total: number }[]): number {
  return lines.reduce((s, l) => s + l.total, 0);
}

/**
 * Mã hợp lệ mà không đem lại đồng nào cho lần đặt (giảm 0đ, freeship không miễn được phí nào) thì coi như chưa áp: placeOrder không
 * redeem. Trả lý do báo khách, null = mã có áp.
 */
function couponNothingReason(discount: number, freeship: boolean, freeshipSaved: number, freeshipNothing = COUPON_FREESHIP_NOTHING_REASON): string | null {
  if (discount > 0 || freeshipSaved > 0) return null;
  return freeship ? freeshipNothing : COUPON_ZERO_DISCOUNT_REASON;
}

type ShipmentTerm = {
  shippingFee: number;
  commissionPct: number | null;
  freeshipWaived: number;
  firstOrderWaived: number;
  /** Kiện Tubu có phí giao bằng 0 vì tiền hàng đạt ngưỡng miễn phí giao thường của hạng; giá trị là ngưỡng đó. */
  thresholdFree: number | null;
  /** Phí giao còn thu của kiện gian hàng đối tác (mã freeship không miễn được); 0 với kiện Tubu. */
  partnerFee: number;
  /** Phí giao kiện Tubu miễn nhờ thu rác kèm đơn, tính trên phần phí còn lại sau freeship đơn đầu và ngưỡng, trước mã freeship. */
  recycleWaived: number;
};

/**
 * Lý do mã freeship không miễn thêm được gì khi kiện Tubu đã hết phí giao từ trước, theo thứ tự freeship đơn đầu rồi ngưỡng
 * thường; đơn còn kiện đối tác thu phí giao thì câu nói rõ phạm vi Tubu. null = không kiện Tubu nào hết phí giao sẵn (đơn chỉ có hàng gian hàng tự giao): giữ câu chung COUPON_FREESHIP_NOTHING_REASON.
 */
function shipAlreadyFreeReason(terms: ShipmentTerm[]): string | null {
  // Còn kiện đối tác thu phí giao thì câu "đơn đã được miễn phí giao" sai với số tiền khách thấy: giới hạn câu ở phần hàng Tubu.
  const partnerCharged = terms.some((t) => t.partnerFee > 0);
  if (terms.some((t) => t.recycleWaived > 0)) {
    return partnerCharged ? COUPON_FREESHIP_TUBU_PART_RECYCLE_REASON : COUPON_FREESHIP_RECYCLE_REASON;
  }
  if (terms.some((t) => t.firstOrderWaived > 0)) {
    return partnerCharged ? couponFreeshipTubuPartReason('FIRST_ORDER') : COUPON_FREESHIP_FIRST_ORDER_REASON;
  }
  const threshold = terms.find((t) => t.thresholdFree != null)?.thresholdFree;
  if (threshold == null) return null;
  if (partnerCharged) return couponFreeshipTubuPartReason(threshold > 0 ? { threshold } : null);
  return threshold > 0 ? couponFreeshipThresholdReason(threshold) : COUPON_FREESHIP_ALREADY_FREE_REASON;
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
    // Optional: các spec dựng module tối giản không nạp vùng đổi rác; thiếu thì đơn không kèm rác/quà vẫn chạy như trước, còn
    // khách đòi thu kèm rác thì báo 503 rõ ràng thay vì lỗi null.
    @Optional() private readonly wasteHold?: WasteHoldService,
    @Optional() private readonly wasteRequests?: WasteRequestsService,
    @Optional() private readonly giftAttach?: WasteGiftAttachService,
    @Optional() private readonly geo?: GeoService,
    // Optional: test dựng tay không truyền; thiếu thì hạn thanh toán dùng TTL mặc định như cron tự huỷ, phí/hoa hồng
    // gian hàng tự giao dùng mặc định.
    @Optional() private readonly config?: SystemConfigService,
    @Optional() private readonly mssOrderEvents?: MssOrderEventRecorder,
    @Optional() private readonly giftTrial?: GiftTrialService,
    // Optional: thiếu (spec dựng tay) thì ngăn chọn món không kèm gợi ý bao bì, như khi cờ tắt.
    @Optional() private readonly returnPackaging?: WasteReturnPackagingService,
  ) {}

  /** Ghi công của lần mua (người giới thiệu, gian hàng) — dùng chung với giỏ, xem attribution.ts. */
  private resolveAttribution(userId: string, input: { referralCode?: string; storefrontSlug?: string | null }) {
    return resolveAttribution(this.prisma, this.affiliate, userId, input);
  }

  /**
   * Người giới thiệu của đơn khách vãng lai web: chỉ theo mã giới thiệu gửi kèm. Khách chưa đăng nhập nên không có "chạm", và giá vãng lai không
   * đi qua gian hàng (báo giá và đặt đơn cùng không có slug), nên chỉ bậc đầu của attribution.ts. Cùng điều kiện findEligibleReferrer (CTV/đại lý
   * còn quyền). SĐT đặt hàng trùng SĐT tài khoản của người giới thiệu là tự mua qua link của chính mình: không ghi công, như đơn đăng nhập. Khách
   * không qua xác minh danh tính nên người giới thiệu chưa có SĐT (không so được) cũng không ghi công cho đơn khách.
   */
  private async guestReferrer(userId: string, referralCode: string | undefined, phone: string): Promise<string | null> {
    if (!referralCode) return null;
    const referrerUserId = await this.affiliate.findEligibleReferrer(referralCode, userId);
    if (!referrerUserId) return null;
    const referrer = await this.prisma.user.findUnique({ where: { id: referrerUserId }, select: { phone: true } });
    const referrerPhone = normalizeZaloPhone(referrer?.phone);
    return referrerPhone && referrerPhone !== normalizeZaloPhone(phone) ? referrerUserId : null;
  }

  /**
   * Mã link CTV (`?l=`) lưu lên đơn: đúng khuôn, link có thật và thuộc ĐÚNG người giới thiệu đã ghi công của đơn. Mã link của CTV khác (ghép
   * `?l=` của người này với `?ref=` của người kia) bị bỏ im lặng: đơn vẫn đặt, chỉ không cộng vào link nào. Không có người giới thiệu thì không lưu.
   */
  private async linkCodeFor(code: string | undefined, referrerUserId: string | null): Promise<string | null> {
    const c = code?.trim();
    if (!c || !referrerUserId || !LINK_CODE_RE.test(c)) return null;
    const link = await this.prisma.affiliateLink.findUnique({ where: { shortCode: c }, select: { userId: true } });
    return link?.userId === referrerUserId ? c : null;
  }

  /**
   * Tính tạm đơn (ship + giảm + điểm) cho màn checkout. `buyerIpHash`: IP đã băm của lần gọi (flashIpHash), chỉ dùng làm khoá giới hạn Giờ
   * vàng khi người mua chưa xác thực; khách web vãng lai mang IP trong `guest`.
   */
  async quote(userId: string, dto: QuoteDto, guest: GuestPricingContext | false = false, buyerIpHash: string | null = null) {
    try {
      return await this.quoteInner(userId, dto, guest, buyerIpHash);
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

  private async quoteInner(userId: string, dto: QuoteDto, guest: GuestPricingContext | false, buyerIpHash: string | null) {
    const pickupInput = pickupInputOf(dto);
    const { storefront } = guest ? { storefront: null } : await this.resolveAttribution(userId, { storefrontSlug: dto.storefrontSlug });
    const { cart, user, computed } = await this.compute(userId, dto.addressId, dto.pointsToUse, storefront?.slug, dto.itemIds, guest ? null : pickupInput, !!guest, guest ? guest.ipHash : buyerIpHash);
    if (cart.items.length === 0) throw new BadRequestException('Chưa chọn sản phẩm để thanh toán.');
    const tubuShipment = computed.shipments.find((s) => s.fulfiller.kind === 'TUBU') ?? null;
    // W179-C (G2): cùng hàm thuần giftAttachDecision cho cả báo giá lẫn đặt đơn (SĐT xác minh Zalo, kiện Tubu >= 99.000đ ròng, tối đa 1 quà/đơn).
    const giftDecision = giftAttachDecision({
      hasTubuShipment: tubuShipment !== null,
      phoneVerified: (user as { phoneVerifiedAt?: Date | null }).phoneVerifiedAt != null,
      netGoodsVnd: tubuShipment ? Math.max(0, tubuShipment.subtotal - tubuShipment.discount) : 0,
      pending: this.giftAttach ? await this.giftAttach.listPending(userId) : [],
      excludedIds: pickupInput.excludeGiftIds,
    });
    const pendingGiftRedemptions = giftDecision.lines;
    // Quà tặng dùng thử 0đ theo mốc (cờ commerce.gift_trial_enabled): cùng hàm với giỏ, xét trên đúng phần hàng đang đặt.
    const giftTrial = (await this.giftTrial?.summaryFor(userId, cart.items)) ?? null;
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
        shippingFeeWaived: s.shippingFeeWaived,
        total: s.total,
      })),
      blockedPaymentMethods,
      subtotal: cart.subtotal,
      discount: computed.discount,
      couponApplied: computed.couponApplied,
      couponNotice: computed.couponNotice,
      // Mã bị kẹp ở trần gộp voucher + Điểm Xanh (redeem-cap.ts): câu nói vì sao mã giảm ít hơn mệnh giá. Không kẹp: không có trường.
      ...(computed.couponCapNote ? { couponCapNote: computed.couponCapNote } : {}),
      ...(computed.couponShortfall !== undefined ? { couponShortfall: computed.couponShortfall } : {}),
      comboDiscount: computed.comboDiscount,
      // Cờ commerce.green_box_enabled tắt thì không có trường này. Bật: phần Hộp Xanh nằm TRONG `comboDiscount` (cùng đường tiền với combo).
      ...(computed.greenBox ? { greenBoxDiscount: computed.greenBox.total } : {}),
      tierDiscount: computed.tierDiscount,
      pointsUsed: computed.pointsUsed,
      pointsUsedConverted: computed.pointsUsedConverted,
      pointsDiscount: computed.pointsDiscount,
      // Số Điểm Xanh tối đa dùng được cho lần đặt này (số dư dùng được, trần %, chỉ trên hàng Tubu) và câu giải thích khi giỏ
      // có hàng của gian hàng đối tác; pointsNotice khi số khách chọn bị kẹp vì hàng đó.
      pointsMax: computed.pointsMax,
      // Mã đã dùng một phần trần gộp nên pointsMax thấp hơn khi không có mã: câu giải thích cho ô Điểm Xanh. Không vậy: không có trường.
      ...(computed.pointsCapNote ? { pointsCapNote: computed.pointsCapNote } : {}),
      pointsPartnerNote: computed.pointsPartnerNote,
      pointsNotice: computed.pointsNotice,
      shippingFee: computed.shippingFee,
      // Phần phí giao miễn nhờ freeship đơn đầu (D2-08), 0 khi không áp.
      firstOrderShipWaived: computed.firstOrderShipWaived,
      // Phần phí giao kiện Tubu miễn nhờ thu rác kèm đơn và mã lý do (RECYCLE_PICKUP); 0/null khi không miễn.
      shippingFeeWaived: computed.recycleShipWaived,
      shippingFeeWaivedReason: computed.recycleShipWaived > 0 ? RECYCLE_PICKUP : null,
      pickup: computed.pickup?.quote ?? null,
      pendingGiftRedemptions,
      giftMinNetGoodsVnd: giftDecision.minNetGoodsVnd,
      giftShortfallVnd: giftDecision.shortfallVnd,
      // Cờ tắt hoặc không còn quà nào còn hàng: không có trường này (màn thanh toán như cũ).
      ...(giftTrial ? { giftTrial } : {}),
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
    guest?: GuestCheckoutContext,
    /** IP đã băm của lần gọi (xem `quote`); khách web vãng lai mang IP trong `guest`. */
    buyerIpHash: string | null = null,
  ) {
    try {
      return await this.placeOrderInner(userId, dto, idempotencyKey, platform, guest, buyerIpHash);
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
    guest?: GuestCheckoutContext,
    buyerIpHash: string | null = null,
  ) {
    // Gửi cả phiếu có sẵn lẫn món rác chọn ngay là yêu cầu sai: báo trước mọi việc khác, kể cả lần gửi lại cùng Idempotency-Key.
    const pickupInput = pickupInputOf(dto);
    const wantsPickup = hasPickupRequest(pickupInput);
    if (idempotencyKey) {
      const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } });
      if (existing) return this.replayIdempotentOrder(existing, userId, dto);
    }

    // PD-3 (Q-03): TubuXu đã gộp vào Điểm Xanh. DTO đã từ chối XU; chặn thêm ở đây cho mọi lối gọi
    // service trực tiếp, vì không còn đường trừ xu nào và đơn XU mới sẽ là đơn PAID không ai trả tiền.
    if ((dto.paymentMethod as string) === 'XU') {
      throw new BadRequestException('Phương thức thanh toán này đã ngừng. Bạn chọn phương thức khác nhé.');
    }

    // Thu kèm rác chỉ nhận khi cổng đang mở (waste.enabled + lane_pickup + Gomdon đã cấu hình) — client gửi wasteRequestId hoặc
    // inlinePickup khi tính năng tắt không được hứa thu gom mà không ai đi thu.
    if (wantsPickup && !(await this.pickupGateOpen())) {
      throw new BadRequestException(PICKUP_GATE_CLOSED);
    }

    // Attribution: ưu tiên referralCode/slug của phiên hiện tại; nếu phiên mất nhưng còn "chạm" giới thiệu trong hạn (3 ngày) →
    // fallback. Resolve TRƯỚC compute() để combo + storefrontSlug dùng đúng slug hiệu lực.
    const { referrerUserId, storefront } = guest
      ? { referrerUserId: await this.guestReferrer(userId, dto.referralCode, guest.phone), storefront: null }
      : await this.resolveAttribution(userId, dto);
    const storefrontSlug = storefront?.slug ?? null;
    const affiliateLinkCode = await this.linkCodeFor(dto.affiliateLinkCode, referrerUserId);
    // Chủ gian hàng đối tác không hưởng hoa hồng giới thiệu trên đơn con do chính gian hàng của mình giao (mua hàng của anh ta qua
    // slug CTV của anh ta); đơn con hàng của người bán khác vẫn ghi hoa hồng như cũ.
    const referrerFor = (fulfiller: { ownerUserId: string | null }) =>
      referrerUserId && fulfiller.ownerUserId === referrerUserId ? null : referrerUserId;

    const { cart, user, address, computed, flashLimitKeys } = await this.compute(
      userId,
      dto.addressId,
      dto.pointsToUse,
      storefrontSlug ?? undefined,
      dto.itemIds,
      wantsPickup && !guest ? pickupInput : null,
      !!guest,
      guest ? guest.ipHash : buyerIpHash,
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
        'Số Điểm Xanh hoặc mã giảm giá của bạn vừa thay đổi nên đơn không còn 0đ. Bạn tải lại trang thanh toán nhé.',
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
    // Quà tặng dùng thử 0đ: quyết NGOÀI tx trên đúng phần hàng đang đặt (quà khách gửi lên không còn mở thì 409 ngay), giữ kho trong tx.
    const giftSettings = this.giftTrial ? await this.giftTrial.settings() : null;
    const giftSummary = giftSettings?.enabled ? await this.giftTrial!.summaryFor(userId, cart.items, { settings: giftSettings }) : null;
    const giftPick = resolveGiftTrial(giftSummary, dto.giftVariationId);
    const paymentMethod = computed.total === 0 ? 'COD' : dto.paymentMethod;
    if (guest && paymentMethod === 'COD' && computed.total > guest.codMax) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: GUEST_COD_OVER_MAX, message: guestCodOverMaxMessage(guest.codMax) });
    }
    const blocked = paymentMethodBlockReason(computed.shipments, paymentMethod);
    if (blocked) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', code: PAYMENT_METHOD_NOT_ALLOWED, message: blocked });
    }
    if (paymentMethod === 'WALLET' && user.walletBalance < computed.total) {
      throw new BadRequestException(
        user.walletBalance < 0
          ? walletNegativeMessage(formatVndText(-user.walletBalance))
          : WALLET_SHORT_MESSAGE,
      );
    }
    // Bưu tá thu gom vỏ đi cùng kiện kho Tubu (vận đơn Gomdon đổi hàng) — không có kiện Tubu thì không ai đi thu.
    const tubuShipment = computed.shipments.find((s) => s.fulfiller.kind === 'TUBU');
    if (wantsPickup && !tubuShipment) {
      throw new BadRequestException(PICKUP_NEEDS_TUBU);
    }
    // Cấu hình giữ chỗ của đường tạo phiếu ngay trong đơn đọc NGOÀI tx (compute đã đọc khi cổng mở).
    const inlinePrepared = pickupInput.inline ? (computed.pickup?.prepared ?? (await this.pickupDeps().wasteRequests.prepareInlinePickup())) : null;
    const returnWeightGrams = computed.pickup?.returnWeightGrams ?? null;
    const freeShipMinPoints = computed.pickup?.freeShip ? (computed.pickup.quote?.minPoints ?? 0) : null;

    // WALLET thanh toán ngay (đơn CONFIRMED + PAID).
    const paid = paymentMethod === 'WALLET';
    const status = paymentMethod === 'COD' || paid ? 'CONFIRMED' : 'PENDING_PAYMENT';
    // 'ctv_assisted' dành riêng cho đơn CTV lên hộ khách (affiliate.service); khách tự mua qua gian hàng là 'storefront'.
    const orderSource = storefrontSlug ? 'storefront' : dto.itemIds?.length ? 'buy_now' : 'checkout';
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
        if (guest) await guest.assertCaps(tx);
        // Mọi lần đặt của cùng giỏ chạy nối tiếp từ đây, và giỏ được dọn trong chính tx này: lần bấm lại (key khác) đang chờ
        // khoá sẽ thấy dòng đã mua biến mất thay vì đặt thêm một đơn từ bản giỏ đã đọc trước đó (R2-MONEY-2).
        const change = cartChangeSince(cart.items, await this.cart.lockForCheckout(tx, userId));
        if (change) throw new CartChangedError(change === 'consumed');
        // Món rác chọn ngay: phiếu PICKUP tạo trong chính tx này (lỗi thì cả đơn rollback, không để lại phiếu mồ côi) rồi đi đường khoá + gắn
        // như phiếu có sẵn. Khoá dẫn xuất từ Idempotency-Key của đơn nên gửi lại cùng khoá không tạo phiếu thứ hai.
        const pickupRequestId = inlinePrepared
          ? await this.pickupDeps().wasteRequests.createPickupInTx(
              tx,
              userId,
              `ck:${idempotencyKey ?? codes[0]}`,
              pickupInput.inline!.lines.map((l) => ({ itemId: l.itemId, declaredQty: l.qty })),
              inlinePrepared,
              address.province,
            )
          : pickupInput.wasteRequestId;
        const pickup = pickupRequestId ? await lockPickupRequestForCheckout(tx, userId, pickupRequestId, address.province) : null;
        // Miễn phí giao đã tính theo điểm đọc trước tx; phiếu có sẵn bị sửa/đổi giữa chừng thì kiểm lại dưới khoá, không giao miễn phí cho phiếu thiếu điểm.
        if (pickup && freeShipMinPoints !== null && pickup.estimatedPoints < freeShipMinPoints) throw new ConflictException(PICKUP_CHANGED_MESSAGE);

        // Giữ chỗ tồn kho ATOMIC từng line — chống oversell khi flash-sale/hàng giới hạn:
        // 2 đơn cùng grab variation cuối → chỉ 1 câu UPDATE sửa được dòng; thua thì throw rollback.
        // Đặt TRƯỚC order.create để fail-fast, không tốn resource ghi Order/Item rồi rollback.
        // SP có thể bị gỡ/từ chối giữa lúc tính giá (compute) và lúc ghi đơn — kiểm lại ở đây.
        await assertVariationsSellable(tx, cart.items);
        // Biến thể quà khoá cùng lượt, theo thứ tự id như mọi dòng: giữ kho quà sau vòng dòng hàng không mở chỗ chờ ngược chiều.
        await lockVariationsInIdOrder(tx, [...cart.items.map((l) => l.variationId), ...(giftPick ? [giftPick.variationId] : [])]);
        // Giữ kho từng dòng tới dòng thiếu hàng đầu tiên, rồi trừ suất giờ vàng của các dòng trước nó một lượt (khoá theo pha,
        // xem consumeQuotas): lỗi báo khách vẫn là lỗi của dòng hỏng sớm nhất như khi làm từng dòng.
        let short = cart.items.length;
        for (const [i, line] of cart.items.entries()) {
          if (!(await reserveVariationStock(tx, line.variationId, line.quantity))) {
            short = i;
            break;
          }
        }
        const flashLines = cart.items
          .slice(0, short)
          .flatMap((l) => (l.flashSaleItemId ? [{ flashSaleItemId: l.flashSaleItemId, quantity: l.quantity }] : []));
        const outcomes = flashLines.length > 0 ? await this.consumeFlashQuotas(tx, userId, flashLines, code, flashLimitKeys) : [];
        const failed = outcomes.findIndex((o) => o !== 'OK');
        if (failed >= 0) {
          // Vượt giới hạn mua = lỗi hợp lệ sửa được ở giỏ (FLASH_LIMIT kèm giới hạn của suất). Hết suất/hết giờ → PRICE_CHANGED để FE hỏi lại giá mới
          // (không âm thầm tính giá flash đã hết).
          if (outcomes[failed] === 'OVER_LIMIT') throw await this.flashSale.overLimitError(tx, flashLines[failed]!.flashSaleItemId);
          this.logger.error(`consumeQuotas hết suất cho đơn ${code}, flashSaleItemId=${flashLines[failed]!.flashSaleItemId}`);
          throw new BadRequestException('PRICE_CHANGED');
        }
        if (short < cart.items.length) {
          throw new BadRequestException(`Sản phẩm "${cart.items[short]!.productName}" không đủ tồn kho.`);
        }
        // Quà 0đ giữ kho SAU dòng hàng: lỗi của dòng hàng vẫn báo trước. Quà khách đã thấy mà hết thì 409 để chọn lại; app cũ (không vẽ quà) thì bỏ quà.
        const giftLine = giftPick && tubuShipment ? await this.reserveGiftTrial(tx, giftPick.variationId) : null;
        if (giftPick?.strict && !giftLine) throw giftTrialUnavailableError();

        await this.assertPartnerStoresUnderLock(tx, computed.shipments);

        const created: Awaited<ReturnType<typeof tx.order.create>>[] = [];
        for (const [i, shipment] of computed.shipments.entries()) {
          const isPrimary = i === 0;
          const withPickup = pickup !== null && shipment === tubuShipment;
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
                referrerUserId: referrerFor(shipment.fulfiller),
                // Đơn con không ghi công (hàng của chính người giới thiệu) không mang mã link: link chỉ đếm đơn có hoa hồng.
                affiliateLinkCode: referrerFor(shipment.fulfiller) ? affiliateLinkCode : null,
                storefrontSlug,
                storefrontId: storefront?.id ?? null,
                fulfiller: shipment.fulfiller.kind === 'MERCHANT' ? 'MERCHANT' : 'TUBU',
                fulfillerStorefrontId: shipment.fulfiller.storefrontId,
                merchantCommissionPct: shipment.commissionPct,
                checkoutGroup,
                source: orderSource,
                platform,
                notifyRecipientZalo: notifyRecipientZaloOf(dto),
                ...(guest ? { guestPhone: guest.phone, guestTokenHash: guest.tokenHash, guestIpHash: guest.ipHash } : {}),
                // IP đã băm của mọi lần đặt (vãng lai lẫn đã đăng nhập): thưởng đơn đầu của chương trình giới thiệu so IP người mời và bạn được mời.
                placedIpHash: guest ? guest.ipHash : buyerIpHash,
                // Khoá phụ đã trừ ở consumeFlashQuotas: huỷ/trả đơn hoàn đúng các khoá này (không suy lại từ người mua lúc huỷ). Bí danh
                // SĐT cũ chỉ để đọc, không bị cộng nên không ghi.
                ...(flashLines.length > 0 && writableFlashKeys(flashLimitKeys).length > 0 ? { flashLimitKeys: writableFlashKeys(flashLimitKeys) } : {}),
                paidAt: paid ? new Date() : null,
                // Chỉ gắn coupon khi THỰC SỰ áp (subset không đạt điều kiện → couponApplied=false).
                couponCode: isPrimary && computed.couponApplied ? cart.couponCode : null,
                invoiceRequest: dto.invoiceRequest ? (dto.invoiceRequest as object) : undefined,
                invoiceStatus: dto.invoiceRequest ? 'REQUESTED' : 'NOT_REQUESTED',
                note: dto.note,
                hasRecyclingPickup: withPickup,
                recyclingNote: withPickup ? buildPickupRecyclingNote(pickup, returnWeightGrams) : null,
                recyclingWeightGrams: withPickup ? returnWeightGrams : null,
                items: {
                  // Combo: trừ phần giảm phân bổ vào total từng dòng → hoa hồng (đọc OrderItem.total)
                  // tính trên giá thực trả sau giảm combo (§7.2).
                  create: [
                    ...shipment.lineIds.map((lineId, idx) => {
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
                    ...(giftLine && shipment === tubuShipment ? [giftLine] : []),
                  ],
                },
              },
            }),
          );
        }

        if (pickup) await attachPickupRequest(tx, userId, pickup.id, created[computed.shipments.indexOf(tubuShipment!)]!.id);

        // W179-C (G2): gắn tối đa 1 quà hiện vật 0đ khi kiện Tubu >= 99.000đ ròng và SĐT đã xác minh (đọc trong tx TRƯỚC users FOR UPDATE để giữ thứ tự khoá).
        if (tubuShipment && this.giftAttach) {
          const pending = await this.giftAttach.listPending(userId, tx);
          if (pending.length > 0) {
            const uRow = await tx.user.findUnique({ where: { id: userId }, select: { phoneVerifiedAt: true } });
            const { attachIds } = giftAttachDecision({
              hasTubuShipment: true,
              phoneVerified: uRow?.phoneVerifiedAt != null,
              netGoodsVnd: Math.max(0, tubuShipment.subtotal - tubuShipment.discount),
              pending,
              excludedIds: pickupInput.excludeGiftIds,
            });
            if (attachIds.length > 0) {
              await this.giftAttach.attachInTx(tx, userId, attachIds, created[computed.shipments.indexOf(tubuShipment)]!.id);
            }
          }
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
                `Đơn này dùng ${formatPoints(usedStandard)} Điểm Xanh nhưng hiện bạn chỉ dùng được ${formatPoints(usable)}/${formatPoints(balance)} điểm: ${this.loyalty.lockedPointsMessage(lock)}. Bạn tải lại trang thanh toán nhé.`,
              );
            }
            throw new BadRequestException(`Số điểm Xanh không đủ (hiện có ${formatPoints(balance)} điểm).`);
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
              `Số Điểm Xanh không hết hạn của bạn đã thay đổi (đơn này cần ${formatPoints(computed.pointsUsedConverted)} điểm). Bạn tải lại trang thanh toán nhé.`,
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
              insufficientMessage: WALLET_SHORT_MESSAGE,
            });
          }
        }
        if (computed.firstOrderShipWaived > 0) {
          // Hai lần đặt song song cùng tính là đơn đầu: kiểm lại dưới khoá first-order (trước khoá mã, cùng thứ tự CouponsService).
          await assertFirstOrderInTx(tx, userId, { orderIds: created.map((o) => o.id), checkoutGroup }, FIRST_ORDER_FREESHIP_TAKEN_MSG);
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
              firstTouchSource: user.firstTouchSource ?? null,
              firstTouchCampaign: user.firstTouchCampaign ?? null,
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
          if (order.referrerUserId) await this.affiliate.createCommissionForOrder(order.id, tx);
        }
        // Dọn giỏ cùng tx với đơn (vẫn dưới khoá giỏ). Checkout TẬP CON: chỉ xoá món ĐÃ mua, giữ phần còn lại và mã giảm giá.
        // Cả giỏ: xoá đúng các dòng đã đọc (món đã mua + dòng ngừng bán), dòng vào giỏ sau lần đọc được giữ lại.
        if (Array.isArray(dto.itemIds) && dto.itemIds.length > 0) {
          await this.cart.removeItems(userId, cart.items.map((l) => l.id), tx);
        } else {
          await this.cart.clearOrdered(userId, [...cart.items, ...cart.unavailableItems].map((l) => l.id), tx);
        }
        // Lựa chọn quà là của lần đặt này: đơn sau lại tự lấy quà đầu tiên đã mở (kể cả khách vừa chọn "Không nhận quà").
        if (giftSettings?.enabled) await tx.cart.updateMany({ where: { userId, giftChoice: { not: null } }, data: { giftChoice: null } });
        await this.mssOrderEvents?.onOrdersPlaced(tx, created, dto.orderZaloConsent);
        return created;
      });
    } catch (err) {
      // Cùng Idempotency-Key gửi chồng: lần đến sau hoặc ăn unique-violation (P2002), hoặc chờ khoá giỏ rồi thấy giỏ đã
      // thành đơn. Trả lại đơn mà lần thắng đã tạo. Khách vãng lai còn một đường nữa: lần đến sau chờ khoá trần SĐT/IP rồi đếm cả đơn
      // lần thắng vừa tạo nên bị chặn trần, trong khi đơn của chính khoá này đã có.
      const guestCapAfterWinner = !!guest && err instanceof ForbiddenException;
      if (idempotencyKey && (this.isUniqueViolation(err) || err instanceof CartChangedError || guestCapAfterWinner)) {
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
          await this.notifications.notify(userId, 'ORDER_CONFIRMED', orderConfirmedData(order));
        }
      } catch (err) {
        this.logger.error(`Gửi thông báo lỗi cho đơn ${order.code}: ${err instanceof Error ? err.message : err}`);
      }
      // CTV nhận tin có đơn mới từ link của mình — gửi sau commit vì hoa hồng được tạo trong tx của đơn.
      if (order.referrerUserId) {
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
   * double-tap), không chỉ ca race hiếm gặp: khách luôn thấy câu "tải lại trang" dù chưa
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
      checkoutGroup?: string | null;
    },
    userId: string,
    dto: PlaceOrderDto,
  ) {
    if (existing.userId !== userId) {
      throw new BadRequestException('Idempotency-Key không hợp lệ.');
    }
    if (!(await this.isSameRequest(existing, dto))) {
      throw new BadRequestException('Yêu cầu trước đó với thông tin khác đã được xử lý, bạn tải lại trang nhé.');
    }
    return this.findOrderResponse(existing.id);
  }

  /**
   * Đơn đã có và lần gửi này cùng địa chỉ, cách trả tiền, thu kèm rác (wasteRequestId) (so snapshot địa chỉ bằng stableStringify, xem trên).
   * Khách đã tự sửa người nhận/địa chỉ của đơn sau lần đặt thì ảnh chụp không còn khớp sổ địa chỉ: vẫn là cùng một yêu cầu (cách trả tiền và
   * phiếu thu kèm vẫn phải khớp), nên lần gửi lại bằng cùng khoá trả đúng đơn đó thay vì báo "thông tin khác".
   */
  private async isSameRequest(
    existing: { id: string; paymentMethod: string; total?: number; shippingAddress: Prisma.JsonValue; checkoutGroup?: string | null },
    dto: PlaceOrderDto,
  ): Promise<boolean> {
    // Đơn 0đ đã bị ép COD (placeOrderInner): khách gửi lại đúng phương thức đã chọn lúc đầu vẫn là
    // cùng một yêu cầu.
    const forcedCod = existing.paymentMethod === 'COD' && existing.total === 0;
    if (existing.paymentMethod !== dto.paymentMethod && !forcedCod) return false;
    // Gắn yêu cầu thu kèm rác khác (hoặc bật/tắt) giữa 2 lần gửi cũng là "yêu cầu khác" — không trả đơn cũ.
    if (!(await this.isSamePickup(existing, dto))) return false;
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    if (!address) return false;
    if (stableStringify(this.addressSnapshot(address)) === stableStringify(existing.shippingAddress)) return true;
    const edited = await this.prisma.orderStatusHistory.findFirst({ where: orderEditHistoryWhere(existing.id), select: { id: true } });
    return edited !== null;
  }

  /**
   * Phiếu thu kèm gắn trên đơn đã có khớp lần gửi này: gửi `wasteRequestId` thì đúng phiếu đó; gửi `inlinePickup` thì phiếu gắn đơn là phiếu
   * tạo từ chính lần đặt trước (id mới, nên so theo món và số lượng); không gửi thì đơn cũ phải không gắn phiếu nào.
   */
  private async isSamePickup(existing: { id: string; checkoutGroup?: string | null }, dto: PlaceOrderDto): Promise<boolean> {
    const where = existing.checkoutGroup ? { order: { checkoutGroup: existing.checkoutGroup } } : { orderId: existing.id };
    if (dto.inlinePickup) {
      const row = await this.prisma.wasteRequest.findFirst({ where, select: { id: true, lines: { select: { itemId: true, declaredQty: true } } } });
      return !!row && sameInlineLines(row.lines, dto.inlinePickup.lines);
    }
    const row = await this.prisma.wasteRequest.findFirst({ where, select: { id: true } });
    return (row?.id ?? null) === (dto.wasteRequestId ?? null);
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

  /**
   * Giữ 1 đơn vị kho cho quà tặng dùng thử trong tx đặt đơn (biến thể đã khoá cùng lượt với dòng hàng). Quà ngừng bán, không còn kho Tubu giao,
   * hoặc hết hàng thì `null`. Dòng trả về là dòng đơn 0đ: không có khoản giảm, điểm hay suất Giờ vàng nào gắn vào nó.
   */
  private async reserveGiftTrial(tx: Prisma.TransactionClient, variationId: string) {
    const v = await tx.variation.findFirst({
      where: { id: variationId, ...SELLABLE_PANCAKE_VARIATION_WHERE },
      select: { id: true, name: true, product: { select: { name: true, slug: true } } },
    });
    if (!v || !(await reserveVariationStock(tx, v.id, 1))) return null;
    return {
      variationId: v.id,
      productName: v.product.name,
      productSlug: v.product.slug,
      variationName: v.name,
      unitPrice: 0,
      quantity: 1,
      total: 0,
      paidTotal: 0,
      pointsDiscount: 0,
      flashSaleItemId: null,
      isGift: true,
    };
  }

  /**
   * Nơi giao "gian hàng đối tác" được quyết NGOÀI tx (giỏ → `fulfillerOf`); admin tắt cờ `isPartner` (setStorePartner khoá FOR
   * UPDATE dòng gian hàng rồi đếm đơn tự giao còn chạy) commit trước lần ghi đơn thì để lại đơn tự giao trên gian hàng không còn là
   * đối tác. KEY SHARE dòng gian hàng rồi đọc lại cờ: tắt cờ đến trước thì ở đây thấy cờ đã tắt; đến sau thì chờ tx này và đếm được
   * đơn vừa ghi. Đặt ngay trước lần chèn đơn, nơi khoá ngoại `fulfillerStorefrontId` vốn lấy đúng khoá này, nên thứ tự khoá không
   * đổi (biến thể → suất giờ vàng → gian hàng/users của khoá ngoại đơn → users FOR UPDATE → mã giảm giá). KEY SHARE không chặn chủ
   * gian hàng đổi tên/tạm nghỉ (NO KEY UPDATE), như duyệt liên kết giao hộ (merchant-pancake-link).
   */
  /**
   * Trừ suất giờ vàng trong tx đặt đơn. Thua tranh khoá (deadlock, quá hạn chờ) → 503 để khách thử lại, không báo "giá đã
   * đổi" cho một lỗi không liên quan tới giá. Lỗi hạ tầng khác vẫn log rồi PRICE_CHANGED như trước.
   */
  private async consumeFlashQuotas(
    tx: Prisma.TransactionClient,
    userId: string,
    lines: FlashQuotaLine[],
    code: string,
    limitKeys: readonly string[],
  ): Promise<FlashQuotaOutcome[]> {
    try {
      return await this.flashSale.consumeQuotas(tx, userId, lines, new Date(), limitKeys);
    } catch (e) {
      const original = e instanceof FlashQuotaLineError ? e.original : e;
      const fid = e instanceof FlashQuotaLineError ? lines[e.lineIndex]?.flashSaleItemId : undefined;
      const detail = `đơn ${code}, flashSaleItemId=${fid}: ${original instanceof Error ? original.message : original}`;
      if (isLockBusy(original)) {
        this.logger.warn(`consumeQuotas thua tranh khoá cho ${detail}`);
        throw new ServiceUnavailableException(LOCK_BUSY_MESSAGE);
      }
      this.logger.error(`consumeQuotas lỗi cho ${detail}`);
      throw new BadRequestException('PRICE_CHANGED');
    }
  }

  private async assertPartnerStoresUnderLock(tx: Prisma.TransactionClient, shipments: CheckoutShipment[]): Promise<void> {
    const ids = [...new Set(shipments.flatMap((s) => (s.fulfiller.kind === 'MERCHANT' ? [s.fulfiller.storefrontId] : [])))];
    if (ids.length === 0) return;
    const stores = await tx.$queryRaw<{ type: string; isPartner: boolean }[]>`
      SELECT "type"::text AS "type", "isPartner" FROM "storefronts" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR KEY SHARE`;
    if (stores.length !== ids.length || !stores.every((s) => isPartnerStore(s))) {
      throw new ConflictException(STORE_CHANGED_MESSAGE);
    }
  }

  /**
   * Mức giảm từng mã trong ví cho chính lần đặt khách đang xem (cùng tham số báo giá), để thẻ voucher ghi đúng số checkout sẽ trừ.
   * Đi qua đúng các bước của compute: cùng dòng hàng, cùng phần hàng tính mã (loại giờ vàng, trừ combo), cùng validateAndCompute
   * (đọc gộp cho cả ví) và cùng phí giao. Không có `addressId` (trang giỏ, chưa có phí giao) thì không tính phần freeship.
   * Chỉ đọc: không áp mã vào giỏ, không ghi lượt dùng, không khoá.
   */
  async couponPreviews(userId: string, dto: CouponPreviewDto): Promise<CouponPreviewsResponse> {
    const { storefront } = await this.resolveAttribution(userId, { storefrontSlug: dto.storefrontSlug });
    const cart = await this.checkoutLines(userId, dto.itemIds);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const withShipping = !!dto.addressId;
    if (dto.addressId) await this.deliveryAddress(userId, dto.addressId);
    const base = await this.couponBase(cart.items, storefront?.slug, userId);

    const held = await this.loyalty.getAvailableCoupons(userId);
    const results = await this.coupons.previewMany(
      held.map((c) => c.code),
      userId,
      base.goodsAfterCombo,
      base.couponLines,
    );
    // Mã hụt đơn tối thiểu chỉ vì Hộp Xanh: báo giá sẽ bỏ Hộp Xanh để áp mã (yieldGreenBoxToCoupon), nên thẻ voucher ghi số của bản đó.
    const baseOf = new Map<string, number>();
    const plain = base.withoutGreenBox;
    const knocked = plain ? [...results].filter(([, r]) => r instanceof CouponMinOrderError).map(([code]) => code) : [];
    if (plain && knocked.length > 0) {
      for (const [code, r] of await this.coupons.previewMany(knocked, userId, plain.goodsAfterCombo, plain.couponLines)) {
        if (r instanceof BadRequestException) continue;
        results.set(code, r);
        baseOf.set(code, plain.goodsAfterCombo);
      }
    }
    // Báo giá ném lỗi này cho cả lần đặt; xem trước cũng vậy để không hứa số tiền của một lần đặt không đặt được.
    if (withShipping) assertNoUnavailableLine(cart.items);
    let freeshipSaved = 0;
    let alreadyFreeReason: string | null = null;
    // Phí giao không phụ thuộc địa chỉ nên trang giỏ cũng biết được phí giao đã bằng 0 từ trước (đơn đầu, đạt ngưỡng, hạng): mã freeship không giúp thêm gì.
    if ([...results.values()].some((r) => !(r instanceof BadRequestException) && r.freeship)) {
      const groups = groupByFulfiller(cart.items);
      const firstOrderFrom = await firstOrderFreeShipFrom(this.config, this.prisma, userId);
      const terms = await this.shipmentTerms(groups, groups.map((g) => groupSubtotal(g.lines)), user.tierId, true, firstOrderFrom);
      freeshipSaved = terms.reduce((s, t) => s + t.freeshipWaived, 0);
      alreadyFreeReason = shipAlreadyFreeReason(terms);
    }

    // Cùng trần gộp voucher + Điểm Xanh như báo giá (compute): thẻ voucher ghi số mã thật sự giảm.
    const redeemPct = await loadRedeemPct(this.config ?? DEFAULT_TTL_CONFIG);
    const redeemCap = combinedRedeemCap(cart.subtotal, redeemPct);
    const coupons: CouponPreviewItem[] = [];
    for (const [code, r] of results) {
      if (r instanceof BadRequestException) {
        const shortfall = couponShortfallOf(r);
        coupons.push({ code, eligible: false, reason: couponRejectReason(r, cart.items), discount: 0, ...(shortfall !== undefined ? { shortfall } : {}) });
        continue;
      }
      const full = Math.min(r.discount, baseOf.get(code) ?? base.goodsAfterCombo);
      const discount = Math.min(full, redeemCap);
      const cappedToZero = discount === 0 && full > 0 && !r.freeship;
      // Trang giỏ chưa có phí giao: mã freeship hợp lệ là dùng được (như getCart), số tiền miễn phí giao chỉ biết ở thanh toán.
      const alreadyFree = r.freeship && discount === 0 && freeshipSaved === 0 ? alreadyFreeReason : null;
      const nothing = cappedToZero
        ? COUPON_CAP_ZERO_REASON
        : withShipping
          ? couponNothingReason(discount, r.freeship, r.freeship ? freeshipSaved : 0, alreadyFreeReason ?? undefined)
          : alreadyFree
            ? alreadyFree
            : discount > 0 || r.freeship
              ? null
              : COUPON_ZERO_DISCOUNT_REASON;
      coupons.push({
        code,
        eligible: nothing === null,
        ...(nothing ? { reason: nothing } : {}),
        discount,
        ...(discount > 0 && discount < full ? { cappedFrom: full } : {}),
        ...(withShipping && r.freeship ? { freeshipSaving: freeshipSaved } : {}),
      });
    }
    return { coupons };
  }

  /**
   * Dòng hàng của lần đặt: toàn giỏ hoặc tập con đã chọn, chặn dòng ngừng bán được chọn và dòng chưa có giá. Báo giá, đặt đơn
   * và xem trước mã dùng chung.
   */
  private async checkoutLines(userId: string, itemIds?: string[], flashLimitKeys: readonly string[] = []) {
    const fullCart = await this.cart.getCartForCheckout(userId, flashLimitKeys);
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
        `Sản phẩm "${unpriced.productName}" đang được cập nhật giá, tạm thời chưa đặt được. Bạn bỏ khỏi đơn hoặc thử lại sau nhé.`,
      );
    }
    const subtotal = subset ? items.reduce((s, l) => s + l.total, 0) : fullCart.subtotal;
    return { ...fullCart, items, subtotal };
  }

  private async deliveryAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findUnique({ where: { id: addressId } });
    if (!address || address.userId !== userId) {
      throw new BadRequestException('Địa chỉ giao hàng không hợp lệ.');
    }
    await assertDeliverableAddress(this.geo, address);
    return address;
  }

  /**
   * Phần hàng tính mã: loại hàng giờ vàng (giá cuối, không cộng dồn mã), trừ combo của gian hàng (combo CHỈ áp trên dòng
   * không giờ vàng). Báo giá, đặt đơn và xem trước mã dùng chung.
   */
  private async couponBase(items: CheckoutLine[], storefrontSlug: string | undefined, userId: string, couponCode?: string | null) {
    const nonFlash = items.filter((l) => !l.isFlash);
    const flashSubtotal = items
      .filter((l) => l.isFlash)
      .reduce((s, l) => s + l.total, 0);
    const comboLines = nonFlash.map((l) => ({ variationId: l.variationId, productId: l.productId, total: l.total, quantity: l.quantity }));
    const greenBoxSettings = await loadGreenBoxSettings(this.config);
    // Cờ Hộp Xanh tắt: đúng một lời gọi như trước. Bật: cần nhóm combo để biết dòng khoá của bộ đang áp (sản phẩm chính của "mua kèm").
    if (!greenBoxSettings.enabled) {
      const combo = await this.combo.computeForStorefront(storefrontSlug, comboLines, userId);
      // goodsAfterCombo = coupon base (loại flash)
      return { flashSubtotal, combo, greenBox: null, ...goodsAfterComboOf(nonFlash, combo), withoutGreenBox: null };
    }
    const match = await this.combo.computeWithGroups(storefrontSlug, comboLines, userId);
    const plainCombo = { total: match.total, perLine: match.perLine };
    const applied = applyGreenBox(plainCombo, nonFlash.map(greenBoxLineOf), greenBoxSettings, comboKeyIds(match.groups));
    const withBox = { combo: applied.combo, greenBox: applied.greenBox as GreenBoxResult | null, ...goodsAfterComboOf(nonFlash, applied.combo) };
    if (!applied.greenBox?.total) return { flashSubtotal, ...withBox, withoutGreenBox: null };
    // Bản không Hộp Xanh: để mã của khách được xét lại khi Hộp Xanh làm nó hụt đơn tối thiểu (yieldGreenBoxToCoupon).
    const withoutBox = { combo: plainCombo, greenBox: null as GreenBoxResult | null, ...goodsAfterComboOf(nonFlash, plainCombo) };
    if (!couponCode) return { flashSubtotal, ...withBox, withoutGreenBox: withoutBox };
    const picked = await yieldGreenBoxToCoupon(withBox, withoutBox, (b) =>
      this.coupons.validateAndCompute(couponCode, userId, b.goodsAfterCombo, b.couponLines),
    );
    return { flashSubtotal, ...picked, withoutGreenBox: null };
  }

  private async compute(
    userId: string,
    addressId: string,
    pointsToUse?: number,
    storefrontSlug?: string,
    itemIds?: string[],
    /** Thu rác kèm đơn khách chọn (báo giá luôn truyền để dựng thẻ thu kèm; đặt đơn chỉ truyền khi khách chọn thu kèm). null = không đánh giá. */
    pickupInput: PickupRequestInput | null = null,
    /** Khách vãng lai (GuestCheckoutContext): tính như tài khoản trắng, không mã, không hạng, không Điểm Xanh dùng hay tích. */
    guest = false,
    /** IP đã băm của lần gọi: khoá giới hạn Giờ vàng của người mua chưa xác thực (flash-buyer-keys.ts). */
    ipHash: string | null = null,
  ) {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const address = await this.deliveryAddress(userId, addressId);
    // Người mua chưa xác thực (guest_ Mini, khách web vãng lai) được giá Giờ vàng; giới hạn mua đếm thêm theo SĐT nhận hàng và IP web, nên
    // giá giỏ ở đây và lần trừ suất lúc đặt dùng cùng các khoá.
    const flashLimitKeys = buyerFlashLimitKeys(account, { phone: address.phone, ipHash });
    const cart = await this.checkoutLines(userId, itemIds, flashLimitKeys);
    const user = guest ? { ...account, tierId: null, pointsBalance: 0, pointsConvertedBalance: 0 } : account;
    const couponCode = guest ? null : cart.couponCode;

    // Thứ tự áp giảm TUẦN TỰ (mỗi mức trên phần còn lại) để KHÔNG giảm chồng và KHÔNG vượt
    // giá trị hàng (giữ invariant subtotal - tổng-giảm = goods):
    //   1) Combo (shop tài trợ) — phân bổ vào từng dòng → cũng ghi vào OrderItem.total (§7.2, hoa hồng trên giá thực trả).
    //   2) Coupon (Tubu tài trợ) — tính lại trên base SAU combo (đơn không-combo: base = subtotal → y hệt cũ).
    //   3) Điểm Xanh — trên phần còn lại sau coupon (lô STANDARD có trần %, lô quy đổi thì không).
    const { flashSubtotal, combo, greenBox, goodsAfterCombo, couponLines } = await this.couponBase(cart.items, storefrontSlug, userId, couponCode);
    // Lời báo mã chỉ nhắc combo khi có combo thật: `combo.total` gồm cả Hộp Xanh.
    const hasCombo = combo.total - (greenBox?.total ?? 0) > 0;

    // Trần giảm gộp voucher + Điểm Xanh trên tạm tính của lần đặt (redeem-cap.ts): mã lấy trước, điểm lô thường lấy phần còn lại.
    const redeemPct = await loadRedeemPct(this.config ?? DEFAULT_TTL_CONFIG);
    const redeemCap = combinedRedeemCap(cart.subtotal, redeemPct);
    let discount = 0; // coupon (sau combo)
    let couponCapped = false;
    let couponProductIds: string[] | null = null;
    let freeship = false;
    let couponValid = false;
    let couponNotice: string | null = null;
    let couponShortfall: number | undefined;
    if (couponCode) {
      try {
        const r = await this.coupons.validateAndCompute(couponCode, userId, goodsAfterCombo, couponLines);
        const full = Math.min(r.discount, goodsAfterCombo);
        discount = Math.min(full, redeemCap);
        couponCapped = discount < full;
        couponProductIds = r.productIds ?? null;
        freeship = r.freeship;
        couponValid = true;
      } catch (err) {
        // Mã không đạt điều kiện trên phần hàng được tính (đã loại flash, trừ combo; hoặc tập con đã
        // chọn) → KHÔNG giảm và KHÔNG redeem, kể cả khi đặt toàn giỏ: trước đây toàn giỏ rơi về
        // cart.discount (0đ khi flash kéo phần còn lại dưới minOrder) mà vẫn redeem → đốt mất mã một lần
        // của khách cho đơn không được giảm đồng nào (MONEY-3). Lỗi hạ tầng thì báo lỗi, không âm thầm bỏ mã.
        if (!(err instanceof BadRequestException)) throw err;
        couponNotice = couponNotAppliedNotice(couponRejectReason(err, cart.items), flashSubtotal > 0, hasCombo);
        couponShortfall = couponShortfallOf(err);
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
    const tierDiscountPct = await tierDiscountPctOf(this.prisma, user.tierId);
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
    // PD-3: STANDARD (trần max_redeem_pct) trước, phần còn lại từ lô quy đổi (không trần), spec 2.3. Phần STANDARD còn chịu
    // phần trần gộp mã đã chưa dùng.
    const pointsCapVnd = Math.max(0, redeemCap - discount);
    const redemption = await this.pricing.resolvePointsRedemptionByLot(
      pointsToUse ?? 0,
      redeemablePoints,
      user.pointsConvertedBalance,
      redeemBase,
      pointsCapVnd,
    );
    const allPoints = redeemablePoints + user.pointsConvertedBalance;
    const pointsMax = (
      await this.pricing.resolvePointsRedemptionByLot(allPoints, redeemablePoints, user.pointsConvertedBalance, redeemBase, pointsCapVnd)
    ).pointsUsed;
    // Mã đã dùng một phần trần gộp làm khách dùng được ít điểm hơn khi không có mã: nói lý do cạnh ô Điểm Xanh.
    const pointsCappedByCoupon =
      discount > 0 &&
      allPoints > pointsMax &&
      (await this.pricing.resolvePointsRedemptionByLot(allPoints, redeemablePoints, user.pointsConvertedBalance, redeemBase)).pointsUsed > pointsMax;
    // Báo khách khi chính hàng của gian hàng đối tác làm số điểm dùng được ít hơn số khách chọn (không báo khi chỉ vì số dư/trần %).
    let pointsNotice: string | null = null;
    if (hasPartnerLines && (pointsToUse ?? 0) > redemption.pointsUsed) {
      const withPartner = await this.pricing.resolvePointsRedemptionByLot(
        pointsToUse ?? 0,
        redeemablePoints,
        user.pointsConvertedBalance,
        goodsAfterTierDiscount + flashSubtotal,
        pointsCapVnd,
      );
      if (withPartner.pointsUsed > redemption.pointsUsed) pointsNotice = partnerPointsNotice(pointsMax);
    }

    // Giảm giá tính trên cả lần đặt ở trên rồi phân bổ về từng dòng và từng kiện; phí giao tính riêng từng kiện. Giỏ chỉ hàng
    // Tubu = một kiện = đúng số tiền như trước.
    assertNoUnavailableLine(cart.items);
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
      throw new InternalServerErrorException('Không tính được số tiền của đơn hàng. Bạn thử lại sau hoặc liên hệ Tubu Tree nhé.');
    }
    const firstOrderFrom = await firstOrderFreeShipFrom(this.config, this.prisma, userId);
    // Đánh giá thu rác kèm đơn TRƯỚC phí giao: phí kiện Tubu về 0 là một phần của số tiền báo giá và đặt đơn cùng dùng.
    const pickup = pickupInput ? await this.evaluatePickup(userId, address, groups, pickupInput) : null;
    const terms = await this.shipmentTerms(groups, amounts.map((a) => a.subtotal), user.tierId, freeship, firstOrderFrom, pickup?.freeShip === true);
    const firstOrderShipWaived = terms.reduce((s, t) => s + t.firstOrderWaived, 0);
    const recycleShipWaived = terms.reduce((s, t) => s + t.recycleWaived, 0);
    const alreadyFreeReason = shipAlreadyFreeReason(terms);
    // Mã không có đơn tối thiểu vẫn "hợp lệ" trên base 0đ (giỏ/tập con toàn hàng giờ vàng, combo phủ hết) → giảm 0đ; mã
    // freeship chỉ miễn phí giao kiện Tubu, nên giỏ toàn hàng gian hàng tự giao hoặc kiện Tubu đã miễn phí giao thì không
    // được gì. Coi là chưa áp để placeOrder không redeem, tránh đốt mã một lần cho đơn không được giảm.
    const freeshipSaved = terms.reduce((s, t) => s + t.freeshipWaived, 0);
    // couponApplied: coupon có THỰC SỰ áp không → placeOrder chỉ redeem khi true.
    const nothingReason = !couponValid
      ? null
      : couponCapped && discount === 0 && !freeship
        ? COUPON_CAP_ZERO_REASON
        : couponNothingReason(discount, freeship, freeshipSaved, alreadyFreeReason ?? undefined);
    const couponApplied = couponValid && nothingReason === null;
    const couponCapNoteText = couponApplied && couponCapped && discount > 0 ? couponCapNote(discount, redeemPct) : null;
    if (nothingReason !== null) {
      // Hàng giờ vàng và phần giảm combo vẫn tính vào ngưỡng phí giao, nên câu lý do freeship không kèm ngoặc loại trừ của điều kiện mã;
      // trần giảm gộp cũng không liên quan tới điều kiện mã.
      const plain = freeship || nothingReason === COUPON_CAP_ZERO_REASON;
      couponNotice = plain ? couponNotAppliedNotice(nothingReason, false, false) : couponNotAppliedNotice(nothingReason, flashSubtotal > 0, hasCombo);
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
        pointsEarned: guest ? 0 : await this.pricing.calcPointsEarned(a.goodsAfterAll, multiplier),
        commissionPct: terms[i]!.commissionPct,
        shippingFeeWaived: terms[i]!.recycleWaived,
      });
    }
    const shippingFee = shipments.reduce((s, x) => s + x.shippingFee, 0);
    const pointsEarned = shipments.reduce((s, x) => s + x.pointsEarned, 0);
    const total = shipments.reduce((s, x) => s + x.total, 0);
    return {
      cart,
      user,
      address,
      flashLimitKeys,
      computed: {
        discount,
        couponApplied,
        couponNotice,
        couponShortfall,
        comboDiscount: combo.total,
        comboPerLine: combo.perLine,
        greenBox,
        tierDiscount,
        pointsUsed: redemption.pointsUsed,
        pointsUsedConverted: redemption.pointsUsedConverted,
        pointsDiscount: redemption.discount,
        couponCapNote: couponCapNoteText,
        pointsMax,
        pointsCapNote: pointsCappedByCoupon ? pointsCapNote(pointsMax, redeemPct) : null,
        pointsNotice,
        pointsPartnerNote: hasPartnerLines ? PARTNER_POINTS_NOTE : null,
        redeemablePoints,
        lockedPoints,
        shippingFee,
        firstOrderShipWaived,
        recycleShipWaived,
        total,
        pointsEarned,
        shipments,
        pickup: pickup
          ? { ...pickup, quote: pickup.quote ? { ...pickup.quote, shippingFeeWaived: recycleShipWaived } : null }
          : null,
      },
    };
  }

  private pickupDeps(): { wasteHold: WasteHoldService; wasteRequests: WasteRequestsService } {
    if (!this.wasteHold || !this.wasteRequests) throw new ServiceUnavailableException(PICKUP_UNAVAILABLE_MESSAGE);
    return { wasteHold: this.wasteHold, wasteRequests: this.wasteRequests };
  }

  private async pickupGateOpen(): Promise<boolean> {
    return readPickupGate(this.config, () => isGomdonRecyclingEnabled(this.config!).catch(() => false));
  }

  /** Cân nặng mặc định cho dòng thiếu cân (cấu hình Gomdon), cùng nguồn với vận đơn và ghi chú Pancake. */
  private async weightFallbackGrams(): Promise<number> {
    if (!this.config) return DEFAULT_GOMDON_WEIGHT_FALLBACK;
    try {
      return (await loadGomdonConfig(this.config)).defaultWeightFallback;
    } catch {
      return DEFAULT_GOMDON_WEIGHT_FALLBACK;
    }
  }

  /**
   * Phần thu rác kèm đơn của lần tính tiền. Chỉ đọc, không ghi DB: phiếu INLINE chỉ được tạo trong tx đặt đơn (createPickupInTx), ở đây
   * tính thử bằng đúng luật giữ chỗ (WasteHoldService) để báo giá khớp với điều placeOrder sẽ làm.
   *
   * `quote` null = không có kiện Tubu, hoặc cổng đóng mà khách không chọn thu kèm. `freeShip` chỉ true khi phần khách chọn đủ điều kiện:
   * cổng mở, tài khoản không bị chặn/khoá đường kho, phiếu (có sẵn hoặc chọn ngay) đạt ngưỡng điểm. Sai cân nặng gửi lại và Pin ngoài
   * TP.HCM là lỗi 400, không phải "chưa đủ điều kiện".
   */
  private async evaluatePickup(
    userId: string,
    address: { province: string },
    groups: { fulfiller: LineFulfiller; lines: CheckoutLine[] }[],
    input: PickupRequestInput,
  ): Promise<PickupEvaluation> {
    const none: PickupEvaluation = { quote: null, freeShip: false, returnWeightGrams: null, prepared: null };
    const tubu = groups.find((g) => g.fulfiller.kind === 'TUBU');
    if (!tubu) return none;
    const requested = hasPickupRequest(input);
    if (!this.wasteHold || !this.wasteRequests) {
      if (requested) this.pickupDeps();
      return none;
    }
    const { wasteHold, wasteRequests } = this.pickupDeps();
    const gateOpen = await this.pickupGateOpen();
    if (!gateOpen && !requested) return none;

    const weights = pickupWeights(tubu.lines, await this.weightFallbackGrams());
    const base: CheckoutPickupQuote = {
      gateOpen,
      eligible: false,
      reason: null,
      mode: null,
      estimatedPoints: 0,
      minPoints: 0,
      freeShip: false,
      shippingFeeWaived: 0,
      ...weights,
      returnWeightGrams: null,
    };
    if (!gateOpen) return { ...none, quote: { ...base, reason: PICKUP_GATE_CLOSED } };

    const prepared = await wasteRequests.prepareInlinePickup();
    const minPoints = prepared.holdCfg.pickupMinPoints;
    const flags = await this.prisma.wasteUserFlags.findUnique({ where: { userId }, select: { blockedAt: true, shipLockedAt: true } });
    const paused = pausedReason(flags);
    if (!requested) return { ...none, prepared, quote: { ...base, minPoints, reason: paused } };

    const returnWeightGrams = input.returnWeightGrams;
    if (returnWeightGrams !== null) {
      const problem = returnWeightProblem(returnWeightGrams, weights.maxReturnWeightGrams);
      if (problem) throw new BadRequestException(problem);
    }
    const mode = input.wasteRequestId ? 'REQUEST' : 'INLINE';
    const { estimatedPoints, reason } =
      mode === 'REQUEST'
        ? await this.requestPickupStanding(userId, input.wasteRequestId!, address.province, minPoints)
        : await this.inlinePickupStanding(wasteHold, userId, input.inline!.lines, address.province, prepared);
    const blocker = paused ?? reason;
    const eligible = blocker === null;
    return {
      quote: { ...base, mode, minPoints, estimatedPoints, eligible, reason: blocker, freeShip: eligible, returnWeightGrams },
      freeShip: eligible,
      returnWeightGrams,
      prepared,
    };
  }

  /** Phiếu thu kèm có sẵn: còn mở, của khách, chưa gắn đơn và đủ điểm tối thiểu. Phiếu không còn thì để bước khoá trong tx báo 409. */
  private async requestPickupStanding(
    userId: string,
    wasteRequestId: string,
    province: string,
    minPoints: number,
  ): Promise<{ estimatedPoints: number; reason: string | null }> {
    const req = await this.prisma.wasteRequest.findFirst({
      where: { id: wasteRequestId, userId, method: 'PICKUP', status: 'OPEN', orderId: null },
      select: { estimatedPoints: true, lines: { select: { item: { select: { hazardous: true } } } } },
    });
    if (!req) return { estimatedPoints: 0, reason: PICKUP_REQUEST_GONE_MESSAGE };
    assertPickupItemsAllowedForProvince(req.lines.map((l) => ({ hazardous: l.item.hazardous })), province);
    const missing = minPoints - req.estimatedPoints;
    return { estimatedPoints: req.estimatedPoints, reason: missing > 0 ? WASTE_MESSAGES.BELOW_MIN('PICKUP', minPoints, missing) : null };
  }

  /**
   * Món rác chọn ngay trên thanh toán: tính điểm và các luật giữ chỗ (trần, ngưỡng, món chưa nhận, phiếu đang chờ, khoá khách) bằng
   * WasteHoldService ở chế độ chỉ đọc. Vi phạm đầu tiên thành lý do báo khách; Pin ngoài TP.HCM là 400.
   */
  private async inlinePickupStanding(
    wasteHold: WasteHoldService,
    userId: string,
    lines: { itemId: string; qty: number }[],
    province: string,
    prepared: InlinePickupPrepared,
  ): Promise<{ estimatedPoints: number; reason: string | null }> {
    const items = await this.prisma.wasteItem.findMany({ where: { id: { in: lines.map((l) => l.itemId) } }, select: { hazardous: true } });
    assertPickupItemsAllowedForProvince(items, province);
    const input = {
      path: 'CREATE' as const,
      userId,
      method: 'PICKUP' as const,
      lines: lines.map((l) => ({ itemId: l.itemId, declaredQty: l.qty })),
      pointId: null,
      now: new Date(),
    };
    const refusal = (e: unknown): string | null => (e instanceof ForbiddenException || e instanceof ConflictException ? e.message : null);
    let estimatedPoints = 0;
    try {
      const { result, blocks } = await wasteHold.evaluate(this.prisma, input, prepared.holdCfg);
      estimatedPoints = result.estimatedPoints;
      if (blocks.length === 0) return { estimatedPoints, reason: null };
      // Cùng kiểm tra ở chế độ ném lỗi để lấy đúng câu của vi phạm đầu tiên (khối chỉ mang mã, không mang câu).
      await wasteHold.validateAndHold(this.prisma, input, prepared.holdCfg);
      return { estimatedPoints, reason: INLINE_PICKUP_NOT_READY };
    } catch (e) {
      const reason = refusal(e);
      if (reason === null) throw e;
      return { estimatedPoints, reason };
    }
  }

  /**
   * Dữ liệu dựng ngăn chọn món rác ngay trên thanh toán: món đang nhận (Pin cũ hiện nhưng khoá nếu địa chỉ giao ngoài TP.HCM), ngưỡng
   * điểm, trần cân nặng gói gửi lại theo kiện Tubu của phần giỏ đang thanh toán, và phiếu thu kèm đang chờ của khách.
   */
  async pickupOptions(userId: string, q: PickupOptionsQueryDto): Promise<PickupOptionsResponse> {
    const cart = await this.checkoutLines(userId, q.itemIds);
    const address = await this.deliveryAddress(userId, q.addressId);
    const tubu = groupByFulfiller(cart.items).find((g) => g.fulfiller.kind === 'TUBU');
    const weights = pickupWeights(tubu?.lines ?? [], await this.weightFallbackGrams());
    const { holdCfg } = await this.pickupDeps().wasteRequests.prepareInlinePickup();
    const gateOpen = !!tubu && (await this.pickupGateOpen());
    if (!gateOpen) return { gateOpen, minPoints: holdCfg.pickupMinPoints, ...weights, items: [], existingRequest: null };

    const hcm = isHcmProvince(address.province);
    const [items, existing] = await Promise.all([
      this.prisma.wasteItem.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, code: true, name: true, unitLabel: true, unitsPerPoint: true, pointsPerGroup: true, hazardous: true, prepInstructions: true },
      }),
      this.prisma.wasteRequest.findFirst({
        where: { userId, method: 'PICKUP', status: 'OPEN', orderId: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          code: true,
          estimatedPoints: true,
          lines: { orderBy: { id: 'asc' }, select: { itemId: true, itemName: true, unitLabel: true, declaredQty: true } },
        },
      }),
    ]);
    // Phiếu thu kèm có sẵn thắng gợi ý từ đơn ở cả hai app, nên khỏi đọc gợi ý.
    const suggestion = existing ? null : await this.returnSuggestion(userId, address, holdCfg);
    return {
      gateOpen,
      minPoints: holdCfg.pickupMinPoints,
      ...weights,
      items: items.map((i) => ({ ...i, blockedReason: i.hazardous && !hcm ? ('BATTERY_OUT_OF_HCM' as const) : null })),
      existingRequest: existing,
      suggestion,
    };
  }

  /** Bao bì của các đơn đã giao tới địa chỉ này, để thẻ đổi rác điền sẵn gói gửi lại. Đọc gợi ý lỗi thì ngăn chọn món vẫn mở, chỉ thiếu gợi ý. */
  private async returnSuggestion(
    userId: string,
    address: { street: string; ward: string; wardCode: string },
    holdCfg: InlinePickupPrepared['holdCfg'],
  ): Promise<ReturnPackagingSuggestion | null> {
    if (!this.returnPackaging) return null;
    try {
      const suggestion = await this.returnPackaging.forAddress(userId, address);
      if (!suggestion) return null;
      return { ...suggestion, oneTapReady: await this.suggestionPassesHold(userId, suggestion, holdCfg) };
    } catch (err) {
      this.logger.warn(`Gợi ý bao bì gửi lại lỗi cho khách ${userId}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * Đúng các dòng gợi ý qua được kiểm tra của báo giá (chỉ đọc, như `inlinePickupStanding`): chỉ khi đó thẻ mới hứa miễn phí giao bằng một chạm.
   * Kiểm tra lỗi thì coi như chưa qua: khách vẫn mở được ngăn chọn món đã điền sẵn.
   */
  private async suggestionPassesHold(userId: string, suggestion: ReturnPackagingSuggestion, holdCfg: InlinePickupPrepared['holdCfg']): Promise<boolean> {
    try {
      const { blocks } = await this.pickupDeps().wasteHold.evaluate(
        this.prisma,
        {
          path: 'CREATE',
          userId,
          method: 'PICKUP',
          lines: suggestion.lines.map((l) => ({ itemId: l.itemId, declaredQty: l.qty })),
          pointId: null,
          now: new Date(),
        },
        holdCfg,
      );
      return blocks.length === 0;
    } catch {
      return false;
    }
  }

  /**
   * Phí giao và phí sàn từng kiện. Kiện Tubu: luật phí giao hiện có trên tiền hàng của kiện. Kiện đối tác: phí gian hàng tự
   * đặt (trống thì merchant.default_shipping_fee), miễn khi tiền hàng của kiện đạt freeShipFrom. Mã freeship (Tubu tài trợ)
   * chỉ miễn kiện Tubu; `freeshipWaived` là số mã thực sự miễn được.
   */
  private async shipmentTerms(
    groups: { fulfiller: LineFulfiller }[],
    /** Tiền hàng (trước mọi khoản giảm) của từng kiện, cùng thứ tự `groups`. */
    subtotals: number[],
    tierId: string | null,
    freeship: boolean,
    /** Ngưỡng freeship đơn đầu của khách (firstOrderFreeShipFrom), null = không áp. */
    firstOrderFrom: number | null = null,
    /** Kiện Tubu được miễn phí giao vì có thu rác kèm đơn đủ điều kiện (bất kể tiền hàng). Kiện đối tác không đổi. */
    recycleFree = false,
  ): Promise<ShipmentTerm[]> {
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
    const out: ShipmentTerm[] = [];
    for (const [i, g] of groups.entries()) {
      if (g.fulfiller.kind !== 'MERCHANT') {
        const base = await this.pricing.calcShippingFee({ subtotal: subtotals[i]!, tierId });
        // Freeship đơn đầu miễn trước mã freeship: mã chỉ "miễn được" phần còn lại, nên không bị tiêu cho đơn đã miễn phí giao.
        const fee = firstOrderShippingFee(base, subtotals[i]!, firstOrderFrom);
        // Ngưỡng chỉ cần khi phí đã 0 từ gốc. Phí dưới ngưỡng cũng có thể cấu hình 0đ, nên chỉ nêu số ngưỡng khi đơn thật sự đạt nó; chưa đạt thì 0 (câu chung).
        let thresholdFree: number | null = null;
        if (base === 0 && this.config) {
          const t = await freeShipThreshold(this.config, tierId);
          thresholdFree = subtotals[i]! >= t ? t : 0;
        }
        // Miễn vì đổi rác đi trước mã freeship: phí đã về 0 thì mã không bị tiêu cho đơn này.
        const recycleWaived = recycleFree ? fee : 0;
        const left = fee - recycleWaived;
        out.push({
          shippingFee: freeship ? 0 : left,
          commissionPct: null,
          freeshipWaived: freeship ? left : 0,
          firstOrderWaived: base - fee,
          thresholdFree,
          partnerFee: 0,
          recycleWaived,
        });
        continue;
      }
      const sf = byId.get(g.fulfiller.storefrontId);
      const freeByShop = sf?.freeShipFrom != null && subtotals[i]! >= sf.freeShipFrom;
      const partnerFee = freeByShop ? 0 : sf?.shippingFee ?? defaultFee;
      out.push({
        // Mã freeship là Tubu tài trợ phí kho Tubu; phí giao của đối tác là tiền của đối tác nên chỉ miễn theo ngưỡng của shop.
        shippingFee: partnerFee,
        commissionPct: sf?.commissionPct != null ? Number(sf.commissionPct) : defaultPct,
        freeshipWaived: 0,
        firstOrderWaived: 0,
        thresholdFree: null,
        partnerFee,
        recycleWaived: 0,
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

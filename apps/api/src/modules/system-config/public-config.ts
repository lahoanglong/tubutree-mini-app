import type { SystemConfigService } from './system-config.service';
import { toShippingEta } from './shipping-eta';
import { DEFAULT_PIT_WITHHOLD_PCT, DEFAULT_PIT_WITHHOLD_THRESHOLD } from '../affiliate/affiliate.service';
import { PUBLIC_PREVIEW_DEFAULT, PUBLIC_PREVIEW_KEY } from '../feed/community-public-preview';
import { EVENT_REWARD_MAX_POINTS } from '../feed/community-limits';
import { DEALER_MAX_DISCOUNT_PCT_DEFAULT, DEALER_REVIEW_HOURS_DEFAULT } from '../dealer/dealer-config';
import { FREE_SHIP_THRESHOLD_DEFAULT, FIRST_ORDER_FREESHIP_ENABLED_DEFAULT, FIRST_ORDER_FREESHIP_ENABLED_KEY, FIRST_ORDER_FREESHIP_MIN_DEFAULT, FIRST_ORDER_FREESHIP_MIN_KEY } from '../pricing/pricing.service';
import { publicCommunityUrl } from './community-links';
import { isAdvisorAvailable } from '../ai-advisor/advisor-config';
import { DEFAULT_POINT_EXPIRE_MONTHS, normalizePointExpireMonths } from '../loyalty/points-expiry-date';
import { DEFAULT_EARN_PCT, DEFAULT_MARKETPLACE_EARN_PCT, EARN_PCT_KEY, MARKETPLACE_EARN_PCT_KEY, MAX_MARKETPLACE_EARN_PCT } from '../loyalty/earn-rates';
import { MARKETPLACE_CLAIM_ENABLED_KEY, MARKETPLACE_CLAIM_MAX_AGE_KEY, normalizeClaimMaxAgeDays } from '../external-points/external-claim.config';
import { CHAT_ENABLED_KEY, CHAT_HOURS_KEY, DEFAULT_CHAT_HOURS, chatHoursProblem } from '../support-chat/support-chat.config';
import { computeWastePublicFlags } from '../waste-exchange/core/waste-public-config';
import { readCompanyIdentity } from './company-config';
import { CATALOG_LAUNCH_DATE_KEY, publicCatalogLaunchDate } from '../catalog/catalog-launch-date';
import { readGreenCornerConfig } from '../reviews/review-green-corner';
import { GREEN_CORNER_MAX_PHOTOS } from '@tubutree/shared-types';
import { FREESHIP_BOOSTER_ENABLED_KEY } from '../catalog/upsell/freeship-upsell';
import { RETURN_PACKAGING_NUDGE_KEY } from '../waste-exchange/customer/waste-return-packaging';
import { MSS_ORDER_CONSENT_PRECHECKED_KEY, TUBU_ZALO_PHONE_DEFAULT, TUBU_ZALO_PHONE_KEY, orderZaloGateOpen, tubuZaloPhoneOf, type OrderZaloGate } from './order-zalo-config';

/** Giỏ cho khách chưa đăng nhập trên web; mặc định tắt (seed createOnly + migration 20261117030000_web_guest_cart_flag). */
/** Cờ Giờ Xanh Ưu Đãi (tubu-w3-06): chỉ đổi cách vẽ khối Giờ vàng ở Trang chủ và Ưu đãi, giá và suất vẫn của Giờ vàng. */
export const FLASH_GREEN_HOUR_KEY = 'flashsale.green_hour_enabled';

export const WEB_GUEST_CART_ENABLED_KEY = 'web.guest_cart_enabled';

/** Trang đích link mời và tiến độ mời; mặc định tắt (seed createOnly + migration 20261118015753). */
export const REFERRAL_SHARE_CARD_KEY = 'referral.share_card_enabled';

/** Chỉ hai trường công khai, để khoá phụ lưu thêm trong cấu hình không lọt ra endpoint công khai. */
const pickHours = (v: { start: string; end: string }) => ({ start: v.start, end: v.end });

/** Trần % giá trị đơn trả được bằng điểm khi chưa cấu hình, khớp mặc định ở getOverview và pricing.service. */
const LOYALTY_MAX_REDEEM_PCT_DEFAULT = 0.2;

/** Khớp mặc định của PricingService.calcShippingFee và legal-config.controller. */
const FLAT_SHIPPING_FEE_DEFAULT = 19000;

/** Admin để trống (hoặc lưu sai kiểu) thì trả null để miniapp ẩn dòng, không hiện thông tin giả. */
function displayText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Tham số nghiệp vụ FE cần để HIỂN THỊ đúng. Mọi giá trị ở đây trước đó bị hardcode rải rác
 * trong miniapp ("tiết kiệm 12%", "Ví Tubu ×1.5", "rút tối thiểu 50k") — admin đổi config là
 * FE nói sai số tiền mà không ai phát hiện (P2-5/P2-15 audit mạch lạc). Chỉ đưa ra thứ vốn
 * đã hiển thị công khai cho người dùng, không lộ tham số nội bộ.
 *
 * Dùng chung cho GET /config/public và khối `publicConfig` của GET /home (Trang chủ gộp request), nên hai nơi luôn cùng số.
 */
export type TierRow = { id: string; name: string; pointMultiplier: unknown };
export type TierLoader = () => Promise<TierRow[]>;

/** Bảng hạng đọc từ cùng nguồn với /loyalty/preview (membershipTier); hệ số hỏng (không phải số > 0) bị bỏ để UI rơi về hệ số 1. */
export const tierLoaderOf = (prisma: { membershipTier: { findMany: (args: { select: { id: true; name: true; pointMultiplier: true } }) => Promise<TierRow[]> } }): TierLoader => () =>
  prisma.membershipTier.findMany({ select: { id: true, name: true, pointMultiplier: true } });

function tierTables(rows: TierRow[]) {
  const tierMultipliers: Record<string, number> = {};
  const tierNames: Record<string, string> = {};
  for (const t of rows) {
    const m = Number(t.pointMultiplier);
    if (!Number.isFinite(m) || m <= 0) continue;
    tierMultipliers[t.id] = m;
    tierNames[t.id] = t.name;
  }
  return { tierMultipliers, tierNames };
}

/** `orderZaloGate`: cổng tin đơn qua MSS đọc trong bộ nhớ (`MssOrderEventRecorder.gate`); không truyền thì `orderZaloEnabled` là false. */
export async function buildPublicConfig(config: SystemConfigService, loadTiers: TierLoader = async () => [], orderZaloGate?: () => OrderZaloGate | null | undefined) {
  const [
    freeshipThreshold,
    subscribeDiscountPct,
    cashbackHoldDays,
    etaMinDays,
    etaMaxDays,
    hotline,
    supportEmail,
    zaloOaName,
    groupBuyDiscountPct,
    groupBuyTargetSize,
    returnWindowDays,
    pitPct,
    pitThreshold,
    welcomeAmount,
    welcomeMinOrder,
    firstOrderFree,
    firstOrderFreeMin,
    earnPct,
    marketplaceClaimEnabled,
    marketplaceEarnPct,
    marketplaceClaimMaxAgeDays,
    vndPerPointRedeem,
    maxRedeemPct,
    pointExpireMonths,
    communityPublicPreview,
    dealerMaxDiscountPct,
    dealerReviewHours,
    communityZaloGroupUrl,
    communityFacebookUrl,
    communityTiktokUrl,
    waste,
    chatEnabled,
    chatHours,
    company,
    catalogLaunchDate,
    tierRows,
    flatShippingFee,
    webGuestCart,
    orderZaloPrechecked,
    tubuZaloPhone,
    referralShareCard,
    greenCorner,
    freeshipBooster,
    flashGreenHour,
    returnPackagingNudge,
  ] = await Promise.all([
    config.get<number>('shipping.free_threshold', FREE_SHIP_THRESHOLD_DEFAULT),
    config.get<number>('subscribe.discount_pct', 0.12),
    config.get<number>('cashback.hold_days', 30),
    config.get<number | null>('shipping.eta_min_days', null),
    config.get<number | null>('shipping.eta_max_days', null),
    config.get<unknown>('support.hotline', '0984 606 774'),
    config.get<unknown>('support.email', 'tubutree@gmail.com'),
    config.get<unknown>('support.zalo_oa_name', ''),
    // Mặc định phải khớp GroupBuyService.create và OrdersService.requestReturn (cùng khoá, cùng fallback).
    config.get<number>('groupbuy.discount_pct', 15),
    config.get<number>('groupbuy.target_size', 3),
    config.get<number>('returns.window_days', 7),
    config.get<number>('affiliate.pit_withhold_pct', DEFAULT_PIT_WITHHOLD_PCT),
    config.get<number>('affiliate.pit_withhold_threshold', DEFAULT_PIT_WITHHOLD_THRESHOLD),
    // Mặc định khớp VouchersService (cron và cấp ngay lúc đăng ký), PricingService và CheckoutService: cùng khoá, cùng fallback.
    config.get<number>('voucher.welcome_amount', 30000),
    config.get<number>('voucher.welcome_min_order', 199000),
    config.get<unknown>(FIRST_ORDER_FREESHIP_ENABLED_KEY, FIRST_ORDER_FREESHIP_ENABLED_DEFAULT),
    config.get<number>(FIRST_ORDER_FREESHIP_MIN_KEY, FIRST_ORDER_FREESHIP_MIN_DEFAULT),
    config.get<number>(EARN_PCT_KEY, DEFAULT_EARN_PCT),
    config.get<unknown>(MARKETPLACE_CLAIM_ENABLED_KEY, false),
    config.get<unknown>(MARKETPLACE_EARN_PCT_KEY, DEFAULT_MARKETPLACE_EARN_PCT),
    config.get<unknown>(MARKETPLACE_CLAIM_MAX_AGE_KEY, null),
    config.get<number>('loyalty.vnd_per_point_redeem', 1),
    config.get<unknown>('loyalty.max_redeem_pct', LOYALTY_MAX_REDEEM_PCT_DEFAULT),
    config.get<unknown>('loyalty.point_expire_months', DEFAULT_POINT_EXPIRE_MONTHS),
    config.get<unknown>(PUBLIC_PREVIEW_KEY, PUBLIC_PREVIEW_DEFAULT),
    config.get<unknown>('dealer.max_discount_pct', DEALER_MAX_DISCOUNT_PCT_DEFAULT),
    config.get<unknown>('dealer.review_hours', DEALER_REVIEW_HOURS_DEFAULT),
    config.get<unknown>('community.zalo_group_url', ''),
    config.get<unknown>('community.facebook_url', 'https://www.facebook.com/tubutree'),
    config.get<unknown>('community.tiktok_url', 'https://www.tiktok.com/@tubutree.com'),
    computeWastePublicFlags(config).catch(() => ({ enabled: false, dropoff: false, mailin: false, pickup: false })),
    config.get<unknown>(CHAT_ENABLED_KEY, false),
    config.get<unknown>(CHAT_HOURS_KEY, DEFAULT_CHAT_HOURS),
    readCompanyIdentity(config),
    config.get<unknown>(CATALOG_LAUNCH_DATE_KEY, ''),
    loadTiers().catch(() => [] as TierRow[]),
    config.get<unknown>('shipping.flat_fee_below_threshold', FLAT_SHIPPING_FEE_DEFAULT),
    config.get<unknown>(WEB_GUEST_CART_ENABLED_KEY, false),
    config.get<unknown>(MSS_ORDER_CONSENT_PRECHECKED_KEY, false),
    config.get<unknown>(TUBU_ZALO_PHONE_KEY, TUBU_ZALO_PHONE_DEFAULT),
    config.get<unknown>(REFERRAL_SHARE_CARD_KEY, false),
    readGreenCornerConfig(config),
    config.get<unknown>(FREESHIP_BOOSTER_ENABLED_KEY, false),
    config.get<unknown>(FLASH_GREEN_HOUR_KEY, false),
    config.get<unknown>(RETURN_PACKAGING_NUDGE_KEY, false),
  ]);
  return {
    freeshipThreshold,
    // Phí giao cố định của phần hàng Tubu Tree giao chưa đạt ngưỡng miễn phí (cùng khoá và mặc định với pricing.service); JSON-LD sản phẩm của web đọc số này. Giá trị hỏng thì mặc định.
    shippingFlatFee: typeof flatShippingFee === 'number' && Number.isFinite(flatShippingFee) && flatShippingFee >= 0 ? flatShippingFee : FLAT_SHIPPING_FEE_DEFAULT,
    subscribeDiscountPct,
    // Luật Ví ×1,5 đã bỏ: rút hoa hồng về Ví Tubu là 1:1 (affiliate.service). Giữ trường (cố định 1) để miniapp
    // đã phát hành không vỡ kiểu dữ liệu; không đọc khoá affiliate.tubu_wallet_multiplier còn sót trong DB.
    affiliateWalletMultiplier: 1,
    // Rút về ngân hàng đã bỏ, nhưng Mini App đã phát hành có thể còn đọc trường này (mức rút tối thiểu); thiếu trường thì màn cũ hiện
    // sai. Giữ giá trị mặc định cũ thêm một bản phát hành, không đọc khoá affiliate.min_withdraw_bank.
    affiliateMinWithdrawBank: 50000,
    affiliatePitWithhold: { pct: pitPct, threshold: pitThreshold },
    cashbackHoldDays,
    waste,
    shippingEta: toShippingEta(etaMinDays, etaMaxDays),
    groupBuy: { discountPct: groupBuyDiscountPct, targetSize: groupBuyTargetSize },
    returnWindowDays,
    support: { hotline: displayText(hotline), email: displayText(supportEmail), zaloOaName: displayText(zaloOaName) },
    // Đơn vị vận hành (tên, MST, địa chỉ, link thông báo Bộ Công Thương); trường chưa nhập là null để FE ẩn.
    company,
    newCustomer: {
      welcomeVoucher: { amount: welcomeAmount, minOrder: welcomeMinOrder },
      // Chỉ boolean true thật mới bật: chuỗi "false" là truthy, cờ gõ nhầm không được hứa freeship.
      firstOrderFreeShip: { enabled: firstOrderFree === true, minSubtotal: firstOrderFreeMin },
    },
    // Hai giá trị sau giải thích cách dùng/hạn điểm; chuẩn hoá giống getOverview và pointsExpiryFrom để chữ nói đúng điều server làm.
    loyalty: {
      earnPct,
      // Chỉ boolean true thật mới bật (cờ gõ nhầm không được hứa tích điểm đơn sàn). Tỉ lệ hỏng thì rơi về mặc định như phía cộng điểm.
      marketplaceClaimEnabled: marketplaceClaimEnabled === true,
      marketplaceClaimMaxAgeDays: normalizeClaimMaxAgeDays(marketplaceClaimMaxAgeDays),
      marketplaceEarnPct: typeof marketplaceEarnPct === 'number' && Number.isFinite(marketplaceEarnPct) && marketplaceEarnPct > 0 ? Math.min(marketplaceEarnPct, MAX_MARKETPLACE_EARN_PCT) : DEFAULT_MARKETPLACE_EARN_PCT,
      // Bản app cũ chưa đọc earnPct: giữ số đồng cho 1 điểm.
      vndPerPoint: typeof earnPct === 'number' && earnPct > 0 ? Math.round(100 / earnPct) : Math.round(100 / DEFAULT_EARN_PCT),
      vndPerPointRedeem,
      maxRedeemPct: typeof maxRedeemPct === 'number' && maxRedeemPct >= 0 && maxRedeemPct <= 1 ? maxRedeemPct : LOYALTY_MAX_REDEEM_PCT_DEFAULT,
      pointExpireMonths: normalizePointExpireMonths(pointExpireMonths),
      // Hệ số điểm theo hạng (id hạng → hệ số) và tên hạng, để trang sản phẩm tính số điểm của khách mà không gọi thêm API.
      ...tierTables(tierRows),
    },
    // Ngày mở bán (YYYY-MM-DD giờ VN) cho nhãn "Mới"; chưa đặt hoặc hỏng thì null và client giữ luật 30 ngày.
    catalogLaunchDate: publicCatalogLaunchDate(catalogLaunchDate),
    // Chỉ boolean: true khi AI bật VÀ có provider dùng được. Miniapp ẩn mọi lối vào AI khi không phải true (kể cả API cũ không trả).
    aiAdvisorEnabled: isAdvisorAvailable((k) => process.env[k]),
    // Miniapp chỉ gọi /feed/public-preview khi cờ này true (API vẫn tự kiểm cờ và trả 404 khi tắt).
    communityPublicPreview: communityPublicPreview === true,
    // Góc Sống Xanh: app đổi lời mời thưởng ở form đánh giá, giới hạn 3 ảnh, hiện chọn thẻ cảm nhận và dải Trang chủ. Tắt (hoặc API cũ không
    // trả) thì form và Trang chủ như cũ. Số điểm chỉ để nói trước; máy chủ quyết định lúc admin duyệt.
    // Giờ Xanh Ưu Đãi: khối Giờ vàng ở Trang chủ và Ưu đãi đổi tên, màu xanh và có nút ＋ một chạm. Chỉ boolean true mới bật; API cũ không trả thì như cũ.
    flashGreenHourEnabled: flashGreenHour === true,
    reviewGreenCorner: { enabled: greenCorner.enabled, rewardPoints: greenCorner.rewardPoints, dailyCap: greenCorner.dailyCap, maxPhotos: GREEN_CORNER_MAX_PHOTOS },
    // Chữ trên trang đăng ký đại lý ("giá sỉ đến X%", "xét duyệt trong N giờ"). Giá trị hỏng → null để miniapp bỏ con số.
    dealer: {
      maxDiscountPct: typeof dealerMaxDiscountPct === 'number' && dealerMaxDiscountPct > 0 && dealerMaxDiscountPct <= 1 ? dealerMaxDiscountPct : null,
      reviewHours: Number.isInteger(dealerReviewHours) && (dealerReviewHours as number) >= 1 ? (dealerReviewHours as number) : null,
    },
    community: {
      eventRewardMaxPoints: EVENT_REWARD_MAX_POINTS,
      zaloGroupUrl: publicCommunityUrl(communityZaloGroupUrl),
      facebookUrl: publicCommunityUrl(communityFacebookUrl),
      tiktokUrl: publicCommunityUrl(communityTiktokUrl),
    },
    // Chỉ cờ bật và giờ làm việc; mã nhóm Zalo và lời nhắn ngoài giờ không ra công khai. Giờ hỏng rơi về mặc định như phía gửi tin.
    chat: {
      enabled: chatEnabled === true,
      hours: chatHoursProblem(chatHours) === null ? pickHours(chatHours as { start: string; end: string }) : { ...DEFAULT_CHAT_HOURS },
    },
    // Chỉ boolean true thật mới bật: cờ gõ nhầm (chuỗi "false") không được mở giỏ khách trên web.
    webGuestCartEnabled: webGuestCart === true,
    // Ô đồng ý nhận hành trình đơn qua Zalo: cờ chung (cờ bật, MSS nhận sự kiện, tỉ lệ > 0). Tỉ lệ theo từng khách và số đã xác minh
    // ở GET /config/order-zalo, client chỉ gọi khi cờ chung bật.
    orderZaloEnabled: orderZaloGateOpen(orderZaloGate?.()),
    orderZaloPrechecked: orderZaloPrechecked === true,
    tubuZaloPhone: tubuZaloPhoneOf(tubuZaloPhone),
    // Link mời trỏ trang đích /moi/<mã> (web dựng trang và ảnh xem trước; cờ tắt thì trang trả 404), khối mời hiện tiến độ.
    referralShareCardEnabled: referralShareCard === true,
    // Dải "Thêm 1 món nhỏ để đủ Miễn phí giao hàng" ở đầu giỏ đọc `GET /upsell/freeship`; tắt hoặc API cũ thì hai app giữ dải lấy từ kệ Bán chạy nhất.
    freeshipBoosterEnabled: freeshipBooster === true,
    // Thẻ đổi rác kèm đơn điền sẵn bao bì của đơn đã giao (`pickup-options.suggestion`, `GET /waste/return-packaging`); tắt hay API cũ thì thẻ như trước.
    returnPackagingNudgeEnabled: returnPackagingNudge === true,
  };
}

export type PublicConfigDTO = Awaited<ReturnType<typeof buildPublicConfig>>;

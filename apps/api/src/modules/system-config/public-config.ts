import type { SystemConfigService } from './system-config.service';
import { isGomdonRecyclingEnabled } from '../integrations/gomdon/gomdon-config';
import { toShippingEta } from './shipping-eta';
import { DEFAULT_PIT_WITHHOLD_PCT, DEFAULT_PIT_WITHHOLD_THRESHOLD } from '../affiliate/affiliate.service';
import { PUBLIC_PREVIEW_DEFAULT, PUBLIC_PREVIEW_KEY } from '../feed/community-public-preview';
import { EVENT_REWARD_MAX_POINTS } from '../feed/community-limits';
import { DEALER_MAX_DISCOUNT_PCT_DEFAULT, DEALER_REVIEW_HOURS_DEFAULT } from '../dealer/dealer-config';
import { FIRST_ORDER_FREESHIP_ENABLED_DEFAULT, FIRST_ORDER_FREESHIP_ENABLED_KEY, FIRST_ORDER_FREESHIP_MIN_DEFAULT, FIRST_ORDER_FREESHIP_MIN_KEY } from '../pricing/pricing.service';
import { publicCommunityUrl } from './community-links';
import { isAdvisorAvailable } from '../ai-advisor/advisor-config';
import { DEFAULT_POINT_EXPIRE_MONTHS, normalizePointExpireMonths } from '../loyalty/points-expiry-date';
import { DEFAULT_EARN_PCT, DEFAULT_MARKETPLACE_EARN_PCT, EARN_PCT_KEY, MARKETPLACE_EARN_PCT_KEY, MAX_MARKETPLACE_EARN_PCT } from '../loyalty/earn-rates';
import { MARKETPLACE_CLAIM_ENABLED_KEY } from '../external-points/external-claim.config';

/** Trần % giá trị đơn trả được bằng điểm khi chưa cấu hình, khớp mặc định ở getOverview và pricing.service. */
const LOYALTY_MAX_REDEEM_PCT_DEFAULT = 0.2;

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
export async function buildPublicConfig(config: SystemConfigService) {
  const [
    freeshipThreshold,
    subscribeDiscountPct,
    affiliateMinWithdrawBank,
    cashbackHoldDays,
    recyclingEnabled,
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
    vndPerPointRedeem,
    maxRedeemPct,
    pointExpireMonths,
    homeNewCustomerLayout,
    communityPublicPreview,
    dealerMaxDiscountPct,
    dealerReviewHours,
    communityZaloGroupUrl,
    communityFacebookUrl,
    communityTiktokUrl,
  ] = await Promise.all([
    config.get<number>('shipping.free_threshold', 200000),
    config.get<number>('subscribe.discount_pct', 0.12),
    config.get<number>('affiliate.min_withdraw_bank', 50000),
    config.get<number>('cashback.hold_days', 30),
    // Chỉ trả boolean — KHÔNG lộ cấu hình/tài khoản Gomdon. true khi Gomdon đã cấu hình VÀ admin
    // bật shipping.gomdon.recycling_enabled; miniapp chỉ hiện lựa chọn thu gom khi true.
    isGomdonRecyclingEnabled(config).catch(() => false),
    config.get<number | null>('shipping.eta_min_days', null),
    config.get<number | null>('shipping.eta_max_days', null),
    config.get<unknown>('support.hotline', '0899 149 229'),
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
    config.get<number>('loyalty.vnd_per_point_redeem', 1),
    config.get<unknown>('loyalty.max_redeem_pct', LOYALTY_MAX_REDEEM_PCT_DEFAULT),
    config.get<unknown>('loyalty.point_expire_months', DEFAULT_POINT_EXPIRE_MONTHS),
    config.get<unknown>('home.new_customer_layout', true),
    config.get<unknown>(PUBLIC_PREVIEW_KEY, PUBLIC_PREVIEW_DEFAULT),
    config.get<unknown>('dealer.max_discount_pct', DEALER_MAX_DISCOUNT_PCT_DEFAULT),
    config.get<unknown>('dealer.review_hours', DEALER_REVIEW_HOURS_DEFAULT),
    config.get<unknown>('community.zalo_group_url', ''),
    config.get<unknown>('community.facebook_url', ''),
    config.get<unknown>('community.tiktok_url', ''),
  ]);
  return {
    freeshipThreshold,
    subscribeDiscountPct,
    // Luật Ví ×1,5 đã bỏ: rút hoa hồng về Ví Tubu là 1:1 (affiliate.service). Giữ trường (cố định 1) để miniapp
    // đã phát hành không vỡ kiểu dữ liệu; không đọc khoá affiliate.tubu_wallet_multiplier còn sót trong DB.
    affiliateWalletMultiplier: 1,
    affiliateMinWithdrawBank,
    affiliatePitWithhold: { pct: pitPct, threshold: pitThreshold },
    cashbackHoldDays,
    recyclingEnabled,
    shippingEta: toShippingEta(etaMinDays, etaMaxDays),
    groupBuy: { discountPct: groupBuyDiscountPct, targetSize: groupBuyTargetSize },
    returnWindowDays,
    support: { hotline: displayText(hotline), email: displayText(supportEmail), zaloOaName: displayText(zaloOaName) },
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
      marketplaceEarnPct: typeof marketplaceEarnPct === 'number' && Number.isFinite(marketplaceEarnPct) && marketplaceEarnPct > 0 ? Math.min(marketplaceEarnPct, MAX_MARKETPLACE_EARN_PCT) : DEFAULT_MARKETPLACE_EARN_PCT,
      // Bản app cũ chưa đọc earnPct: giữ số đồng cho 1 điểm.
      vndPerPoint: typeof earnPct === 'number' && earnPct > 0 ? Math.round(100 / earnPct) : Math.round(100 / DEFAULT_EARN_PCT),
      vndPerPointRedeem,
      maxRedeemPct: typeof maxRedeemPct === 'number' && maxRedeemPct >= 0 && maxRedeemPct <= 1 ? maxRedeemPct : LOYALTY_MAX_REDEEM_PCT_DEFAULT,
      pointExpireMonths: normalizePointExpireMonths(pointExpireMonths),
    },
    homeNewCustomerLayout: homeNewCustomerLayout === true,
    // Chỉ boolean: true khi AI bật VÀ có provider dùng được. Miniapp ẩn mọi lối vào AI khi không phải true (kể cả API cũ không trả).
    aiAdvisorEnabled: isAdvisorAvailable((k) => process.env[k]),
    // Miniapp chỉ gọi /feed/public-preview khi cờ này true (API vẫn tự kiểm cờ và trả 404 khi tắt).
    communityPublicPreview: communityPublicPreview === true,
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
  };
}

export type PublicConfigDTO = Awaited<ReturnType<typeof buildPublicConfig>>;

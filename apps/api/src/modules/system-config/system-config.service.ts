import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatPoints } from '../../common/format-points';
import { COMMUNITY_LINK_KEYS, communityUrlProblem } from './community-links';
import { spinPrizeProblem } from './spin-prizes';
import { bannedKeywordsProblem } from '../feed/content-filter';
import { commissionPctOf, freezeDefaultCommissionChange, MERCHANT_COMMISSION_KEY } from '../merchant/merchant-terms-history';
import { parseConsignmentSettleFrom } from '../merchant/merchant-config';
import { COMMISSION_ELIGIBLE_ROLES_KEY, eligibleRolesProblem } from '../affiliate/commission-eligibility';
import { PANCAKE_CATEGORY_MAP_KEY, categoryMapProblem } from '../integrations/pancake/pancake-category-map';
import { AFFILIATE_DEFAULT_RATE_KEY, DEFAULT_AFFILIATE_DEFAULT_RATE_PCT, sanitizeDefaultRate } from '../affiliate/commission-rate';
import { AFFILIATE_MAX_RATE_KEY, DEFAULT_AFFILIATE_MAX_RATE_PCT, sanitizeMaxRate } from '../affiliate/commission-rate-csv';
import { STOREFRONT_REQUIRE_APPROVAL_KEY, STOREFRONT_SUBDOMAIN_ENABLED_KEY } from '../storefront/storefront-config';
import { DEALER_BONUS_TIERS_KEY, dealerBonusTiersProblem } from './dealer-bonus-tiers-rule';
import { WASTE_JSON_RULES, WASTE_RANGES } from '../waste-exchange/waste-config.keys';
import { CHAT_ENABLED_KEY, CHAT_GROUP_KEY, CHAT_HOURS_KEY, CHAT_OFF_HOURS_TEXT_KEY, CHAT_RETENTION_KEY, chatGroupIdProblem, chatHoursProblem, offHoursTextProblem } from '../support-chat/support-chat.config';
import { EXTERNAL_CAPTURE_ENABLED_KEY, ORDER_SOURCE_MAP_KEY, orderSourceMapProblem } from '../external-points/external-order.config';
import {
  EXTERNAL_LOOKUP_ENABLED_KEY,
  EXTERNAL_POLL_ENABLED_KEY,
  EXTERNAL_SINCE_KEY,
  MARKETPLACE_CLAIM_ENABLED_KEY,
} from '../external-points/external-claim.config';
import { CHAT_ORDER_EARN_PCT_KEY, CHAT_ORDER_POINTS_ENABLED_KEY, CHAT_ORDER_REQUIRE_CARRIER_KEY, PANCAKE_STAFF_MAP_KEY, staffMapProblem } from '../external-points/external-chat.config';

const DISPLAY_NAME_MAX = 100;

/** Chuỗi hiển thị bắt buộc (tên ngân hàng, tên chủ tài khoản): có chữ, không quá DISPLAY_NAME_MAX ký tự. */
function displayNameProblem(value: unknown, what: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return `không được để trống — nhập ${what}`;
  if (value.length > DISPLAY_NAME_MAX) return `tối đa ${DISPLAY_NAME_MAX} ký tự`;
  return null;
}

/**
 * Đọc/ghi tham số nghiệp vụ từ bảng SystemConfig (Build Spec Section 15).
 * QUY TẮC: mọi rate/ngưỡng/hold-time PHẢI lấy qua service này, KHÔNG hard-code.
 * Cache in-memory ngắn để tránh query lặp; invalidates khi set().
 */
const LEGAL_DOC_MAX_CHARS = 50_000;

function legalDocProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'phải là chuỗi chữ (markdown hoặc chữ thường)';
  if (value.length > LEGAL_DOC_MAX_CHARS) return `tối đa ${LEGAL_DOC_MAX_CHARS.toLocaleString('vi-VN')} ký tự`;
  return null;
}

@Injectable()
export class SystemConfigService {
  private cache = new Map<string, { value: unknown; at: number }>();
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback?: T): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) {
      return cached.value as T;
    }
    const row = await this.prisma.systemConfig.findUnique({ where: { key } });
    if (!row) {
      if (fallback !== undefined) {
        // Cache fallback value too — nếu không, key chưa tồn tại (DB mới/seed chưa chạy) khiến
        // MỌI lần get() (kể cả từ route @Public như /config/public) đều bỏ qua cache, query
        // thẳng DB. set() vẫn xoá đúng entry này khi config được tạo thật.
        this.cache.set(key, { value: fallback, at: Date.now() });
        return fallback;
      }
      throw new NotFoundException(`SystemConfig "${key}" chưa được cấu hình.`);
    }
    this.cache.set(key, { value: row.value, at: Date.now() });
    return row.value as T;
  }

  async getByCategory(category: string): Promise<Record<string, unknown>> {
    const rows = await this.prisma.systemConfig.findMany({ where: { category } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /**
   * Ghi 1 config. Nhiều module dùng `get<T>(key, fallback)` và TIN TƯỞNG runtime type khớp T mà
   * KHÔNG validate lại (xem vd. wallet.service.ts, cashback.service.ts, vouchers.service.ts —
   * dùng thẳng trong phép toán số học, không guard). Nếu set() cho phép ghi null/kiểu khác với
   * giá trị hiện tại, lần đọc tiếp theo ở module khác có thể NaN/throw giữa business logic tài
   * chính (ví dụ ví, cashback, voucher). Chặn ngay tại đây — điểm ghi DUY NHẤT — rẻ hơn nhiều so
   * với việc bắt từng call site tự guard.
   */
  /**
   * Biên hợp lệ cho những khoá mà ĐƠN VỊ dễ gõ nhầm. Kiểm tra kiểu (số vẫn là số) không cứu
   * được trường hợp gõ "80" cho một khoá lưu PHÂN SỐ: mô tả trong seed ghi "User nhận 70%"
   * nhưng giá trị thật là 0.7, nên nâng lên 80% rất dễ thành 80 — hoa hồng 50.000đ biến thành
   * 4.000.000đ cộng thẳng vào ví rút được, và sau khi đã trả thì không đòi lại được.
   *
   * Cố ý liệt kê TỪNG KHOÁ chứ không suy theo hậu tố: `subscribe.discount_pct` là phân số
   * (0.12) còn `groupbuy.discount_pct` là phần trăm nguyên (15) — cùng hậu tố, khác đơn vị.
   */
  private static readonly RANGES: Record<string, { min: number; max: number; note: string; integer?: true }> = {
    'loyalty.max_redeem_pct': { min: 0, max: 1, note: 'phân số (0.2 = 20%)' },
    // Hạn của mọi điểm thưởng mới (điểm đơn, điểm danh, đánh giá, vòng quay, giới thiệu…). 0 hay số âm làm điểm hết hạn
    // ngay lúc cộng, số quá lớn làm điểm không bao giờ hết hạn; số lẻ bị các nguồn cộng điểm cắt bỏ phần thập phân.
    'loyalty.point_expire_months': { min: 1, max: 120, note: 'số tháng nguyên (12 = điểm hết hạn sau 12 tháng)', integer: true },
    'subscribe.discount_pct': { min: 0, max: 1, note: 'phân số (0.12 = 12%)' },
    'wishlist.price_drop_min_pct': { min: 0, max: 1, note: 'phân số (0.05 = 5%)' },
    'wishlist.price_drop_cooldown_days': { min: 0, max: 90, note: 'số ngày (0 = tắt cooldown)', integer: true },
    'community.author_notify_interval_minutes': { min: 0, max: 1440, note: 'số phút gộp tin "bài của bạn có người thích/bình luận" và "câu hỏi của bạn có câu trả lời mới" (0 = tắt tin thích/bình luận; tin câu trả lời mới vẫn gửi nhưng không gộp)', integer: true },
    'community.unanswered_alert_hours': { min: 1, max: 720, note: 'số giờ câu hỏi chưa ai trả lời thì lên "Việc cần xử lý"', integer: true },
    'subscribe.stock_retry_days': { min: 0, max: 7, note: 'số đêm thử lại kỳ định kỳ khi hết hàng (0 = không thử lại)', integer: true },
    'flashsale.min_discount_pct': { min: 0, max: 1, note: 'phân số (0.1 = 10%)' },
    'flashsale.max_discount_pct': { min: 0.01, max: 1, note: 'phân số (0.9 = giá flash ≥ 10% giá đang bán; 1 = không chặn)' },
    'flashsale.max_duration_days': { min: 1, max: 366, note: 'số ngày tối đa của một đợt flash sale', integer: true },
    'dealer.max_discount_pct': { min: 0, max: 1, note: 'phân số (0.45 = 45%)' },
    'dealer.review_hours': { min: 1, max: 720, note: 'số giờ nguyên Tubu hẹn xét duyệt hồ sơ đại lý (chỉ để hiện chữ cho người đăng ký)', integer: true },
    'cashback.merchant_user_share': { min: 0, max: 1, note: 'phân số (0.7 = 70%)' },
    'groupbuy.discount_pct': { min: 0, max: 100, note: 'phần trăm nguyên (15 = 15%)', integer: true },
    'cashback.hold_days': { min: 0, max: 365, note: 'số ngày', integer: true },
    'affiliate.hold_days': { min: 0, max: 365, note: 'số ngày', integer: true },
    // Khoá code THẬT SỰ đọc (orders.service requestReturn, affiliate.service hold) — trước đây RANGES/seed
    // ghi 'return.window_days' (không ai đọc) nên giới hạn này chưa bao giờ áp vào khoá thật.
    'returns.window_days': { min: 0, max: 365, note: 'số ngày', integer: true },
    'dealer.reward_claim_grace_days': { min: 0, max: 366, note: 'số ngày', integer: true },
    'dealer.bonus_topup_window_days': { min: 0, max: 120, note: 'số ngày nguyên sau ngày cuối quý còn trả bù thưởng quý cho đơn chốt muộn (0 hoặc dưới 10 = tắt: ngày chốt thưởng là ngày 10 sau quý)', integer: true },
    // ETA giao hàng trên trang đặt hàng thành công (buy-flow 4a): số nguyên ngày, gõ nhầm (vd 300) sẽ
    // bị từ chối lúc ghi thay vì âm thầm ẩn dòng ETA (toShippingEta bỏ giá trị ngoài 0–60).
    'shipping.eta_min_days': { min: 0, max: 60, note: 'số ngày' },
    'shipping.eta_max_days': { min: 0, max: 60, note: 'số ngày' },
    // Cron VouchersService cấp mã hàng loạt theo các khoá này: gõ nhầm đơn vị (30000 → 3000000) hay số âm sẽ cấp mã
    // sai giá trị cho cả tệp khách. Mức 0đ bị loại vì grant() vẫn tạo mã 0đ và gửi thông báo.
    'voucher.welcome_amount': { min: 1000, max: 1_000_000, note: 'đồng' },
    'voucher.birthday_amount': { min: 1000, max: 1_000_000, note: 'đồng' },
    'voucher.winback_amount': { min: 1000, max: 1_000_000, note: 'đồng' },
    'voucher.welcome_min_order': { min: 0, max: 50_000_000, note: 'đồng (0 = không yêu cầu đơn tối thiểu)' },
    // 0 ngày = coi mọi khách từng mua là "đã bỏ đi" và cấp mã cho tất cả.
    'voucher.winback_days': { min: 1, max: 365, note: 'số ngày' },
    // PD-3 / points-1d: khoá tính bằng Điểm Xanh (1 điểm = 1đ). Biên chặn gõ nhầm đơn vị cũ (1 điểm = 1.000đ) hoặc
    // bội số của nó ngay lúc ghi. `integer`: điểm là số nguyên
    // (cột INTEGER; RewardPointsService.grant ném 500 với số lẻ nên thưởng 2.5 sẽ không bao giờ được cấp).
    'referral.referrer_reward_points': { min: 0, max: 100_000, note: 'Điểm Xanh (1 điểm = 1đ), không phải xu', integer: true },
    'community.post_reward_points': { min: 0, max: 20_000, note: 'Điểm Xanh (1 điểm = 1đ), không phải xu', integer: true },
    'community.answer_reward_points': { min: 0, max: 20_000, note: 'Điểm Xanh (1 điểm = 1đ), không phải xu', integer: true },
    'community.best_answer_reward_points': { min: 0, max: 20_000, note: 'Điểm Xanh (1 điểm = 1đ), không phải xu', integer: true },
    // Điểm UY TÍN cộng đồng (cấp Mầm đến Cổ thụ), không phải Điểm Xanh. Cột reputation/amount là INTEGER: số lẻ làm giao dịch lỗi,
    // và bumpReputation nuốt lỗi đó nên người đăng bài không được cộng mà không ai biết. Số lớn đưa người đăng bài lên cấp cao nhất ngay.
    'community.rep_post': { min: 0, max: 100, note: 'điểm uy tín mỗi bài được đăng (0 = không cộng)', integer: true },
    'community.rep_answer': { min: 0, max: 100, note: 'điểm uy tín mỗi câu trả lời (0 = không cộng)', integer: true },
    'community.rep_best': { min: 0, max: 100, note: 'điểm uy tín cho câu trả lời được chọn hay nhất (0 = không cộng)', integer: true },
    'community.daily_rep_cap': { min: 0, max: 1000, note: 'điểm uy tín tối đa mỗi người mỗi ngày (0 = không ai được cộng)', integer: true },
    'game.tree_points_price': { min: 1, max: 500_000, note: 'Điểm Xanh mỗi lượt góp quỹ (1 điểm = 1đ), không phải xu', integer: true },
    'game.spin_buy_cost_points': { min: 1, max: 1_000_000, note: 'Điểm Xanh mỗi lượt quay', integer: true },
    'game.spin_voucher_min_order_multiplier': { min: 1, max: 50, note: 'hệ số nguyên (6 = voucher 20.000đ cho đơn từ 120.000đ)', integer: true },
    // ADMINOPS-3: các khoá tiền/điểm đọc thẳng vào checkout, ví, rút tiền. Phí âm làm tổng đơn nhỏ hơn tiền hàng;
    // Tích điểm là phần trăm tiền hàng nên 100 (thay vì 2) là tích gấp 50 lần. Chặn ngay lúc ghi.
    'shipping.flat_fee_below_threshold': { min: 0, max: 1_000_000, note: 'đồng phí ship cố định', integer: true },
    'shipping.free_threshold': { min: 0, max: 50_000_000, note: 'đồng (đơn từ mức này được freeship)', integer: true },
    'shipping.first_order_free_min_subtotal': { min: 0, max: 50_000_000, note: 'đồng tiền hàng tối thiểu để đơn đầu được freeship (0 = mọi đơn đầu)', integer: true },
    'loyalty.earn_pct': { min: 0.1, max: 20, note: 'phần trăm tiền hàng (sau giảm giá, không gồm ship) tích thành Điểm Xanh (2 = 2%), trước hệ số hạng' },
    // Tích điểm đơn sàn (B6): cùng đơn vị phần trăm với loyalty.earn_pct. Trần điểm tính theo Điểm Xanh (1 điểm = 1đ).
    'loyalty.marketplace_earn_pct': { min: 0.1, max: 20, note: 'phần trăm tiền hàng đơn mua ngoài app tích thành Điểm Xanh (1 = 1%), không nhân hệ số hạng' },
    'loyalty.marketplace_claim_daily_attempts': { min: 1, max: 100, note: 'số lần nhập mã mỗi khách mỗi ngày (kể cả mã không tìm thấy)', integer: true },
    'loyalty.marketplace_claim_daily_max': { min: 1, max: 50, note: 'số đơn ngoài app được tích mỗi khách mỗi ngày', integer: true },
    'loyalty.marketplace_claim_monthly_points_cap': { min: 1, max: 10_000_000, note: 'Điểm Xanh (1 điểm = 1đ) tối đa mỗi khách mỗi tháng từ đơn ngoài app', integer: true },
    'loyalty.marketplace_claim_max_age_days': { min: 1, max: 365, note: 'số ngày tuổi tối đa của đơn được tích', integer: true },
    'loyalty.marketplace_claim_review_above_vnd': { min: 100_000, max: 50_000_000, note: 'đồng, đơn lớn hơn mức này chờ nhân viên duyệt', integer: true },
    'loyalty.chat_order_monthly_points_cap': { min: 1, max: 10_000_000, note: 'Điểm Xanh (1 điểm = 1đ) tối đa mỗi SĐT mỗi tháng từ đơn chat/điện thoại', integer: true },
    'loyalty.chat_order_review_above_vnd': { min: 100_000, max: 50_000_000, note: 'đồng, đơn chat lớn hơn mức này chờ nhân viên duyệt', integer: true },
    'loyalty.chat_unclaimed_hold_days': { min: 1, max: 180, note: 'số ngày giữ điểm đơn chat cho SĐT chưa là thành viên', integer: true },
    'loyalty.chat_phone_verified_max_days': { min: 1, max: 3650, note: 'số ngày SĐT thành viên còn được coi là đã xác minh để tự liên kết điểm đơn chat', integer: true },
    'loyalty.chat_order_creator_monthly_points': { min: 1, max: 1_000_000_000, note: 'Điểm Xanh tự cộng tối đa mỗi tháng cho đơn chat của một nhân viên tạo đơn trên Pancake', integer: true },
    'loyalty.external_pending_days': { min: 1, max: 60, note: 'số ngày sau khi đơn giao xong mới cộng điểm', integer: true },
    'referral.min_order_amount': { min: 0, max: 50_000_000, note: 'đồng', integer: true },
    'groupbuy.max_open_per_user': { min: 1, max: 100, note: 'số nhóm', integer: true },
    'game.max_plots': { min: 1, max: 50, note: 'số lô đất', integer: true },
    // OQ-11: lô Điểm Xanh quy đổi từ xu là tiền khách trả trước theo giá 1 điểm = 1đ; đổi tỉ giá là
    // làm lô đó mất hoặc tăng giá trị cho mọi khách.
    'loyalty.vnd_per_point_redeem': { min: 1, max: 1, note: 'đồng/điểm, khoá cứng từ points-1d (lô quy đổi)' },
    // p8-seller: phí giao/phí sàn đối tác đọc thẳng vào checkout và đối soát; hạn SLA và thời gian chờ đọc vào cron.
    'merchant.default_shipping_fee': { min: 0, max: 500000, note: 'đồng', integer: true },
    'merchant.commission_pct': { min: 0, max: 0.5, note: 'phân số (0.15 = 15%)' },
    'merchant.settlement_hold_days': { min: 0, max: 60, note: 'số ngày', integer: true },
    'merchant.negative_payout_due_days': { min: 1, max: 60, note: 'số ngày', integer: true },
    'merchant.confirm_sla_hours': { min: 1, max: 168, note: 'số giờ', integer: true },
    'ops.alert_unsynced_minutes': { min: 15, max: 1440, note: 'số phút', integer: true },
    'ops.alert_stuck_orders': { min: 1, max: 1000, note: 'số đơn', integer: true },
    'ops.alert_webhook_failed': { min: 1, max: 10000, note: 'số webhook', integer: true },
    'ops.alert_queue_failed_1h': { min: 1, max: 10000, note: 'số job', integer: true },
    'ops.alert_repeat_hours': { min: 1, max: 168, note: 'số giờ', integer: true },
    'ops.alert_gomdon_backlog_minutes': { min: 5, max: 1440, note: 'số phút', integer: true },
    'merchant.ship_sla_hours': { min: 1, max: 336, note: 'số giờ', integer: true },
    'merchant.deliver_sla_days': { min: 1, max: 60, note: 'số ngày', integer: true },
    'storefront.identifier_cooldown_days': { min: 0, max: 365, note: 'số ngày', integer: true },
    'orders.dealer_pending_payment_ttl_hours': { min: 1, max: 720, note: 'số giờ', integer: true },
    'dealer.min_order_value_vnd': { min: 0, max: 100_000_000, note: 'đồng tiền hàng tối thiểu của một đơn đại lý (0 = không chặn)', integer: true },
    'dealer.free_ship_threshold_vnd': { min: 0, max: 500_000_000, note: 'đồng tiền hàng từ mức này đơn đại lý miễn phí giao', integer: true },
    'dealer.shipping_fee_below_threshold_vnd': { min: 0, max: 1_000_000, note: 'đồng phí giao đơn đại lý dưới ngưỡng miễn phí', integer: true },
    'affiliate.pit_withhold_pct': { min: 0, max: 0.35, note: 'phân số (0.1 = 10%)' },
    'affiliate.pit_withhold_threshold': { min: 0, max: 100000000, note: 'đồng', integer: true },
    // ADMINOPS-3 (vòng 2): tiền phạt đi trễ đi thẳng vào bảng lương (âm = cộng tiền), giá/thưởng 💧 âm đảo chiều ví game.
    'attendance.late_fine': { min: 0, max: 500_000, note: 'đồng mỗi lần đi trễ', integer: true },
    'game.streak_repair_cost': { min: 1, max: 100_000, note: '💧 hồi sinh chuỗi', integer: true },
    'game.streak_freeze_cost': { min: 1, max: 100_000, note: '💧 mỗi vé giữ lửa', integer: true },
    'game.dew_seeds': { min: 0, max: 10_000, note: '💧 giọt sương mỗi ngày', integer: true },
    'game.daily_login_seeds': { min: 0, max: 10_000, note: '💧 mỗi lần check-in', integer: true },
    'game.harvest_coupon_min_order': { min: 0, max: 50_000_000, note: 'đồng', integer: true },
    'groupbuy.target_size': { min: 2, max: 50, note: 'số người', integer: true },
    'referral.window_days': { min: 1, max: 365, note: 'số ngày', integer: true },
    'affiliate.attribution_days': { min: 1, max: 365, note: 'số ngày', integer: true },
    // Trần % hoa hồng CTV admin được đặt cho biến thể (commission-admin.service). PHẦN TRĂM, không phải phân số như pit_withhold_pct.
    'affiliate.max_rate_pct': { min: 0, max: 100, note: 'phần trăm (50 = 50%)' },
    // % hoa hồng CTV cho biến thể chưa đặt riêng (commission-rate.ts). Số nguyên như mức từng biến thể (RATE_MAX_DECIMALS = 0).
    'affiliate.default_rate_pct': { min: 0, max: 50, note: 'phần trăm (8 = 8%)', integer: true },
    'flashsale.default_per_user_limit': { min: 1, max: 1000, note: 'số sản phẩm mỗi người', integer: true },
    // ADMINOPS-3 (vòng 3, R3-UI-4): các khoá số còn lại nhận số âm, số khổng lồ hay số thực nên "đã lưu" mà tính năng chạy sai
    // (bán kính chấm công âm, ô vườn mục tiêu âm, giới hạn quay vô hạn). Phía đọc không kẹp lại, nên chặn ngay lúc ghi.
    // config-numeric-ranges.spec.ts buộc mọi khoá số được seed phải có luật ở đây hoặc ở admin-config-rules.
    'loyalty.point_expiry_reminder_days': { min: 0, max: 90, note: 'số ngày báo trước điểm sắp hết hạn (0 = không nhắc)', integer: true },
    'loyalty.tier_grace_days': { min: 0, max: 365, note: 'số ngày giữ hạng khi rớt mốc (0 = rớt hạng ngay)', integer: true },
    'cashback.click_rate_limit_seconds': { min: 0, max: 3600, note: 'số giây giữa hai lần bấm cùng sàn (0 = không giới hạn)', integer: true },
    'cashback.reconcile_lookback_days': { min: 1, max: 365, note: 'số ngày kéo lại giao dịch đối soát', integer: true },
    'community.daily_post_reward_cap': { min: 0, max: 100, note: 'số bài được thưởng mỗi ngày/người (0 = không thưởng)', integer: true },
    'community.daily_answer_reward_cap': { min: 0, max: 100, note: 'số câu trả lời được thưởng mỗi ngày/người (0 = không thưởng)', integer: true },
    'community.daily_best_answer_cap': { min: 0, max: 100, note: 'số lần được thưởng câu trả lời hay nhất mỗi ngày/người (0 = không thưởng)', integer: true },
    'game.spin_buy_daily_limit': { min: 0, max: 100, note: 'số lượt mua mỗi ngày (0 = khoá mua lượt quay)', integer: true },
    'game.quiz_daily_count': { min: 1, max: 50, note: 'số câu hỏi mỗi ngày', integer: true },
    'game.tank_capacity': { min: 1, max: 100_000, note: '💧 sức chứa bình nước', integer: true },
    'game.tree_default_target': { min: 1, max: 100_000, note: '💧 cần để thu hoạch cây mặc định', integer: true },
    'game.harvest_coupon_daily_cap': { min: 0, max: 100, note: 'số coupon thu hoạch mỗi ngày/người (0 = không phát)', integer: true },
    'game.streak_repair_window_hours': { min: 1, max: 720, note: 'số giờ được hồi sinh chuỗi sau khi mất', integer: true },
    'game.streak_repair_cooldown_days': { min: 0, max: 365, note: 'số ngày giữa hai lần hồi sinh chuỗi (0 = không chờ)', integer: true },
    'game.plot_unlock_seed_base': { min: 1, max: 100_000, note: '💧 mở lô đất (giá = số này × số thứ tự lô)', integer: true },
    'game.plot_target': { min: 1, max: 100_000, note: '💧 cần để thu hoạch cây ở lô phụ', integer: true },
    'seasonpass.checkin_xp': { min: 0, max: 1000, note: 'XP mỗi lần điểm danh', integer: true },
    'groupbuy.window_hours': { min: 1, max: 720, note: 'số giờ nhóm mua chung mở', integer: true },
    'notifications.zns_quiet_start_hour': { min: 0, max: 23, note: 'giờ VN bắt đầu giờ yên tĩnh của ZNS', integer: true },
    'notifications.zns_quiet_end_hour': { min: 0, max: 23, note: 'giờ VN kết thúc giờ yên tĩnh của ZNS', integer: true },
    'notifications.zns_promo_monthly_cap': { min: 0, max: 100, note: 'số tin ZNS khuyến mãi mỗi khách mỗi tháng (0 = không giới hạn)', integer: true },
    'remarketing.cart_abandon_min_hours': { min: 1, max: 720, note: 'số giờ giỏ bỏ quên trước khi nhắc', integer: true },
    'remarketing.cart_abandon_max_hours': { min: 1, max: 720, note: 'số giờ tối đa còn nhắc giỏ bỏ quên', integer: true },
    'remarketing.voucher_expiry_days': { min: 1, max: 60, note: 'số ngày báo trước voucher sắp hết hạn', integer: true },
    'reorder.default_cycle_days': { min: 1, max: 365, note: 'số ngày chu kỳ mua lại mặc định', integer: true },
    'reorder.remind_ratio': { min: 0.1, max: 1, note: 'phân số chu kỳ (0.8 = nhắc khi đã qua 80% chu kỳ)' },
    'attendance.radius_m': { min: 10, max: 5000, note: 'mét bán kính GPS được chấm công', integer: true },
    'attendance.late_grace_min': { min: 0, max: 240, note: 'số phút trễ được bỏ qua trước khi phạt', integer: true },
    'attendance.checkin_early_min': { min: 0, max: 720, note: 'số phút được chấm công sớm trước giờ vào ca', integer: true },
    'attendance.cancel_notice_days': { min: 0, max: 30, note: 'số ngày báo trước khi huỷ ca', integer: true },
    'attendance.emergency_cap_month': { min: 0, max: 31, note: 'số lần huỷ đột xuất miễn phạt mỗi tháng', integer: true },
    'attendance.heartbeat_stale_min': { min: 1, max: 240, note: 'số phút coi tín hiệu vị trí là cũ', integer: true },
    'attendance.out_of_range_max_count': { min: 1, max: 100, note: 'số nhịp ngoài vùng liên tiếp trước khi tự checkout', integer: true },
    'attendance.out_of_range_max_min': { min: 1, max: 1440, note: 'số phút ngoài vùng trước khi tự checkout', integer: true },
    // data-retention vẫn kẹp xuống sàn minDays (RETENTION_POLICY) khi đọc: ghi dưới sàn là "đã lưu" mà hệ thống giữ lâu hơn.
    'retention.analytics_events_days': { min: 90, max: 3650, note: 'số ngày giữ sự kiện phân tích (tối thiểu 90)', integer: true },
    'retention.notification_logs_days': { min: 30, max: 3650, note: 'số ngày giữ nhật ký thông báo (tối thiểu 30)', integer: true },
    'retention.webhook_events_days': { min: 14, max: 3650, note: 'số ngày giữ webhook (tối thiểu 14)', integer: true },
    'retention.refresh_sessions_days': { min: 7, max: 3650, note: 'số ngày giữ phiên đăng nhập đã hết hạn (tối thiểu 7)', integer: true },
    [CHAT_RETENTION_KEY]: { min: 90, max: 3650, note: 'số ngày giữ tin chat CSKH (tối thiểu 90)', integer: true },
    ...WASTE_RANGES,
  };

  /** Khoá mà null có nghĩa ("chưa đặt" — ETA giao hàng null = ẩn dòng "Giao dự kiến"): admin được đặt lại null. */
  private static readonly NULLABLE_KEYS = new Set(['shipping.eta_min_days', 'shipping.eta_max_days', CHAT_ORDER_EARN_PCT_KEY]);

  /** Bậc thưởng Season Pass tính bằng Điểm Xanh lớn nhất hợp lệ. */
  private static readonly SEASONPASS_POINTS_MAX = 100_000;
  /** Thưởng mốc giới thiệu lớn nhất hợp lệ. */
  private static readonly REFERRAL_MILESTONE_POINTS_MAX = 500_000;

  /**
   * Kiểm dạng cho khoá JSON có đơn vị tiền bên trong (RANGES chỉ kiểm số). Trả lời lỗi hoặc null.
   * PD-3: chặn ghi dạng xu cũ ({bonus} / type 'XU') hay giá trị xu dưới tên điểm.
   */
  private static readonly JSON_RULES: Record<string, (value: unknown) => string | null> = {
    // VietQR dựng từ hai khoá này: sai một ký tự là tiền khách chuyển vào tài khoản khác hoặc QR không quét được.
    'payment.bank_account_no': (value) =>
      typeof value === 'string' && /^\d{6,20}$/.test(value) ? null : 'phải là chuỗi 6–20 chữ số, không khoảng trắng',
    // Vai trò được ghi công đơn và hưởng hoa hồng CTV (affiliate.service createCommissionForOrder / findEligibleReferrer).
    [COMMISSION_ELIGIBLE_ROLES_KEY]: eligibleRolesProblem,
    // Chuỗi "false" là truthy ở chỗ đọc lỏng: chỉ nhận đúng boolean để khoá mua chịu quá hạn không bị tắt/bật nhầm.
    'dealer.block_credit_when_overdue': (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    [DEALER_BONUS_TIERS_KEY]: dealerBonusTiersProblem,
    // Cờ gian hàng: chuỗi "false" là truthy ở chỗ đọc lỏng, nên chỉ nhận đúng boolean.
    [STOREFRONT_REQUIRE_APPROVAL_KEY]: (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    [STOREFRONT_SUBDOMAIN_ENABLED_KEY]: (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    'payment.bank_bin': (value) =>
      typeof value === 'string' && /^\d{6}$/.test(value) ? null : 'phải là mã BIN Napas gồm đúng 6 chữ số (vd "970407")',
    // Trang chuyển khoản của khách và phiếu chi trả đối tác in nguyên hai dòng này: để trống là "Ngân hàng: " trống trơn.
    'payment.bank_name': (value) => displayNameProblem(value, 'tên ngân hàng, vd "Techcombank"'),
    'payment.bank_account_name': (value) => displayNameProblem(value, 'tên chủ tài khoản in hoa không dấu, vd "CONG TY TUBU TREE"'),
    // Chuỗi "false" là truthy ở chỗ đọc lỏng: chỉ nhận đúng boolean để cờ tắt không vô tình bật freeship đơn đầu.
    'shipping.first_order_free_enabled': (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    // Công tắc kiểm lệch tổng Pancake (PANCAKE_TOTAL_CHECK_KEY): chỉ `false` mới tắt, nên chuỗi "false" phải bị từ chối chứ không được lưu.
    // Nhóm hàng Pancake → danh mục Tubu (PancakeSyncService.mappedCategoryIds): sai dạng thì đồng bộ lặng lẽ không gán danh mục nào.
    [PANCAKE_CATEGORY_MAP_KEY]: categoryMapProblem,
    'pancake.total_mismatch_check': (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    // Cờ nạp đơn ngoài app: chuỗi "false" là truthy ở chỗ đọc lỏng, nên chỉ nhận đúng boolean.
    [EXTERNAL_CAPTURE_ENABLED_KEY]: (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    // Cờ tích điểm đơn sàn và hai cờ gọi Pancake: chuỗi "false" là truthy ở chỗ đọc lỏng nên chỉ nhận đúng boolean.
    [MARKETPLACE_CLAIM_ENABLED_KEY]: (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    // Chuỗi "false" là truthy ở chỗ đọc lỏng: chỉ nhận đúng boolean để chat không bật nhầm khi cầu nối chưa sẵn sàng.
    [CHAT_ENABLED_KEY]: (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    [CHAT_HOURS_KEY]: chatHoursProblem,
    [CHAT_OFF_HOURS_TEXT_KEY]: offHoursTextProblem,
    [CHAT_GROUP_KEY]: chatGroupIdProblem,
    // Hai cờ chat: chuỗi "false" là truthy ở chỗ đọc lỏng nên chỉ nhận đúng boolean (tắt yêu cầu vận đơn là mở cửa cho đơn giả).
    [CHAT_ORDER_POINTS_ENABLED_KEY]: (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    [CHAT_ORDER_REQUIRE_CARRIER_KEY]: (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    // Tỉ lệ tích đơn chat: null = dùng loyalty.earn_pct (tỉ lệ đơn trong app); có giá trị thì cùng khoảng với loyalty.earn_pct.
    [CHAT_ORDER_EARN_PCT_KEY]: (value) => (value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 20) ? null : 'phải là số phần trăm từ 0.1 đến 20 (2 = 2%) hoặc để trống để dùng tỉ lệ đơn trong app'),
    // Sai bản đồ nhân viên thì chặn tự duyệt/tự tích điểm lặng lẽ không hoạt động.
    [PANCAKE_STAFF_MAP_KEY]: staffMapProblem,
    [EXTERNAL_LOOKUP_ENABLED_KEY]: (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    [EXTERNAL_POLL_ENABLED_KEY]: (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    // Mốc bắt đầu tích điểm đơn sàn: để trống (null) = chỉ áp tuổi đơn tối đa; có giá trị thì phải là ngày hợp lệ.
    [EXTERNAL_SINCE_KEY]: (value) =>
      value === null || value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) ? null : 'phải là ngày dạng YYYY-MM-DD hoặc để trống',
    // Sai bản đồ nguồn thì mọi đơn sàn rơi xuống "chưa biết" mà không ai thấy lỗi.
    [ORDER_SOURCE_MAP_KEY]: orderSourceMapProblem,
    // Cờ bố cục Trang chủ cho khách mới: chỉ nhận boolean để chuỗi "false" không vô tình đổi thứ tự khối của mọi khách mới.
    'home.new_customer_layout': (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    // Cờ mở cho khách chưa đăng nhập xem trước bài cộng đồng: chỉ nhận boolean để chuỗi "false" không vô tình công khai bài của khách.
    'community.public_preview': (value) => (typeof value === 'boolean' ? null : 'phải là true hoặc false'),
    // Link kênh cộng đồng mở ra ngoài app qua webview: chỉ https và tên miền mạng xã hội đã duyệt.
    ...Object.fromEntries(COMMUNITY_LINK_KEYS.map((k) => [k, communityUrlProblem])),
    // Link nhận mã in trong QR thẻ hộp hàng và link chia sẻ của CTV dựng từ khoá này: sai là thẻ đã in mở ra trang lỗi.
    'app.miniapp_base_url': (value) =>
      value === '' || (typeof value === 'string' && /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(value))
        ? null
        : 'phải để trống hoặc là link https của Mini App, vd "https://zalo.me/s/<Mini App ID>" (ID Mini App, không phải App ID của Zalo App)',
    'shipping.tier_freeship_overrides': (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return 'phải là object { HẠNG: ngưỡng freeship (đồng) }';
      for (const [tier, threshold] of Object.entries(value as Record<string, unknown>)) {
        if (!Number.isInteger(threshold) || (threshold as number) < 0 || (threshold as number) > 50_000_000) {
          return `ngưỡng của hạng ${tier} phải là số đồng nguyên 0–50.000.000`;
        }
      }
      return null;
    },
    'subscribe.discount_tiers': (value) => {
      if (!Array.isArray(value)) return 'phải là mảng bậc [{ minActive, pct }]';
      for (const t of value as Record<string, unknown>[]) {
        if (!Number.isInteger(t?.minActive) || (t.minActive as number) < 1) return 'mỗi bậc cần minActive là số nguyên ≥ 1';
        if (typeof t.pct !== 'number' || !(t.pct >= 0 && t.pct <= 1)) return 'mỗi bậc cần pct là phân số 0–1 (0.12 = 12%)';
      }
      return null;
    },
    'referral.milestones_points': (value) => {
      if (!Array.isArray(value)) return 'phải là mảng [{ count, bonusPoints }]';
      const max = SystemConfigService.REFERRAL_MILESTONE_POINTS_MAX;
      for (const m of value as Record<string, unknown>[]) {
        const count = m?.count;
        const bonus = m?.bonusPoints;
        if (!Number.isInteger(count) || (count as number) < 1) return 'mỗi mốc cần count là số nguyên ≥ 1';
        if (!Number.isInteger(bonus) || (bonus as number) < 1 || (bonus as number) > max) {
          return `mỗi mốc cần bonusPoints là Điểm Xanh nguyên 1–${max} (không phải xu; trường cũ "bonus" không còn dùng)`;
        }
      }
      return null;
    },
    // Giải POINTS âm trừ điểm của khách trong lần quay trúng giải (GameService.creditPoints nhánh delta < 0). Mảng rỗng
    // hợp lệ: tắt vòng quay ("Vòng quay chưa cấu hình").
    'game.spin_prizes': (value) => {
      if (!Array.isArray(value)) return 'phải là mảng giải [{ id, name, weight, rewardType, value }]';
      for (const [i, prize] of value.entries()) {
        const problem = spinPrizeProblem(prize);
        if (problem) {
          const id = (prize as { id?: unknown } | null)?.id;
          return `giải thứ ${i + 1}${typeof id === 'string' ? ` ("${id}")` : ''}: ${problem}`;
        }
      }
      return null;
    },
    // Trang /chinh-sach/:loai của web in nguyên chuỗi này (markdown). Rỗng = dùng bản nháp mặc định của web.
    'legal.dieu-khoan': legalDocProblem,
    'legal.bao-mat': legalDocProblem,
    'legal.doi-tra': legalDocProblem,
    'legal.van-chuyen': legalDocProblem,
    // Cấp uy tín chỉ có 4 tên (Mầm, Cây non, Cây trưởng thành, Cổ thụ): thêm mốc thứ 5 thì cấp 5 hiện lại tên "Mầm", bớt mốc thì mất cấp.
    // Mốc đầu là 0 để bốn mốc ứng đúng cấp 1 đến 4, và các mốc tăng dần, nếu không cấp nhảy ngược khi điểm tăng.
    'community.rep_thresholds': (value) => {
      if (!Array.isArray(value) || value.length !== 4) return 'phải là mảng đúng 4 mốc điểm uy tín [0, a, b, c] cho cấp 1 đến 4';
      if (!value.every((n) => Number.isInteger(n) && n >= 0 && n <= 1_000_000)) return 'mỗi mốc phải là số nguyên 0–1.000.000';
      if (value[0] !== 0) return 'mốc đầu phải là 0 (ai cũng ít nhất cấp 1)';
      for (let i = 1; i < value.length; i++) {
        if ((value[i] as number) <= (value[i - 1] as number)) return 'các mốc phải tăng dần';
      }
      return null;
    },
    // Chỉ `seeds` được đọc (GameEconomyService.checkIn); `free_spins` có trong seed.ts nhưng không code nào dùng, nhận để bản seed không tự bị từ chối.
    'game.streak_7_bonus': (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return 'phải là object { seeds: 💧 thưởng chuỗi 7 ngày }';
      const { seeds, free_spins: freeSpins } = value as Record<string, unknown>;
      if (!Number.isInteger(seeds) || (seeds as number) < 0 || (seeds as number) > 10_000) return 'seeds phải là số 💧 nguyên 0–10.000';
      if (freeSpins !== undefined && (!Number.isInteger(freeSpins) || (freeSpins as number) < 0 || (freeSpins as number) > 100)) {
        return 'free_spins (nếu có) phải là số nguyên 0–100';
      }
      return null;
    },
    'community.banned_keywords': bannedKeywordsProblem,
    // Bảng kê đối soát giao hộ lọc đơn theo mốc này: mốc không có thật thì bảng kê tạm bỏ giới hạn, nên chặn ngay lúc ghi.
    'merchant.consignment_settle_from': (value) =>
      parseConsignmentSettleFrom(value)
        ? null
        : 'phải là thời điểm ISO 8601 có thật, vd "2026-10-14T00:00:00Z" (không ghi múi giờ thì hiểu là UTC)',
    'seasonpass.tiers': (value) => {
      if (!Array.isArray(value)) return 'phải là mảng bậc [{ xp, free, premium }]';
      const max = SystemConfigService.SEASONPASS_POINTS_MAX;
      for (const t of value as Record<string, unknown>[]) {
        if (!Number.isInteger(t?.xp) || (t.xp as number) < 0) return 'mỗi bậc cần xp là số nguyên ≥ 0';
        for (const track of ['free', 'premium'] as const) {
          const r = t[track] as { type?: unknown; amount?: unknown } | undefined;
          if (!r || (r.type !== 'SEEDS' && r.type !== 'POINTS')) return `${track}.type chỉ nhận SEEDS hoặc POINTS (XU đã gộp vào Điểm Xanh)`;
          if (!Number.isInteger(r.amount) || (r.amount as number) < 0) return `${track}.amount phải là số nguyên ≥ 0`;
          if (r.type === 'POINTS' && (r.amount as number) > max) return `${track}.amount POINTS tối đa ${formatPoints(max)} Điểm Xanh (không phải xu)`;
        }
      }
      return null;
    },
    ...WASTE_JSON_RULES,
  };

  /** Khoá có luật ghi riêng (biên số hoặc luật JSON): hệ thống biết khoá này, dù DB chưa có dòng. */
  static hasWriteRule(key: string): boolean {
    return key in SystemConfigService.RANGES || key in SystemConfigService.JSON_RULES;
  }

  static writeRuleKeys(): string[] {
    return [...Object.keys(SystemConfigService.RANGES), ...Object.keys(SystemConfigService.JSON_RULES)];
  }

  private assertInRange(key: string, value: unknown): void {
    const jsonRule = SystemConfigService.JSON_RULES[key];
    if (jsonRule) {
      const problem = jsonRule(value);
      if (problem) throw new BadRequestException(`"${key}" không hợp lệ: ${problem}.`);
      return;
    }
    const rule = SystemConfigService.RANGES[key];
    if (!rule) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException(`"${key}" phải là số — ${rule.note}.`);
    }
    if (rule.integer && !Number.isInteger(value)) {
      throw new BadRequestException(`"${key}" phải là số nguyên — ${rule.note}. Giá trị vừa nhập: ${value}.`);
    }
    if (value < rule.min || value > rule.max) {
      throw new BadRequestException(
        `"${key}" phải nằm trong khoảng ${rule.min}–${rule.max} — ${rule.note}. Giá trị vừa nhập: ${value}.`,
      );
    }
  }

  /** Mức mặc định hoa hồng không được vượt trần % mỗi biến thể: kiểm cả khi hạ trần xuống dưới mặc định đang áp. */
  private async assertRateCapsConsistent(key: string, value: unknown): Promise<void> {
    if (typeof value !== 'number') return;
    if (key === AFFILIATE_DEFAULT_RATE_KEY) {
      const max = sanitizeMaxRate(await this.get<unknown>(AFFILIATE_MAX_RATE_KEY, DEFAULT_AFFILIATE_MAX_RATE_PCT));
      if (value > max) {
        throw new BadRequestException(`"${key}" (${value}%) vượt trần ${max}% của "${AFFILIATE_MAX_RATE_KEY}". Nâng trần trước.`);
      }
    } else if (key === AFFILIATE_MAX_RATE_KEY) {
      const def = sanitizeDefaultRate(await this.get<unknown>(AFFILIATE_DEFAULT_RATE_KEY, DEFAULT_AFFILIATE_DEFAULT_RATE_PCT));
      if (value < def) {
        throw new BadRequestException(`"${key}" (${value}%) thấp hơn mức mặc định ${def}% của "${AFFILIATE_DEFAULT_RATE_KEY}". Hạ mức mặc định trước.`);
      }
    }
  }

  async set(key: string, value: object | string | number | boolean | null, changedBy: string): Promise<void> {
    const unset = value === null && SystemConfigService.NULLABLE_KEYS.has(key);
    if ((value === null && !unset) || value === undefined) {
      throw new BadRequestException(`Giá trị cho SystemConfig "${key}" không được null/undefined.`);
    }
    if (!unset) {
      this.assertInRange(key, value);
      await this.assertRateCapsConsistent(key, value);
    }
    const stored = unset ? Prisma.JsonNull : (value as object);
    const dotIndex = key.indexOf('.');
    const category = dotIndex > 0 ? key.slice(0, dotIndex) : 'misc';
    await this.prisma.$transaction(async (tx) => {
      // Đọc `existing` TRONG transaction (thay vì trước đó) để thu hẹp cửa sổ race: 2 admin sửa
      // cùng key gần như đồng thời trước đây có thể tạo 2 dòng history cùng oldValue (v1→v2 và
      // v1→v3), làm mất bản ghi v1→v2 thật sự đã xảy ra trong audit trail.
      const existing = await tx.systemConfig.findUnique({ where: { key } });
      if (existing) {
        // JSON null = khoá có dòng nhưng chưa đặt giá trị (seed ETA giao hàng): chưa có kiểu để giữ, và `typeof null`
        // là 'object' nên nếu không bỏ qua thì admin không bao giờ đặt được số đầu tiên.
        const wasUnset = existing.value === null;
        const oldType = Array.isArray(existing.value) ? 'array' : typeof existing.value;
        const newType = Array.isArray(value) ? 'array' : typeof value;
        if (!wasUnset && !unset && oldType !== newType) {
          throw new BadRequestException(
            `Kiểu dữ liệu mới ("${newType}") khác kiểu hiện tại ("${oldType}") của "${key}". ` +
              'Đổi kiểu có thể làm crash nơi khác đang dùng get<T>() với kiểu cũ. Nếu chắc chắn muốn đổi, xoá config này trước rồi tạo lại.',
          );
        }
        await tx.systemConfigHistory.create({
          data: {
            key,
            oldValue: wasUnset ? Prisma.JsonNull : (existing.value as object),
            newValue: stored,
            changedBy,
          },
        });
      }
      await tx.systemConfig.upsert({
        where: { key },
        update: { value: stored, updatedBy: changedBy },
        create: { key, value: stored, category, updatedBy: changedBy },
      });
      // Hàng "Tubu giao hộ" chốt phí sàn theo lúc đặt: gian hàng đang theo mặc định cần dòng lịch sử cho mức mới.
      if (key === MERCHANT_COMMISSION_KEY && typeof value === 'number') {
        await freezeDefaultCommissionChange(tx, commissionPctOf(existing?.value), value, new Date(), changedBy);
      }
    });
    this.cache.delete(key);
  }
}

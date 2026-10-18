/**
 * Seed dev DB:
 *  - SystemConfig: toàn bộ key từ Build Spec Section 15.2 (single source of truth).
 *  - MembershipTier: 4 hạng loyalty (Mầm Xanh → Cổ Thụ).
 *  - DealerTier: 4 bậc đại lý.
 * Catalog (~50 sản phẩm) sẽ seed từ Pancake ở Phase 1, không nằm ở đây.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { seedGameQuiz } from './seed-game-quiz';
import { assertPoints1dApplied } from './seed-reference';
import { configSeedUpsertArgs, type ConfigSeed } from '../src/modules/system-config/config-seed';
import { assertSeedAllowed } from '../src/modules/system-config/seed-guard';
import {
  COMMUNITY_CATEGORIES,
  communityCategoryUpsertArgs,
  retireCommunityCategoriesArgs,
} from '../src/modules/feed/community-categories-seed';
import { assertWasteConfigSeedRows } from '../src/modules/waste-exchange/waste-config.keys';
import { WASTE_SEED_GIFTS, WASTE_SEED_ITEMS, wasteGiftUpsertArgs, wasteItemUpsertArgs } from '../src/modules/waste-exchange/waste-seed-data';
import { COMMUNITY_GOAL_SEED, SEASON_SEED } from './reference-data/garden';

const prisma = new PrismaClient();

export const SYSTEM_CONFIGS: ConfigSeed[] = [
  // Loyalty
  { key: 'loyalty.earn_pct', value: 2, category: 'loyalty', description: 'Đơn đặt trong Mini App: tích 2% tiền hàng (sau giảm giá, không tính ship) thành Điểm Xanh, rồi nhân hệ số hạng. 1 điểm = 1đ' },
  { key: 'loyalty.vnd_per_point_redeem', value: 1, category: 'loyalty', description: '1 điểm = 1đ khi áp', createOnly: true },
  { key: 'loyalty.max_redeem_pct', value: 0.2, category: 'loyalty', description: 'Tối đa 20% giá trị đơn được trừ điểm' },
  { key: 'loyalty.point_expire_months', value: 12, category: 'loyalty', description: 'Điểm hết hạn sau 12 tháng' },
  { key: 'loyalty.point_expiry_reminder_days', value: 7, category: 'loyalty', description: 'Nhắc trước khi điểm hết hạn (số ngày)' },
  { key: 'loyalty.tier_grace_days', value: 30, category: 'loyalty', description: 'Grace period giữ hạng khi rớt' },
  // Điểm danh hằng ngày + tích điểm tại quầy (POS) — loyalty.service. createOnly: admin chỉnh rồi thì seed không reset.
  { key: 'loyalty.checkin_points', value: [1000, 1000, 1000, 1000, 1000, 1000, 2000], category: 'loyalty', description: 'Điểm Xanh điểm danh theo ngày 1..7 của vòng 7 ngày', createOnly: true },
  { key: 'loyalty.pos_credit_enabled', value: false, category: 'loyalty', description: 'Bật tích điểm tại quầy (POS) do nhân viên nhập', createOnly: true },
  { key: 'loyalty.pos_max_order_total', value: 5000000, category: 'loyalty', description: 'Giá trị hoá đơn tối đa (đ) mỗi lần tích điểm POS', createOnly: true },
  { key: 'loyalty.pos_staff_daily_points_cap', value: 3_000_000, category: 'loyalty', description: 'Tổng điểm tối đa một nhân viên được tích POS mỗi ngày', createOnly: true },
  { key: 'loyalty.pos_member_daily_points_cap', value: 1_000_000, category: 'loyalty', description: 'Tổng điểm POS tối đa một thành viên nhận mỗi ngày', createOnly: true },

  // Mã giảm giá tự động (VouchersService) — mặc định trùng đúng giá trị code dùng khi khoá chưa có, seed chỉ để
  // admin THẤY và sửa được ở tab Cấu hình. createOnly: deploy lại không reset giá trị admin đã chỉnh.
  { key: 'voucher.welcome_amount', value: 30000, category: 'voucher', description: 'Mã giảm giá chào mừng khách mới (đ)', createOnly: true },
  { key: 'voucher.welcome_min_order', value: 199000, category: 'voucher', description: 'Đơn tối thiểu (đ) để dùng mã giảm giá chào mừng', createOnly: true },
  { key: 'voucher.birthday_amount', value: 50000, category: 'voucher', description: 'Mã giảm giá sinh nhật mặc định (đ) cho hạng chưa có mức riêng (mức riêng theo hạng nằm ở bảng hạng thành viên)', createOnly: true },
  { key: 'voucher.winback_days', value: 60, category: 'voucher', description: 'Khách từng mua nhưng quá số ngày này chưa đặt lại thì nhận mã giảm giá quay lại', createOnly: true },
  { key: 'voucher.winback_amount', value: 50000, category: 'voucher', description: 'Mã giảm giá quay lại (đ)', createOnly: true },
  { key: 'coupon.staff_max_percent', value: 30, category: 'voucher', description: 'Mã giảm % do nhân viên (không phải quản trị viên) tạo hoặc sửa: mức giảm tối đa (%, số nguyên 1–100)', createOnly: true },
  { key: 'coupon.staff_max_amount_vnd', value: 100000, category: 'voucher', description: 'Mã do nhân viên tạo hoặc sửa: số tiền giảm tối đa (đ) của mã giảm tiền, và Giảm tối đa bắt buộc của mã giảm %', createOnly: true },
  { key: 'coupon.staff_max_usage', value: 1000, category: 'voucher', description: 'Mã do nhân viên tạo hoặc sửa: tổng lượt dùng tối đa của một mã (số nguyên 1–100.000)', createOnly: true },
  { key: 'coupon.staff_daily_budget_vnd', value: 10000000, category: 'voucher', description: 'Ngân sách mã của mỗi nhân viên trong một ngày (đ): tổng mức giảm tối đa × tổng lượt của mọi mã, lô người đó tạo trong ngày. 0 = nhân viên không tạo được mã', createOnly: true },
  {
    key: 'voucher.milestones',
    value: [
      { spend: 1000000, reward: 30000 },
      { spend: 3000000, reward: 100000 },
      { spend: 5000000, reward: 200000 },
    ],
    category: 'voucher',
    description: 'Mốc chi tiêu trong tháng (đ) → mã giảm giá tri ân (đ); khách nhận mốc cao nhất đạt được',
    createOnly: true,
  },

  // Affiliate
  { key: 'affiliate.hold_days', value: 10, category: 'affiliate', description: 'Hold ngày sau DELIVERED trước khi APPROVED' },
  // Q-31: cửa sổ ghi nhận "chạm" giới thiệu CTV (AffiliateService.recordTouch). createOnly: admin chỉnh rồi thì seed không reset.
  { key: 'affiliate.attribution_days', value: 7, category: 'affiliate', description: 'Số ngày giữ ghi nhận giới thiệu (chạm link CTV/nhãn) cho đơn đặt sau đó', createOnly: true },
  { key: 'affiliate.min_withdraw_bank', value: 50000, category: 'affiliate', description: 'Min rút STK' },

  // Cashback
  { key: 'cashback.merchant_user_share', value: 0.7, category: 'cashback', description: 'User nhận 70% commission' },
  { key: 'cashback.hold_days', value: 30, category: 'cashback', description: 'Hold sau khi AT confirm' },
  { key: 'cashback.click_rate_limit_seconds', value: 30, category: 'cashback', description: '1 click/merchant/user/30s' },
  { key: 'cashback.reconcile_lookback_days', value: 45, category: 'cashback', description: 'Reconcile cron kéo giao dịch từ provider trong N ngày gần nhất (phủ hold window + biên)' },

  // Rút Ví về ngân hàng: tối thiểu 100k, phí 3k (xu đã gộp vào Điểm Xanh, Ví không còn đổi sang xu).
  { key: 'wallet.withdraw_min', value: 100000, category: 'wallet', description: 'Rút Ví về ngân hàng tối thiểu' },
  { key: 'wallet.withdraw_fee', value: 3000, category: 'wallet', description: 'Phí chuyển khoản ngân hàng/lần' },
  // PD-3: thưởng giới thiệu bằng Điểm Xanh (khoá xu coins.* đã chết). createOnly: migration
  // pd3_points_config_keys chép giá trị DB cũ bằng CEIL(xu/1000); seed không đè.
  { key: 'referral.referrer_reward_points', value: 5000, category: 'referral', description: 'Điểm Xanh thưởng người giới thiệu khi bạn được mời có đơn thứ 2 giao thành công trong referral.window_days ngày (thu hồi nếu trả hàng; CTV không nhận)', createOnly: true },
  { key: 'referral.window_days', value: 30, category: 'referral', description: 'Đơn thứ 2 phải đặt trong số ngày này kể từ đơn đầu thì người mời mới được thưởng Điểm Xanh', createOnly: true },
  { key: 'referral.min_order_amount', value: 200000, category: 'referral', description: 'Chỉ đơn có tổng tiền từ mức này mới được tính là đơn đầu/đơn thứ 2 của chương trình giới thiệu', createOnly: true },
  // Q-17: liên hệ hiển thị ở trang Về Tubu Tree (GET /config/public). Để trống thì miniapp ẩn dòng đó.
  { key: 'support.hotline', value: '0899 149 229', category: 'support', description: 'Hotline CSKH hiển thị cho khách', createOnly: true },
  { key: 'support.email', value: 'tubutree@gmail.com', category: 'support', description: 'Email CSKH hiển thị cho khách', createOnly: true },
  { key: 'support.zalo_oa_name', value: '', category: 'support', description: 'Tên Zalo OA hiển thị cho khách (để trống khi chưa có OA)', createOnly: true },
  {
    key: 'referral.milestones_points',
    value: [
      { count: 3, bonusPoints: 20_000 },
      { count: 5, bonusPoints: 40_000 },
      { count: 10, bonusPoints: 100_000 },
    ],
    category: 'referral',
    description: 'Mốc số bạn giới thiệu thành công → thưởng thêm Điểm Xanh (1 lần/mốc)',
    createOnly: true,
  },
  // Thưởng cộng đồng bằng Điểm Xanh (PD-3, OQ-6): đăng bài 1 điểm ≤ 1/ngày, trả lời tắt (0), hay nhất 1 điểm ≤ 3/ngày.
  { key: 'community.post_reward_points', value: 1000, category: 'community', description: 'Điểm Xanh thưởng khi bài cộng đồng được đăng (0 = tắt)', createOnly: true },
  { key: 'community.daily_post_reward_cap', value: 1, category: 'community', description: 'Số bài được thưởng tối đa mỗi ngày/người', createOnly: true },
  { key: 'community.answer_reward_points', value: 0, category: 'community', description: 'Điểm Xanh thưởng người trả lời bài của người khác (0 = tắt)', createOnly: true },
  { key: 'community.daily_answer_reward_cap', value: 10, category: 'community', description: 'Số câu trả lời được thưởng tối đa mỗi ngày/người', createOnly: true },
  { key: 'community.best_answer_reward_points', value: 1000, category: 'community', description: 'Điểm Xanh thưởng câu trả lời được chọn hay nhất (0 = tắt)', createOnly: true },
  { key: 'community.zalo_group_url', value: '', category: 'community', description: 'Link nhóm Zalo cộng đồng (https://zalo.me/...), để trống = ẩn nút', createOnly: true },
  { key: 'community.facebook_url', value: '', category: 'community', description: 'Link fanpage Facebook (facebook.com hoặc fb.com), để trống = ẩn nút', createOnly: true },
  { key: 'community.tiktok_url', value: '', category: 'community', description: 'Link kênh TikTok (tiktok.com), để trống = ẩn nút', createOnly: true },
  { key: 'community.banned_keywords', value: ['lua dao', 'lua tien', 'casino', 'vay nong', 'vay lai', 'tin dung den', 'da cap', 'rua tien', 'hang nhai', 'khieu dam', 'sex', 'ma tuy', 'vu khi', 'lam bang gia', 'chiem doat tai san', 'ca do bong da', 'ca cuoc bong da', 'cá độ', 'cá cược', 'hàng giả', 'cờ bạc'], category: 'community', description: 'Từ/cụm từ cấm trong bài cộng đồng (khớp → bài chờ duyệt). Cụm không dấu khớp cả có dấu; cụm có dấu chỉ khớp khi gõ đúng dấu', createOnly: true },
  { key: 'community.daily_best_answer_cap', value: 3, category: 'community', description: 'Số lần được thưởng câu trả lời hay nhất tối đa mỗi ngày/người', createOnly: true },
  { key: 'community.author_notify_interval_minutes', value: 60, category: 'community', description: 'Gộp tin "bài của bạn có người thích/bình luận": tối đa 1 tin mỗi bài trong chừng này phút (0 = tắt tin)', createOnly: true },
  { key: 'community.unanswered_alert_hours', value: 24, category: 'community', description: 'Câu hỏi cộng đồng chưa ai trả lời quá chừng này giờ thì hiện ở "Việc cần xử lý" của CSKH', createOnly: true },
  // createOnly: migration 20261012120000_pd3_points_config_keys đã chép CEIL(game.tree_xu_price/1000) nếu DB có giá cũ.
  { key: 'game.tree_points_price', value: 50_000, category: 'game', description: 'Điểm Xanh cho 1 lượt góp quỹ trồng cây', createOnly: true },

  // Subscribe & Save — chiết khấu định kỳ theo thang bậc (kiểu Amazon).
  { key: 'subscribe.discount_pct', value: 0.12, category: 'subscribe', description: 'Chiết khấu cơ bản Subscribe & Save (fallback bậc minActive:1)' },
  { key: 'wishlist.price_drop_min_pct', value: 0.05, category: 'wishlist', description: 'Giảm dưới mức này (phân số, 0.05 = 5%) thì không báo user đã yêu thích sản phẩm' },
  { key: 'wishlist.price_drop_cooldown_days', value: 7, category: 'wishlist', description: 'Số ngày tối thiểu giữa hai thông báo giảm giá cùng sản phẩm cho một user (0 = tắt)' },
  { key: 'subscribe.stock_retry_days', value: 3, category: 'subscribe', description: 'Số đêm cron thử lại kỳ định kỳ khi hết hàng/lỗi tạm thời trước khi bỏ kỳ (0 = không thử lại)' },
  {
    key: 'subscribe.discount_tiers',
    value: [
      { minActive: 1, pct: 0.12 },
      { minActive: 3, pct: 0.14 },
      { minActive: 5, pct: 0.15 },
    ],
    category: 'subscribe',
    description: 'Chiết khấu Subscribe&Save theo số subscription đang chạy (chọn bậc cao nhất đạt)',
  },

  // Flash Sale
  { key: 'flashsale.default_per_user_limit', value: 5, category: 'flashsale', description: 'Giới hạn mua mặc định/user/item flash' },
  { key: 'flashsale.min_discount_pct', value: 0, category: 'flashsale', description: 'Mức giảm tối thiểu để tạo item flash (0 = tắt validate)' },
  { key: 'flashsale.max_discount_pct', value: 0.9, category: 'flashsale', description: 'Mức giảm tối đa của giá flash so với giá đang bán (phân số; 0.9 = giá flash ≥ 10% giá bán, 1 = không chặn)', createOnly: true },
  { key: 'flashsale.max_duration_days', value: 31, category: 'flashsale', description: 'Số ngày tối đa của một đợt flash sale', createOnly: true },

  // Orders — PendingPaymentExpiryCron. createOnly: không ghi đè giá trị admin đã chỉnh.
  { key: 'orders.pending_payment_ttl_hours', value: 24, category: 'orders', description: 'Đơn trả trước (khách lẻ/CTV) chờ thanh toán quá số giờ này thì tự huỷ (hoàn kho, coupon). Tối thiểu 1, tối đa 720; đơn đại lý dùng orders.dealer_pending_payment_ttl_hours', createOnly: true },
  // Gói p8-seller (createOnly): đối tác tự giao (D4), cách ly định danh gian hàng (SELLER-5), đơn đại lý trả trước (SELLER-7), thuế TNCN hoa hồng (SELLER-11).
  { key: 'merchant.default_shipping_fee', value: 30000, category: 'merchant', description: 'Phí giao một kiện của gian hàng đối tác tự giao khi gian hàng chưa đặt phí riêng (đồng)', createOnly: true },
  { key: 'merchant.commission_pct', value: 0.15, category: 'merchant', description: 'Phí sàn Tubu thu trên tiền hàng đơn đối tác tự giao khi gian hàng chưa có mức riêng (phân số, 0.15 = 15%)', createOnly: true },
  { key: 'merchant.settlement_hold_days', value: 7, category: 'merchant', description: 'Số ngày sau khi giao đơn đối tác mới đưa vào bảng kê đối soát (nên bằng hạn đổi/trả)', createOnly: true },
  { key: 'merchant.confirm_sla_hours', value: 24, category: 'merchant', description: 'Đối tác phải xác nhận đơn tự giao trong chừng này giờ, quá hạn thì nhắc và hiện ở trang quản trị', createOnly: true },
  { key: 'merchant.ship_sla_hours', value: 48, category: 'merchant', description: 'Đối tác phải gửi hàng (nhập mã vận đơn) trong chừng này giờ kể từ khi khách đặt', createOnly: true },
  { key: 'merchant.deliver_sla_days', value: 7, category: 'merchant', description: 'Đơn đối tác đang giao quá chừng này ngày chưa xác nhận đã giao thì hiện ở danh sách quá hạn', createOnly: true },
  { key: 'merchant.negative_payout_due_days', value: 7, category: 'merchant', description: 'Số ngày đối tác phải nộp lại Tubu khoản của phiếu đối soát âm (đơn COD đối tác đã tự thu tiền), tính từ ngày lập phiếu', createOnly: true },
  // Ngưỡng báo động sức khoẻ vận hành (PLATFORM-5, ops-health.service). createOnly: admin chỉnh rồi thì seed không reset.
  { key: 'ops.alert_unsynced_minutes', value: 30, category: 'ops', description: 'Đơn còn ở kho mà quá số phút này chưa lên Pancake thì tính là đơn kẹt', createOnly: true },
  { key: 'ops.alert_stuck_orders', value: 1, category: 'ops', description: 'Báo động khi số đơn kẹt chưa lên Pancake từ mức này trở lên', createOnly: true },
  { key: 'ops.alert_webhook_failed', value: 1, category: 'ops', description: 'Báo động khi số webhook Pancake/Gomdon lỗi chưa ai xử lý từ mức này trở lên', createOnly: true },
  { key: 'ops.alert_queue_failed_1h', value: 5, category: 'ops', description: 'Báo động khi một hàng đợi có từ chừng này job lỗi trong 1 giờ qua', createOnly: true },
  { key: 'ops.alert_repeat_hours', value: 6, category: 'ops', description: 'Sự cố chưa hết thì nhắc lại admin sau chừng này giờ', createOnly: true },
  { key: 'ops.alert_gomdon_backlog_minutes', value: 15, category: 'ops', description: 'Đơn thu gom đã thanh toán được mà quá số phút này chưa có vận đơn Gomdon thì báo động', createOnly: true },
  { key: 'storefront.identifier_cooldown_days', value: 90, category: 'storefront', description: 'Subdomain/tên miền gian hàng vừa đổi hoặc gỡ chỉ gian hàng khác dùng lại sau chừng này ngày', createOnly: true },
  { key: 'orders.dealer_pending_payment_ttl_hours', value: 72, category: 'orders', description: 'Đơn đại lý trả trước chờ chuyển khoản quá số giờ này thì tự huỷ (hoàn kho). Tối thiểu 1, tối đa 720', createOnly: true },
  { key: 'affiliate.pit_withhold_pct', value: 0.1, category: 'affiliate', description: 'Thuế TNCN khấu trừ khi trả hoa hồng CTV (phân số, 0.1 = 10%; 0 = tắt)', createOnly: true },
  { key: 'affiliate.pit_withhold_threshold', value: 2000000, category: 'affiliate', description: 'Lần rút hoa hồng từ số tiền này trở lên thì khấu trừ thuế TNCN (đồng)', createOnly: true },

  // Dealer
  { key: 'dealer.max_discount_pct', value: 0.45, category: 'dealer', description: 'Chiết khấu tối đa hard cap' },
  // Hạn gửi yêu cầu nhận thưởng mốc sau khi kỳ kết thúc (dealer.service). createOnly: không ghi đè giá trị admin.
  { key: 'dealer.reward_claim_grace_days', value: 30, category: 'dealer', description: 'Số ngày sau khi kỳ (quý/năm) kết thúc mà đại lý vẫn được gửi yêu cầu nhận thưởng mốc đã đạt trong kỳ đó', createOnly: true },

  // Game
  { key: 'game.streak_7_bonus', value: { seeds: 10, free_spins: 1 }, category: 'game', description: 'Bonus chuỗi 7 ngày' },
  { key: 'game.spin_buy_cost_points', value: 10_000, category: 'game', description: 'Điểm Xanh đổi 1 lượt quay' },
  { key: 'game.spin_buy_daily_limit', value: 5, category: 'game', description: 'Max mua lượt/ngày' },
  { key: 'game.quiz_daily_count', value: 5, category: 'game', description: 'Số quiz/ngày' },
  { key: 'game.daily_login_seeds', value: 10, category: 'game', description: '💧 khi mở app/check-in' },
  { key: 'game.tank_capacity', value: 500, category: 'game', description: 'Sức chứa bình nước (💧)' },
  { key: 'game.tree_default_target', value: 600, category: 'game', description: '💧 cần để thu hoạch cây mặc định' },
  { key: 'game.harvest_coupon_daily_cap', value: 3, category: 'game', description: 'Trần số coupon thu hoạch/ngày/user — chống farm nước→coupon (P0-1)' },
  { key: 'game.spin_voucher_min_order_multiplier', value: 6, category: 'game', description: 'Voucher trúng vòng quay dùng cho đơn từ (giá trị × hệ số này); 6 = như quà đổi điểm 50.000đ/300.000đ', createOnly: true },
  { key: 'game.harvest_coupon_min_order', value: 199000, category: 'game', description: 'Đơn tối thiểu (đ) để dùng coupon thu hoạch (lô nhà + lô phụ); không bao giờ thấp hơn giá trị coupon', createOnly: true },
  { key: 'game.dew_seeds', value: 15, category: 'game', description: '💧 giọt sương sáng/ngày' },
  { key: 'game.streak_freeze_cost', value: 80, category: 'game', description: '💧 mua 1 vé giữ lửa (streak-freeze)' },
  { key: 'game.streak_repair_cost', value: 150, category: 'game', description: 'Giá 💧 hồi sinh chuỗi đã mất' },
  { key: 'game.streak_repair_window_hours', value: 48, category: 'game', description: 'Cửa sổ (giờ) được hồi sinh sau khi mất chuỗi' },
  { key: 'game.streak_repair_cooldown_days', value: 30, category: 'game', description: 'Số ngày giữa 2 lần hồi sinh chuỗi' },
  { key: 'game.max_plots', value: 5, category: 'game', description: 'Số lô đất tối đa/user (gồm lô nhà)' },
  { key: 'game.plot_unlock_seed_base', value: 100, category: 'game', description: '💧 mở lô đất (giá = base × số thứ tự lô)' },
  { key: 'game.plot_target', value: 600, category: 'game', description: '💧 cần để thu hoạch 1 cây ở lô phụ' },
  { key: 'seasonpass.checkin_xp', value: 10, category: 'game', description: 'XP season pass mỗi lần điểm danh' },
  {
    key: 'seasonpass.tiers',
    value: [
      { xp: 30, free: { type: 'SEEDS', amount: 20 }, premium: { type: 'POINTS', amount: 5000 } },
      { xp: 70, free: { type: 'SEEDS', amount: 30 }, premium: { type: 'POINTS', amount: 8000 } },
      { xp: 120, free: { type: 'SEEDS', amount: 40 }, premium: { type: 'POINTS', amount: 12_000 } },
      { xp: 200, free: { type: 'SEEDS', amount: 60 }, premium: { type: 'POINTS', amount: 20_000 } },
      { xp: 300, free: { type: 'SEEDS', amount: 80 }, premium: { type: 'POINTS', amount: 30_000 } },
    ],
    category: 'game',
    description: 'Bậc Season Pass',
  },
  { key: 'groupbuy.discount_pct', value: 15, category: 'groupbuy', description: '% giảm giá khi mua chung đủ người' },
  { key: 'groupbuy.target_size', value: 3, category: 'groupbuy', description: 'Số người cần để nhóm mua chung thành công' },
  { key: 'groupbuy.window_hours', value: 48, category: 'groupbuy', description: 'Số giờ nhóm mua chung mở trước khi hết hạn' },
  { key: 'groupbuy.max_open_per_user', value: 3, category: 'groupbuy', description: 'Trần số nhóm mua chung OPEN cùng lúc/user — chống spam mở nhóm (P0-2)' },
  { key: 'refill.seeds_per_bottle', value: 50, category: 'refill', description: '💧 thưởng cho mỗi vỏ chai đổi' },
  { key: 'refill.monthly_cap_bottles', value: 20, category: 'refill', description: 'Trần số vỏ chai đổi được mỗi tháng/user (chống lạm dụng)' },
  { key: 'refill.pickup_address', value: '', category: 'refill', description: 'CŨ (dự phòng): địa chỉ điểm nhận vỏ. Quản lý điểm nhận ở Quản trị → Đổi vỏ chai → Điểm nhận vỏ; khoá này chỉ được đọc khi bảng đó chưa có điểm nào.' },
  { key: 'refill.pickup_hours', value: '', category: 'refill', description: 'CŨ (dự phòng): giờ mở cửa điểm nhận vỏ. Quản lý ở Quản trị → Đổi vỏ chai → Điểm nhận vỏ.' },
  { key: 'refill.pickup_phone', value: '', category: 'refill', description: 'CŨ (dự phòng): SĐT điểm nhận vỏ. Quản lý ở Quản trị → Đổi vỏ chai → Điểm nhận vỏ.' },
  { key: 'payment.bank_bin', value: '970407', category: 'payment', description: 'Mã ngân hàng Napas (BIN) nhận chuyển khoản — 970407 = Techcombank' },
  { key: 'payment.bank_account_no', value: '8386790906', category: 'payment', description: 'Số tài khoản nhận chuyển khoản (VietQR)' },
  { key: 'payment.bank_account_name', value: 'CONG TY TNHH TUBU TREE', category: 'payment', description: 'Tên chủ tài khoản (hiển thị; in hoa không dấu)' },
  { key: 'payment.bank_name', value: 'Ngân hàng TMCP Kỹ Thương Việt Nam', category: 'payment', description: 'Tên ngân hàng (hiển thị)' },
  {
    key: 'game.spin_prizes',
    value: [
      { id: 'p1', name: '5.000 điểm Xanh', weight: 30, rewardType: 'POINTS', value: 5000 },
      { id: 'p2', name: '10.000 điểm Xanh', weight: 22, rewardType: 'POINTS', value: 10_000 },
      { id: 'p3', name: '20.000 điểm Xanh', weight: 12, rewardType: 'POINTS', value: 20_000 },
      { id: 'p4', name: 'Voucher 20k', weight: 10, rewardType: 'COUPON', value: 20000 },
      { id: 'p5', name: '30 💧', weight: 15, rewardType: 'SEEDS', value: 30 },
      { id: 'p6', name: 'Voucher 50k', weight: 4, rewardType: 'COUPON', value: 50000 },
      { id: 'p7', name: '50.000 điểm Xanh', weight: 5, rewardType: 'POINTS', value: 50_000 },
      { id: 'p8', name: 'Chúc may mắn lần sau', weight: 2, rewardType: 'NONE', value: 0 },
    ],
    category: 'game',
    description: 'Bảng giải vòng quay + trọng số xác suất',
  },

  // Shipping
  { key: 'shipping.free_threshold', value: 200000, category: 'shipping', description: 'Đơn ≥ 200k được freeship' },
  { key: 'shipping.flat_fee_below_threshold', value: 19000, category: 'shipping', description: 'Phí cố định khi đơn < 200k' },
  // null = chưa đặt: app ẩn dòng "Giao dự kiến" thay vì hứa số ngày chủ shop chưa chốt. Khoá phải CÓ dòng để admin
  // bật được từ tab Cấu hình (tab chỉ liệt kê dòng đã tồn tại). createOnly: deploy lại không xoá số admin đã đặt.
  { key: 'shipping.eta_min_days', value: Prisma.JsonNull, category: 'shipping', description: 'Giao dự kiến: số ngày tối thiểu (0-60). Để null thì app ẩn dòng "Giao dự kiến"', createOnly: true },
  { key: 'shipping.eta_max_days', value: Prisma.JsonNull, category: 'shipping', description: 'Giao dự kiến: số ngày tối đa (0-60, không nhỏ hơn mức tối thiểu). Để null thì app ẩn dòng "Giao dự kiến"', createOnly: true },
  { key: 'shipping.tier_freeship_overrides', value: { LOC_BIEC: 99000, DAI_THU: 0, CO_THU: 0 }, category: 'shipping', description: 'Hạng được freeship trước ngưỡng' },
  // Gomdon (thu gom tái chế): createOnly — admin sửa kho/cân nặng/công tắc, deploy chạy lại seed KHÔNG
  // được reset. Tài khoản Gomdon (phone/password) KHÔNG nằm ở đây: đặt qua env GOMDON_PHONE/
  // GOMDON_PASSWORD (không lộ mật khẩu ở GET /admin/config + lịch sử config).
  {
    key: 'shipping.gomdon.config',
    value: {
      defaultWarehouse: {
        name: 'Fuwa3e Tubu HCM',
        phone: '0899149229',
        address: 'Golf Park, 1 đường số 2',
        ward: 'Phường Long Bình',
        district: 'Thành phố Thủ Đức',
        province: 'Thành phố Hồ Chí Minh',
      },
      defaultWeightFallback: 500,
    },
    category: 'shipping',
    description: 'Gomdon (đơn đổi hàng thu gom tái chế): kho lấy hàng + cân nặng mặc định (gram). Tài khoản đặt qua env GOMDON_PHONE/GOMDON_PASSWORD.',
    createOnly: true,
  },
  {
    key: 'shipping.gomdon.recycling_enabled',
    value: false,
    category: 'shipping',
    description: 'Bật lựa chọn "Gửi lại vật liệu tái chế" ở checkout (chỉ hiện khi Gomdon đã cấu hình env)',
    createOnly: true,
  },

  // Return
  // Khoá code đọc là 'returns.window_days' (orders.service + affiliate.service). Bản cũ seed nhầm
  // 'return.window_days' = 15 (không ai đọc) → hiệu lực thật luôn là mặc định 7, khớp chính sách đang
  // công bố trên app ("đổi/trả trong 7 ngày"). createOnly: admin chỉnh rồi thì seed không reset.
  { key: 'returns.window_days', value: 7, category: 'return', description: 'Số ngày từ khi giao (DELIVERED) được yêu cầu đổi/trả', createOnly: true },

  // Trang /chinh-sach/:loai của web (legal-config.controller). Rỗng = web dùng bản nháp mặc định "chờ duyệt"; admin dán nội
  // dung đã duyệt (markdown) vào đây là thay thế. createOnly: nội dung đã duyệt không bị seed ghi đè.
  { key: 'legal.dieu-khoan', value: '', category: 'legal', description: 'Nội dung trang Điều khoản sử dụng (markdown). Để trống = bản nháp mặc định', createOnly: true },
  { key: 'legal.bao-mat', value: '', category: 'legal', description: 'Nội dung trang Chính sách bảo mật (markdown). Để trống = bản nháp mặc định', createOnly: true },
  { key: 'legal.doi-tra', value: '', category: 'legal', description: 'Nội dung trang Chính sách đổi trả (markdown). Để trống = bản nháp mặc định', createOnly: true },
  { key: 'legal.van-chuyen', value: '', category: 'legal', description: 'Nội dung trang Chính sách vận chuyển (markdown). Để trống = bản nháp mặc định', createOnly: true },

  // Remarketing — nhắc giỏ bỏ quên + voucher sắp hết hạn (cron RemarketingService).
  { key: 'remarketing.cart_abandon_min_hours', value: 6, category: 'remarketing', description: 'Giỏ bỏ quên ít nhất N giờ mới nhắc' },
  { key: 'remarketing.cart_abandon_max_hours', value: 72, category: 'remarketing', description: 'Không nhắc giỏ cũ quá N giờ' },
  { key: 'remarketing.voucher_expiry_days', value: 3, category: 'remarketing', description: 'Nhắc voucher cá nhân sắp hết hạn trong N ngày tới' },

  // Reorder reminder (§6.14.7, cron LifecycleService.sendReorderReminders) — trước đây 2 số này
  // hardcode fallback 60/0.85 (≈51 ngày), TRỄ HƠN cửa sổ north-star "đơn thứ 2 trong 30 ngày".
  // createOnly: admin tự tinh chỉnh theo tốc độ tiêu dùng thật của ngành hàng — deploy lại KHÔNG
  // được reset về mặc định. Mặc định mới 30×0.8 = nhắc ở ngày 24, còn dư ~6 ngày để khách đặt lại
  // trước khi hết cửa sổ 30 ngày (thay vì trễ 21 ngày như trước).
  { key: 'reorder.default_cycle_days', value: 30, category: 'reorder', description: 'Số ngày chu kỳ tiêu dùng mặc định (mọi SKU) dùng để tính hạn nhắc mua lại', createOnly: true },
  { key: 'reorder.remind_ratio', value: 0.8, category: 'reorder', description: 'Tỉ lệ của chu kỳ tại đó gửi nhắc (0.8 × cycle_days = ngày nhắc)', createOnly: true },

  // Chấm công (Phase C) — nhập IP/toạ độ công ty thật qua hub/DB trước khi dùng.
  { key: 'attendance.office_ips', value: [], category: 'attendance', description: 'Danh sách IP/CIDR nội bộ được phép checkin' },
  // office_lat / office_lng: KHÔNG seed (để null mặc định) — admin nhập toạ độ thật qua config.
  { key: 'attendance.radius_m', value: 150, category: 'attendance', description: 'Bán kính GPS cho phép (m)' },
  { key: 'attendance.late_grace_min', value: 30, category: 'attendance', description: 'Trễ quá X phút thì phạt' },
  { key: 'attendance.checkin_early_min', value: 60, category: 'attendance', description: 'Cho checkin sớm nhất X phút trước giờ vào ca (chặn checkin vào ca của ngày khác)' },
  { key: 'attendance.late_fine', value: 10000, category: 'attendance', description: 'Tiền phạt đi trễ (VND)' },
  { key: 'attendance.cancel_notice_days', value: 3, category: 'attendance', description: 'Huỷ ca báo trước X ngày' },
  { key: 'attendance.emergency_cap_month', value: 3, category: 'attendance', description: 'Số lần huỷ đột xuất miễn phạt/tháng' },
  // CHƯA ĐƯỢC DÙNG: cron chỉ đóng phiên khi quá giờ hết ca, cố ý không cắt theo heartbeat (cất
  // điện thoại vào túi là bình thường, cắt theo heartbeat sẽ cắt nhầm về ~0 giờ công). Mô tả cũ
  // ghi "→ auto checkout" khiến admin tưởng đang bật chống gian lận.
  { key: 'attendance.heartbeat_stale_min', value: 10, category: 'attendance', description: 'Ngưỡng coi heartbeat là cũ (hiện CHƯA dùng để tự checkout)' },
  { key: 'attendance.enforce_ip', value: true, category: 'attendance', description: 'Bật kiểm IP (tắt nếu chưa có IP tĩnh)' },
  // C-056: GPS nhảy một nhịp không được tự chấm ra. createOnly: admin chỉnh theo độ ổn định GPS thực tế
  // của văn phòng, deploy lại không được reset.
  { key: 'attendance.out_of_range_max_count', value: 3, category: 'attendance', description: 'Tự checkout (OUT_OF_RANGE) sau X heartbeat ngoài vùng LIÊN TIẾP (miniapp gửi 3 phút/nhịp; tối thiểu 1)', createOnly: true },
  { key: 'attendance.out_of_range_max_min', value: 15, category: 'attendance', description: 'Hoặc tự checkout khi chuỗi ngoài vùng kéo dài quá X phút (heartbeat thưa vì app bị cất đi)', createOnly: true },
  // Job dọn log theo lô (data-retention.service.ts, C-046/Q-21). createOnly: admin chỉnh rồi thì seed không reset.
  { key: 'retention.analytics_events_days', value: 395, category: 'retention', description: 'Giữ analytics_events thô bao nhiêu ngày (13 tháng; sàn 90)', createOnly: true },
  { key: 'retention.notification_logs_days', value: 180, category: 'retention', description: 'Giữ notification_logs bao nhiêu ngày (sàn 30)', createOnly: true },
  { key: 'retention.webhook_events_days', value: 90, category: 'retention', description: 'Giữ log webhook Pancake/Gomdon/tin nhắn OA bao nhiêu ngày (sàn 14)', createOnly: true },
  { key: 'retention.refresh_sessions_days', value: 30, category: 'retention', description: 'Xoá refresh token đã thu hồi/hết hạn quá bao nhiêu ngày (sàn 7)', createOnly: true },
  { key: 'waste.enabled', value: false, category: 'waste', description: 'Cờ tổng của chương trình Đổi rác lấy quà, tắt thì khách không tạo được yêu cầu mới và bàn đại lý bị chặn, kho vẫn xử lý yêu cầu đã có.', createOnly: true },
  { key: 'waste.lane_dropoff_enabled', value: true, category: 'waste', description: 'Bật cách giao Mang tới điểm nhận cho yêu cầu mới.', createOnly: true },
  { key: 'waste.lane_mailin_enabled', value: true, category: 'waste', description: 'Bật cách giao Gửi về kho cho yêu cầu mới.', createOnly: true },
  { key: 'waste.lane_pickup_enabled', value: false, category: 'waste', description: 'Bật cách giao Thu kèm đơn cho yêu cầu mới, còn cần cờ Gomdon hiện có.', createOnly: true },
  { key: 'waste.mailin_min_points', value: 15_000, category: 'waste', description: 'Số Điểm Xanh tối thiểu của một gói gửi kho, không được lớn hơn trần điểm tháng của khách.', createOnly: true },
  { key: 'waste.pickup_min_points', value: 10_000, category: 'waste', description: 'Số Điểm Xanh tối thiểu của một gói thu kèm đơn, không được lớn hơn trần điểm tháng của khách.', createOnly: true },
  { key: 'waste.customer_monthly_cap_points', value: 60_000, category: 'waste', description: 'Trần Điểm Xanh mỗi khách được cộng từ đổi rác trong một tháng.', createOnly: true },
  { key: 'waste.max_open_requests', value: 3, category: 'waste', description: 'Số yêu cầu đổi rác một khách được mở cùng lúc.', createOnly: true },
  { key: 'waste.request_hold_days', value: 7, category: 'waste', description: 'Số ngày giữ chỗ một yêu cầu và chờ khách nhập mã vận đơn.', createOnly: true },
  { key: 'waste.pickup_wait_days', value: 14, category: 'waste', description: 'Số ngày chờ hàng thu kèm về kho sau khi đơn mua đã giao.', createOnly: true },
  { key: 'waste.in_transit_review_days', value: 30, category: 'waste', description: 'Yêu cầu gửi kho đang vận chuyển quá ngần này ngày thì vào danh sách admin xem lại.', createOnly: true },
  { key: 'waste.mailin_max_weight_kg', value: 20, category: 'waste', description: 'Khối lượng tối đa của mỗi kiện gửi kho, tính bằng kg, theo giới hạn của hãng chuyển phát.', createOnly: true },
  { key: 'waste.mailin_max_edge_cm', value: 50, category: 'waste', description: 'Cạnh dài tối đa của mỗi kiện gửi kho, tính bằng cm.', createOnly: true },
  { key: 'waste.shortfall_lock_pct', value: 50, category: 'waste', description: 'Yêu cầu hoàn tất mà điểm cộng chưa tới (100 trừ ngần này) phần trăm điểm ước tính thì tính là một lần nhận thiếu.', createOnly: true },
  { key: 'waste.shortfall_lock_streak', value: 3, category: 'waste', description: 'Số lần nhận thiếu liền nhau thì khoá đường gửi kho và thu kèm đơn của khách.', createOnly: true },
  { key: 'waste.staff_daily_cap_points', value: 1_000_000, category: 'waste', description: 'Trần Điểm Xanh mỗi nhân viên kho hoặc điểm nhận được xác nhận trong một ngày.', createOnly: true },
  { key: 'waste.gift_claim_days', value: 60, category: 'waste', description: 'Số ngày khách được nhận quà bằng mã, quá hạn thì lượt đổi vào danh sách admin xem lại.', createOnly: true },
  { key: 'waste.point_inactive_days', value: 60, category: 'waste', description: 'Điểm nhận đối tác không có lượt xác nhận nào quá ngần này ngày kể từ lần xác nhận cuối hoặc lần kích hoạt thì bị ẩn khỏi danh sách khách.', createOnly: true },
  { key: 'waste.mailin_fee_table', value: { zones: [], defaultZone: { name: 'Toàn quốc', low: 30_000, high: 85_000 } }, category: 'waste', description: 'Bảng ước tính phí ship gửi kho theo vùng tỉnh, mỗi vùng có phí thấp và phí cao, cộng một vùng mặc định cho tỉnh chưa xếp.', createOnly: true },
  { key: 'waste.alert_thresholds', value: { quotaPacePct: 60, quotaPaceDays: 10, fullMatchPct: 95, fullMatchMinSample: 10, repeatCustomerCount: 3, repeatCustomerDays: 7, avgUnitsFactor: 2, lookupMissCount: 10, lookupMissDays: 1, staffDirectCount: 5, staffDirectDays: 7 }, category: 'waste', description: 'Ngưỡng cảnh báo bất thường về điểm nhận và người xác nhận, chỉ để admin xem, không tự khoá ai.', createOnly: true },
  { key: 'waste.rules_text', value: '', category: 'waste', description: 'Thể lệ công khai của chương trình, tối đa 8000 ký tự, để trống thì mục Thể lệ hiện ghi chú sắp có.', createOnly: true },
];
assertWasteConfigSeedRows(SYSTEM_CONFIGS);

export const TIERS = [
  {
    id: 'MAM_XANH',
    name: 'Mầm Xanh',
    minPoints: 0,
    minSpending: null,
    pointMultiplier: new Prisma.Decimal(1),
    discountPct: new Prisma.Decimal(0),
    perks: ['Tích Điểm Xanh x1'],
    birthdayVoucherAmount: null,
    sortOrder: 0,
  },
  {
    id: 'LOC_BIEC',
    name: 'Lộc Biếc',
    minPoints: 30_000,
    minSpending: 1_500_000,
    pointMultiplier: new Prisma.Decimal(1.2),
    discountPct: new Prisma.Decimal(0),
    perks: ['Tích Điểm Xanh x1.2', 'Freeship đơn ≥ 99k', 'Mã giảm giá sinh nhật 50k'],
    birthdayVoucherAmount: 50000,
    sortOrder: 1,
  },
  {
    id: 'DAI_THU',
    name: 'Đại Thụ',
    minPoints: 400_000,
    minSpending: 20000000,
    pointMultiplier: new Prisma.Decimal(1.5),
    discountPct: new Prisma.Decimal(0),
    perks: ['Tích Điểm Xanh x1.5', 'Freeship toàn shop', 'Mã giảm giá sinh nhật 150k'],
    birthdayVoucherAmount: 150000,
    sortOrder: 2,
  },
  {
    id: 'CO_THU',
    name: 'Cổ Thụ',
    minPoints: 1_000_000,
    minSpending: 50000000,
    pointMultiplier: new Prisma.Decimal(2),
    discountPct: new Prisma.Decimal(0.05),
    perks: ['Tích Điểm Xanh x2', 'Freeship + giảm 5% mọi đơn', 'Mã giảm giá sinh nhật 300k'],
    birthdayVoucherAmount: 300000,
    sortOrder: 3,
  },
];

export const DEALER_TIERS = [
  { id: 'DEALER_1', name: 'Đại lý Cấp 1', minOrderVolume: 10000000, discountRules: { default: 0.2 }, creditLimit: 0, paymentTerms: 'PREPAID' },
  { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30000000, discountRules: { default: 0.3 }, creditLimit: 20000000, paymentTerms: 'NET 15' },
  { id: 'DEALER_3', name: 'Đại lý Cấp 3', minOrderVolume: 80000000, discountRules: { default: 0.38 }, creditLimit: 50000000, paymentTerms: 'NET 30' },
  { id: 'DEALER_VIP', name: 'Đại lý VIP', minOrderVolume: 200000000, discountRules: { default: 0.45 }, creditLimit: 150000000, paymentTerms: 'NET 30' },
];

const CATEGORIES = [
  { id: 'cat-skincare', name: 'Mỹ phẩm thiên nhiên', slug: 'my-pham-thien-nhien', sortOrder: 1 },
  { id: 'cat-cleaning', name: 'Tẩy rửa sinh học', slug: 'tay-rua-sinh-hoc', sortOrder: 2 },
  { id: 'cat-baby', name: 'Cho bé', slug: 'cho-be', sortOrder: 3 },
  { id: 'cat-mom', name: 'Cho mẹ bầu', slug: 'cho-me-bau', sortOrder: 4 },
  { id: 'cat-personal', name: 'Chăm sóc cá nhân', slug: 'cham-soc-ca-nhan', sortOrder: 5 },
  { id: 'cat-coffee', name: 'Cà phê & Đồ uống', slug: 'ca-phe-do-uong', sortOrder: 6 },
  { id: 'cat-food', name: 'Nông sản & Thực phẩm', slug: 'nong-san-thuc-pham', sortOrder: 7 },
];

type SeedProduct = {
  id: string;
  brand: string;
  slug: string;
  name: string;
  shortDesc: string;
  basePrice: number;
  salePrice?: number;
  categoryIds: string[];
  forSegment: string[];
  certifications: string[];
  isFeatured?: boolean;
  ingredients?: { name: string; percentage?: string; benefit: string }[];
  variations: { sku: string; name: string; attributes: Record<string, string>; retailPrice: number; salePrice?: number; stock: number; weight: number }[];
};

// Catalog mẫu đa thương hiệu (8 brand đại diện hệ sinh thái tubutree.com): Visante, Pơ Lang,
// Fuwa3e, Cobote, Le Plateau Coffee, BH.Nong, Sokfram, Hector. KHÔNG dùng ảnh demo picsum
// (trông giả/rẻ tiền) — để rỗng cho FE hiện placeholder lá; Pancake sync ghi đè ảnh THẬT khi có.
// ≥40 SP để demo "đa thương hiệu".
const PRODUCTS: SeedProduct[] = [
  // ── Visante — mỹ phẩm thiên nhiên ─────────────────────────────
  {
    id: 'p-visante-serum', brand: 'Visante', slug: 'serum-duong-am-visante', name: 'Serum dưỡng ẩm Visante',
    shortDesc: 'Cấp ẩm chuyên sâu chiết xuất rau má.', basePrice: 320000, salePrice: 289000, categoryIds: ['cat-skincare'],
    forSegment: ['sensitive_skin', 'skincare'], certifications: ['USDA Organic', 'Vegan'], isFeatured: true,
    ingredients: [
      { name: 'Chiết xuất rau má', percentage: '5%', benefit: 'Phục hồi, làm dịu da nhạy cảm' },
      { name: 'Hyaluronic Acid', percentage: '2%', benefit: 'Cấp ẩm sâu, căng mịn' },
      { name: 'Chiết xuất lô hội', benefit: 'Làm dịu, chống kích ứng' },
    ],
    variations: [
      { sku: 'VIS-SR-30', name: '30ml', attributes: { size: '30ml' }, retailPrice: 320000, salePrice: 289000, stock: 60, weight: 90 },
      { sku: 'VIS-SR-50', name: '50ml', attributes: { size: '50ml' }, retailPrice: 460000, stock: 30, weight: 130 },
    ],
  },
  {
    id: 'p-visante-cream', brand: 'Visante', slug: 'kem-duong-ba-bau-visante', name: 'Kem dưỡng cho mẹ bầu Visante',
    shortDesc: 'Ngừa rạn da, lành tính cho thai kỳ.', basePrice: 290000, categoryIds: ['cat-mom'],
    forSegment: ['mom_baby'], certifications: ['USDA Organic'],
    ingredients: [
      { name: 'Bơ hạt mỡ (Shea)', percentage: '8%', benefit: 'Tăng đàn hồi, ngừa rạn da' },
      { name: 'Dầu jojoba', benefit: 'Dưỡng ẩm sâu, thẩm thấu nhanh' },
    ],
    variations: [
      { sku: 'VIS-CR-100', name: '100ml', attributes: { size: '100ml' }, retailPrice: 290000, stock: 45, weight: 160 },
    ],
  },
  {
    id: 'p-visante-cleanser', brand: 'Visante', slug: 'nuoc-tay-trang-rau-ma-visante', name: 'Nước tẩy trang rau má Visante',
    shortDesc: 'Làm sạch dịu nhẹ, không lưu cồn.', basePrice: 180000, salePrice: 155000, categoryIds: ['cat-skincare'],
    forSegment: ['sensitive_skin', 'skincare'], certifications: ['Vegan'], isFeatured: true,
    variations: [{ sku: 'VIS-CL-300', name: '300ml', attributes: { size: '300ml' }, retailPrice: 180000, salePrice: 155000, stock: 110, weight: 330 }],
  },
  {
    id: 'p-visante-sunscreen', brand: 'Visante', slug: 'kem-chong-nang-khoang-visante', name: 'Kem chống nắng khoáng Visante SPF50',
    shortDesc: 'Chống nắng vật lý, không gây bí da.', basePrice: 345000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Reef-safe'],
    variations: [{ sku: 'VIS-SUN-50', name: '50ml', attributes: { size: '50ml', spf: 'SPF50+' }, retailPrice: 345000, stock: 70, weight: 95 }],
  },
  {
    id: 'p-visante-mask', brand: 'Visante', slug: 'mat-na-rau-ma-visante', name: 'Mặt nạ rau má phục hồi Visante',
    shortDesc: 'Làm dịu da sau nắng, cấp ẩm tức thì.', basePrice: 25000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'VIS-MASK-1', name: '1 miếng', attributes: { type: 'sheet' }, retailPrice: 25000, stock: 400, weight: 30 }],
  },
  {
    id: 'p-visante-lipbalm', brand: 'Visante', slug: 'son-duong-gac-visante', name: 'Son dưỡng gấc Visante',
    shortDesc: 'Dưỡng môi mềm mịn từ tinh dầu gấc.', basePrice: 95000, salePrice: 79000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'VIS-LIP-4', name: '4g', attributes: { size: '4g' }, retailPrice: 95000, salePrice: 79000, stock: 180, weight: 20 }],
  },

  // ── Pơ Lang — dược liệu Tây Nguyên ───────────────────────────
  {
    id: 'p-polang-shampoo', brand: 'Pơ Lang', slug: 'dau-goi-buoi-po-lang', name: 'Dầu gội bưởi Pơ Lang',
    shortDesc: 'Dầu gội thảo dược tinh dầu bưởi, giảm rụng tóc.', basePrice: 165000, categoryIds: ['cat-skincare', 'cat-personal'],
    forSegment: ['sensitive_skin', 'skincare'], certifications: ['Vegan'], isFeatured: true,
    ingredients: [
      { name: 'Tinh dầu bưởi', percentage: '2%', benefit: 'Kích thích mọc tóc, giảm gãy rụng' },
      { name: 'Bồ kết', benefit: 'Làm sạch dịu nhẹ, sạch gàu tự nhiên' },
      { name: 'Hương nhu', benefit: 'Thư giãn da đầu, mượt tóc' },
    ],
    variations: [
      { sku: 'POLANG-SP-300', name: '300ml', attributes: { size: '300ml' }, retailPrice: 165000, stock: 120, weight: 350 },
      { sku: 'POLANG-SP-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 245000, salePrice: 219000, stock: 80, weight: 560 },
    ],
  },
  {
    id: 'p-polang-bodywash', brand: 'Pơ Lang', slug: 'sua-tam-sa-po-lang', name: 'Sữa tắm sả chanh Pơ Lang',
    shortDesc: 'Hương sả chanh thư giãn, dưỡng ẩm.', basePrice: 175000, categoryIds: ['cat-skincare', 'cat-personal'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'POLANG-BW-500', name: '500ml', attributes: { size: '500ml', scent: 'sả chanh' }, retailPrice: 175000, stock: 90, weight: 560 }],
  },
  {
    id: 'p-polang-ginger', brand: 'Pơ Lang', slug: 'dau-gung-po-lang', name: 'Dầu gừng massage Pơ Lang',
    shortDesc: 'Làm ấm, thư giãn cơ sau ngày dài.', basePrice: 135000, salePrice: 115000, categoryIds: ['cat-personal'],
    forSegment: ['eco'], certifications: ['Handmade'], isFeatured: true,
    variations: [{ sku: 'POLANG-GG-100', name: '100ml', attributes: { size: '100ml' }, retailPrice: 135000, salePrice: 115000, stock: 140, weight: 150 }],
  },
  {
    id: 'p-polang-lemongrass', brand: 'Pơ Lang', slug: 'tinh-dau-sa-chanh-po-lang', name: 'Tinh dầu sả chanh Pơ Lang',
    shortDesc: 'Đuổi muỗi, khử mùi, thư giãn không gian.', basePrice: 110000, categoryIds: ['cat-personal'],
    forSegment: ['eco', 'home_clean'], certifications: ['Nguyên chất'],
    variations: [{ sku: 'POLANG-LG-10', name: '10ml', attributes: { size: '10ml' }, retailPrice: 110000, stock: 220, weight: 40 }],
  },
  {
    id: 'p-polang-facemist', brand: 'Pơ Lang', slug: 'xit-khoang-hoa-hong-po-lang', name: 'Xịt khoáng hoa hồng Pơ Lang',
    shortDesc: 'Cấp ẩm tức thì, làm dịu da căng thẳng.', basePrice: 145000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'POLANG-FM-150', name: '150ml', attributes: { size: '150ml' }, retailPrice: 145000, stock: 95, weight: 200 }],
  },

  // ── Fuwa3e — tẩy rửa sinh học ────────────────────────────────
  {
    id: 'p-fuwa-dishwash', brand: 'Fuwa3e', slug: 'nuoc-rua-chen-fuwa3e', name: 'Nước rửa chén sinh học Fuwa3e',
    shortDesc: 'Lên men enzyme dứa, an toàn cho da tay.', basePrice: 120000, categoryIds: ['cat-cleaning'],
    forSegment: ['home_clean'], certifications: ['Eco'], isFeatured: true,
    ingredients: [
      { name: 'Enzyme dứa lên men', percentage: '15%', benefit: 'Phân giải dầu mỡ, không hại da tay' },
      { name: 'Tinh dầu sả', benefit: 'Khử mùi tanh, kháng khuẩn tự nhiên' },
      { name: 'Nước cất', benefit: 'Dung môi an toàn, phân huỷ sinh học' },
    ],
    variations: [
      { sku: 'FUWA-DW-1L', name: '1L', attributes: { size: '1L' }, retailPrice: 120000, stock: 200, weight: 1050 },
      { sku: 'FUWA-DW-5L', name: 'Can 5L', attributes: { size: '5L' }, retailPrice: 480000, salePrice: 430000, stock: 40, weight: 5200 },
    ],
  },
  {
    id: 'p-fuwa-laundry', brand: 'Fuwa3e', slug: 'nuoc-giat-fuwa3e', name: 'Nước giặt sinh học Fuwa3e',
    shortDesc: 'Sạch sâu, dịu nhẹ cho đồ em bé.', basePrice: 210000, categoryIds: ['cat-cleaning', 'cat-baby'],
    forSegment: ['mom_baby', 'home_clean'], certifications: ['Eco'], isFeatured: true,
    variations: [{ sku: 'FUWA-LD-2L', name: '2L', attributes: { size: '2L' }, retailPrice: 210000, stock: 150, weight: 2100 }],
  },
  {
    id: 'p-fuwa-floor', brand: 'Fuwa3e', slug: 'nuoc-lau-san-fuwa3e', name: 'Nước lau sàn enzyme Fuwa3e',
    shortDesc: 'Sàn sạch bóng, hương thảo mộc dịu.', basePrice: 165000, salePrice: 139000, categoryIds: ['cat-cleaning'],
    forSegment: ['home_clean'], certifications: ['Eco'],
    variations: [{ sku: 'FUWA-FL-2L', name: '2L', attributes: { size: '2L' }, retailPrice: 165000, salePrice: 139000, stock: 120, weight: 2100 }],
  },
  {
    id: 'p-fuwa-handwash', brand: 'Fuwa3e', slug: 'nuoc-rua-tay-fuwa3e', name: 'Nước rửa tay sinh học Fuwa3e',
    shortDesc: 'Sạch khuẩn dịu nhẹ, dưỡng ẩm da tay.', basePrice: 89000, categoryIds: ['cat-cleaning'],
    forSegment: ['home_clean', 'mom_baby'], certifications: ['Eco'],
    variations: [{ sku: 'FUWA-HW-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 89000, stock: 260, weight: 540 }],
  },
  {
    id: 'p-fuwa-bottle', brand: 'Fuwa3e', slug: 'nuoc-rua-binh-sua-fuwa3e', name: 'Nước rửa bình sữa Fuwa3e',
    shortDesc: 'An toàn cho bé, sạch cặn sữa, không mùi.', basePrice: 135000, categoryIds: ['cat-cleaning', 'cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Eco', 'Food-grade'],
    variations: [{ sku: 'FUWA-BT-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 135000, stock: 130, weight: 540 }],
  },

  // ── Cobote — chăm sóc cho bé ─────────────────────────────────
  {
    id: 'p-cobote-tram', brand: 'Cobote', slug: 'dau-tram-be-cobote', name: 'Dầu tràm cho bé Cobote',
    shortDesc: 'Giữ ấm, phòng ho cảm cho bé sơ sinh.', basePrice: 89000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Nguyên chất'], isFeatured: true,
    ingredients: [{ name: 'Tinh dầu tràm Huế', percentage: '100%', benefit: 'Giữ ấm, kháng khuẩn đường hô hấp' }],
    variations: [{ sku: 'COBOTE-TR-50', name: '50ml', attributes: { size: '50ml' }, retailPrice: 89000, stock: 300, weight: 80 }],
  },
  {
    id: 'p-cobote-wash', brand: 'Cobote', slug: 'nuoc-tam-goi-be-cobote', name: 'Nước tắm gội thảo dược cho bé Cobote',
    shortDesc: 'Tắm gội 2 trong 1, không cay mắt bé.', basePrice: 155000, salePrice: 132000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Vegan'],
    variations: [{ sku: 'COBOTE-WS-250', name: '250ml', attributes: { size: '250ml' }, retailPrice: 155000, salePrice: 132000, stock: 110, weight: 290 }],
  },
  {
    id: 'p-cobote-powder', brand: 'Cobote', slug: 'phan-rom-thao-duoc-cobote', name: 'Phấn rôm thảo dược Cobote',
    shortDesc: 'Hút ẩm, ngừa hăm, không bột talc.', basePrice: 79000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Talc-free'],
    variations: [{ sku: 'COBOTE-PW-100', name: '100g', attributes: { size: '100g' }, retailPrice: 79000, stock: 160, weight: 130 }],
  },
  {
    id: 'p-cobote-diapercream', brand: 'Cobote', slug: 'kem-chong-ham-cobote', name: 'Kem chống hăm Cobote',
    shortDesc: 'Làm dịu, phục hồi vùng da hăm của bé.', basePrice: 119000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Vegan'],
    variations: [{ sku: 'COBOTE-DC-50', name: '50g', attributes: { size: '50g' }, retailPrice: 119000, stock: 140, weight: 70 }],
  },

  // ── Le Plateau Coffee — cà phê đặc sản ───────────────────────
  {
    id: 'p-leplateau-arabica', brand: 'Le Plateau Coffee', slug: 'arabica-cau-dat-le-plateau', name: 'Cà phê Arabica Cầu Đất Le Plateau',
    shortDesc: 'Hạt rang specialty, hậu vị trái cây, chua thanh.', basePrice: 185000, categoryIds: ['cat-coffee', 'cat-food'],
    forSegment: ['eco'], certifications: ['Specialty', 'Rainforest Alliance'], isFeatured: true,
    ingredients: [{ name: 'Arabica Cầu Đất 1.650m', percentage: '100%', benefit: 'Hương hoa, hậu vị cam quýt' }],
    variations: [
      { sku: 'LP-ARA-250', name: '250g · nguyên hạt', attributes: { weight: '250g', grind: 'nguyên hạt' }, retailPrice: 185000, stock: 90, weight: 270 },
      { sku: 'LP-ARA-250-F', name: '250g · xay pha phin', attributes: { weight: '250g', grind: 'pha phin' }, retailPrice: 185000, stock: 70, weight: 270 },
    ],
  },
  {
    id: 'p-leplateau-robusta', brand: 'Le Plateau Coffee', slug: 'robusta-honey-le-plateau', name: 'Cà phê Robusta Honey Le Plateau',
    shortDesc: 'Sơ chế honey, đậm vị, ít đắng gắt.', basePrice: 145000, salePrice: 125000, categoryIds: ['cat-coffee', 'cat-food'],
    forSegment: ['eco'], certifications: ['Honey process'], isFeatured: true,
    variations: [{ sku: 'LP-ROB-250', name: '250g', attributes: { weight: '250g' }, retailPrice: 145000, salePrice: 125000, stock: 120, weight: 270 }],
  },
  {
    id: 'p-leplateau-drip', brand: 'Le Plateau Coffee', slug: 'ca-phe-phin-giay-le-plateau', name: 'Cà phê phin giấy Le Plateau (hộp 10)',
    shortDesc: 'Pha nhanh tại bàn, tiện mang đi.', basePrice: 95000, categoryIds: ['cat-coffee'],
    forSegment: ['eco'], certifications: [],
    variations: [{ sku: 'LP-DRIP-10', name: 'Hộp 10 gói', attributes: { count: '10' }, retailPrice: 95000, stock: 200, weight: 130 }],
  },
  {
    id: 'p-leplateau-coldbrew', brand: 'Le Plateau Coffee', slug: 'cold-brew-tui-loc-le-plateau', name: 'Cold Brew túi lọc Le Plateau',
    shortDesc: 'Ủ lạnh 12h, ngọt dịu, ít axit.', basePrice: 120000, categoryIds: ['cat-coffee'],
    forSegment: ['eco'], certifications: [],
    variations: [{ sku: 'LP-CB-5', name: 'Hộp 5 túi', attributes: { count: '5' }, retailPrice: 120000, stock: 85, weight: 180 }],
  },

  // ── BH.Nong — nông sản & thực phẩm sạch ──────────────────────
  {
    id: 'p-bhnong-honey', brand: 'BH.Nong', slug: 'mat-ong-rung-bhnong', name: 'Mật ong rừng nguyên chất BH.Nong',
    shortDesc: 'Mật ong rừng tự nhiên, không pha đường.', basePrice: 260000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Nguyên chất'], isFeatured: true,
    variations: [{ sku: 'BHN-HN-500', name: 'Chai 500ml', attributes: { size: '500ml' }, retailPrice: 260000, stock: 80, weight: 720 }],
  },
  {
    id: 'p-bhnong-cashew', brand: 'BH.Nong', slug: 'hat-dieu-rang-moc-bhnong', name: 'Hạt điều rang mộc BH.Nong',
    shortDesc: 'Điều Bình Phước rang mộc, giòn bùi.', basePrice: 180000, salePrice: 159000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['OCOP'],
    variations: [{ sku: 'BHN-CW-500', name: '500g', attributes: { weight: '500g' }, retailPrice: 180000, salePrice: 159000, stock: 150, weight: 540 }],
  },
  {
    id: 'p-bhnong-pepper', brand: 'BH.Nong', slug: 'tieu-den-bhnong', name: 'Tiêu đen Chư Sê BH.Nong',
    shortDesc: 'Tiêu Tây Nguyên thơm nồng, hạt chắc.', basePrice: 95000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['OCOP'],
    variations: [{ sku: 'BHN-PP-200', name: '200g', attributes: { weight: '200g' }, retailPrice: 95000, stock: 200, weight: 230 }],
  },
  {
    id: 'p-bhnong-tea', brand: 'BH.Nong', slug: 'tra-thao-moc-bhnong', name: 'Trà thảo mộc thanh nhiệt BH.Nong',
    shortDesc: 'Atiso, cúc, cam thảo — thanh mát mỗi ngày.', basePrice: 85000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Vegan'],
    variations: [{ sku: 'BHN-TEA-20', name: 'Hộp 20 túi', attributes: { count: '20' }, retailPrice: 85000, stock: 180, weight: 80 }],
  },

  // ── Sokfram — thực phẩm organic ──────────────────────────────
  {
    id: 'p-sokfram-rice', brand: 'Sokfram', slug: 'gao-lut-huyet-rong-sokfram', name: 'Gạo lứt huyết rồng Sokfram',
    shortDesc: 'Gạo lứt đỏ giàu chất xơ, dẻo thơm.', basePrice: 75000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Organic'], isFeatured: true,
    variations: [{ sku: 'SOK-RC-1KG', name: '1kg', attributes: { weight: '1kg' }, retailPrice: 75000, stock: 220, weight: 1050 }],
  },
  {
    id: 'p-sokfram-coconut', brand: 'Sokfram', slug: 'dau-dua-ep-lanh-sokfram', name: 'Dầu dừa ép lạnh Sokfram',
    shortDesc: 'Ép lạnh nguyên chất, dùng ăn & dưỡng.', basePrice: 130000, salePrice: 110000, categoryIds: ['cat-food', 'cat-skincare'],
    forSegment: ['eco', 'skincare'], certifications: ['Organic', 'Ép lạnh'],
    variations: [{ sku: 'SOK-CO-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 130000, salePrice: 110000, stock: 140, weight: 560 }],
  },
  {
    id: 'p-sokfram-centella', brand: 'Sokfram', slug: 'bot-rau-ma-sokfram', name: 'Bột rau má nguyên chất Sokfram',
    shortDesc: 'Sấy lạnh giữ dưỡng chất, pha uống tiện lợi.', basePrice: 99000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Organic'],
    variations: [{ sku: 'SOK-CT-150', name: '150g', attributes: { weight: '150g' }, retailPrice: 99000, stock: 160, weight: 180 }],
  },
  {
    id: 'p-sokfram-granola', brand: 'Sokfram', slug: 'granola-hat-sokfram', name: 'Granola ngũ cốc hạt Sokfram',
    shortDesc: 'Ăn sáng healthy, ngọt nhẹ từ mật ong.', basePrice: 140000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Không đường tinh luyện'],
    variations: [{ sku: 'SOK-GR-400', name: '400g', attributes: { weight: '400g' }, retailPrice: 140000, stock: 120, weight: 440 }],
  },

  // ── Hector — chăm sóc cá nhân cho nam ────────────────────────
  {
    id: 'p-hector-clay', brand: 'Hector', slug: 'sap-vuot-toc-hector', name: 'Sáp vuốt tóc Hector Matte',
    shortDesc: 'Giữ nếp tự nhiên cả ngày, không bóng nhờn.', basePrice: 160000, categoryIds: ['cat-personal'],
    forSegment: ['skincare'], certifications: [], isFeatured: true,
    variations: [{ sku: 'HEC-CL-80', name: '80g', attributes: { size: '80g' }, retailPrice: 160000, stock: 130, weight: 110 }],
  },
  {
    id: 'p-hector-facewash', brand: 'Hector', slug: 'sua-rua-mat-than-tre-hector', name: 'Sữa rửa mặt than tre Hector',
    shortDesc: 'Sạch nhờn, sạch bụi mịn cho da nam.', basePrice: 145000, salePrice: 119000, categoryIds: ['cat-personal', 'cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'HEC-FW-120', name: '120ml', attributes: { size: '120ml' }, retailPrice: 145000, salePrice: 119000, stock: 150, weight: 150 }],
  },
  {
    id: 'p-hector-shampoo', brand: 'Hector', slug: 'dau-goi-bac-ha-hector', name: 'Dầu gội bạc hà mát lạnh Hector',
    shortDesc: 'Sảng khoái, sạch gàu, mát da đầu.', basePrice: 135000, categoryIds: ['cat-personal'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'HEC-SH-300', name: '300ml', attributes: { size: '300ml' }, retailPrice: 135000, stock: 140, weight: 330 }],
  },
  {
    id: 'p-hector-deo', brand: 'Hector', slug: 'lan-khu-mui-hector', name: 'Lăn khử mùi thiên nhiên Hector',
    shortDesc: 'Khử mùi 24h, không cồn, không nhôm.', basePrice: 99000, categoryIds: ['cat-personal'],
    forSegment: ['skincare'], certifications: ['Aluminum-free'],
    variations: [{ sku: 'HEC-DEO-50', name: '50ml', attributes: { size: '50ml' }, retailPrice: 99000, stock: 200, weight: 70 }],
  },

  // ── Bổ sung đợt 2 (làm dày catalog đa thương hiệu) ───────────
  {
    id: 'p-visante-vitc', brand: 'Visante', slug: 'tinh-chat-vitamin-c-visante', name: 'Tinh chất Vitamin C Visante',
    shortDesc: 'Làm sáng, mờ thâm từ Vitamin C tự nhiên.', basePrice: 380000, salePrice: 329000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'], isFeatured: true,
    variations: [{ sku: 'VIS-VITC-20', name: '20ml', attributes: { size: '20ml' }, retailPrice: 380000, salePrice: 329000, stock: 55, weight: 70 }],
  },
  {
    id: 'p-visante-eye', brand: 'Visante', slug: 'kem-mat-rau-ma-visante', name: 'Kem mắt rau má Visante',
    shortDesc: 'Giảm bọng, mờ quầng thâm vùng mắt.', basePrice: 295000, categoryIds: ['cat-skincare'],
    forSegment: ['skincare'], certifications: ['Vegan'],
    variations: [{ sku: 'VIS-EYE-15', name: '15ml', attributes: { size: '15ml' }, retailPrice: 295000, stock: 60, weight: 50 }],
  },
  {
    id: 'p-polang-hairoil', brand: 'Pơ Lang', slug: 'dau-duong-toc-bo-ket-po-lang', name: 'Dầu dưỡng tóc bồ kết Pơ Lang',
    shortDesc: 'Phục hồi tóc khô xơ, vào nếp mượt.', basePrice: 125000, categoryIds: ['cat-personal'],
    forSegment: ['skincare'], certifications: ['Handmade'],
    variations: [{ sku: 'POLANG-HO-50', name: '50ml', attributes: { size: '50ml' }, retailPrice: 125000, stock: 110, weight: 80 }],
  },
  {
    id: 'p-fuwa-glass', brand: 'Fuwa3e', slug: 'nuoc-lau-kinh-fuwa3e', name: 'Nước lau kính enzyme Fuwa3e',
    shortDesc: 'Sáng bóng không vệt, không amoniac.', basePrice: 79000, categoryIds: ['cat-cleaning'],
    forSegment: ['home_clean'], certifications: ['Eco'],
    variations: [{ sku: 'FUWA-GL-500', name: '500ml', attributes: { size: '500ml' }, retailPrice: 79000, stock: 170, weight: 540 }],
  },
  {
    id: 'p-cobote-massage', brand: 'Cobote', slug: 'dau-massage-be-cobote', name: 'Dầu massage cho bé Cobote',
    shortDesc: 'Dưỡng da bé mềm mại, hỗ trợ giấc ngủ.', basePrice: 109000, categoryIds: ['cat-baby'],
    forSegment: ['mom_baby'], certifications: ['Vegan'],
    variations: [{ sku: 'COBOTE-MS-100', name: '100ml', attributes: { size: '100ml' }, retailPrice: 109000, stock: 120, weight: 130 }],
  },
  {
    id: 'p-leplateau-instant', brand: 'Le Plateau Coffee', slug: 'ca-phe-sua-hoa-tan-le-plateau', name: 'Cà phê sữa hoà tan Le Plateau (hộp 12)',
    shortDesc: 'Cà phê sữa 3in1 từ hạt thật, tiện lợi.', basePrice: 89000, salePrice: 75000, categoryIds: ['cat-coffee'],
    forSegment: ['eco'], certifications: [],
    variations: [{ sku: 'LP-INS-12', name: 'Hộp 12 gói', attributes: { count: '12' }, retailPrice: 89000, salePrice: 75000, stock: 190, weight: 320 }],
  },
  {
    id: 'p-bhnong-cagaileo', brand: 'BH.Nong', slug: 'cao-ca-gai-leo-bhnong', name: 'Cao cà gai leo BH.Nong',
    shortDesc: 'Hỗ trợ mát gan, giải độc tự nhiên.', basePrice: 220000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['OCOP'],
    variations: [{ sku: 'BHN-CGL-100', name: 'Hũ 100g', attributes: { size: '100g' }, retailPrice: 220000, stock: 70, weight: 160 }],
  },
  {
    id: 'p-sokfram-chia', brand: 'Sokfram', slug: 'hat-chia-uc-sokfram', name: 'Hạt chia Úc Sokfram',
    shortDesc: 'Giàu Omega-3 & chất xơ, pha uống tiện.', basePrice: 115000, categoryIds: ['cat-food'],
    forSegment: ['eco'], certifications: ['Organic'],
    variations: [{ sku: 'SOK-CH-500', name: '500g', attributes: { weight: '500g' }, retailPrice: 115000, stock: 150, weight: 540 }],
  },
];

export const NOTIFICATION_TEMPLATES = [
  // ORDER_CONFIRMED/ORDER_SHIPPING mang kênh ZNS nhưng chưa có zaloTemplateId (cần Zalo duyệt mẫu, không tự điền được):
  // NotificationsService chỉ gửi ZNS khi có mã mẫu, nên hiện khách nhận bản INAPP.
  { id: 'nt-confirmed', code: 'ORDER_CONFIRMED', channel: 'ZNS', bodyTemplate: 'Đơn {{order_code}} đã được xác nhận. Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿' },
  { id: 'nt-shipping', code: 'ORDER_SHIPPING', channel: 'ZNS', bodyTemplate: 'Đơn {{order_code}} đang được giao đến bạn.' },
  // {{points_note}} do OrderStatusService điền khi đơn thật sự có tích điểm (đơn không tích điểm thì rỗng).
  { id: 'nt-delivered', code: 'ORDER_DELIVERED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã giao thành công.{{points_note}} Cảm ơn bạn đã mua sắm tại Tubu Tree 🌿' },
  // {{refund_note}}: tiền hoàn bao nhiêu, về đâu (Ví Tubu / tài khoản ngân hàng) — rỗng khi đơn chưa thanh toán.
  { id: 'nt-cancelled', code: 'ORDER_CANCELLED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã bị hủy.{{refund_note}}' },
  { id: 'nt-invoice', code: 'INVOICE_ISSUED', channel: 'INAPP', bodyTemplate: 'Hóa đơn VAT cho đơn {{order_code}} đã được phát hành.' },
  { id: 'nt-packed', code: 'ORDER_PACKED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã được đóng gói, chuẩn bị giao.' },
  // {{refund_note}}: tiền hoàn bao nhiêu, về đâu — rỗng khi đơn không có tiền để hoàn.
  { id: 'nt-returned', code: 'ORDER_RETURNED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã được hoàn trả.{{refund_note}}' },
  // Báo động vận hành (chỉ gửi tài khoản ADMIN) — vận đơn thu gom Gomdon cần người xử lý.
  { id: 'nt-ops-gomdon', code: 'OPS_GOMDON_ALERT', channel: 'INAPP', bodyTemplate: '⚠️ Vận đơn thu gom đơn {{order_code}}: {{message}}' },
  { id: 'nt-ops-health', code: 'OPS_HEALTH_ALERT', channel: 'INAPP', bodyTemplate: '{{title}}: {{summary}}' },
  { id: 'nt-ops-pancake', code: 'OPS_PANCAKE_ALERT', channel: 'INAPP', bodyTemplate: '⚠️ Đơn {{order_code}} cần xử lý (Pancake): {{message}}' },
  { id: 'nt-return-req', code: 'RETURN_REQUESTED', channel: 'INAPP', bodyTemplate: 'Đã nhận yêu cầu đổi/trả đơn {{order_code}}. Tubu sẽ phản hồi trong 24h.' },
  { id: 'nt-return-ok', code: 'RETURN_APPROVED', channel: 'INAPP', bodyTemplate: 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt. Tiền đã hoàn vào Ví Tubu 🌿' },
  // A6-06 (docs/audit-2026-09/06-web.md, phần thông báo): dùng khi admin.reviewReturn duyệt trả
  // hàng nhưng reverseFinancials KHÔNG thực sự chi khoản hoàn nào (vd đơn chưa từng thanh toán
  // thật dù đã DELIVERED, hoặc đã được hoàn bởi một đường khác trước đó) — KHÔNG được nói "đã hoàn
  // tiền" trong trường hợp này. createOnly: thêm sau lần seed đầu, không ghi đè nếu admin đã sửa.
  { id: 'nt-return-ok-no-refund', code: 'RETURN_APPROVED_NO_REFUND', channel: 'INAPP', bodyTemplate: 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt.', createOnly: true },
  // PD-3: đơn XU cũ và phần điểm quy đổi hoàn bằng Điểm Xanh (không vào Ví); {{points}} là tổng điểm khách nhận lại.
  // Cùng mã/nội dung với migration 20261012140000_pd3_review_b1_return_templates.
  { id: 'nt-return-ok-points', code: 'RETURN_APPROVED_POINTS', channel: 'INAPP', bodyTemplate: 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt. Đã hoàn {{points}} Điểm Xanh vào tài khoản của bạn 🌿', createOnly: true },
  { id: 'nt-return-ok-wallet-points', code: 'RETURN_APPROVED_WALLET_POINTS', channel: 'INAPP', bodyTemplate: 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt. Tiền đã hoàn vào Ví Tubu và {{points}} Điểm Xanh đã hoàn vào tài khoản của bạn 🌿', createOnly: true },
  // P5 (D2/D3): đơn trả trước chờ tiền, trả hàng theo dòng, hàng đợi hoàn tiền chuyển khoản. Cùng lời với migration
  // 20261014091000_p5_refunds_returns_notification_templates.
  { id: 'nt-order-awaiting-payment', code: 'ORDER_AWAITING_PAYMENT', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đang chờ thanh toán {{amount}}. Vui lòng thanh toán trước {{deadline}}, quá hạn đơn sẽ tự huỷ.', createOnly: true },
  { id: 'nt-order-payment-expired', code: 'ORDER_PAYMENT_EXPIRED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã tự huỷ vì quá hạn thanh toán. Nếu bạn đã chuyển khoản, Tubu sẽ tạo yêu cầu hoàn tiền và báo bạn. Bạn có thể đặt lại trong mục Đơn hàng.', createOnly: true },
  { id: 'nt-return-ok-detail', code: 'RETURN_APPROVED_DETAIL', channel: 'INAPP', bodyTemplate: 'Yêu cầu đổi/trả đơn {{order_code}} đã được duyệt.{{refund_note}}', createOnly: true },
  { id: 'nt-return-rejected', code: 'RETURN_REJECTED', channel: 'INAPP', bodyTemplate: 'Yêu cầu đổi/trả đơn {{order_code}} chưa được chấp nhận. Lý do: "{{reason}}". Liên hệ Tubu qua Zalo OA nếu bạn cần hỗ trợ thêm.', createOnly: true },
  { id: 'nt-return-received', code: 'RETURN_RECEIVED', channel: 'INAPP', bodyTemplate: 'Tubu đã nhận lại hàng trả của đơn {{order_code}}. Cảm ơn bạn 🌿', createOnly: true },
  { id: 'nt-refund-bank-requested', code: 'REFUND_BANK_REQUESTED', channel: 'INAPP', bodyTemplate: 'Tubu đã ghi nhận hoàn {{amount}} của đơn {{order_code}} về tài khoản {{bank}}. Tiền sẽ được chuyển trong 1-3 ngày làm việc, miễn phí.', createOnly: true },
  { id: 'nt-refund-bank-completed', code: 'REFUND_BANK_COMPLETED', channel: 'INAPP', bodyTemplate: 'Tubu đã chuyển khoản hoàn {{amount}} của đơn {{order_code}} về tài khoản {{bank}} (mã giao dịch {{bank_ref}}) 🌿', createOnly: true },
  { id: 'nt-refund-late-payment', code: 'REFUND_LATE_PAYMENT', channel: 'INAPP', bodyTemplate: 'Tubu đã nhận {{amount}} cho đơn {{order_code}} nhưng đơn đã huỷ. Vào chi tiết đơn để chọn nhận tiền hoàn về Ví Tubu (ngay) hoặc tài khoản ngân hàng (1-3 ngày làm việc, miễn phí).', createOnly: true },
  { id: 'nt-refund-overpayment', code: 'REFUND_OVERPAYMENT', channel: 'INAPP', bodyTemplate: 'Tubu đã nhận thêm {{amount}} cho đơn {{order_code}}, nhiều hơn số tiền của đơn. Vào chi tiết đơn để chọn nhận lại khoản này về Ví Tubu (ngay) hoặc tài khoản ngân hàng (1-3 ngày làm việc, miễn phí).', createOnly: true },
  { id: 'nt-refund-wallet-credited', code: 'REFUND_WALLET_CREDITED', channel: 'INAPP', bodyTemplate: 'Đã hoàn {{amount}} của đơn {{order_code}} vào Ví Tubu 🌿', createOnly: true },
  { id: 'nt-ops-refund', code: 'OPS_REFUND_ALERT', channel: 'INAPP', bodyTemplate: '💸 Hoàn tiền đơn {{order_code}}: {{message}}', createOnly: true },
  // Q1 (R2-MONEY-4, R2-LIFECYCLE-3): tiền khách trả không khớp đơn. Cùng lời với migration 20261014160100_q1_money_refunds_templates.
  { id: 'nt-ops-payment', code: 'OPS_PAYMENT_ALERT', channel: 'INAPP', bodyTemplate: '⚠️ Thanh toán đơn {{order_code}}: {{message}}', createOnly: true },
  { id: 'nt-order-underpaid', code: 'ORDER_UNDERPAID', channel: 'INAPP', bodyTemplate: 'Tubu đã nhận {{paid}} cho đơn {{order_code}}, còn thiếu {{missing}} (tổng {{total}}). Vui lòng chuyển thêm phần còn thiếu với nội dung {{order_code}}. Nếu đơn bị huỷ, Tubu sẽ hoàn lại số tiền đã nhận.', createOnly: true },
  { id: 'nt-cashback-paid', code: 'CASHBACK_PAID', channel: 'INAPP', bodyTemplate: 'Hoàn tiền {{amount}}đ từ mua sắm sàn ngoài đã vào Ví Tubu 🌿' },
  { id: 'nt-reorder', code: 'REORDER_REMINDER', channel: 'INAPP', bodyTemplate: '{{product}} của bạn dự kiến sắp hết. Đặt lại ngay để không gián đoạn nhé! 🛒' },
  { id: 'nt-pricedrop', code: 'PRICE_DROP_ALERT', channel: 'INAPP', bodyTemplate: '{{product}} bạn yêu thích đang giảm giá{{price_note}}! Xem ngay 💚' },
  { id: 'nt-sub-order', code: 'SUBSCRIPTION_ORDER', channel: 'INAPP', bodyTemplate: 'Đơn định kỳ {{order_code}} đã được tạo tự động. Cảm ơn bạn đã đồng hành 🌿' },
  // Mọi nhánh tạm dừng (SP ngừng bán, địa chỉ hỏng, Ví Tubu không đủ — C-015) đều truyền {{reason}}. Prod nhận lời này
  // và mẫu chuyển khoản dưới qua migration 20261010191000_subscription_second_order_templates_fix.
  { id: 'nt-sub-pause', code: 'SUBSCRIPTION_PAUSED', channel: 'INAPP', bodyTemplate: 'Lịch đặt định kỳ đã tạm dừng: {{reason}}. Vui lòng kiểm tra lại rồi bật lại lịch nhé 🌿' },
  // Gói trả bằng chuyển khoản (C-015, Q-13): đơn kỳ chờ tiền, quá hạn thì cron huỷ đơn như đơn trả trước thường.
  { id: 'nt-sub-order-awaiting-payment', code: 'SUBSCRIPTION_ORDER_AWAITING_PAYMENT', channel: 'INAPP', bodyTemplate: 'Đơn định kỳ {{order_code}} đã được tạo, vui lòng chuyển khoản {{amount}}đ trong {{hours}} giờ để Tubu giao hàng. Quá hạn đơn kỳ này sẽ tự huỷ, lịch vẫn giữ cho kỳ sau 🌿' },
  // Thiếu mẫu này thì notify() rơi về fallback = in NGUYÊN VĂN mã code cho khách
  // ("SUBSCRIPTION_ORDER_FAILED"), và biến {{reason}} không bao giờ hiển thị.
  { id: 'nt-sub-order-failed', code: 'SUBSCRIPTION_ORDER_FAILED', channel: 'INAPP', bodyTemplate: 'Đơn định kỳ kỳ này chưa đặt được: {{reason}}. {{retry}} 🌿' },
  { id: 'nt-welcome', code: 'WELCOME_VOUCHER', channel: 'INAPP', bodyTemplate: 'Chào mừng bạn đến Tubu Tree! Tặng mã giảm giá {{code}} giảm {{value}}đ{{min_order_note}}, dùng trước {{expires}} 🎁' },
  { id: 'nt-birthday', code: 'BIRTHDAY_VOUCHER', channel: 'INAPP', bodyTemplate: 'Chúc mừng sinh nhật! 🎂 Tặng bạn voucher {{code}} giảm {{value}}đ, dùng trước {{expires}}.' },
  { id: 'nt-winback', code: 'WINBACK_VOUCHER', channel: 'INAPP', bodyTemplate: 'Tubu nhớ bạn! Quay lại với voucher {{code}} giảm {{value}}đ, dùng trước {{expires}} 💚' },
  // C-017: cùng mã/nội dung với migration 20261010190500_order_review_invite_second_order (lời sửa ở 20261010191000).
  { id: 'nt-second-order', code: 'SECOND_ORDER_VOUCHER', channel: 'INAPP', bodyTemplate: 'Cảm ơn bạn đã tin dùng Tubu Tree! Tặng mã giảm giá {{code}} giảm {{value}}đ{{min_order_note}}, dùng cho lần mua tiếp theo trước {{expires}} 🌿', createOnly: true },
  { id: 'nt-review-request', code: 'REVIEW_REQUEST', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã đến tay bạn. Bạn thấy {{product}} thế nào? Viết đánh giá để giúp người mua sau, lần đầu đánh giá mỗi sản phẩm được cộng Điểm Xanh 🌿', createOnly: true },
  { id: 'nt-milestone', code: 'MILESTONE_VOUCHER', channel: 'INAPP', bodyTemplate: 'Cảm ơn bạn đã tin dùng Tubu! Tặng voucher tri ân {{code}} giảm {{value}}đ, dùng trước {{expires}} 🌿' },
  // Báo người mời khi thưởng giới thiệu được cấp/thu lại (gửi sau khi sổ điểm commit, mỗi dòng sổ một tin).
  { id: 'nt-referral-reward-paid', code: 'REFERRAL_REWARD_PAID', channel: 'INAPP', bodyTemplate: 'Bạn nhận {{points}} Điểm Xanh vì {{friend}} đã mua đơn thứ hai. Cảm ơn bạn đã giới thiệu Tubu Tree 🌿', createOnly: true },
  { id: 'nt-referral-milestone-paid', code: 'REFERRAL_MILESTONE_PAID', channel: 'INAPP', bodyTemplate: 'Bạn đã giới thiệu thành công {{count}} người bạn và nhận thêm {{points}} Điểm Xanh thưởng mốc 🌿', createOnly: true },
  { id: 'nt-referral-reward-revoked', code: 'REFERRAL_REWARD_REVOKED', channel: 'INAPP', bodyTemplate: 'Thưởng giới thiệu từ {{friend}} được thu lại vì {{cause}}: {{detail}}.', createOnly: true },
  // Điểm đơn mua ngoài app (extclaim): báo khi ghi nhận, cộng, huỷ/thu hồi và khi không tìm thấy đơn.
  { id: 'nt-external-points-pending', code: 'EXTERNAL_POINTS_PENDING', channel: 'INAPP', bodyTemplate: 'Tubu Tree đã ghi nhận {{points}} Điểm Xanh chờ cộng cho đơn {{code}}. Điểm được cộng sau khi đơn giao thành công và hết thời gian giữ điểm 🌿', createOnly: true },
  { id: 'nt-external-points-credited', code: 'EXTERNAL_POINTS_CREDITED', channel: 'INAPP', bodyTemplate: 'Bạn nhận {{points}} Điểm Xanh từ đơn {{code}} mua ngoài app. Cảm ơn bạn đã ủng hộ Tubu Tree 🌿', createOnly: true },
  { id: 'nt-external-points-voided', code: 'EXTERNAL_POINTS_VOIDED', channel: 'INAPP', bodyTemplate: 'Điểm từ đơn {{code}} không được tích: {{detail}}.', createOnly: true },
  { id: 'nt-external-points-claim-not-found', code: 'EXTERNAL_POINTS_CLAIM_NOT_FOUND', channel: 'INAPP', bodyTemplate: 'Tubu Tree chưa tích được điểm cho mã {{code}}: {{detail}}. Bạn có thể kiểm tra lại mã hoặc liên hệ hỗ trợ.', createOnly: true },
  { id: 'nt-game-checkin', code: 'GAME_CHECKIN_REMINDER', channel: 'INAPP', bodyTemplate: '🔥 Chuỗi {{streak}} ngày của bạn sắp lỡ! Điểm danh Vườn Xanh hôm nay để giữ lửa nhé 🌿' },
  { id: 'nt-game-thirsty', code: 'GAME_TREE_THIRSTY', channel: 'INAPP', bodyTemplate: '🥀 Cây của bạn đang khát! Tưới nước hôm nay để cây không héo và mất tiến trình nhé 💧' },
  { id: 'nt-game-gift', code: 'GAME_WATER_GIFT', channel: 'INAPP', bodyTemplate: '🎁 Một người bạn vừa tặng bạn {{amount}}💧 cho Vườn Xanh! Vào tưới cây ngay nhé 🌿' },
  { id: 'nt-groupbuy-ok', code: 'GROUP_BUY_SUCCESS', channel: 'INAPP', bodyTemplate: '🎉 Nhóm mua chung đã đủ người! Bạn nhận mã giảm {{discount}}đ để mua với giá nhóm. Đặt hàng ngay nhé 🛒' },
  { id: 'nt-groupbuy-failed', code: 'GROUP_BUY_FAILED', channel: 'INAPP', bodyTemplate: 'Nhóm mua chung "{{product}}" chưa đủ người trước hạn nên đã đóng. Bạn vẫn mua được với giá thường hoặc mở nhóm mới để rủ thêm bạn bè nhé 🌿', createOnly: true },
  { id: 'nt-comm-event-winner', code: 'COMMUNITY_EVENT_WINNER', channel: 'INAPP', bodyTemplate: '🏆 Chúc mừng! Bạn là người thắng sự kiện "{{title}}" của cộng đồng Tubu.{{reward}}', createOnly: true },
  { id: 'nt-dealer-bonus', code: 'DEALER_BONUS_PAID', channel: 'INAPP', bodyTemplate: '🎁 Thưởng doanh số {{quarter}}: bạn được cộng {{amount}}đ vào công nợ đại lý (doanh số {{revenue}}đ). Cảm ơn bạn đã đồng hành cùng Tubu Tree 🌿' },
  // Yêu cầu nhận thưởng mốc đại lý — cùng mã/nội dung với migration 20260926130000_dealer_reward_claims.
  { id: 'nt-dealer-reward-claim-new', code: 'DEALER_REWARD_CLAIM_NEW', channel: 'INAPP', bodyTemplate: '📥 Đại lý {{dealer}} yêu cầu nhận thưởng "{{reward}}" ({{period}}, doanh số đã chốt {{volume}}đ). Vào trang quản trị để duyệt.' },
  { id: 'nt-dealer-reward-claim-approved', code: 'DEALER_REWARD_CLAIM_APPROVED', channel: 'INAPP', bodyTemplate: '✅ Yêu cầu nhận thưởng "{{reward}}" ({{period}}) đã được duyệt. Tubu Tree sẽ liên hệ để trao thưởng cho bạn 🌿' },
  { id: 'nt-dealer-reward-claim-rejected', code: 'DEALER_REWARD_CLAIM_REJECTED', channel: 'INAPP', bodyTemplate: 'Yêu cầu nhận thưởng "{{reward}}" ({{period}}) chưa được duyệt. Lý do: {{reason}}. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.' },
  { id: 'nt-dealer-reward-claim-paid', code: 'DEALER_REWARD_CLAIM_PAID', channel: 'INAPP', bodyTemplate: '🎁 Tubu Tree đã trao thưởng "{{reward}}" ({{period}}) cho bạn. Cảm ơn bạn đã đồng hành 🌿' },
  // Thu hồi thưởng doanh số quý khi đơn đại lý bị huỷ/trả (dealer.service clawbackQuarterBonusForOrder) —
  // cùng mã/nội dung với migration 20260927100000_dealer_bonus_adjusted_template. createOnly: admin sửa nội
  // dung rồi thì chạy lại seed KHÔNG ghi đè.
  { id: 'nt-dealer-bonus-adjusted', code: 'DEALER_BONUS_ADJUSTED', channel: 'INAPP', bodyTemplate: 'Thưởng doanh số {{quarter}} đã được điều chỉnh do đơn {{order_code}} bị huỷ/trả: thu hồi {{amount}}đ (cộng lại vào công nợ đại lý). Thưởng {{quarter}} còn lại: {{remaining}}đ. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.', createOnly: true },
  // A5-09 (docs/audit-2026-09/05-ctv-dealer-staff.md): đại lý "Báo đã CK" giờ CHỈ tạo thông báo cho
  // admin xác nhận, không tự trừ nợ (DealerService.reportCreditPayment/adminRecordCreditPayment).
  { id: 'nt-dealer-credit-reported', code: 'DEALER_CREDIT_PAYMENT_REPORTED', channel: 'INAPP', bodyTemplate: '📥 Đại lý {{dealer}} báo đã chuyển khoản {{amount}}đ trả nợ. Vào trang quản trị (Đại lý → Công nợ) để kiểm tra sao kê và xác nhận.', createOnly: true },
  { id: 'nt-dealer-credit-confirmed', code: 'DEALER_CREDIT_PAYMENT_CONFIRMED', channel: 'INAPP', bodyTemplate: '✅ Tubu Tree đã xác nhận nhận {{amount}}đ trả nợ của bạn — công nợ đã được cập nhật. Cảm ơn bạn 🌿', createOnly: true },
  { id: 'nt-comm-answer', code: 'COMMUNITY_NEW_ANSWER', channel: 'INAPP', bodyTemplate: '💬 {{author}} vừa trả lời câu hỏi "{{title}}" của bạn.' },
  { id: 'nt-comm-expert', code: 'COMMUNITY_EXPERT_REPLIED', channel: 'INAPP', bodyTemplate: '🌿 Chuyên gia Tubu vừa trả lời câu hỏi "{{title}}" của bạn.' },
  // PD-3 OQ-10: báo khách có xu đã quy sang Điểm Xanh (1.000 xu = 1 điểm, làm tròn lên). Cùng mã/nội dung với migration
  // 20261012160000_pd3_xu_converted_notice, nơi tạo luôn thông báo cho từng user đã quy đổi.
  { id: 'nt-xu-converted', code: 'XU_CONVERTED', channel: 'INAPP', bodyTemplate: '{{xu}} xu cũ của bạn đã thành {{points}} Điểm Xanh không hết hạn, dùng trả tới 100% giá trị hàng.', createOnly: true },
  { id: 'nt-comm-best', code: 'COMMUNITY_BEST_ANSWER', channel: 'INAPP', bodyTemplate: 'Câu trả lời của bạn được chọn là hay nhất! 🌿 Bạn nhận thêm Điểm Xanh thưởng.' },
  { id: 'nt-comm-approved', code: 'COMMUNITY_POST_APPROVED', channel: 'INAPP', bodyTemplate: '🌱 Bài viết của bạn đã được duyệt và hiển thị trong cộng đồng.' },
  { id: 'nt-refill-approved', code: 'REFILL_APPROVED', channel: 'INAPP', bodyTemplate: '🌿 Đổi vỏ chai thành công: ghi nhận {{quantity}} vỏ{{note}}, +{{seeds}} 💧 tưới cây.' },
  { id: 'nt-refill-rejected', code: 'REFILL_REJECTED', channel: 'INAPP', bodyTemplate: 'Yêu cầu đổi {{quantity}} vỏ chai chưa được duyệt{{reason}}. Bạn có thể gửi lại yêu cầu mới sau khi mang vỏ đến điểm nhận.' },
  { id: 'nt-comm-rejected', code: 'COMMUNITY_POST_REJECTED', channel: 'INAPP', bodyTemplate: '🌿 Bài viết "{{title}}" của bạn chưa được đăng vì {{reason}}. Bạn có thể chỉnh lại nội dung rồi đăng bài mới nhé.' },
  { id: 'nt-comm-post-liked', code: 'COMMUNITY_POST_LIKED', channel: 'INAPP', bodyTemplate: '💚 Bài viết "{{title}}" của bạn vừa được thả tim.', createOnly: true },
  { id: 'nt-comm-post-commented', code: 'COMMUNITY_POST_COMMENTED', channel: 'INAPP', bodyTemplate: '💬 {{author}} vừa bình luận bài viết "{{title}}" của bạn.', createOnly: true },
  { id: 'nt-comm-post-hidden', code: 'COMMUNITY_POST_HIDDEN', channel: 'INAPP', bodyTemplate: '🌿 Bài viết "{{title}}" của bạn đã được ẩn khỏi cộng đồng vì {{reason}}. Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.', createOnly: true },
  { id: 'nt-cart-abandon', code: 'CART_ABANDONED', channel: 'INAPP', bodyTemplate: '🛒 Bạn còn {{item_count}} món trong giỏ (có {{product}})! Hoàn tất đơn ngay trước khi hết hàng nhé.' },
  { id: 'nt-voucher-expiring', code: 'VOUCHER_EXPIRING', channel: 'INAPP', bodyTemplate: '⏰ Voucher {{code}} của bạn sắp hết hạn ({{expires}}). Dùng ngay kẻo lỡ nhé!' },
  { id: 'nt-flash-starting', code: 'FLASH_STARTING', channel: 'INAPP', bodyTemplate: '⚡ Giờ vàng {{product}} đã bắt đầu! Vào săn ưu đãi ngay trước khi hết suất nhé.' },
  { id: 'nt-points-expiring', code: 'POINTS_EXPIRING', channel: 'INAPP', bodyTemplate: '⏳ Bạn có {{points}} Điểm Xanh sắp hết hạn vào {{date}}. Dùng để đổi ưu đãi trước khi lỡ nhé! 🌿' },
  { id: 'nt-storefront-trending', code: 'STOREFRONT_TRENDING_PRODUCTS', channel: 'INAPP', bodyTemplate: '✨ Có {{count}} sản phẩm nổi bật (như {{sample}}) bạn chưa thêm vào gian hàng — thêm ngay để không bỏ lỡ khách quan tâm!' },
  // C-029: CTV biết kết quả công việc — đơn mới từ link của mình, hoa hồng được duyệt, lệnh rút đã chi.
  // Không dùng {{order_code}} ở COMMISSION_NEW: đó là đơn của khách, app sẽ hiện nút "Xem đơn" mà CTV không xem được.
  { id: 'nt-ctv-commission-new', code: 'COMMISSION_NEW', channel: 'INAPP', bodyTemplate: '💰 Có đơn mới từ link của bạn! Hoa hồng dự kiến {{amount}}. Khoản này được chốt sau khi khách nhận hàng và hết thời gian đổi/trả.', createOnly: true },
  { id: 'nt-ctv-commission-approved', code: 'COMMISSION_APPROVED', channel: 'INAPP', bodyTemplate: '✅ {{count}} khoản hoa hồng (tổng {{amount}}) đã được duyệt. Bạn có thể rút ngay trong mục CTV.', createOnly: true },
  { id: 'nt-ctv-payout-paid', code: 'COMMISSION_PAYOUT_PAID', channel: 'INAPP', bodyTemplate: '🏦 Lệnh rút {{amount}} của bạn đã được chuyển khoản{{ref}}. Kiểm tra tài khoản ngân hàng nhé!', createOnly: true },
  // Gói p8-seller: rút hoa hồng (SELLER-10), đối tác tự giao (D4), duyệt hồ sơ/sản phẩm (SELLER-12). Cùng nội dung với migration p8_seller_config_templates.
  { id: 'nt-ctv-payout-approved', code: 'COMMISSION_PAYOUT_APPROVED', channel: 'INAPP', bodyTemplate: 'Lệnh rút {{amount}} của bạn đã được duyệt, Tubu Tree sẽ chuyển khoản trong thời gian sớm nhất.', createOnly: true },
  { id: 'nt-ctv-payout-rejected', code: 'COMMISSION_PAYOUT_REJECTED', channel: 'INAPP', bodyTemplate: 'Lệnh rút {{amount}} chưa được duyệt: {{reason}}. Hoa hồng đã trả lại số dư khả dụng, bạn kiểm tra rồi gửi lệnh mới nhé.', createOnly: true },
  { id: 'nt-ctv-commission-reversed', code: 'COMMISSION_REVERSED', channel: 'INAPP', bodyTemplate: 'Khoản hoa hồng dự kiến {{amount}} đã bị thu hồi vì đơn của khách bị huỷ hoặc trả hàng.', createOnly: true },
  { id: 'nt-merchant-order-new', code: 'MERCHANT_ORDER_NEW', channel: 'INAPP', bodyTemplate: '🛒 Gian hàng của bạn có đơn mới {{order_code}} ({{total}}đ). Vào Cổng người bán → Đơn cần giao để xác nhận và gửi hàng.', createOnly: true },
  { id: 'nt-merchant-return-approved', code: 'MERCHANT_RETURN_APPROVED', channel: 'INAPP', bodyTemplate: 'Khách trả hàng đơn {{order_code}} ({{items}}) đã được duyệt. Khi nhận được hàng, hãy bấm "Đã nhận hàng trả" trong Cổng người bán để cộng lại tồn kho.', createOnly: true },
  { id: 'nt-merchant-order-cancelled', code: 'MERCHANT_ORDER_CANCELLED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} đã bị huỷ ({{reason}}). Bạn không cần gửi hàng cho đơn này nữa.', createOnly: true },
  { id: 'nt-merchant-order-overdue', code: 'MERCHANT_ORDER_OVERDUE', channel: 'INAPP', bodyTemplate: '⏰ Đơn {{order_code}} đã quá hạn {{step}}. Vào Cổng người bán → Đơn cần giao để xử lý ngay, tránh khách phải chờ.', createOnly: true },
  { id: 'nt-merchant-cancelled-by-seller', code: 'MERCHANT_ORDER_CANCELLED_BY_SELLER', channel: 'INAPP', bodyTemplate: 'Rất tiếc, {{store}} đã huỷ đơn {{order_code}}: {{reason}}. Tiền bạn đã trả trước (nếu có) được hoàn theo chính sách của Tubu Tree.', createOnly: true },
  { id: 'nt-merchant-payout-created', code: 'MERCHANT_PAYOUT_CREATED', channel: 'INAPP', bodyTemplate: 'Tubu Tree đã lập phiếu đối soát {{amount}}đ cho {{count}} đơn của gian hàng. Xem chi tiết ở Cổng người bán → Đối soát.', createOnly: true },
  { id: 'nt-merchant-payout-paid', code: 'MERCHANT_PAYOUT_PAID', channel: 'INAPP', bodyTemplate: 'Phiếu đối soát {{amount}}đ của gian hàng đã được tất toán (mã giao dịch {{bank_ref}}).', createOnly: true },
  { id: 'nt-merchant-payout-created-to-tubu', code: 'MERCHANT_PAYOUT_CREATED_TO_TUBU', channel: 'INAPP', bodyTemplate: 'Tubu Tree đã lập phiếu đối soát cho {{count}} đơn của gian hàng: bạn cần chuyển cho Tubu Tree {{amount}}đ trước {{due_date}}, nội dung chuyển khoản "{{memo}}". Xem tài khoản nhận và các khoản trong phiếu ở Cổng người bán → Đối soát.', createOnly: true },
  { id: 'nt-merchant-payout-cancelled', code: 'MERCHANT_PAYOUT_CANCELLED', channel: 'INAPP', bodyTemplate: 'Tubu Tree đã huỷ phiếu đối soát {{amount}}đ lập ngày {{created}}: {{reason}}. Các đơn trong phiếu quay lại bảng kê và sẽ vào phiếu mới; xem lại các khoản của phiếu đã huỷ ở Cổng người bán → Đối soát.', createOnly: true },
  { id: 'nt-merchant-payout-cancelled-to-tubu', code: 'MERCHANT_PAYOUT_CANCELLED_TO_TUBU', channel: 'INAPP', bodyTemplate: 'Tubu Tree đã huỷ phiếu đối soát lập ngày {{created}} (bạn phải nộp {{amount}}đ): {{reason}}. Bạn chưa cần chuyển khoản cho phiếu này; nếu đã chuyển, liên hệ Tubu Tree để đối chiếu. Các đơn trong phiếu quay lại bảng kê và sẽ vào phiếu mới.', createOnly: true },
  { id: 'nt-storefront-taken-down', code: 'STOREFRONT_TAKEN_DOWN', channel: 'INAPP', bodyTemplate: 'Tubu Tree đã gỡ gian hàng "{{store}}" khỏi trang công khai: {{reason}}. Bạn vẫn xem và sửa được gian hàng trong ứng dụng; liên hệ CSKH nếu cần được xem xét lại.', createOnly: true },
  { id: 'nt-storefront-reinstated', code: 'STOREFRONT_REINSTATED', channel: 'INAPP', bodyTemplate: 'Gian hàng "{{store}}" của bạn đã được Tubu Tree xem xét và hiển thị lại với khách.', createOnly: true },
  { id: 'nt-storefront-approved', code: 'STOREFRONT_APPROVED', channel: 'INAPP', bodyTemplate: 'Gian hàng "{{store}}" của bạn đã được Tubu Tree duyệt: trang công khai có dấu tích xanh và nhãn "CTV tuyển chọn".', createOnly: true },
  { id: 'nt-merchant-return-requested', code: 'MERCHANT_RETURN_REQUESTED', channel: 'INAPP', bodyTemplate: 'Khách gửi yêu cầu trả hàng đơn {{order_code}} ({{items}}): "{{reason}}". Tubu đang xem xét; xem ảnh khách gửi ở Cổng người bán → Hàng trả về.', createOnly: true },
  { id: 'nt-order-merchant-delayed', code: 'ORDER_MERCHANT_DELAYED', channel: 'INAPP', bodyTemplate: 'Đơn {{order_code}} do {{store}} giao đang chậm {{step}}. Tubu đã nhắc gian hàng. Nếu không muốn chờ, bạn huỷ được đơn trong mục Đơn hàng khi hàng chưa gửi đi, tiền đã trả được hoàn đủ.', createOnly: true },
  { id: 'nt-merchant-product-unlinked', code: 'MERCHANT_PRODUCT_UNLINKED', channel: 'INAPP', bodyTemplate: 'Sản phẩm "{{product_name}}" đã gỡ liên kết mã Pancake (Tubu giao hộ) và tạm ngừng bán: {{reason}}. Liên hệ Tubu nếu bạn cần liên kết lại.', createOnly: true },
  { id: 'nt-merchant-product-approved', code: 'MERCHANT_PRODUCT_APPROVED', channel: 'INAPP', bodyTemplate: '✅ Sản phẩm "{{product_name}}" đã được duyệt và đang bán trên Tubu Tree.', createOnly: true },
  { id: 'nt-merchant-product-rejected', code: 'MERCHANT_PRODUCT_REJECTED', channel: 'INAPP', bodyTemplate: 'Sản phẩm "{{product_name}}" chưa được duyệt: {{reason}}. Sửa lại trong Cổng người bán để gửi duyệt lại.', createOnly: true },
  { id: 'nt-ops-merchant-product', code: 'OPS_MERCHANT_PRODUCT_PENDING', channel: 'INAPP', bodyTemplate: '📦 {{store}} gửi sản phẩm "{{product_name}}" ({{mode}}) chờ duyệt. Vào trang quản trị → Duyệt sản phẩm đối tác.', createOnly: true },
  { id: 'nt-ops-merchant-product-edit', code: 'OPS_MERCHANT_PRODUCT_EDIT_PENDING', channel: 'INAPP', bodyTemplate: '📝 {{store}} sửa nội dung sản phẩm "{{product_name}}" ({{mode}}). Sản phẩm vẫn bán với nội dung cũ. Vào trang quản trị → Duyệt sản phẩm đối tác để duyệt bản sửa.', createOnly: true },
  { id: 'nt-merchant-product-edit-approved', code: 'MERCHANT_PRODUCT_EDIT_APPROVED', channel: 'INAPP', bodyTemplate: '✅ Bản sửa của sản phẩm "{{product_name}}" đã được duyệt và đang hiển thị trên Tubu Tree.', createOnly: true },
  { id: 'nt-merchant-product-edit-rejected', code: 'MERCHANT_PRODUCT_EDIT_REJECTED', channel: 'INAPP', bodyTemplate: 'Bản sửa của sản phẩm "{{product_name}}" chưa được duyệt: {{reason}}. Sản phẩm vẫn bán với nội dung cũ; bạn sửa lại trong Cổng người bán để gửi duyệt lại.', createOnly: true },
  { id: 'nt-ops-dealer-application', code: 'OPS_DEALER_APPLICATION_PENDING', channel: 'INAPP', bodyTemplate: '📝 Hồ sơ đại lý mới: {{business}} ({{owner}}, {{phone}}). Vào trang quản trị → Đại lý để duyệt.', createOnly: true },
  { id: 'nt-dealer-app-approved', code: 'DEALER_APPLICATION_APPROVED', channel: 'INAPP', bodyTemplate: '🎉 Hồ sơ đại lý của bạn đã được duyệt, bậc {{tier}}. Vào mục Đại lý để xem bảng giá sỉ và đặt hàng.', createOnly: true },
  { id: 'nt-dealer-app-rejected', code: 'DEALER_APPLICATION_REJECTED', channel: 'INAPP', bodyTemplate: 'Hồ sơ đại lý của bạn chưa được duyệt: {{reason}}. Bạn có thể bổ sung thông tin và nộp lại.', createOnly: true },
  // A1-03 (docs/audit-2026-09/01-ia-navigation.md): báo admin khi khách gửi yêu cầu xoá tài khoản
  // (UsersService.requestAccountDeletion) — mirror nt-dealer-credit-reported (chỉ gửi ADMIN).
  { id: 'nt-account-deletion-requested', code: 'ACCOUNT_DELETION_REQUESTED', channel: 'INAPP', bodyTemplate: '🗑️ Khách {{user}} (SĐT {{phone}}) yêu cầu xoá tài khoản. Vào trang quản trị (Tài khoản → Yêu cầu xoá) để xử lý.', createOnly: true },
  { id: 'nt-waste-parcel-received', code: 'WASTE_PARCEL_RECEIVED', channel: 'INAPP', bodyTemplate: 'Kho Tubu đã nhận kiện của yêu cầu {{code}}. Tubu sẽ đếm và báo bạn kết quả cộng Điểm Xanh.', createOnly: true },
  { id: 'nt-waste-points-credited', code: 'WASTE_POINTS_CREDITED', channel: 'INAPP', bodyTemplate: 'Yêu cầu {{code}} đã đếm xong. {{result}}.', createOnly: true },
  { id: 'nt-waste-request-rejected', code: 'WASTE_REQUEST_REJECTED', channel: 'INAPP', bodyTemplate: 'Yêu cầu {{code}} chưa được nhận: {{reason}}. Bạn xem chi tiết trong mục Đổi rác.', createOnly: true },
  { id: 'nt-waste-request-expired', code: 'WASTE_REQUEST_EXPIRED', channel: 'INAPP', bodyTemplate: 'Yêu cầu {{code}} đã đóng: {{detail}}.', createOnly: true },
  { id: 'nt-waste-pickup-started', code: 'WASTE_PICKUP_STARTED', channel: 'INAPP', bodyTemplate: 'Đơn mua của bạn đã giao. Phần rác của yêu cầu {{code}} đang về kho Tubu, Tubu chờ tới hết ngày {{until}}.', createOnly: true },
  { id: 'nt-waste-pickup-cancelled', code: 'WASTE_PICKUP_CANCELLED', channel: 'INAPP', bodyTemplate: 'Đơn mua bị huỷ nên yêu cầu thu kèm rác {{code}} cũng đã đóng. Bạn tạo yêu cầu mới trong mục Đổi rác khi cần.', createOnly: true },
  { id: 'nt-waste-points-reversed', code: 'WASTE_POINTS_REVERSED', channel: 'INAPP', bodyTemplate: 'Tubu đã thu hồi {{points}} Điểm Xanh của yêu cầu {{code}}. Lý do: {{reason}}.', createOnly: true },
  { id: 'nt-waste-ship-locked', code: 'WASTE_SHIP_LOCKED', channel: 'INAPP', bodyTemplate: 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn. Bạn vẫn mang rác tới điểm nhận được. Yêu cầu thu kèm chưa gắn đơn (nếu có) sẽ được huỷ. Cần hỗ trợ, liên hệ Tubu Tree.', createOnly: true },
  { id: 'nt-waste-gift-cancelled', code: 'WASTE_GIFT_CANCELLED', channel: 'INAPP', bodyTemplate: 'Lượt đổi quà {{gift}} đã bị huỷ.{{points_note}}', createOnly: true },
  { id: 'nt-waste-perk-reviewed', code: 'WASTE_PERK_REVIEWED', channel: 'INAPP', bodyTemplate: 'Ưu đãi riêng của điểm nhận {{point}}: {{result}}.', createOnly: true },
];

const QUIZZES = [
  { id: 'q1', question: 'Sản phẩm Fuwa3e được lên men từ nguyên liệu nào?', options: ['Dứa', 'Táo', 'Nho', 'Cam'], correct: 0, rewardPts: 3, brand: 'Fuwa3e' },
  { id: 'q2', question: 'Bao bì xanh nên được xử lý thế nào?', options: ['Vứt chung', 'Tái chế', 'Đốt', 'Chôn'], correct: 1, rewardPts: 3 },
  { id: 'q3', question: 'Vùng nguyên liệu của Pơ Lang ở đâu?', options: ['Đắk Lắk', 'Hà Nội', 'Cà Mau', 'Huế'], correct: 0, rewardPts: 3, brand: 'Pơ Lang' },
  { id: 'q4', question: 'Chứng nhận hữu cơ quốc tế phổ biến là?', options: ['ISO', 'USDA Organic', 'CE', 'FDA'], correct: 1, rewardPts: 3 },
  { id: 'q5', question: '"Sống xanh An Lành" là slogan của?', options: ['Tubu Tree', 'Shopee', 'Lazada', 'Tiki'], correct: 0, rewardPts: 3 },
  { id: 'q6', question: 'Khi thu hoạch cây ảo, giọt nước bạn đã tưới được góp vào đâu?', options: ['Hồ nước chung của cộng đồng', 'Ví Tubu của bạn', 'Kho hàng của đại lý', 'Quỹ khuyến mãi'], correct: 0, rewardPts: 3 },
];

export const MISSIONS = [
  { id: 'm1', code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', description: 'Nhận thành công đơn hàng đầu tiên', rewardPoints: 20_000, goal: 1, isRepeatable: false },
  { id: 'm2', code: 'CHECKIN_7', title: 'Chăm chỉ 7 ngày', description: 'Điểm danh Vườn Xanh 7 ngày liên tiếp (nhận một lần)', rewardPoints: 30_000, goal: 7, isRepeatable: false },
  { id: 'm3', code: 'REVIEW_3', title: 'Nhà phê bình', description: 'Viết 3 đánh giá có ảnh', rewardPoints: 15_000, goal: 3, isRepeatable: false },
  { id: 'm4', code: 'INVITE_3', title: 'Lan tỏa sống xanh', description: 'Mời 3 bạn mua hàng thành công qua mã giới thiệu', rewardPoints: 50_000, goal: 3, isRepeatable: false },
];

const CASHBACK_MERCHANTS = [
  { id: 'cb-shopee', slug: 'shopee', provider: 'accesstrade', name: 'Shopee', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.035), fullRate: new Prisma.Decimal(0.05), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/shopee?utm_content={{clickId}}' },
  { id: 'cb-lazada', slug: 'lazada', provider: 'accesstrade', name: 'Lazada', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.042), fullRate: new Prisma.Decimal(0.06), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/lazada?utm_content={{clickId}}' },
  { id: 'cb-tiktok', slug: 'tiktokshop', provider: 'accesstrade', name: 'TikTok Shop', logoUrl: '', category: 'ecommerce', baseRate: new Prisma.Decimal(0.049), fullRate: new Prisma.Decimal(0.07), deeplinkTemplate: 'https://gostore.accesstrade.vn/deep_link/tiktok?utm_content={{clickId}}' },
];

async function seedWasteReferenceData() {
  for (const item of WASTE_SEED_ITEMS) await prisma.wasteItem.upsert(wasteItemUpsertArgs(item));
  for (const gift of WASTE_SEED_GIFTS) await prisma.wasteGift.upsert(wasteGiftUpsertArgs(gift));
}

async function main() {
  assertSeedAllowed(process.env);
  await assertPoints1dApplied(prisma);
  console.log('🌱 Seeding SystemConfig...');
  for (const cfg of SYSTEM_CONFIGS) {
    // Key createOnly (admin sở hữu giá trị) chỉ tạo khi chưa có — xem config-seed.ts.
    await prisma.systemConfig.upsert(configSeedUpsertArgs(cfg));
  }
  console.log(`   → ${SYSTEM_CONFIGS.length} config keys.`);

  // 🌱 RBAC — grant admin gán sẵn từ env SEED_ADMIN_PHONES (CSV). Idempotent.
  const seedAdminPhones = (process.env.SEED_ADMIN_PHONES ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const phone of seedAdminPhones) {
    const has = await prisma.roleGrant.findFirst({
      where: { phone, role: 'ADMIN', revokedAt: null },
    });
    if (!has) {
      await prisma.roleGrant.create({ data: { phone, role: 'ADMIN', grantedBy: 'seed' } });
    }
  }
  if (seedAdminPhones.length > 0) {
    console.log(`🌱 RoleGrant ADMIN cho ${seedAdminPhones.length} SĐT (SEED_ADMIN_PHONES).`);
  }

  console.log('🌱 Seeding MembershipTier...');
  for (const tier of TIERS) {
    await prisma.membershipTier.upsert({
      where: { id: tier.id },
      update: tier,
      create: tier,
    });
  }
  console.log(`   → ${TIERS.length} tiers.`);

  console.log('🌱 Seeding DealerTier...');
  for (const dt of DEALER_TIERS) {
    await prisma.dealerTier.upsert({
      where: { id: dt.id },
      update: dt,
      create: dt,
    });
  }
  console.log(`   → ${DEALER_TIERS.length} dealer tiers.`);

  console.log('🌱 Seeding Categories...');
  for (const c of CATEGORIES) {
    await prisma.category.upsert({ where: { id: c.id }, update: c, create: c });
  }
  console.log(`   → ${CATEGORIES.length} categories.`);

  console.log('🌱 Seeding Products (sample catalog)...');
  let variationCount = 0;
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {
        name: p.name, shortDesc: p.shortDesc, basePrice: p.basePrice, salePrice: p.salePrice ?? null,
        brand: p.brand, categoryIds: p.categoryIds, forSegment: p.forSegment,
        certifications: p.certifications, isFeatured: p.isFeatured ?? false,
        ingredients: p.ingredients ?? undefined,
        // KHÔNG đụng images/thumbnail ở update → giữ ảnh THẬT nếu Pancake sync đã ghi.
      },
      create: {
        id: p.id,
        pancakeId: `seed-${p.id}`, // placeholder; sync thật sẽ map theo pancakeId riêng
        brand: p.brand, slug: p.slug, name: p.name, shortDesc: p.shortDesc,
        description: p.shortDesc, images: [], thumbnail: null,
        categoryIds: p.categoryIds, tags: [p.brand.toLowerCase()],
        basePrice: p.basePrice, salePrice: p.salePrice ?? null,
        forSegment: p.forSegment, certifications: p.certifications, isFeatured: p.isFeatured ?? false,
        ingredients: p.ingredients ?? undefined,
      },
    });
    for (const v of p.variations) {
      await prisma.variation.upsert({
        where: { sku: v.sku },
        update: { retailPrice: v.retailPrice, salePrice: v.salePrice ?? null, stock: v.stock },
        create: {
          pancakeId: `seed-${v.sku}`, productId: p.id, sku: v.sku, name: v.name,
          attributes: v.attributes, retailPrice: v.retailPrice, salePrice: v.salePrice ?? null,
          stock: v.stock, weight: v.weight,
        },
      });
      variationCount++;
    }
  }
  console.log(`   → ${PRODUCTS.length} products, ${variationCount} variations.`);

  console.log('🌱 Seeding NotificationTemplates...');
  for (const { createOnly, ...t } of NOTIFICATION_TEMPLATES) {
    // createOnly: chỉ tạo khi chưa có — không ghi đè nội dung admin đã chỉnh.
    await prisma.notificationTemplate.upsert({ where: { id: t.id }, update: createOnly ? {} : t, create: t });
  }
  console.log(`   → ${NOTIFICATION_TEMPLATES.length} templates.`);

  console.log('🌱 Seeding waste reference data (items, gifts)...');
  await seedWasteReferenceData();

  console.log('🌱 Seeding sample Coupons...');
  const COUPONS: Prisma.CouponCreateInput[] = [
    { code: 'WELCOME30', type: 'AMOUNT', value: 30000, minOrder: 199000, startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), perUserLimit: 1, scope: 'PUBLIC' },
    { code: 'FREESHIP', type: 'FREESHIP', value: 0, minOrder: 99000, startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), perUserLimit: 3, scope: 'PUBLIC' },
    { code: 'XANH10', type: 'PERCENT', value: 10, minOrder: 250000, maxDiscount: 50000, startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), perUserLimit: 2, scope: 'PUBLIC' },
  ];
  for (const c of COUPONS) {
    await prisma.coupon.upsert({ where: { code: c.code }, update: {}, create: c });
  }

  console.log('🌱 Seeding Quizzes & Missions...');
  for (const q of QUIZZES) {
    await prisma.gameQuiz.upsert({ where: { id: q.id }, update: q, create: q });
  }
  for (const m of MISSIONS) {
    // Không ghi đè: admin sửa tiêu đề/điểm thưởng ở màn Nhiệm vụ & quà đổi điểm.
    await prisma.mission.upsert({ where: { id: m.id }, update: {}, create: m });
  }
  console.log(`   → ${QUIZZES.length} quizzes, ${MISSIONS.length} missions.`);

  console.log('🌱 Seeding CashbackMerchants...');
  for (const m of CASHBACK_MERCHANTS) {
    await prisma.cashbackMerchant.upsert({ where: { id: m.id }, update: m, create: m });
  }
  console.log(`   → ${CASHBACK_MERCHANTS.length} merchants.`);

  console.log('🌱 Seeding Nature Quiz questions...');
  await seedGameQuiz(prisma);

  // Vườn Xanh 2.0 Phase 2 — mốc cộng đồng góp quỹ trồng cây đang mở.
  console.log('🌳 Seeding Community Goal...');
  await prisma.communityGoal.upsert({
    where: { id: 'cg-cangio-2026' },
    update: {},
    create: COMMUNITY_GOAL_SEED,
  });

  // Vườn Xanh 2.0 Phase 3 — sổ tay loài cây Việt Nam.
  console.log('🌿 Seeding Plant Species...');
  for (const sp of PLANT_SPECIES) {
    await prisma.plantSpecies.upsert({ where: { id: sp.id }, update: sp, create: sp });
  }

  // Vườn Xanh 2.0 Phase 4 — mùa đang diễn ra.
  console.log('🍃 Seeding Season...');
  await prisma.season.upsert({
    where: { id: 'se-2026-he-cangio' },
    update: {},
    create: SEASON_SEED,
  });

  // Cộng đồng Vườn Tubu — danh mục Q&A theo ngành hàng thật (C-073). Danh mục cây cảnh của bản đầu chỉ bị ẩn,
  // không xoá: bài đã đăng giữ nguyên chỗ (xem community-categories-seed.ts).
  console.log('🌱 Seeding Community Categories...');
  for (const c of COMMUNITY_CATEGORIES) {
    await prisma.communityCategory.upsert(communityCategoryUpsertArgs(c));
  }
  const retired = await prisma.communityCategory.updateMany(retireCommunityCategoriesArgs());
  console.log(`Seeded ${COMMUNITY_CATEGORIES.length} community categories (${retired.count} danh mục cũ đã ẩn)`);

  console.log('✅ Seed done.');
}

export const PLANT_SPECIES = [
  { id: 'sp-tram', name: 'Cây Tràm', scientificName: 'Melaleuca cajuputi', region: 'Đồng bằng sông Cửu Long', rarity: 'COMMON', emoji: '🌿',
    story: 'Tràm phủ xanh vùng đất phèn miền Tây, cho mật ong tràm và tinh dầu kháng khuẩn.', ecoFact: 'Rừng tràm U Minh là "lá phổi" lọc nước và giữ đa dạng sinh học bậc nhất Nam Bộ.' },
  { id: 'sp-duoc', name: 'Cây Đước', scientificName: 'Rhizophora apiculata', region: 'Cần Giờ, Cà Mau', rarity: 'COMMON', emoji: '🌱',
    story: 'Đước với bộ rễ chống đỡ đặc trưng là loài chủ lực của rừng ngập mặn Việt Nam.', ecoFact: 'Rễ đước chắn sóng, giữ phù sa và lưu trữ carbon gấp ~4 lần rừng trên cạn.' },
  { id: 'sp-ban', name: 'Cây Bàng', scientificName: 'Terminalia catappa', region: 'Ven biển cả nước', rarity: 'COMMON', emoji: '🌳',
    story: 'Bàng cho bóng mát sân trường, lá đỏ rực khi sang đông.', ecoFact: 'Tán bàng rộng giúp hạ nhiệt đô thị và là nơi trú ngụ của nhiều loài chim.' },
  { id: 'sp-phuong', name: 'Phượng Vĩ', scientificName: 'Delonix regia', region: 'Hải Phòng & đô thị', rarity: 'RARE', emoji: '🌺',
    story: 'Phượng vĩ nở đỏ báo hiệu mùa hè và mùa chia tay tuổi học trò.', ecoFact: 'Hoa phượng là nguồn mật quan trọng cho ong và côn trùng thụ phấn đầu hè.' },
  { id: 'sp-lim', name: 'Cây Lim Xanh', scientificName: 'Erythrophleum fordii', region: 'Rừng Bắc & Trung Bộ', rarity: 'RARE', emoji: '🌳',
    story: 'Lim là một trong "tứ thiết" gỗ quý, sống hàng trăm năm.', ecoFact: 'Cây gỗ lớn như lim giữ đất chống xói mòn và tích trữ carbon dài hạn.' },
  { id: 'sp-sao', name: 'Cây Sao Đen', scientificName: 'Hopea odorata', region: 'Đông Nam Bộ', rarity: 'RARE', emoji: '🌲',
    story: 'Sao đen cao vút thường được trồng làm hàng cây di sản trên phố.', ecoFact: 'Tán sao đen tạo hành lang xanh, giảm bụi mịn và tiếng ồn đô thị.' },
  { id: 'sp-po-mu', name: 'Cây Pơ Mu', scientificName: 'Fokienia hodginsii', region: 'Núi cao Tây Bắc', rarity: 'LEGENDARY', emoji: '🌲',
    story: 'Pơ mu là cây gỗ quý vùng núi cao, gắn với văn hoá người Mông, Dao.', ecoFact: 'Pơ mu thuộc nhóm nguy cấp — bảo tồn giúp giữ rừng đầu nguồn và nguồn nước.' },
  { id: 'sp-bach-xanh', name: 'Bách Xanh', scientificName: 'Calocedrus macrolepis', region: 'Cao nguyên Đà Lạt', rarity: 'LEGENDARY', emoji: '🌲',
    story: 'Bách xanh cổ thụ ở Hòn Bà, Bidoup có cây hàng nghìn năm tuổi.', ecoFact: 'Là loài quý hiếm, bách xanh chỉ tin tưởng ở rừng nguyên sinh ít bị tác động.' },
  { id: 'sp-thong', name: 'Thông Ba Lá', scientificName: 'Pinus kesiya', region: 'Lâm Đồng', rarity: 'COMMON', emoji: '🌲',
    story: 'Rừng thông Đà Lạt tạo nên khí hậu mát lành và cảnh quan thơ mộng.', ecoFact: 'Thông giữ đất dốc, lá kim phân huỷ chậm nuôi tầng mùn cho rừng.' },
  { id: 'sp-gao', name: 'Cây Gạo', scientificName: 'Bombax ceiba', region: 'Đồng bằng Bắc Bộ', rarity: 'RARE', emoji: '🌺',
    story: '"Tháng ba hoa gạo" đỏ rực bến nước, đình làng Bắc Bộ.', ecoFact: 'Hoa gạo nhiều mật, là "nhà hàng" cho chào mào, sáo và nhiều loài chim mùa xuân.' },
] as const;

// Chỉ chạy khi gọi thẳng (`tsx prisma/seed.ts`); seed-reference.ts import file này để lấy hằng số mà không chạy main().
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

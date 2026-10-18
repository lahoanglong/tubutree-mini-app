import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM_CONFIGS, TIERS } from '../../../prisma/seed';
import { SystemConfigService } from './system-config.service';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  BUSINESS_CONFIG_KEYS,
  EXCLUDED_CONFIG_KEYS,
  EXCLUDED_CONFIG_PREFIXES,
  EXTRA_CONFIGS,
  REFERENCE_CONFIG_PREFIXES,
  classifyConfigKey,
  selectBusinessConfigs,
  selectReferenceConfigs,
} from '../../../prisma/reference-data/config-selection';

const API_ROOT = join(__dirname, '../../..');
const keysOf = (rows: readonly { key: string }[]) => rows.map((r) => r.key);

const APPROVED_LOADED_KEYS = [
    'affiliate.attribution_days',
    'affiliate.commission_eligible_roles',
    'affiliate.hold_days',
    'affiliate.max_rate_pct',
    'affiliate.min_withdraw_bank',
    'affiliate.pit_withhold_pct',
    'affiliate.pit_withhold_threshold',
    'attendance.cancel_notice_days',
    'attendance.checkin_early_min',
    'attendance.emergency_cap_month',
    'attendance.enforce_ip',
    'attendance.heartbeat_stale_min',
    'attendance.late_fine',
    'attendance.late_grace_min',
    'attendance.office_ips',
    'attendance.out_of_range_max_count',
    'attendance.out_of_range_max_min',
    'attendance.radius_m',
    'cashback.click_rate_limit_seconds',
    'cashback.hold_days',
    'cashback.merchant_user_share',
    'cashback.reconcile_lookback_days',
    'community.answer_reward_points',
    'community.author_notify_interval_minutes',
    'community.banned_keywords',
    'community.best_answer_reward_points',
    'community.daily_answer_reward_cap',
    'community.daily_best_answer_cap',
    'community.daily_post_reward_cap',
    'community.daily_rep_cap',
    'community.post_reward_points',
    'community.public_preview',
    'community.rep_answer',
    'community.rep_best',
    'community.rep_post',
    'community.rep_thresholds',
    'community.unanswered_alert_hours',
    'dealer.max_discount_pct',
    'dealer.review_hours',
    'dealer.reward_claim_grace_days',
    'flashsale.default_per_user_limit',
    'flashsale.max_discount_pct',
    'flashsale.max_duration_days',
    'flashsale.min_discount_pct',
    'game.daily_login_seeds',
    'game.dew_seeds',
    'game.harvest_coupon_daily_cap',
    'game.harvest_coupon_min_order',
    'game.max_plots',
    'game.plot_target',
    'game.plot_unlock_seed_base',
    'game.quiz_daily_count',
    'game.spin_buy_cost_points',
    'game.spin_buy_daily_limit',
    'game.spin_voucher_min_order_multiplier',
    'game.streak_freeze_cost',
    'game.streak_repair_cooldown_days',
    'game.streak_repair_cost',
    'game.streak_repair_window_hours',
    'game.tank_capacity',
    'game.tree_default_target',
    'game.tree_points_price',
    'groupbuy.discount_pct',
    'groupbuy.max_open_per_user',
    'groupbuy.target_size',
    'groupbuy.window_hours',
    'home.new_customer_layout',
    'legal.bao-mat',
    'legal.dieu-khoan',
    'legal.doi-tra',
    'legal.van-chuyen',
    'loyalty.checkin_points',
    'loyalty.max_redeem_pct',
    'loyalty.point_expire_months',
    'loyalty.point_expiry_reminder_days',
    'loyalty.pos_credit_enabled',
    'loyalty.pos_max_order_total',
    'loyalty.pos_member_daily_points_cap',
    'loyalty.pos_staff_daily_points_cap',
    'loyalty.tier_grace_days',
    'loyalty.vnd_per_point',
    'loyalty.vnd_per_point_redeem',
    'merchant.commission_pct',
    'merchant.confirm_sla_hours',
    'merchant.default_shipping_fee',
    'merchant.deliver_sla_days',
    'merchant.negative_payout_due_days',
    'merchant.settlement_hold_days',
    'merchant.ship_sla_hours',
    'ops.alert_gomdon_backlog_minutes',
    'ops.alert_queue_failed_1h',
    'ops.alert_repeat_hours',
    'ops.alert_stuck_orders',
    'ops.alert_unsynced_minutes',
    'ops.alert_webhook_failed',
    'orders.dealer_pending_payment_ttl_hours',
    'orders.pending_payment_ttl_hours',
    'referral.min_order_amount',
    'referral.referrer_reward_points',
    'referral.window_days',
    'remarketing.cart_abandon_max_hours',
    'remarketing.cart_abandon_min_hours',
    'remarketing.voucher_expiry_days',
    'reorder.default_cycle_days',
    'reorder.remind_ratio',
    'retention.analytics_events_days',
    'retention.notification_logs_days',
    'retention.refresh_sessions_days',
    'retention.webhook_events_days',
    'returns.window_days',
    'seasonpass.checkin_xp',
    'shipping.eta_max_days',
    'shipping.eta_min_days',
    'storefront.identifier_cooldown_days',
    'subscribe.discount_pct',
    'subscribe.stock_retry_days',
    'support.email',
    'support.hotline',
    'support.zalo_oa_name',
    'voucher.birthday_amount',
    'voucher.milestones',
    'voucher.welcome_amount',
    'voucher.welcome_min_order',
    'voucher.winback_amount',
    'voucher.winback_days',
    'wallet.withdraw_fee',
    'wallet.withdraw_min',
    'wishlist.price_drop_cooldown_days',
    'wishlist.price_drop_min_pct',
];

const APPROVED_BUSINESS_KEYS = [
    'game.spin_prizes',
    'game.streak_7_bonus',
    'referral.milestones_points',
    'seasonpass.tiers',
    'shipping.tier_freeship_overrides',
    'subscribe.discount_tiers',
];

describe('khoá SystemConfig nạp lên DB thật (seed-reference)', () => {
  it('mọi khoá của seed.ts đã được phân loại: nạp hoặc loại có lý do (khoá/tiền tố mới phải được chọn, không tự lọt lên prod)', () => {
    const unclassified = SYSTEM_CONFIGS.filter((c) => classifyConfigKey(c.key) === 'unclassified').map((c) => c.key);
    expect(unclassified).toEqual([]);
  });

  it('danh sách loại không có dòng thừa: mọi khoá/tiền tố loại đều còn khoá tương ứng trong seed.ts', () => {
    const seeded = keysOf(SYSTEM_CONFIGS);
    for (const key of Object.keys(EXCLUDED_CONFIG_KEYS)) expect(seeded).toContain(key);
    for (const prefix of Object.keys(EXCLUDED_CONFIG_PREFIXES)) expect(seeded.some((k) => k.startsWith(`${prefix}.`))).toBe(true);
  });

  it('tiền tố vừa được nạp vừa bị loại thì không có', () => {
    const overlap = REFERENCE_CONFIG_PREFIXES.filter((p) => p in EXCLUDED_CONFIG_PREFIXES);
    expect(overlap).toEqual([]);
  });

  it('không nạp tài khoản ngân hàng, họ khoá Gomdon (kể cả khoá thêm sau) và khoá đổi vỏ (không đụng cấu hình thanh toán hay phần đổi rác)', () => {
    const loaded = keysOf(selectReferenceConfigs(SYSTEM_CONFIGS));
    expect(loaded.filter((k) => /^(payment|refill)\./.test(k))).toEqual([]);
    expect(loaded.filter((k) => k.startsWith('shipping.gomdon.'))).toEqual([]);
    expect(classifyConfigKey('shipping.gomdon.mot_khoa_moi')).toBe('excluded');
    expect(classifyConfigKey('shipping.eta_min_days')).toBe('reference');
  });

  it('không nạp phí ship: để trống thì go-live:check WARN (db.shipping_rates) buộc chủ shop xác nhận', () => {
    const loaded = keysOf(selectReferenceConfigs(SYSTEM_CONFIGS));
    expect(loaded).not.toContain('shipping.free_threshold');
    expect(loaded).not.toContain('shipping.flat_fee_below_threshold');
  });

  // Danh sách chốt: khoá mới của seed.ts (hay khoá bổ sung) làm test này đỏ để người thêm phải quyết định nạp hay loại,
  // rồi sửa danh sách ở đây cùng commit. Đừng cập nhật danh sách mà không xem khoá mới có nhạy cảm không.
  it('danh sách khoá nạp mặc định lên DB thật khớp danh sách đã duyệt', () => {
    expect(keysOf(selectReferenceConfigs(SYSTEM_CONFIGS)).sort()).toEqual(APPROVED_LOADED_KEYS);
  });

  it('bốn khoá legal.* được nạp với giá trị rỗng, bằng mặc định trong mã (LegalConfigController trả null thì web dùng bản nháp), để admin có chỗ dán nội dung đã duyệt', () => {
    const legal = selectReferenceConfigs(SYSTEM_CONFIGS).filter((c) => c.key.startsWith('legal.'));
    expect(legal.map((c) => c.key).sort()).toEqual(['legal.bao-mat', 'legal.dieu-khoan', 'legal.doi-tra', 'legal.van-chuyen']);
    for (const c of legal) expect(c.value).toBe('');
  });

  it('danh sách khoá giá trị kinh doanh (chỉ nạp có cờ) khớp danh sách đã duyệt, và không lẫn vào phần nạp mặc định', () => {
    expect(keysOf(selectBusinessConfigs(SYSTEM_CONFIGS)).sort()).toEqual(APPROVED_BUSINESS_KEYS);
    const loaded = new Set(keysOf(selectReferenceConfigs(SYSTEM_CONFIGS)));
    expect(APPROVED_BUSINESS_KEYS.filter((k) => loaded.has(k))).toEqual([]);
  });

  it('mọi khoá giá trị kinh doanh còn trong seed.ts và có lý do ghi kèm hai giá trị so sánh', () => {
    const seeded = keysOf(SYSTEM_CONFIGS);
    for (const [key, reason] of Object.entries(BUSINESS_CONFIG_KEYS)) {
      expect(seeded).toContain(key);
      expect(reason).toMatch(/mã mặc định .*seed /);
    }
  });

  it('freeship theo hạng: mọi hạng trong shipping.tier_freeship_overrides là hạng có thật trong TIERS, và khoá này đi cùng TIERS ở nhóm chỉ nạp có cờ', () => {
    const overrides = SYSTEM_CONFIGS.find((c) => c.key === 'shipping.tier_freeship_overrides')!.value as Record<string, number>;
    const tierIds = TIERS.map((t) => t.id);
    expect(Object.keys(overrides).filter((tier) => !tierIds.includes(tier))).toEqual([]);
    expect(keysOf(selectBusinessConfigs(SYSTEM_CONFIGS))).toContain('shipping.tier_freeship_overrides');
    expect(keysOf(selectReferenceConfigs(SYSTEM_CONFIGS))).not.toContain('shipping.tier_freeship_overrides');
  });

  it('khoá bổ sung không trùng khoá của seed.ts và không có hai dòng cùng khoá', () => {
    const seeded = new Set(keysOf(SYSTEM_CONFIGS));
    const extras = keysOf(EXTRA_CONFIGS);
    expect(extras.filter((k) => seeded.has(k))).toEqual([]);
    expect(new Set(extras).size).toBe(extras.length);
    for (const key of extras) expect(classifyConfigKey(key)).toBe('reference');
  });

  it.each(EXTRA_CONFIGS.map((c) => [c.key, c] as const))('%s: giá trị nạp bằng mặc định đang nằm trong mã', (_key, extra) => {
    const source = readFileSync(join(API_ROOT, extra.fallbackSource.file), 'utf-8');
    expect(source).toContain(extra.fallbackSource.text);
  });

  // Admin đọc mô tả này để quyết bật cờ: phải nói cờ chỉ đổi thứ tự, không phải công tắc của khối chào mừng.
  it('home.new_customer_layout: mô tả nói cờ chỉ đổi thứ tự, khối "Quà khách mới" luôn hiện với khách mới', () => {
    const desc = EXTRA_CONFIGS.find((c) => c.key === 'home.new_customer_layout')!.description;
    expect(desc).toMatch(/chỉ đổi thứ tự/);
    expect(desc).toMatch(/luôn hiện/);
  });

  it('dòng nạp không còn cờ createOnly lẫn chú thích nguồn (cột SystemConfig không có hai trường này)', () => {
    for (const row of selectReferenceConfigs(SYSTEM_CONFIGS).filter((r) => EXTRA_CONFIGS.some((e) => e.key === r.key))) {
      expect(row).not.toHaveProperty('fallbackSource');
    }
  });

  // Dòng nạp lên DB thật là dòng admin sửa tiếp: khoá có JSON/mảng/số tiền mà chưa có luật ghi thì gõ nhầm đơn vị là "đã lưu", hệ thống chạy sai.
  it('mọi khoá bổ sung và khoá giá trị kinh doanh đều có luật ghi, và giá trị nạp tự nó hợp lệ với luật đó', async () => {
    const tx = {
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      systemConfigHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)) } as unknown as PrismaService;
    const service = new SystemConfigService(prisma);
    const rows = [...selectBusinessConfigs(SYSTEM_CONFIGS), ...selectReferenceConfigs(SYSTEM_CONFIGS).filter((r) => EXTRA_CONFIGS.some((e) => e.key === r.key))];
    expect(rows.map((r) => r.key).filter((k) => !SystemConfigService.hasWriteRule(k))).toEqual([]);
    for (const row of rows) await expect(service.set(row.key, row.value as object, 'admin-it')).resolves.toBeUndefined();
  });
});

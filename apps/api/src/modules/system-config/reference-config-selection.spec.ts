import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM_CONFIGS } from '../../../prisma/seed';
import {
  EXCLUDED_CONFIG_KEYS,
  EXCLUDED_CONFIG_PREFIXES,
  EXTRA_CONFIGS,
  REFERENCE_CONFIG_PREFIXES,
  classifyConfigKey,
  selectReferenceConfigs,
} from '../../../prisma/reference-data/config-selection';

const API_ROOT = join(__dirname, '../../..');
const keysOf = (rows: readonly { key: string }[]) => rows.map((r) => r.key);

const APPROVED_LOADED_KEYS = [
    'affiliate.attribution_days',
    'affiliate.hold_days',
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
    'community.banned_keywords',
    'community.best_answer_reward_points',
    'community.daily_answer_reward_cap',
    'community.daily_best_answer_cap',
    'community.daily_post_reward_cap',
    'community.daily_rep_cap',
    'community.post_reward_points',
    'community.rep_answer',
    'community.rep_best',
    'community.rep_post',
    'community.rep_thresholds',
    'dealer.max_discount_pct',
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
    'game.spin_prizes',
    'game.spin_voucher_min_order_multiplier',
    'game.streak_7_bonus',
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
    'referral.milestones_points',
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
    'seasonpass.tiers',
    'shipping.eta_max_days',
    'shipping.eta_min_days',
    'shipping.tier_freeship_overrides',
    'storefront.identifier_cooldown_days',
    'subscribe.discount_pct',
    'subscribe.discount_tiers',
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
  it('danh sách khoá nạp lên DB thật khớp danh sách đã duyệt', () => {
    expect(keysOf(selectReferenceConfigs(SYSTEM_CONFIGS)).sort()).toEqual(APPROVED_LOADED_KEYS);
  });

  it('hạng thành viên đi cùng freeship theo hạng: khoá freeship phải nằm trong phần nạp (quyền lợi hứa trên hạng thực hiện nhờ khoá này)', () => {
    expect(keysOf(selectReferenceConfigs(SYSTEM_CONFIGS))).toContain('shipping.tier_freeship_overrides');
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

  it('dòng nạp không còn cờ createOnly lẫn chú thích nguồn (cột SystemConfig không có hai trường này)', () => {
    for (const row of selectReferenceConfigs(SYSTEM_CONFIGS).filter((r) => EXTRA_CONFIGS.some((e) => e.key === r.key))) {
      expect(row).not.toHaveProperty('fallbackSource');
    }
  });
});

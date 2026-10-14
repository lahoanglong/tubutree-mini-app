import { BadRequestException } from '@nestjs/common';
import { configPartnerKey, validateAdminConfigValue } from './admin-config-rules';

const ok = (key: string, value: unknown) => expect(() => validateAdminConfigValue(key, value)).not.toThrow();
const bad = (key: string, value: unknown) => expect(() => validateAdminConfigValue(key, value)).toThrow(BadRequestException);

/**
 * Các form cấu hình mới (Gomdon, tích điểm) ghi qua PUT /admin/config chung. SystemConfigService.set chỉ
 * giữ KIỂU dữ liệu; phía đọc thì lặng lẽ quay về mặc định khi giá trị sai (loyalty.getCheckInPointsTable,
 * positiveConfig) — admin bấm Lưu thấy "đã lưu" mà hệ thống vẫn chạy số cũ. Chặn ngay lúc ghi, báo rõ.
 */
describe('validateAdminConfigValue', () => {
  // C-054 (A1-032): admin tưởng đã tắt COD / đặt trần COD mà không code nào đọc khoá → chặn ghi và nói rõ.
  it.each(['payment.cod_max_amount', 'payment.enabled_methods', 'loyalty.welcome_voucher_amount', 'rbac.admin_phones'])(
    'khoá chết %s: từ chối ghi, thông báo nêu rõ không có tác dụng',
    (key) => {
      expect(() => validateAdminConfigValue(key, 1)).toThrow(BadRequestException);
      expect(() => validateAdminConfigValue(key, 1)).toThrow(/không còn được hệ thống đọc/);
    },
  );

  it('khoá thay thế đang sống vẫn ghi được (voucher.welcome_amount)', () => {
    ok('voucher.welcome_amount', 50000);
  });

  it('loyalty.checkin_points: đúng 7 số nguyên 0..100', () => {
    ok('loyalty.checkin_points', [1, 1, 1, 1, 1, 1, 2]);
    ok('loyalty.checkin_points', [0, 0, 0, 0, 0, 0, 100]);
    bad('loyalty.checkin_points', [1, 1, 1, 1, 1, 1]);
    bad('loyalty.checkin_points', [1, 1, 1, 1, 1, 1, 1, 1]);
    bad('loyalty.checkin_points', [1, 1, 1, 1, 1, 1, 101]);
    bad('loyalty.checkin_points', [1, 1, 1, 1, 1, 1, -1]);
    bad('loyalty.checkin_points', [1, 1, 1, 1, 1, 1, 1.5]);
    bad('loyalty.checkin_points', '1,1,1,1,1,1,2');
  });

  it('công tắc boolean: shipping.gomdon.recycling_enabled, loyalty.pos_credit_enabled', () => {
    ok('shipping.gomdon.recycling_enabled', true);
    ok('loyalty.pos_credit_enabled', false);
    bad('shipping.gomdon.recycling_enabled', 'true');
    bad('loyalty.pos_credit_enabled', 1);
  });

  it('trần POS: số nguyên dương trong biên', () => {
    ok('loyalty.pos_max_order_total', 5_000_000);
    bad('loyalty.pos_max_order_total', 0);
    bad('loyalty.pos_max_order_total', 999);
    bad('loyalty.pos_max_order_total', 2_000_000_000);
    ok('loyalty.pos_staff_daily_points_cap', 3000);
    bad('loyalty.pos_staff_daily_points_cap', 0);
    bad('loyalty.pos_member_daily_points_cap', 10.5);
    ok('loyalty.pos_member_daily_points_cap', 1000);
  });

  // Cron huỷ đơn quá hạn thanh toán kẹp giá trị ngoài biên về 1/720 hoặc 24 — chặn lúc ghi để admin không thấy
  // "đã lưu" một con số mà cron không chạy theo.
  it('orders.pending_payment_ttl_hours: số nguyên 1..720 giờ', () => {
    ok('orders.pending_payment_ttl_hours', 24);
    ok('orders.pending_payment_ttl_hours', 1);
    ok('orders.pending_payment_ttl_hours', 720);
    bad('orders.pending_payment_ttl_hours', 0);
    bad('orders.pending_payment_ttl_hours', 721);
    bad('orders.pending_payment_ttl_hours', 1.5);
    bad('orders.pending_payment_ttl_hours', '24');
  });

  it('shipping.gomdon.config: kho + cân nặng mặc định hợp lệ', () => {
    ok('shipping.gomdon.config', {
      defaultWarehouse: { name: 'Kho', phone: '0900000000', address: '1 A', ward: 'P1', district: '', province: 'HCM' },
      defaultWeightFallback: 500,
    });
    bad('shipping.gomdon.config', { defaultWeightFallback: 0 });
    bad('shipping.gomdon.config', { defaultWeightFallback: 500.5 });
    bad('shipping.gomdon.config', { defaultWeightFallback: 200_000 });
    bad('shipping.gomdon.config', { defaultWarehouse: { name: '', phone: '0900000000', address: 'a', ward: 'w', province: 'p' } });
    bad('shipping.gomdon.config', { defaultWarehouse: { name: 'Kho', phone: 'abc', address: 'a', ward: 'w', province: 'p' } });
    bad('shipping.gomdon.config', 'x');
  });

  it('voucher.* dạng số phải là số nguyên (đồng/ngày); khoảng do SystemConfigService kiểm', () => {
    for (const k of ['voucher.welcome_amount', 'voucher.welcome_min_order', 'voucher.birthday_amount', 'voucher.winback_amount', 'voucher.winback_days']) {
      ok(k, 30000);
      bad(k, 30000.5);
      bad(k, '30000');
    }
  });

  it('voucher.milestones: mảng mốc {spend>0, reward>0} số nguyên, không trùng spend, ≤ 10 mốc', () => {
    ok('voucher.milestones', [{ spend: 1_000_000, reward: 30_000 }, { spend: 3_000_000, reward: 100_000 }]);
    ok('voucher.milestones', []);
    bad('voucher.milestones', { spend: 1, reward: 1 });
    bad('voucher.milestones', [{ spend: 0, reward: 30_000 }]);
    bad('voucher.milestones', [{ spend: 1_000_000, reward: 0 }]);
    bad('voucher.milestones', [{ spend: 1_000_000, reward: -5 }]);
    bad('voucher.milestones', [{ spend: 1_000_000.5, reward: 30_000 }]);
    bad('voucher.milestones', [{ spend: '1000000', reward: 30_000 }]);
    bad('voucher.milestones', [{ spend: 1_000_000 }]);
    bad('voucher.milestones', [{ spend: 1_000_000, reward: 1 }, { spend: 1_000_000, reward: 2 }]);
    bad('voucher.milestones', Array.from({ length: 11 }, (_, i) => ({ spend: (i + 1) * 1000, reward: 1000 })));
    // Thưởng vượt mốc chi tiêu = lỗ mỗi lần cấp → nhiều khả năng nhầm cột.
    bad('voucher.milestones', [{ spend: 30_000, reward: 1_000_000 }]);
  });

  // toShippingEta âm thầm ẩn dòng giao dự kiến khi max < min nên admin thấy "đã lưu" mà app không hiện gì.
  it('ETA giao hàng: max không nhỏ hơn min hiện có; khoá đối ứng chưa đặt (null) thì bỏ qua', () => {
    const v = (k: string, n: unknown, partner: unknown) => () => validateAdminConfigValue(k, n, partner);
    expect(v('shipping.eta_max_days', 4, 2)).not.toThrow();
    expect(v('shipping.eta_max_days', 2, 2)).not.toThrow();
    expect(v('shipping.eta_max_days', 1, 2)).toThrow(BadRequestException);
    expect(v('shipping.eta_max_days', 1, null)).not.toThrow();
    expect(v('shipping.eta_max_days', 1, undefined)).not.toThrow();
    expect(v('shipping.eta_min_days', 2, 4)).not.toThrow();
    expect(v('shipping.eta_min_days', 5, 4)).toThrow(BadRequestException);
    expect(v('shipping.eta_min_days', 5, 4)).toThrow(/shipping\.eta_max_days/);
    expect(v('shipping.eta_min_days', 3.5, null)).toThrow(BadRequestException);
    expect(v('shipping.eta_min_days', null, 4)).not.toThrow();
    expect(v('shipping.eta_max_days', null, 2)).not.toThrow();
  });

  // R4-ADMIN-8: cron nhắc giỏ bỏ quên lấy giỏ có updatedAt trong [now − max, now − min] mỗi giờ — min ≥ max là khoảng rỗng,
  // không giỏ nào được nhắc mà admin vẫn thấy "đã lưu". Khoá đối ứng chưa có dòng thì so với mặc định cron đang dùng (6/72).
  it('nhắc giỏ bỏ quên: max phải lớn hơn min hiện có (ít nhất 1 giờ); chưa có dòng thì so với mặc định 6/72', () => {
    const v = (k: string, n: unknown, partner?: unknown) => () => validateAdminConfigValue(k, n, partner);
    const MIN = 'remarketing.cart_abandon_min_hours';
    const MAX = 'remarketing.cart_abandon_max_hours';
    expect(configPartnerKey(MIN)).toBe(MAX);
    expect(configPartnerKey(MAX)).toBe(MIN);
    expect(v(MAX, 72, 6)).not.toThrow();
    expect(v(MAX, 7, 6)).not.toThrow();
    expect(v(MAX, 6, 6)).toThrow(BadRequestException);
    expect(v(MAX, 6, 72)).toThrow(/remarketing\.cart_abandon_min_hours/);
    expect(v(MIN, 72, 72)).toThrow(BadRequestException);
    expect(v(MIN, 72, 6)).toThrow(/remarketing\.cart_abandon_max_hours/);
    expect(v(MIN, 12, 72)).not.toThrow();
    expect(v(MIN, 72, undefined)).toThrow(/72/);
    expect(v(MIN, 71, undefined)).not.toThrow();
    expect(v(MAX, 6, null)).toThrow(BadRequestException);
    expect(v(MAX, 7, undefined)).not.toThrow();
    expect(v(MIN, 1.5, 72)).toThrow(BadRequestException);
  });

  it('khoá khác: không can thiệp (SystemConfigService tự giữ kiểu/khoảng)', () => {
    ok('shipping.free_threshold', 200000);
    ok('misc.anything', { a: 1 });
  });
});

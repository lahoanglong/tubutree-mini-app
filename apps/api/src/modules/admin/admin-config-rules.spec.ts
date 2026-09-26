import { BadRequestException } from '@nestjs/common';
import { validateAdminConfigValue } from './admin-config-rules';

const ok = (key: string, value: unknown) => expect(() => validateAdminConfigValue(key, value)).not.toThrow();
const bad = (key: string, value: unknown) => expect(() => validateAdminConfigValue(key, value)).toThrow(BadRequestException);

/**
 * Các form cấu hình mới (Gomdon, tích điểm) ghi qua PUT /admin/config chung. SystemConfigService.set chỉ
 * giữ KIỂU dữ liệu; phía đọc thì lặng lẽ quay về mặc định khi giá trị sai (loyalty.getCheckInPointsTable,
 * positiveConfig) — admin bấm Lưu thấy "đã lưu" mà hệ thống vẫn chạy số cũ. Chặn ngay lúc ghi, báo rõ.
 */
describe('validateAdminConfigValue', () => {
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

  it('khoá khác: không can thiệp (SystemConfigService tự giữ kiểu/khoảng)', () => {
    ok('shipping.free_threshold', 200000);
    ok('misc.anything', { a: 1 });
  });
});

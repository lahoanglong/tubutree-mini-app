import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCouponDto } from './admin.controller';

// Kiểm chứng 2 finding tồn đọng từ Phase 1 (đã sửa ở admin.controller.ts):
// 1) perUserLimit: @Min(0) — 0 vẫn hợp lệ (= không giới hạn, nhất quán coupons.service.ts).
// 2) value: @MaxIfPercent(100) — chặn admin nhập PERCENT > 100% nhưng KHÔNG áp cho AMOUNT.
describe('CreateCouponDto validation (Phase 1 findings)', () => {
  const base = {
    code: 'SALE10',
    type: 'PERCENT',
    value: 10,
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-12-31T00:00:00.000Z',
    scope: 'PUBLIC',
  };

  function makeDto(overrides: Record<string, unknown>) {
    return plainToInstance(CreateCouponDto, { ...base, ...overrides });
  }

  it('perUserLimit âm → lỗi validate (chặn số vô nghĩa)', async () => {
    const errors = await validate(makeDto({ perUserLimit: -1 }));
    expect(errors.some((e) => e.property === 'perUserLimit')).toBe(true);
  });

  it('perUserLimit = 0 → HỢP LỆ (0 = không giới hạn, nhất quán với coupons.service.ts)', async () => {
    const errors = await validate(makeDto({ perUserLimit: 0 }));
    expect(errors.some((e) => e.property === 'perUserLimit')).toBe(false);
  });

  it('perUserLimit không truyền → hợp lệ (optional)', async () => {
    const errors = await validate(makeDto({}));
    expect(errors.some((e) => e.property === 'perUserLimit')).toBe(false);
  });

  it('type=PERCENT, value=500 → lỗi validate (chặn % vô lý)', async () => {
    const errors = await validate(makeDto({ type: 'PERCENT', value: 500 }));
    expect(errors.some((e) => e.property === 'value')).toBe(true);
  });

  it('type=PERCENT, value=100 → hợp lệ (biên trên cho phép)', async () => {
    const errors = await validate(makeDto({ type: 'PERCENT', value: 100 }));
    expect(errors.some((e) => e.property === 'value')).toBe(false);
  });

  it('type=AMOUNT, value=500 → hợp lệ (không giới hạn trên cho AMOUNT)', async () => {
    const errors = await validate(makeDto({ type: 'AMOUNT', value: 500 }));
    expect(errors.some((e) => e.property === 'value')).toBe(false);
  });

  it('value âm → lỗi validate (cả PERCENT lẫn AMOUNT)', async () => {
    const errors = await validate(makeDto({ type: 'AMOUNT', value: -5 }));
    expect(errors.some((e) => e.property === 'value')).toBe(true);
  });
});

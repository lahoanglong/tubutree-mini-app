import { describe, expect, it } from 'vitest';
import { checkoutEtaLabel } from '../shipping-eta';
import { pdpEtaText, pdpFreeshipGap, type GapCartLine } from './pdp-view';

const ETA = { minDays: 2, maxDays: 4 };

describe('pdpEtaText: cùng khoảng ngày với thanh toán', () => {
  it.each([
    ['giữa ngày', '2026-11-18T05:00:00Z'],
    ['23:59 giờ Việt Nam (16:59 UTC)', '2026-11-18T16:59:59Z'],
    ['00:00 giờ Việt Nam, UTC vẫn là hôm trước', '2026-11-18T17:00:00Z'],
    ['cuối tháng, khoảng ngày sang tháng sau', '2026-11-29T10:00:00Z'],
    ['cuối năm', '2026-12-30T18:30:00Z'],
  ])('%s', (_label, iso) => {
    const now = new Date(iso);
    expect(pdpEtaText(ETA, 'TUBU', true, now)).toBe(`Nhận dự kiến ${checkoutEtaLabel(ETA, ['TUBU'], now)}`);
  });

  it('qua nửa đêm giờ Việt Nam thì đổi ngày (không theo UTC)', () => {
    expect(pdpEtaText(ETA, 'TUBU', true, new Date('2026-11-18T16:59:59Z'))).toBe('Nhận dự kiến 20/11 – 22/11');
    expect(pdpEtaText(ETA, 'TUBU', true, new Date('2026-11-18T17:00:00Z'))).toBe('Nhận dự kiến 21/11 – 23/11');
    expect(pdpEtaText(ETA, 'TUBU', true, new Date('2026-11-29T10:00:00Z'))).toBe('Nhận dự kiến 01/12 – 03/12');
  });

  it('không hứa ngày: hàng gian hàng tự giao, gian hàng tạm nghỉ, không rõ nơi giao, hết hàng, chưa cấu hình', () => {
    const now = new Date('2026-11-18T05:00:00Z');
    expect(pdpEtaText(ETA, 'MERCHANT', true, now)).toBeNull();
    expect(pdpEtaText(ETA, 'UNAVAILABLE', true, now)).toBeNull();
    expect(pdpEtaText(ETA, undefined, true, now)).toBeNull();
    expect(pdpEtaText(ETA, 'TUBU', false, now)).toBeNull();
    expect(pdpEtaText(null, 'TUBU', true, now)).toBeNull();
  });

  it('luôn có chữ "dự kiến"', () => {
    expect(pdpEtaText({ minDays: 1, maxDays: 1 }, 'TUBU', true, new Date('2026-11-18T05:00:00Z'))).toBe('Nhận dự kiến 19/11');
  });
});

const line = (variationId: string, total: number, extra: Partial<GapCartLine> = {}): GapCartLine => ({ variationId, total, stock: 9, ...extra });

describe('pdpFreeshipGap', () => {
  it('giỏ cộng món đang xem còn thiếu: nói số còn thiếu', () => {
    expect(pdpFreeshipGap({ lines: [line('x', 60_000)], threshold: 199_000, variationId: 'v', lineTotal: 80_000 })).toBe(
      'Món này + 59.000đ là miễn phí giao',
    );
  });

  it('thêm món này là vừa đủ', () => {
    expect(pdpFreeshipGap({ lines: [line('x', 119_000)], threshold: 199_000, variationId: 'v', lineTotal: 80_000 })).toBe('Thêm món này là đủ miễn phí giao');
  });

  it('giỏ đã đủ trước khi thêm: chỉ nói đơn đã được miễn phí giao', () => {
    expect(pdpFreeshipGap({ lines: [line('x', 199_000)], threshold: 199_000, variationId: 'v', lineTotal: 80_000 })).toBe('Đơn này được miễn phí giao hàng');
  });

  it('ngưỡng lấy từ cấu hình truyền vào, không ghi cứng 199.000đ', () => {
    expect(pdpFreeshipGap({ lines: [], threshold: 250_000, variationId: 'v', lineTotal: 140_000 })).toBe(
      'Món này + 110.000đ là miễn phí giao',
    );
    expect(pdpFreeshipGap({ lines: [], threshold: 199_000, variationId: 'v', lineTotal: 140_000 })).toBe(
      'Món này + 59.000đ là miễn phí giao',
    );
  });

  it('khách có hạng với ngưỡng riêng thấp hơn (máy chủ trả trong giỏ) đã đủ thì không bị báo còn thiếu', () => {
    expect(pdpFreeshipGap({ lines: [line('x', 150_000)], threshold: 149_000, variationId: 'v', lineTotal: 40_000 })).toBe('Đơn này được miễn phí giao hàng');
    expect(pdpFreeshipGap({ lines: [line('x', 100_000)], threshold: 149_000, variationId: 'v', lineTotal: 49_000 })).toBe('Thêm món này là đủ miễn phí giao');
  });

  it('mã miễn phí giao của máy chủ: chỉ tin khi giỏ toàn hàng Tubu còn hàng', () => {
    expect(pdpFreeshipGap({ lines: [line('x', 10_000)], threshold: 199_000, serverFree: true, variationId: 'v', lineTotal: 1 })).toBe('Đơn này được miễn phí giao hàng');
    expect(pdpFreeshipGap({ lines: [line('x', 10_000), line('y', 5_000, { stock: 0 })], threshold: 199_000, serverFree: true, variationId: 'v', lineTotal: 1 })).toBe(
      'Món này + 188.999đ là miễn phí giao',
    );
  });

  it('dòng hết hàng và hàng gian hàng tự giao không cộng vào phần Tubu', () => {
    const lines = [line('x', 100_000), line('y', 90_000, { stock: 0 }), line('z', 90_000, { fulfiller: { kind: 'MERCHANT', name: 'Shop A' } })];
    expect(pdpFreeshipGap({ lines, threshold: 199_000, variationId: 'v', lineTotal: 50_000 })).toBe('Món này + 49.000đ là miễn phí giao');
  });

  it('phân loại đã có trong giỏ: dùng tiền cả dòng sau khi thêm, không cộng hai lần', () => {
    expect(pdpFreeshipGap({ lines: [line('v', 80_000)], threshold: 199_000, variationId: 'v', lineTotal: 160_000 })).toBe(
      'Món này + 39.000đ là miễn phí giao',
    );
  });

  it('món của gian hàng tự giao: chỉ cộng phần của gian hàng đó, ngưỡng của gian hàng', () => {
    const lines = [line('x', 150_000), line('z', 90_000, { fulfiller: { kind: 'MERCHANT', name: 'Shop A' } }), line('w', 50_000, { fulfiller: { kind: 'MERCHANT', name: 'Shop B' } })];
    expect(pdpFreeshipGap({ lines, threshold: 200_000, store: 'Shop A', variationId: 'v', lineTotal: 60_000 })).toBe(
      'Món này + 50.000đ là miễn phí giao',
    );
    expect(pdpFreeshipGap({ lines, threshold: 200_000, store: 'Shop A', serverFree: true, variationId: 'v', lineTotal: 60_000 })).toBe(
      'Món này + 50.000đ là miễn phí giao',
    );
  });

  it('không nói gì khi chưa có giỏ, chưa có ngưỡng, ngưỡng 0, hay món hết hàng mà giỏ chưa đủ', () => {
    expect(pdpFreeshipGap({ lines: undefined, threshold: 199_000, variationId: 'v', lineTotal: 1 })).toBeNull();
    expect(pdpFreeshipGap({ lines: [], threshold: undefined, variationId: 'v', lineTotal: 1 })).toBeNull();
    expect(pdpFreeshipGap({ lines: [], threshold: 0, variationId: 'v', lineTotal: 1 })).toBeNull();
    expect(pdpFreeshipGap({ lines: [line('x', 10_000)], threshold: 199_000, variationId: 'v', lineTotal: null })).toBeNull();
    expect(pdpFreeshipGap({ lines: [line('x', 199_000)], threshold: 199_000, variationId: 'v', lineTotal: null })).toBe('Đơn này được miễn phí giao hàng');
  });
});

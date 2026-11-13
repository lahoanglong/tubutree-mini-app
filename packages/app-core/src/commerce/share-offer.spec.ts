import { describe, expect, it } from 'vitest';
import { SHARE_DESCRIPTION_MAX, SHARE_TITLE_MAX, clipShareText, shareDescription, shareOfferLine, welcomeOfferOf } from './share-offer';
import { FORBIDDEN_TERMS } from '../shop-copy';

const PROD = { amount: 30_000, minOrder: 199_000 };

describe('welcomeOfferOf', () => {
  it('đọc mã chào mừng từ cấu hình công khai', () => {
    expect(welcomeOfferOf({ newCustomer: { welcomeVoucher: PROD } })).toEqual(PROD);
  });

  it('thiếu cấu hình, thiếu mã hay mệnh giá không hợp lệ thì null: không đoán số', () => {
    expect(welcomeOfferOf(undefined)).toBeNull();
    expect(welcomeOfferOf({})).toBeNull();
    expect(welcomeOfferOf({ newCustomer: {} })).toBeNull();
    expect(welcomeOfferOf({ newCustomer: { welcomeVoucher: null } })).toBeNull();
    expect(welcomeOfferOf({ newCustomer: { welcomeVoucher: { amount: 0, minOrder: 199_000 } } })).toBeNull();
    expect(welcomeOfferOf({ newCustomer: { welcomeVoucher: { amount: -1, minOrder: 0 } } })).toBeNull();
    expect(welcomeOfferOf({ newCustomer: { welcomeVoucher: { amount: 30_000.5, minOrder: 0 } } })).toBeNull();
    expect(welcomeOfferOf({ newCustomer: { welcomeVoucher: { amount: '30000', minOrder: 0 } } })).toBeNull();
  });

  it('đơn tối thiểu thiếu hoặc sai thì coi là không yêu cầu (0)', () => {
    expect(welcomeOfferOf({ newCustomer: { welcomeVoucher: { amount: 30_000 } } })).toEqual({ amount: 30_000, minOrder: 0 });
    expect(welcomeOfferOf({ newCustomer: { welcomeVoucher: { amount: 30_000, minOrder: 'x' } } })).toEqual({ amount: 30_000, minOrder: 0 });
  });
});

describe('shareOfferLine', () => {
  it('với số trên PROD đúng chữ chủ chốt: 30.000đ, đơn đầu từ 199k', () => {
    expect(shareOfferLine(PROD)).toBe('Tặng mã 30.000đ cho đơn đầu từ 199k khi mở trên Tubu Tree');
  });

  it('số do Admin đặt chảy theo cấu hình, không viết cứng', () => {
    expect(shareOfferLine({ amount: 50_000, minOrder: 300_000 })).toBe('Tặng mã 50.000đ cho đơn đầu từ 300k khi mở trên Tubu Tree');
    expect(shareOfferLine({ amount: 20_000, minOrder: 150_500 })).toContain('150.500đ');
  });

  it('không yêu cầu đơn tối thiểu thì bỏ vế "từ …"', () => {
    expect(shareOfferLine({ amount: 30_000, minOrder: 0 })).toBe('Tặng mã 30.000đ cho đơn đầu khi mở trên Tubu Tree');
  });

  it('chưa có số thì câu không số', () => {
    const line = shareOfferLine(null);
    expect(line).toBe('Tặng mã giảm giá cho đơn đầu khi mở trên Tubu Tree');
    expect(line).not.toMatch(/\d/);
    expect(shareOfferLine(undefined)).toBe(line);
  });

  it('không dính thuật ngữ cấm của gian hàng', () => {
    for (const text of [shareOfferLine(PROD), shareOfferLine(null), shareOfferLine({ amount: 30_000, minOrder: 0 })]) {
      expect(FORBIDDEN_TERMS.filter((t) => t.pattern.test(text)).map((t) => t.use)).toEqual([]);
    }
  });
});

describe('shareDescription', () => {
  it('dòng ưu đãi đứng đầu, rồi mô tả sản phẩm', () => {
    expect(shareDescription('Gel rửa tay bồ hòn', PROD)).toBe('Tặng mã 30.000đ cho đơn đầu từ 199k khi mở trên Tubu Tree. Gel rửa tay bồ hòn');
  });

  it('mô tả rỗng, null hay toàn khoảng trắng thì chỉ có dòng ưu đãi', () => {
    const only = shareOfferLine(PROD);
    expect(shareDescription('', PROD)).toBe(only);
    expect(shareDescription(null, PROD)).toBe(only);
    expect(shareDescription('   \n ', PROD)).toBe(only);
  });

  it('mô tả dài bị cắt để cả chuỗi ≤ 400 ký tự và dòng ưu đãi còn nguyên', () => {
    const out = shareDescription('Rất dài. '.repeat(200), PROD);
    expect(out.length).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX);
    expect(out.startsWith(shareOfferLine(PROD))).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('cắt không làm gãy cặp surrogate (emoji) và không vượt giới hạn', () => {
    const line = shareOfferLine(PROD);
    const room = SHARE_DESCRIPTION_MAX - line.length - 2;
    // Emoji hai đơn vị UTF-16 nằm đúng chỗ cắt.
    const base = 'a'.repeat(room - 2) + '🌿🌿🌿';
    const out = shareDescription(base, PROD);
    expect(out.length).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX);
    const code = out.charCodeAt(out.length - 2);
    expect(code >= 0xd800 && code <= 0xdbff).toBe(false);
  });

  it('gộp xuống dòng và khoảng trắng thừa của mô tả', () => {
    expect(shareDescription('Dòng một\n\n  dòng   hai', null)).toBe('Tặng mã giảm giá cho đơn đầu khi mở trên Tubu Tree. Dòng một dòng hai');
  });

  it('giới hạn tuỳ chọn nhỏ hơn dòng ưu đãi thì cắt dòng ưu đãi, không ném lỗi', () => {
    expect(shareDescription('abc', PROD, 10).length).toBeLessThanOrEqual(10);
  });

  it('dòng ưu đãi ngắn hơn giới hạn tiêu đề của thẻ: không bao giờ làm title vượt 100', () => {
    expect(shareOfferLine(PROD).length).toBeLessThan(SHARE_TITLE_MAX);
  });
});

describe('clipShareText', () => {
  it('ngắn hơn giới hạn thì giữ nguyên', () => {
    expect(clipShareText('abc', 3)).toBe('abc');
  });
  it('cắt thì thêm … và đúng giới hạn', () => {
    expect(clipShareText('abcdef', 4)).toBe('abc…');
  });
});

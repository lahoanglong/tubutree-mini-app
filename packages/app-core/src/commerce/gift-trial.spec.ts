import { describe, expect, it } from 'vitest';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { giftTrialPlaceField, giftTrialRowView, giftTrialSheetView, isGiftTrialError } from './gift-trial';

const option = (variationId: string, minOrder: number, unlocked: boolean, extra: Partial<GiftTrialSummaryDTO['options'][number]> = {}) => ({
  variationId,
  productName: `Khăn giấy tre ${variationId}`,
  variationName: 'Gói bỏ túi',
  slug: `khan-${variationId}`,
  thumbnail: `https://img/${variationId}.webp`,
  minOrder,
  unlocked,
  ...extra,
});

const summary = (over: Partial<GiftTrialSummaryDTO> = {}): GiftTrialSummaryDTO => ({
  base: 320_000,
  minOrder: 299_000,
  nextMinOrder: 499_000,
  shortfall: 179_000,
  options: [option('small', 299_000, true), option('big', 499_000, false)],
  selectedVariationId: 'small',
  declined: false,
  ...over,
});

describe('giftTrialRowView', () => {
  it('không có khối quà thì không vẽ gì', () => {
    expect(giftTrialRowView(undefined, { showLocked: true })).toBeNull();
    expect(giftTrialRowView(summary({ options: [] }), { showLocked: true })).toBeNull();
  });

  it('chưa đủ mốc: Giỏ nhắc số còn thiếu, Thanh toán ẩn', () => {
    const locked = summary({ base: 254_000, nextMinOrder: 299_000, shortfall: 45_000, selectedVariationId: null, options: [option('small', 299_000, false)] });
    expect(giftTrialRowView(locked, { showLocked: true })).toEqual({
      state: 'locked',
      label: '🎁 Thêm 45.000đ để nhận quà dùng thử 0đ',
      sub: null,
      action: null,
    });
    expect(giftTrialRowView(locked, { showLocked: false })).toBeNull();
  });

  it('đã chọn quà: tên quà, nút Đổi, nhắc mốc kế', () => {
    expect(giftTrialRowView(summary(), { showLocked: false })).toEqual({
      state: 'chosen',
      label: '🎁 Quà 0đ: Khăn giấy tre small · Gói bỏ túi',
      sub: 'Thêm 179.000đ để mở thêm quà',
      action: 'Đổi',
    });
  });

  it('đã mở hết mốc thì không nhắc mốc kế; biến thể "Mặc định" không lặp vào tên', () => {
    const all = summary({ nextMinOrder: null, shortfall: 0, options: [option('small', 299_000, true, { variationName: 'Mặc định' })] });
    expect(giftTrialRowView(all, { showLocked: false })).toMatchObject({ label: '🎁 Quà 0đ: Khăn giấy tre small', sub: null });
  });

  it('khách chọn không nhận quà: dòng nói rõ và nút Chọn quà', () => {
    expect(giftTrialRowView(summary({ declined: true, selectedVariationId: null }), { showLocked: false })).toMatchObject({
      state: 'declined',
      label: '🎁 Không nhận quà dùng thử 0đ',
      action: 'Chọn quà',
    });
  });
});

describe('giftTrialSheetView', () => {
  it('quà theo mốc, quà chưa mở bị khoá kèm mốc, cuối là Không nhận quà', () => {
    const v = giftTrialSheetView(summary());
    expect(v.title).toBe('Chọn quà tặng 0đ');
    expect(v.options.map((o) => [o.variationId, o.hint, o.checked, o.disabled])).toEqual([
      ['small', '0đ', true, false],
      ['big', 'Đơn từ 499.000đ', false, true],
      [null, 'Đơn vẫn giữ nguyên số tiền', false, false],
    ]);
    expect(v.footer).toBe('Thêm 179.000đ để mở thêm quà');
  });

  it('đã từ chối thì chỉ hàng Không nhận quà được chọn', () => {
    const v = giftTrialSheetView(summary({ declined: true, selectedVariationId: null }));
    expect(v.options.filter((o) => o.checked).map((o) => o.variationId)).toEqual([null]);
  });
});

describe('giftTrialPlaceField', () => {
  it('báo giá không có khối quà: không gửi trường (máy chủ theo lựa chọn ở giỏ)', () => {
    expect(giftTrialPlaceField(undefined)).toEqual({});
  });

  it('gửi đúng quà đang thấy; từ chối hoặc chưa đủ mốc gửi null', () => {
    expect(giftTrialPlaceField(summary())).toEqual({ giftVariationId: 'small' });
    expect(giftTrialPlaceField(summary({ declined: true, selectedVariationId: null }))).toEqual({ giftVariationId: null });
    expect(giftTrialPlaceField(summary({ selectedVariationId: 'big' }))).toEqual({ giftVariationId: null });
  });
});

describe('isGiftTrialError', () => {
  it('nhận mã lỗi ở thân phản hồi axios (Mini) và ở lỗi ApiError (web)', () => {
    expect(isGiftTrialError({ response: { data: { code: 'GIFT_TRIAL_CHANGED' } } })).toBe(true);
    expect(isGiftTrialError({ code: 'GIFT_TRIAL_UNAVAILABLE' })).toBe(true);
    expect(isGiftTrialError({ code: 'TOTAL_CHANGED' })).toBe(false);
    expect(isGiftTrialError(null)).toBe(false);
  });
});

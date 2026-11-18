import { describe, expect, it } from 'vitest';
import type { PickupOptionItem, PickupOptionsResponse, ReturnPackagingSuggestion } from '@tubutree/shared-types';
import { pickupFieldsOf } from './checkout-pickup-state';
import { packagingItemsText, pickupNudgeView, returnNudge } from './return-packaging';

const item = (over: Partial<PickupOptionItem> = {}): PickupOptionItem => ({
  id: 'wi-carton',
  code: 'CARTON',
  name: 'Thùng carton cũ',
  unitLabel: 'thùng',
  unitsPerPoint: 1,
  pointsPerGroup: 1000,
  hazardous: false,
  blockedReason: null,
  prepInstructions: null,
  ...over,
});
const bottle = item({ id: 'wi-tubu-bottle', code: 'TUBU_BOTTLE', name: 'Vỏ chai, hộp Tubu Tree', unitLabel: 'vỏ', pointsPerGroup: 2000 });

const suggestion = (over: Partial<ReturnPackagingSuggestion> = {}): ReturnPackagingSuggestion => ({
  orderCodes: ['TT1'],
  lines: [
    { itemId: 'wi-carton', code: 'CARTON', name: 'Thùng carton cũ', unitLabel: 'thùng', qty: 1, unitsPerPoint: 1, pointsPerGroup: 1000 },
    { itemId: 'wi-tubu-bottle', code: 'TUBU_BOTTLE', name: 'Vỏ chai, hộp Tubu Tree', unitLabel: 'vỏ', qty: 2, unitsPerPoint: 1, pointsPerGroup: 2000 },
  ],
  estimatedPoints: 5000,
  minPoints: 3000,
  ...over,
});

const options = (over: Partial<PickupOptionsResponse> = {}): PickupOptionsResponse => ({
  gateOpen: true,
  minPoints: 3000,
  orderWeightGrams: 2400,
  maxReturnWeightGrams: 2400,
  items: [item(), bottle],
  existingRequest: null,
  suggestion: suggestion(),
  ...over,
});

const EXISTING = { id: 'r1', code: 'TR-ABCDE', estimatedPoints: 4000, lines: [{ itemId: 'wi-carton', itemName: 'Thùng carton cũ', unitLabel: 'thùng', declaredQty: 4 }] };

describe('packagingItemsText', () => {
  it('tên ngắn cho thùng carton và vỏ Tubu Tree, món khác dùng tên món viết thường chữ đầu', () => {
    expect(packagingItemsText(suggestion().lines)).toBe('1 thùng carton, 2 vỏ chai Tubu Tree');
    expect(packagingItemsText([{ code: 'BUBBLE_WRAP', name: 'Nilon chống sốc', qty: 1200 }])).toBe('1.200 nilon chống sốc');
  });
});

describe('returnNudge', () => {
  it('bao bì từ đơn đủ ngưỡng → một chạm, điền đúng số lượng và mức kg nhỏ nhất', () => {
    const n = returnNudge(options());
    expect(n).toMatchObject({ source: 'ORDER', oneTap: true, points: 5000, missingPoints: 0, orderCount: 1, requestCode: null, itemsText: '1 thùng carton, 2 vỏ chai Tubu Tree' });
    expect(n!.draft).toEqual({ requestId: null, qty: { 'wi-carton': 1, 'wi-tubu-bottle': 2 }, returnWeightGrams: 500 });
    expect(pickupFieldsOf(n!.draft)).toEqual({ inlinePickup: { lines: [{ itemId: 'wi-carton', qty: 1 }, { itemId: 'wi-tubu-bottle', qty: 2 }] }, returnWeightGrams: 500 });
  });

  it('chưa đủ ngưỡng → không một chạm, nêu số điểm còn thiếu', () => {
    const n = returnNudge(options({ suggestion: suggestion({ lines: [suggestion().lines[0]!], estimatedPoints: 1000 }) }));
    expect(n).toMatchObject({ source: 'ORDER', oneTap: false, points: 1000, missingPoints: 2000 });
  });

  it('kiện quá nhẹ không có mức kg nào (trần < 0,5 kg) → không một chạm dù đủ điểm', () => {
    expect(returnNudge(options({ maxReturnWeightGrams: 300 }))?.oneTap).toBe(false);
  });

  it('món không còn nhận hoặc bị chặn ở địa chỉ này rời gợi ý; hết món → null', () => {
    const n = returnNudge(options({ items: [item()] }));
    expect(n?.draft.qty).toEqual({ 'wi-carton': 1 });
    expect(n?.itemsText).toBe('1 thùng carton');
    expect(returnNudge(options({ items: [item({ blockedReason: 'BATTERY_OUT_OF_HCM' })] }))).toBeNull();
  });

  it('số lượng kẹp ở 999 như ô số của ngăn chọn món', () => {
    const big = suggestion({ lines: [{ ...suggestion().lines[0]!, qty: 5000 }] });
    expect(returnNudge(options({ suggestion: big }))?.draft.qty).toEqual({ 'wi-carton': 999 });
  });

  it('phiếu thu kèm đã đăng ký thắng bao bì từ đơn: dùng nguyên phiếu', () => {
    const n = returnNudge(options({ existingRequest: EXISTING }));
    expect(n).toMatchObject({ source: 'REQUEST', oneTap: true, points: 4000, requestCode: 'TR-ABCDE', itemsText: 'Thùng carton cũ ×4' });
    expect(pickupFieldsOf(n!.draft)).toEqual({ wasteRequestId: 'r1', returnWeightGrams: 500 });
  });

  it('cổng đóng, chưa tải, hay không có gợi ý (cờ tắt, API cũ) → null', () => {
    expect(returnNudge(undefined)).toBeNull();
    expect(returnNudge(options({ gateOpen: false }))).toBeNull();
    expect(returnNudge(options({ suggestion: null }))).toBeNull();
    expect(returnNudge(options({ suggestion: undefined }))).toBeNull();
  });
});

describe('pickupNudgeView', () => {
  it('một đơn, một chạm', () => {
    expect(pickupNudgeView(returnNudge(options())!)).toEqual({
      lead: 'Đơn trước bạn có 1 thùng carton, 2 vỏ chai Tubu Tree',
      benefit: 'Bật để gửi kèm đơn này: Miễn phí giao hàng, +5.000 Điểm Xanh',
      oneTap: true,
      ariaLabel: '♻️ Đổi rác kèm đơn — Đơn trước bạn có 1 thùng carton, 2 vỏ chai Tubu Tree. Bật để gửi kèm đơn này: Miễn phí giao hàng, +5.000 Điểm Xanh',
    });
  });

  it('nhiều đơn và thiếu điểm', () => {
    const v = pickupNudgeView(returnNudge(options({ suggestion: suggestion({ orderCodes: ['TT2', 'TT1'], lines: [{ ...suggestion().lines[0]!, qty: 2 }] }) }))!);
    expect(v.lead).toBe('2 đơn trước bạn có 2 thùng carton');
    expect(v.benefit).toBe('Còn thiếu 1.000 điểm để gửi kèm, chạm để thêm món');
    expect(v.oneTap).toBe(false);
  });

  it('phiếu có sẵn', () => {
    expect(pickupNudgeView(returnNudge(options({ existingRequest: EXISTING }))!).lead).toBe('Phiếu TR-ABCDE chờ gửi: Thùng carton cũ ×4');
  });
});

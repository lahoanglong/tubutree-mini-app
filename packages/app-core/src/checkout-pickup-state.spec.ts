import { describe, expect, it } from 'vitest';
import type { PickupOptionItem, PickupOptionsResponse, QuotePendingGiftDTO } from '@tubutree/shared-types';
import {
  defaultReturnWeightGrams,
  draftFromRequestLines,
  draftLines,
  draftPoints,
  draftUsingRequest,
  giftLayout,
  inlinePoints,
  itemPoints,
  kgLabel,
  pickupConfirmState,
  pickupFieldsOf,
  pruneExcludedGifts,
  reconcileDraft,
  returnWeightChips,
  setItemQty,
  toggleExcludedGift,
  visibleGifts,
  type PickupDraft,
} from './checkout-pickup-state';

const item = (over: Partial<PickupOptionItem> = {}): PickupOptionItem => ({
  id: 'bottle',
  code: 'BOTTLE',
  name: 'Vỏ chai',
  unitLabel: 'chai',
  unitsPerPoint: 10,
  pointsPerGroup: 100,
  hazardous: false,
  blockedReason: null,
  prepInstructions: null,
  ...over,
});
const battery = item({ id: 'battery', name: 'Pin cũ', unitLabel: 'viên', unitsPerPoint: 1, pointsPerGroup: 500, hazardous: true, blockedReason: 'BATTERY_OUT_OF_HCM' });

const options = (over: Partial<PickupOptionsResponse> = {}): PickupOptionsResponse => ({
  gateOpen: true,
  minPoints: 3000,
  orderWeightGrams: 4000,
  maxReturnWeightGrams: 4000,
  items: [item(), battery],
  existingRequest: null,
  ...over,
});

const draft = (over: Partial<PickupDraft> = {}): PickupDraft => ({ requestId: null, qty: {}, returnWeightGrams: null, ...over });

describe('returnWeightChips / defaultReturnWeightGrams', () => {
  it('chỉ giữ mức không vượt trần theo kiện mua', () => {
    expect(returnWeightChips(10000)).toEqual([500, 1000, 2000, 3000, 5000]);
    expect(returnWeightChips(2500)).toEqual([500, 1000, 2000]);
    expect(returnWeightChips(500)).toEqual([500]);
    expect(returnWeightChips(300)).toEqual([]);
  });

  it('mặc định là mức nhỏ nhất không thấp hơn ước lượng; vượt mọi mức thì lấy mức lớn nhất; không có chip thì null', () => {
    expect(defaultReturnWeightGrams([500, 1000, 2000])).toBe(500);
    expect(defaultReturnWeightGrams([500, 1000, 2000], 1200)).toBe(2000);
    expect(defaultReturnWeightGrams([500, 1000, 2000], 9000)).toBe(2000);
    expect(defaultReturnWeightGrams([])).toBeNull();
  });

  it('kgLabel dùng dấu phẩy kiểu Việt', () => {
    expect(kgLabel(500)).toBe('0,5');
    expect(kgLabel(2000)).toBe('2');
    expect(kgLabel(2500)).toBe('2,5');
  });
});

describe('điểm dự kiến', () => {
  it('floor(qty / unitsPerPoint) * pointsPerGroup, phần lẻ không có điểm, món bị chặn không có điểm', () => {
    expect(itemPoints(item(), 25)).toBe(200);
    expect(itemPoints(item(), 9)).toBe(0);
    expect(itemPoints(battery, 3)).toBe(0);
    expect(itemPoints(item({ unitsPerPoint: 0 }), 5)).toBe(0);
    expect(inlinePoints([item(), battery], { bottle: 30, battery: 4 })).toBe(300);
  });

  it('phiếu có sẵn lấy điểm máy chủ đã tính; phiếu không còn thì 0', () => {
    const existing = { id: 'r1', code: 'TH-1', estimatedPoints: 3400, lines: [] };
    expect(draftPoints(draftUsingRequest({ id: 'r1' }, 1000), options({ existingRequest: existing }))).toBe(3400);
    expect(draftPoints(draftUsingRequest({ id: 'r1' }, 1000), options())).toBe(0);
  });
});

describe('setItemQty', () => {
  it('kẹp 0..999, qty 0 gỡ món, chuyển sang chế độ chọn món', () => {
    const d = setItemQty(draftUsingRequest({ id: 'r1' }, 500), item(), 12);
    expect(d).toEqual({ requestId: null, qty: { bottle: 12 }, returnWeightGrams: 500 });
    expect(setItemQty(d, item(), 5000).qty.bottle).toBe(999);
    expect(setItemQty(d, item(), -3).qty).toEqual({});
    expect(setItemQty(d, item(), Number.NaN).qty).toEqual({});
  });

  it('món bị chặn (Pin cũ ngoài TP.HCM) không chọn được', () => {
    expect(setItemQty(draft(), battery, 2).qty).toEqual({});
  });

  it('draftFromRequestLines điền sẵn số lượng cũ để đổi món', () => {
    const d = draftFromRequestLines({ id: 'r1', code: 'TH-1', estimatedPoints: 100, lines: [{ itemId: 'bottle', itemName: 'Vỏ chai', unitLabel: 'chai', declaredQty: 20 }] }, 1000);
    expect(d).toEqual({ requestId: null, qty: { bottle: 20 }, returnWeightGrams: 1000 });
  });
});

describe('pickupConfirmState (điều kiện nút Xong)', () => {
  const o = options();
  it('chưa chọn món thì chặn vì noItems', () => {
    expect(pickupConfirmState(draft({ returnWeightGrams: 500 }), o)).toMatchObject({ ok: false, reason: 'noItems', points: 0 });
  });

  it('hụt ngưỡng điểm của máy chủ thì chặn belowMin kèm số điểm thiếu, ưu tiên hơn thiếu kg', () => {
    const s = pickupConfirmState(draft({ qty: { bottle: 20 } }), o);
    expect(s).toMatchObject({ ok: false, reason: 'belowMin', points: 200, missingPoints: 2800 });
  });

  it('đủ điểm nhưng chưa có kg hợp lệ thì noWeight; kg vượt trần cũng không hợp lệ', () => {
    expect(pickupConfirmState(draft({ qty: { bottle: 300 } }), o).reason).toBe('noWeight');
    expect(pickupConfirmState(draft({ qty: { bottle: 300 }, returnWeightGrams: 5000 }), o).reason).toBe('noWeight');
  });

  it('đủ điểm và kg hợp lệ thì bấm được; ngưỡng lấy từ máy chủ chứ không cố định 3.000', () => {
    expect(pickupConfirmState(draft({ qty: { bottle: 300 }, returnWeightGrams: 1000 }), o)).toMatchObject({ ok: true, reason: null, missingPoints: 0 });
    const low = options({ minPoints: 100 });
    expect(pickupConfirmState(draft({ qty: { bottle: 10 }, returnWeightGrams: 500 }), low).ok).toBe(true);
  });

  it('dùng phiếu có sẵn: cần phiếu còn đó, đủ điểm và có kg', () => {
    const existing = { id: 'r1', code: 'TH-1', estimatedPoints: 3000, lines: [] };
    expect(pickupConfirmState(draftUsingRequest({ id: 'r1' }, 500), options({ existingRequest: existing })).ok).toBe(true);
    expect(pickupConfirmState(draftUsingRequest({ id: 'r1' }, 500), options()).reason).toBe('noItems');
  });
});

describe('pickupFieldsOf (thân gửi lên báo giá/đặt đơn)', () => {
  it('chưa chọn gì thì object rỗng, thân y hệt bản cũ', () => {
    expect(pickupFieldsOf(null)).toEqual({});
    expect(pickupFieldsOf(draft({ returnWeightGrams: 500 }))).toEqual({});
  });

  it('chọn món: inlinePickup + returnWeightGrams, không có wasteRequestId', () => {
    expect(pickupFieldsOf(draft({ qty: { bottle: 30, gone: 0 }, returnWeightGrams: 2000 }))).toEqual({
      inlinePickup: { lines: [{ itemId: 'bottle', qty: 30 }] },
      returnWeightGrams: 2000,
    });
  });

  it('dùng phiếu có sẵn: wasteRequestId, không có inlinePickup', () => {
    const f = pickupFieldsOf(draftUsingRequest({ id: 'r1' }, 1000));
    expect(f).toEqual({ wasteRequestId: 'r1', returnWeightGrams: 1000 });
    expect(f).not.toHaveProperty('inlinePickup');
  });

  it('quà để đơn sau đi kèm dạng mảng đã sắp xếp, độc lập với thu rác', () => {
    expect(pickupFieldsOf(null, ['b', 'a'])).toEqual({ excludeGiftRedemptionIds: ['a', 'b'] });
    expect(draftLines(draft({ qty: { x: 2 } }))).toEqual([{ itemId: 'x', qty: 2 }]);
  });
});

describe('reconcileDraft (đổi địa chỉ, phiếu bị dùng nơi khác)', () => {
  it('gỡ món Pin cũ nay bị chặn; còn đủ điểm thì giữ phần còn lại', () => {
    const d = draft({ qty: { bottle: 300, battery: 2 }, returnWeightGrams: 1000 });
    const r = reconcileDraft(d, options());
    expect(r.draft?.qty).toEqual({ bottle: 300 });
    expect(r.changed).toBe(true);
  });

  it('gỡ món bị chặn làm hụt ngưỡng thì bỏ cả lựa chọn', () => {
    const r = reconcileDraft(draft({ qty: { bottle: 20, battery: 2 }, returnWeightGrams: 1000 }), options());
    expect(r).toEqual({ draft: null, changed: true });
  });

  it('cổng đóng, hoặc phiếu không còn, thì bỏ lựa chọn', () => {
    expect(reconcileDraft(draft({ qty: { bottle: 300 } }), options({ gateOpen: false })).draft).toBeNull();
    expect(reconcileDraft(draftUsingRequest({ id: 'r1' }, 500), options()).draft).toBeNull();
  });

  it('kg vượt trần mới (địa chỉ/kiện đổi) bị kẹp xuống chip lớn nhất hợp lệ; không đổi gì thì changed=false', () => {
    const d = draft({ qty: { bottle: 300 }, returnWeightGrams: 3000 });
    expect(reconcileDraft(d, options({ maxReturnWeightGrams: 2000 })).draft?.returnWeightGrams).toBe(2000);
    expect(reconcileDraft(d, options())).toEqual({ draft: d, changed: false });
  });
});

describe('quà 0đ', () => {
  const gift = (id: string, included: boolean): QuotePendingGiftDTO => ({ id, code: `QG-${id}`, giftName: `Quà ${id}`, kind: 'GIFT', pointsCost: 100, included });

  it('hiện quà đi cùng đơn và quà vừa bấm Để đơn sau; không có kiện Tubu (included=false hết, chưa bấm) thì ẩn', () => {
    expect(visibleGifts([gift('a', true), gift('b', false)], [])).toHaveLength(1);
    expect(visibleGifts([gift('a', false), gift('b', false)], ['b'])).toEqual([gift('b', false)]);
    expect(visibleGifts(undefined, [])).toEqual([]);
  });

  it('bật/tắt và dọn mã không còn trong ví', () => {
    expect(toggleExcludedGift([], 'a', false)).toEqual(['a']);
    expect(toggleExcludedGift(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(pruneExcludedGifts(['a', 'zzz'], [gift('a', true)])).toEqual(['a']);
    expect(pruneExcludedGifts(['a'], undefined)).toEqual(['a']);
  });

  it('từ 3 quà trở lên gộp một dòng', () => {
    expect([0, 1, 2, 3, 5].map(giftLayout)).toEqual(['none', 'rows', 'rows', 'merged', 'merged']);
  });
});

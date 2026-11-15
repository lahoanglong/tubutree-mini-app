import { describe, expect, it } from 'vitest';
import type { CheckoutPickupQuote, PickupOptionItem, QuotePendingGiftDTO } from '@tubutree/shared-types';
import { FORBIDDEN_TERMS } from './shop-copy';
import {
  giftSectionView,
  pickupCardView,
  pickupConfirmReasonLabel,
  pickupExistingLine,
  pickupItemList,
  pickupProgressView,
  pickupWeightView,
  shippingRowView,
} from './checkout-pickup-view';

const quote = (over: Partial<CheckoutPickupQuote> = {}): CheckoutPickupQuote => ({
  gateOpen: true,
  eligible: false,
  reason: null,
  mode: null,
  estimatedPoints: 0,
  minPoints: 3000,
  freeShip: false,
  shippingFeeWaived: 0,
  orderWeightGrams: 3000,
  maxReturnWeightGrams: 3000,
  returnWeightGrams: null,
  ...over,
});

describe('pickupCardView', () => {
  it('không hiện khi không có phần thu kèm hoặc cổng đóng', () => {
    expect(pickupCardView({ pickup: null, applied: false, tubuShippingFee: 19000 })).toBeNull();
    expect(pickupCardView({ pickup: undefined, applied: false, tubuShippingFee: 19000 })).toBeNull();
    expect(pickupCardView({ pickup: quote({ gateOpen: false }), applied: false, tubuShippingFee: 19000 })).toBeNull();
  });

  it('thẻ đóng: tiêu đề, lợi ích, huy hiệu theo phí giao hiện tại, aria nêu đủ câu', () => {
    const v = pickupCardView({ pickup: quote(), applied: false, tubuShippingFee: 19000 })!;
    expect(v).toMatchObject({ title: '♻️ Đổi rác kèm đơn', sub: 'Miễn 100% phí vận chuyển', badge: '-19.000đ phí giao', checked: false, disabled: false });
    expect(v.ariaLabel).toBe('♻️ Đổi rác kèm đơn — Miễn 100% phí vận chuyển');
  });

  it('phí giao đã 0 và chưa chọn thì không có huy hiệu', () => {
    expect(pickupCardView({ pickup: quote(), applied: false, tubuShippingFee: 0 })!.badge).toBeNull();
  });

  it('đã chọn đủ điều kiện: huy hiệu lấy shippingFeeWaived, dòng tóm tắt kg và điểm', () => {
    const v = pickupCardView({
      pickup: quote({ mode: 'INLINE', eligible: true, freeShip: true, shippingFeeWaived: 19000, estimatedPoints: 3000, returnWeightGrams: 2000 }),
      applied: true,
      tubuShippingFee: 0,
    })!;
    expect(v.badge).toBe('-19.000đ phí giao');
    expect(v.sub).toBe('Gửi lại ~2 kg · +3.000 điểm sau khi kho nhận');
    expect(v.checked).toBe(true);
  });

  it('đã chọn nhưng máy chủ nói chưa đủ điều kiện: hiện đúng câu của máy chủ, tông cảnh báo, vẫn tắt được', () => {
    const v = pickupCardView({ pickup: quote({ mode: 'INLINE', eligible: false, reason: 'Còn thiếu 500 điểm' }), applied: true, tubuShippingFee: 19000 })!;
    expect(v).toMatchObject({ sub: 'Còn thiếu 500 điểm', subTone: 'warn', disabled: false, badge: '-19.000đ phí giao' });
  });

  it('thu kèm tạm dừng với tài khoản (chưa chọn, có reason): hàng chỉ đọc', () => {
    const v = pickupCardView({ pickup: quote({ reason: 'Thu kèm tạm dừng' }), applied: false, tubuShippingFee: 19000 })!;
    expect(v).toMatchObject({ sub: 'Thu kèm tạm dừng', subTone: 'warn', disabled: true });
  });
});

describe('pickupItemList', () => {
  const bottle: PickupOptionItem = { id: 'b', code: 'B', name: 'Vỏ chai', unitLabel: 'chai', unitsPerPoint: 10, pointsPerGroup: 100, hazardous: false, blockedReason: null, prepInstructions: null };
  const battery: PickupOptionItem = { ...bottle, id: 'p', name: 'Pin cũ', unitLabel: 'viên', unitsPerPoint: 1, pointsPerGroup: 500, hazardous: true, blockedReason: 'BATTERY_OUT_OF_HCM' };

  it('dòng "N đơn vị = X điểm", món chặn xuống cuối, câu Pin cũ đúng một lần', () => {
    const v = pickupItemList([battery, bottle], { b: 20, p: 3 });
    expect(v.rows.map((r) => r.id)).toEqual(['b', 'p']);
    expect(v.rows[0]).toMatchObject({ detail: '10 chai = 100 điểm', blocked: false, qty: 20 });
    expect(v.rows[1]).toMatchObject({ blocked: true, qty: 0 });
    expect(v.blockedNote).toBe('Pin cũ cần xử lý an toàn riêng nên hiện chỉ nhận tại điểm thu gom hoặc lấy tận nơi khu vực TP.HCM');
  });

  it('không món nào bị chặn thì không có câu giải thích', () => {
    expect(pickupItemList([bottle], {}).blockedNote).toBeNull();
  });
});

describe('tiến độ, kg, lý do chặn', () => {
  it('tiến độ lấy ngưỡng từ tham số, phần trăm kẹp 0..100', () => {
    expect(pickupProgressView(1200, 3000)).toEqual({ label: 'Dự kiến 1.200 / 3.000 điểm', percent: 40 });
    expect(pickupProgressView(9000, 3000).percent).toBe(100);
    expect(pickupProgressView(0, 0).percent).toBe(100);
    expect(pickupProgressView(10, 500).label).toBe('Dự kiến 10 / 500 điểm');
  });

  it('chip kg chỉ tới trần; lời nhắc nêu trần theo kg định dạng Việt', () => {
    const v = pickupWeightView(2500);
    expect(v.chips.map((c) => c.label)).toEqual(['0,5 kg', '1 kg', '2 kg']);
    expect(v.note).toBe('Bưu tá Best Express giao đơn mới và nhận lại gói rác đã bọc gọn (tối đa 2,5 kg theo kiện mua). Điểm Xanh cộng sau khi kho kiểm nhận.');
  });

  it('mỗi lần chỉ một lý do chặn nút Xong', () => {
    expect(pickupConfirmReasonLabel({ ok: false, reason: 'noItems', points: 0, missingPoints: 3000 })).toBe('Chọn ít nhất một món rác');
    expect(pickupConfirmReasonLabel({ ok: false, reason: 'belowMin', points: 200, missingPoints: 2800 })).toBe('Còn thiếu 2.800 điểm');
    expect(pickupConfirmReasonLabel({ ok: false, reason: 'noWeight', points: 3000, missingPoints: 0 })).toBe('Chọn số kg gửi lại');
    expect(pickupConfirmReasonLabel({ ok: true, reason: null, points: 3000, missingPoints: 0 })).toBeNull();
  });

  it('tóm tắt phiếu có sẵn: mã, món, điểm', () => {
    expect(
      pickupExistingLine({ id: 'r', code: 'TH-12', estimatedPoints: 3400, lines: [{ itemId: 'b', itemName: 'Vỏ chai', unitLabel: 'chai', declaredQty: 30 }] }),
    ).toBe('Phiếu TH-12 · Vỏ chai ×30 · 3.400 điểm');
  });
});

describe('quà 0đ và dòng phí giao', () => {
  const gift = (id: string): QuotePendingGiftDTO => ({ id, code: null, giftName: `Hạt giống ${id}`, kind: 'SEED_PACK', pointsCost: 100, included: true });

  it('mỗi quà một dòng "🎁 Quà đổi điểm tặng kèm: tên · 0đ", receive đảo theo danh sách để lại', () => {
    const v = giftSectionView([gift('1'), gift('2')], ['2']);
    expect(v.layout).toBe('rows');
    expect(v.rows).toEqual([
      { id: '1', label: '🎁 Quà đổi điểm tặng kèm: Hạt giống 1 · 0đ', receive: true },
      { id: '2', label: '🎁 Quà đổi điểm tặng kèm: Hạt giống 2 · 0đ', receive: false },
    ]);
    expect(v.deferLabel).toBe('Để đơn sau');
  });

  it('từ 3 quà thì gộp một dòng', () => {
    const v = giftSectionView([gift('1'), gift('2'), gift('3')], []);
    expect(v).toMatchObject({ layout: 'merged', mergedLabel: '🎁 3 quà đổi điểm tặng kèm · 0đ' });
    expect(giftSectionView([gift('1'), gift('2'), gift('3')], ['2']).mergedLabel).toBe('🎁 2 quà đổi điểm tặng kèm · 0đ (để đơn sau 1)');
    expect(giftSectionView([gift('1'), gift('2'), gift('3')], ['1', '2', '3']).mergedLabel).toBe('🎁 3 quà đổi điểm tặng kèm · 0đ (để đơn sau)');
  });

  it('phí giao chỉ đổi dáng khi được miễn vì RECYCLE_PICKUP; phí gốc = phí hiện tại + phần miễn', () => {
    expect(shippingRowView({ shippingFee: 0, shippingFeeWaived: 19000, shippingFeeWaivedReason: 'RECYCLE_PICKUP' })).toEqual({
      waived: true,
      originalFee: 19000,
      note: 'Miễn phí vận chuyển (đổi rác kèm đơn)',
    });
    expect(shippingRowView({ shippingFee: 19000 })).toEqual({ waived: false, originalFee: 19000, note: null });
    expect(shippingRowView({ shippingFee: 0, shippingFeeWaived: 0, shippingFeeWaivedReason: null }).waived).toBe(false);
  });
});

describe('chữ mới', () => {
  it('mọi chữ trên thẻ, tấm và dòng quà không dính thuật ngữ cấm', () => {
    const v = pickupCardView({ pickup: quote({ mode: 'INLINE', eligible: true, shippingFeeWaived: 19000, estimatedPoints: 3000, returnWeightGrams: 500 }), applied: true, tubuShippingFee: 0 })!;
    const texts = [v.title, v.sub, v.badge ?? '', pickupWeightView(3000).note, pickupProgressView(0, 3000).label, giftSectionView([gift()], []).mergedLabel];
    for (const t of texts) for (const f of FORBIDDEN_TERMS) expect(f.pattern.test(t), t).toBe(false);
  });
});

function gift(): QuotePendingGiftDTO {
  return { id: 'g', code: null, giftName: 'Quà', kind: 'GIFT', pointsCost: 1, included: true };
}

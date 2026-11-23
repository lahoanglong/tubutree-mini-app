import { describe, expect, it } from 'vitest';
import { CHECKOUT_DRAFT_KEY, CHECKOUT_DRAFT_TTL_MS, draftAddressId, saveCheckoutDraft, takeCheckoutDraft, type DraftStorageLike } from './checkout-draft';

function memory(): DraftStorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

const T0 = 1_700_000_000_000;

describe('checkout-draft — giữ lựa chọn thanh toán qua một lần sang giỏ sửa hàng', () => {
  it('ghi rồi đọc lại đúng địa chỉ và ghi chú; đọc xong là xoá (không rò sang lần mua sau)', () => {
    const s = memory();
    saveCheckoutDraft(s, 'u1', { addressId: 'a2', note: 'Giao giờ hành chính' }, T0);
    expect(s.map.has(`${CHECKOUT_DRAFT_KEY}:u1`)).toBe(true);
    expect(takeCheckoutDraft(s, 'u1', T0 + 60_000)).toEqual({ addressId: 'a2', note: 'Giao giờ hành chính' });
    expect(takeCheckoutDraft(s, 'u1', T0 + 61_000)).toBeNull();
    expect(s.map.size).toBe(0);
  });

  it('theo tài khoản: tài khoản khác trên cùng tab không nhận lựa chọn của người trước, và nháp sót đó bị xoá (máy dùng chung)', () => {
    const s = memory();
    saveCheckoutDraft(s, 'u1', { addressId: 'a2', note: 'SĐT bảo vệ 0912345678' }, T0);
    expect(takeCheckoutDraft(s, 'u2', T0)).toBeNull();
    expect(s.map.size).toBe(0);
    saveCheckoutDraft(s, 'u1', { addressId: 'a2', note: '' }, T0);
    s.map.set('tubu_other_key', 'giữ');
    saveCheckoutDraft(s, 'u2', { addressId: 'b1', note: '' }, T0);
    expect([...s.map.keys()].sort()).toEqual([`${CHECKOUT_DRAFT_KEY}:u2`, 'tubu_other_key']);
    expect(takeCheckoutDraft(s, 'u2', T0)).toEqual({ addressId: 'b1', note: '' });
  });

  it('chưa có tài khoản hoặc không có bộ nhớ: không ghi, không đọc, không ném lỗi', () => {
    const s = memory();
    saveCheckoutDraft(s, undefined, { addressId: 'a1', note: '' }, T0);
    saveCheckoutDraft(null, 'u1', { addressId: 'a1', note: '' }, T0);
    expect(s.map.size).toBe(0);
    expect(takeCheckoutDraft(null, 'u1', T0)).toBeNull();
    expect(takeCheckoutDraft(s, null, T0)).toBeNull();
  });

  it('quá hạn 10 phút (hoặc mốc giờ ở tương lai) thì bỏ, và vẫn xoá khỏi bộ nhớ', () => {
    expect(CHECKOUT_DRAFT_TTL_MS).toBe(10 * 60_000);
    const s = memory();
    saveCheckoutDraft(s, 'u1', { addressId: 'a1', note: 'x' }, T0);
    expect(takeCheckoutDraft(s, 'u1', T0 + CHECKOUT_DRAFT_TTL_MS + 1)).toBeNull();
    expect(s.map.size).toBe(0);
    saveCheckoutDraft(s, 'u1', { addressId: 'a1', note: 'x' }, T0 + 5_000);
    expect(takeCheckoutDraft(s, 'u1', T0)).toBeNull();
    saveCheckoutDraft(s, 'u1', { addressId: 'a1', note: 'x' }, T0);
    expect(takeCheckoutDraft(s, 'u1', T0 + CHECKOUT_DRAFT_TTL_MS)).not.toBeNull();
  });

  it('dữ liệu hỏng hay lạ: JSON vỡ thì null; ghi chú cắt ở 500 ký tự; id địa chỉ quá dài bỏ; trường thừa (cách trả tiền) không được đọc lại', () => {
    const s = memory();
    s.map.set(`${CHECKOUT_DRAFT_KEY}:u1`, '{vỡ');
    expect(takeCheckoutDraft(s, 'u1', T0)).toBeNull();
    s.map.set(`${CHECKOUT_DRAFT_KEY}:u1`, JSON.stringify({ addressId: 'x'.repeat(65), note: 'n'.repeat(900), payment: 'ZALOPAY', at: T0 }));
    expect(takeCheckoutDraft(s, 'u1', T0)).toEqual({ addressId: null, note: 'n'.repeat(500) });
    s.map.set(`${CHECKOUT_DRAFT_KEY}:u1`, JSON.stringify({ addressId: 'a1', note: 3, payment: 'WALLET' }));
    expect(takeCheckoutDraft(s, 'u1', T0)).toBeNull();
  });

  it('bộ nhớ ném lỗi (Safari riêng tư): ghi và đọc đều im lặng', () => {
    const broken: DraftStorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(() => saveCheckoutDraft(broken, 'u1', { addressId: 'a1', note: '' }, T0)).not.toThrow();
    expect(takeCheckoutDraft(broken, 'u1', T0)).toBeNull();
  });

  it('draftAddressId: chỉ trả địa chỉ còn trong sổ; đã bị xoá ở nơi khác thì null để dùng địa chỉ mặc định', () => {
    const book = [{ id: 'a1' }, { id: 'a2' }];
    expect(draftAddressId({ addressId: 'a2', note: '' }, book)).toBe('a2');
    expect(draftAddressId({ addressId: 'gone', note: '' }, book)).toBeNull();
    expect(draftAddressId({ addressId: null, note: '' }, book)).toBeNull();
    expect(draftAddressId(null, book)).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { RefillOfferDTO } from './refill-api';
import { REFILL_SAVING_COPY, REFILL_SAVING_COPY_MAX, fetchRefillPair, pdpRefillPill, refillPairQuery, refillSavingBadge, refillSavingCopy, type RefillSavingCopyKey } from './refill-saving';
import { refillConfirmText, refillSwapOffers } from './refill-swap';

const offer = (over: Partial<RefillOfferDTO> = {}): RefillOfferDTO => ({
  productId: 'p-refill',
  slug: 'refill-nuoc-rua-chen-fuwa3e-10l-69f244',
  name: 'Refill Nước rửa chén Fuwa3e 10L',
  thumbnail: null,
  variationId: 'v-refill',
  price: 890_000,
  compareAt: null,
  sizeLabel: '10L',
  inStock: true,
  tubu: true,
  ...over,
});

describe('pdpRefillPill (trang chi tiết chai khách đã mua)', () => {
  it('chai 500ml 68.000đ → Refill 10L 890.000đ: nhãn đổi, huy hiệu rẻ hơn mỗi 100ml (làm tròn xuống), câu đọc bắt đầu bằng chữ nhìn thấy', () => {
    expect(pdpRefillPill({ name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 }, offer())).toEqual({
      slug: 'refill-nuoc-rua-chen-fuwa3e-10l-69f244',
      label: 'Đổi sang túi Refill 10L',
      badge: 'Rẻ hơn 34%/100ml',
      spoken: 'Đổi sang túi Refill 10L, rẻ hơn 34% mỗi 100ml',
    });
    expect(pdpRefillPill({ name: 'Nước rửa chén Fuwa3e 100ml', price: 17_000 }, offer())?.badge).toBe('Rẻ hơn 47%/100ml');
  });

  it('chai đang Giờ vàng: vẫn mời đổi nhưng không nêu mức rẻ hơn (giá khách thấy thấp hơn giá dùng để tính)', () => {
    expect(pdpRefillPill({ name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 }, offer(), { flash: true })).toEqual({
      slug: 'refill-nuoc-rua-chen-fuwa3e-10l-69f244',
      label: 'Đổi sang túi Refill 10L',
      badge: null,
      spoken: 'Đổi sang túi Refill 10L',
    });
  });

  it('không có cặp hay gói Refill hết hàng: không có dải', () => {
    expect(pdpRefillPill({ name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 }, undefined)).toBeNull();
    expect(pdpRefillPill({ name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 }, null)).toBeNull();
    expect(pdpRefillPill({ name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 }, offer({ inStock: false }))).toBeNull();
  });

  it('không đọc được lượng hay Refill không rẻ hơn: chỉ nhãn đổi, không hứa rẻ hơn', () => {
    expect(pdpRefillPill({ name: 'Nước rửa chén Fuwa3e', price: 68_000 }, offer())).toEqual(expect.objectContaining({ badge: null, spoken: 'Đổi sang túi Refill 10L' }));
    expect(pdpRefillPill({ name: 'Nước rửa chén Fuwa3e 500ml', price: 30_000 }, offer())?.badge).toBeNull();
    expect(pdpRefillPill({ name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 }, offer({ sizeLabel: null, name: 'Refill Nước rửa chén Fuwa3e' }))).toEqual(
      expect.objectContaining({ label: 'Đổi sang túi Refill', badge: null }),
    );
  });
});

describe('refillSavingBadge (liên kết đổi ở giỏ)', () => {
  it('đơn giá dòng chai so với gói Refill', () => {
    expect(refillSavingBadge({ name: 'Nước rửa tay dạng Bọt Fuwa3e 300ml', price: 87_000 }, offer({ price: 1_385_000 }))).toBe('Rẻ hơn 52%/100ml');
    expect(refillSavingBadge({ name: 'Nước rửa tay', price: 87_000 }, offer())).toBeNull();
  });

  it('refillSwapOffers gắn huy hiệu khi được truyền hàm tính và dòng giỏ có tên, đơn giá; thiếu một trong hai thì không có', () => {
    const base = { variationId: 'v-b', productId: 'p-b', quantity: 1, stock: 5, total: 68_000 };
    const pairs = { 'p-b': offer() };
    const milestones = { freeship: null, giftTrial: null, greenBox: null };
    const named = [{ ...base, id: 'l1', productName: 'Nước rửa chén Fuwa3e 500ml', unitPrice: 68_000 }];
    const withName = refillSwapOffers({ lines: named, pairs, comboGroups: [], milestones, saving: refillSavingBadge });
    expect(withName.get('l1')?.saving).toBe('Rẻ hơn 34%/100ml');
    const bare = refillSwapOffers({ lines: [{ ...base, id: 'l1' }], pairs, comboGroups: [], milestones, saving: refillSavingBadge });
    expect(bare.get('l1')?.saving).toBeNull();
    expect(refillSwapOffers({ lines: named, pairs, comboGroups: [], milestones }).get('l1')?.saving).toBeNull();
    expect(refillConfirmText(withName.get('l1')!).body).toBe('Refill Nước rửa chén Fuwa3e 10L · 890.000đ, dùng lại chai bạn đang có. Dòng này tăng 822.000đ. Rẻ hơn 34%/100ml.');
    expect(refillConfirmText(bare.get('l1')!).body).not.toContain('Rẻ hơn');
  });
});

describe('cặp công khai của một sản phẩm', () => {
  it('gọi /catalog/refill-pairs?ids=<id>; khoá truy vấn tách khỏi bản theo khách', async () => {
    const get = vi.fn(async () => ({}));
    await fetchRefillPair({ get } as never, 'p-1');
    expect(get).toHaveBeenCalledWith('/catalog/refill-pairs', { query: { ids: 'p-1' } });
    expect(refillPairQuery({ get } as never, 'p-1').queryKey).toEqual(['refill-pairs', 'public', 'p-1']);
  });
});

describe('chữ', () => {
  it('trần độ dài sau khi điền số xấu nhất (một dòng ở khổ 360)', () => {
    const vars = { pct: 99, per: '100ml', label: 'Đổi sang túi Refill 10L' };
    for (const key of Object.keys(REFILL_SAVING_COPY) as RefillSavingCopyKey[]) {
      expect(refillSavingCopy(key, vars).length, key).toBeLessThanOrEqual(REFILL_SAVING_COPY_MAX[key]);
    }
  });
});

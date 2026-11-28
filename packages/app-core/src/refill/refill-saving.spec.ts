import { describe, expect, it, vi } from 'vitest';
import type { RefillOfferDTO } from './refill-api';
import { REFILL_SAVING_COPY, REFILL_SAVING_COPY_MAX, fetchRefillPair, pdpRefillOffer, refillPairQuery, refillSavingBadge, refillSavingCopy, type RefillSavingCopyKey } from './refill-saving';
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

describe('pdpRefillOffer (thẻ so túi/can Refill ở trang chi tiết chai, mọi khách)', () => {
  const bottle = { name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 };

  it('chai 500ml 68.000đ → Refill 10L 890.000đ: tiết kiệm đúng số đồng (~%), thay 20 chai, giá gói, phân loại để thêm giỏ một chạm', () => {
    expect(pdpRefillOffer(bottle, offer())).toEqual({
      slug: 'refill-nuoc-rua-chen-fuwa3e-10l-69f244',
      productId: 'p-refill',
      variationId: 'v-refill',
      name: 'Refill Nước rửa chén Fuwa3e 10L',
      price: 890_000,
      title: 'Chọn túi Refill 10L tiết kiệm 470.000đ (~34%)',
      meta: 'Thay thế 20 chai nhựa · 890.000đ',
      addAria: 'Thêm Refill Nước rửa chén Fuwa3e 10L vào giỏ, 890.000đ',
      comparison: { savedVnd: 470_000, savedPct: 34, bottlesReplaced: 20 },
      pack: 'túi',
    });
  });

  it('gói tên "Can": nói can, không nói túi', () => {
    expect(pdpRefillOffer(bottle, offer({ name: 'Can Refill Nước rửa chén Fuwa3e 10L' }))?.title).toBe('Chọn can Refill 10L tiết kiệm 470.000đ (~34%)');
    expect(pdpRefillOffer(bottle, offer({ name: 'Can Refill Nước rửa chén Fuwa3e 10L' }))?.pack).toBe('can');
    expect(pdpRefillOffer(bottle, offer({ name: 'Refill nước rửa chén Candy 10L' }))?.title).toMatch(/^Chọn túi Refill/);
  });

  it('gói Refill nhỏ hơn một chai: chỉ mời chọn và giá gói, không so tiết kiệm với nửa chai', () => {
    const o = pdpRefillOffer({ name: 'Nước giặt 1L', price: 100_000 }, offer({ name: 'Refill Nước giặt 500ml', sizeLabel: '500ml', price: 40_000 }));
    expect(o).toEqual(expect.objectContaining({ title: 'Chọn túi Refill 500ml', meta: '40.000đ', comparison: null }));
  });

  it('gói Refill đang Giờ vàng: giá trên thẻ là giá Giờ vàng giỏ tính, không nêu số tiết kiệm dựa trên giá tạm thời', () => {
    const o = pdpRefillOffer(bottle, offer(), { packFlashPrice: 690_000 });
    expect(o).toEqual(expect.objectContaining({ title: 'Chọn túi Refill 10L', meta: '690.000đ', price: 690_000, comparison: null, addAria: 'Thêm Refill Nước rửa chén Fuwa3e 10L vào giỏ, 690.000đ' }));
    for (const bad of [0, -1, Number.NaN, null, undefined]) expect(pdpRefillOffer(bottle, offer(), { packFlashPrice: bad })?.meta).toBe('Thay thế 20 chai nhựa · 890.000đ');
  });

  it('chai đang Giờ vàng: vẫn mời chọn Refill nhưng không nêu số tiết kiệm hay số chai (giá khách thấy thấp hơn giá dùng để tính)', () => {
    const o = pdpRefillOffer(bottle, offer(), { flash: true });
    expect(o).toEqual(expect.objectContaining({ title: 'Chọn túi Refill 10L', meta: '890.000đ', comparison: null }));
  });

  it('không có cặp hay gói Refill hết hàng: không có thẻ', () => {
    expect(pdpRefillOffer(bottle, undefined)).toBeNull();
    expect(pdpRefillOffer(bottle, null)).toBeNull();
    expect(pdpRefillOffer(bottle, offer({ inStock: false }))).toBeNull();
  });

  it('không đọc được lượng, khác chiều (ml với g), hay Refill không rẻ hơn: chỉ mời chọn, không hứa tiết kiệm, không bịa số chai', () => {
    for (const o of [
      pdpRefillOffer({ name: 'Nước rửa chén Fuwa3e', price: 68_000 }, offer()),
      pdpRefillOffer({ name: 'Nước rửa chén Fuwa3e 500ml', price: 30_000 }, offer()),
      pdpRefillOffer({ name: 'Bột giặt 500g', price: 68_000 }, offer()),
    ]) {
      expect(o).toEqual(expect.objectContaining({ title: 'Chọn túi Refill 10L', meta: '890.000đ', comparison: null }));
    }
    expect(pdpRefillOffer(bottle, offer({ sizeLabel: null, name: 'Refill Nước rửa chén Fuwa3e' }))).toEqual(
      expect.objectContaining({ title: 'Chọn túi Refill', comparison: null }),
    );
  });
});

describe('refillSavingBadge (liên kết đổi ở giỏ)', () => {
  it('số đồng chính xác so với mua chai cùng lượng, cùng số với thẻ trang chi tiết chai', () => {
    // 300ml 87.000đ → 10L = 2.900.000đ theo chai; gói 1.385.000đ → tiết kiệm 1.515.000đ.
    expect(refillSavingBadge({ name: 'Nước rửa tay dạng Bọt Fuwa3e 300ml', price: 87_000 }, offer({ price: 1_385_000 }))).toBe('Tiết kiệm 1.515.000đ');
    const bottle = { name: 'Nước rửa chén Fuwa3e 500ml', price: 68_000 };
    expect(refillSavingBadge(bottle, offer())).toBe('Tiết kiệm 470.000đ');
    expect(pdpRefillOffer(bottle, offer())?.title).toContain('tiết kiệm 470.000đ');
  });

  it('gói nhỏ hơn một chai: không có số đồng để so, còn phần trăm mỗi 100ml; không đọc được lượng, khác chiều hay không rẻ hơn thì null', () => {
    expect(refillSavingBadge({ name: 'Nước giặt Fuwa3e 1L', price: 100_000 }, offer({ name: 'Refill Nước giặt Fuwa3e 500ml', sizeLabel: '500ml', price: 40_000 }))).toBe('Rẻ hơn 20%/100ml');
    expect(refillSavingBadge({ name: 'Nước rửa tay', price: 87_000 }, offer())).toBeNull();
    expect(refillSavingBadge({ name: 'Bột giặt 500g', price: 68_000 }, offer())).toBeNull();
    expect(refillSavingBadge({ name: 'Nước rửa chén Fuwa3e 500ml', price: 30_000 }, offer())).toBeNull();
  });

  it('refillSwapOffers gắn huy hiệu khi được truyền hàm tính và dòng giỏ có tên, đơn giá; thiếu một trong hai thì không có', () => {
    const base = { variationId: 'v-b', productId: 'p-b', quantity: 1, stock: 5, total: 68_000 };
    const pairs = { 'p-b': offer() };
    const milestones = { freeship: null, giftTrial: null, greenBox: null };
    const named = [{ ...base, id: 'l1', productName: 'Nước rửa chén Fuwa3e 500ml', unitPrice: 68_000 }];
    const withName = refillSwapOffers({ lines: named, pairs, comboGroups: [], milestones, saving: refillSavingBadge });
    expect(withName.get('l1')?.saving).toBe('Tiết kiệm 470.000đ');
    const bare = refillSwapOffers({ lines: [{ ...base, id: 'l1' }], pairs, comboGroups: [], milestones, saving: refillSavingBadge });
    expect(bare.get('l1')?.saving).toBeNull();
    expect(refillSwapOffers({ lines: named, pairs, comboGroups: [], milestones }).get('l1')?.saving).toBeNull();
    expect(refillConfirmText(withName.get('l1')!).body).toBe(
      'Refill Nước rửa chén Fuwa3e 10L · 890.000đ, dùng lại chai bạn đang có. Dòng này tăng 822.000đ. Tiết kiệm 470.000đ so với mua chai cùng lượng.',
    );
    expect(refillConfirmText(bare.get('l1')!).body).not.toContain('Tiết kiệm');
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
    const vars = { pct: 99, per: '100ml', pack: 'túi', size: ' 10,5L', amount: '12.345.678đ', n: 99, price: '1.234.567đ' };
    for (const key of Object.keys(REFILL_SAVING_COPY) as RefillSavingCopyKey[]) {
      expect(refillSavingCopy(key, vars).length, key).toBeLessThanOrEqual(REFILL_SAVING_COPY_MAX[key]);
    }
  });
});

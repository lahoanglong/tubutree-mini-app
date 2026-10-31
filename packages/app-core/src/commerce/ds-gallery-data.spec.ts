import { describe, expect, it } from 'vitest';
import { GALLERY_COMBO_ITEMS, GALLERY_NOW, GALLERY_SLIDES, GALLERY_SORT_OPTIONS, GALLERY_VOUCHERS, galleryCombo, galleryEnd } from './ds-gallery-data';

describe('ds-gallery-data', () => {
  it('mốc cố định và galleryEnd cộng độ lệch, mặc định theo đồng hồ thật', () => {
    expect(GALLERY_NOW).toBe(Date.UTC(2026, 10, 1, 5, 0, 0));
    expect(galleryEnd(1000, 5000)).toBe(new Date(6000).toISOString());
    const before = Date.now();
    const t = Date.parse(galleryEnd(60_000));
    expect(t).toBeGreaterThanOrEqual(before + 60_000);
    expect(t).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it('mã giảm giá phủ đủ 3 loại và 6 trạng thái, id không trùng', () => {
    const kinds = new Set(GALLERY_VOUCHERS.map((v) => v.view.kind));
    const states = new Set(GALLERY_VOUCHERS.map((v) => v.view.state));
    expect([...kinds].sort()).toEqual(['discount', 'freeship', 'shop']);
    expect([...states].sort()).toEqual(['collectable', 'expired', 'ineligible', 'saved', 'soldout', 'used']);
    expect(new Set(GALLERY_VOUCHERS.map((v) => v.id)).size).toBe(GALLERY_VOUCHERS.length);
  });

  it('mã chưa đủ điều kiện có lý do, mã sắp hết hạn được đánh dấu expiring', () => {
    const ineligible = GALLERY_VOUCHERS.find((v) => v.view.state === 'ineligible')!;
    expect(ineligible.reason).toBeTruthy();
    expect(GALLERY_VOUCHERS.some((v) => v.expiring && v.view.expiry !== '')).toBe(true);
  });

  it('món combo: 5 món, có món hết hàng, có tên dài, có món không ảnh', () => {
    expect(GALLERY_COMBO_ITEMS).toHaveLength(5);
    expect(GALLERY_COMBO_ITEMS.some((i) => i.stock === 'out')).toBe(true);
    expect(GALLERY_COMBO_ITEMS.some((i) => i.name.length >= 40)).toBe(true);
    expect(GALLERY_COMBO_ITEMS.some((i) => !i.thumbnail)).toBe(true);
    expect(GALLERY_COMBO_ITEMS.some((i) => !!i.thumbnail)).toBe(true);
  });

  it('galleryCombo: tổng lẻ là tổng giá các món, tổng combo nhỏ hơn đúng theo %, làm tròn nghìn', () => {
    const { total, comboTotal } = galleryCombo(GALLERY_COMBO_ITEMS.slice(0, 3), 10);
    expect(total).toBe(GALLERY_COMBO_ITEMS.slice(0, 3).reduce((s, i) => s + i.price, 0));
    expect(comboTotal).toBeLessThan(total);
    expect(comboTotal % 1000).toBe(0);
    expect(galleryCombo(GALLERY_COMBO_ITEMS.slice(0, 2), 0).comboTotal).toBe(galleryCombo(GALLERY_COMBO_ITEMS.slice(0, 2), 0).total);
  });

  it('banner: ít nhất 3 slide, ảnh data-URI (không gọi mạng), alt không rỗng', () => {
    expect(GALLERY_SLIDES.length).toBeGreaterThanOrEqual(3);
    for (const s of GALLERY_SLIDES) {
      expect(s.image.startsWith('data:image/svg+xml')).toBe(true);
      expect(s.alt.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify([GALLERY_SLIDES, GALLERY_COMBO_ITEMS])).not.toMatch(/https?:/);
  });

  it('thanh sắp xếp: có tab giá kèm tên đọc, giá trị không trùng', () => {
    expect(GALLERY_SORT_OPTIONS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(GALLERY_SORT_OPTIONS.map((o) => o.value)).size).toBe(GALLERY_SORT_OPTIONS.length);
    expect(GALLERY_SORT_OPTIONS.some((o) => o.spoken)).toBe(true);
  });
});

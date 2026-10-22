import { describe, expect, it } from 'vitest';
import { BRAND_ORIGINS, brandBrowseHref, pinBoxes, type PinBox } from './brand-origins';

const hit = (a: PinBox, b: PinBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Khung bản đồ hẹp nhất cần đẹp: màn 360px trừ lề 16px hai bên = 328 rộng, tỉ lệ 3 / 4.6 => 503 cao.
// Màn rộng hơn chỉ nở khung ra theo cùng tỉ lệ nên không chật hơn.
const FRAME = { w: 328, h: 503 };

describe('ghim bản đồ /cau-chuyen không chồng nhau', () => {
  const boxes = BRAND_ORIGINS.map((o) => ({ o, ...pinBoxes(o, FRAME) }));

  it('không cặp ghim nào có vòng tròn hoặc nhãn đè lên vòng tròn/nhãn của ghim khác', () => {
    const clashes: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (hit(a.circle, b.circle) || hit(a.circle, b.label) || hit(a.label, b.circle) || hit(a.label, b.label)) {
          clashes.push(`${a.o.brand} x ${b.o.brand}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it('mọi ghim và nhãn nằm gọn trong khung bản đồ', () => {
    const out = boxes
      .filter(({ circle, label }) => [circle, label].some((x) => x.left < 0 || x.top < 0 || x.right > FRAME.w || x.bottom > FRAME.h))
      .map(({ o }) => o.brand);
    expect(out).toEqual([]);
  });
});

describe('brandBrowseHref — danh sách sản phẩm của nhãn trên web', () => {
  it('dẫn tới /san-pham?brand= theo tên đúng trong catalog, mã hoá ký tự đặc biệt', () => {
    expect(brandBrowseHref('Le Plateau Coffee')).toBe('/san-pham?brand=Le%20Plateau%20Coffee');
    expect(brandBrowseHref('Pơ Lang')).toBe(`/san-pham?brand=${encodeURIComponent('Pơ Lang')}`);
    expect(brandBrowseHref('BH.Nong')).toBe('/san-pham?brand=BH.Nong');
  });

  it('tên trống thì về /san-pham', () => {
    expect(brandBrowseHref('  ')).toBe('/san-pham');
  });

  it('mọi nhãn dùng đúng tên catalog đã khai báo', () => {
    for (const o of BRAND_ORIGINS) expect(brandBrowseHref(o.catalogBrand)).toBe(`/san-pham?brand=${encodeURIComponent(o.catalogBrand)}`);
  });
});

describe('tỉnh ghi trên ô nhãn', () => {
  it('viết "Đắk Lắk" (không phải "Đắc Lắk")', () => {
    const provinces = BRAND_ORIGINS.map((o) => o.province);
    expect(provinces).not.toContain('Đắc Lắk');
    expect(provinces).toContain('Đắk Lắk');
  });
});

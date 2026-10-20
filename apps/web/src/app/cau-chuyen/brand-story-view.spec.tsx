// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';
import { BRAND_ORIGINS } from '@/lib/brand-origins';
import { BrandStoryView } from './brand-story-view';

// Cùng ý nghĩa brand-story.tsx của Mini App: 8 nhãn gắn với tỉnh xuất xứ, ghim bản đồ và ô lưới cùng mở sheet, sheet dẫn tới danh sách sản phẩm nhãn.

let mounted: Rendered[] = [];
const mount = () => {
  const r = render(<BrandStoryView />);
  mounted.push(r);
  return r.container;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

const origin = (brand: string) => BRAND_ORIGINS.find((o) => o.brand === brand)!;
const pin = (c: HTMLElement, brand: string) => c.querySelector<HTMLButtonElement>(`[data-testid="brand-pin-${origin(brand).id}"]`)!;
// Ô lưới: nút có chữ nhãn và tỉnh; ghim bản đồ aria-hidden nên tìm theo chữ tỉnh để không nhầm với ghim.
const gridTile = (c: HTMLElement, brand: string) =>
  Array.from(c.querySelectorAll('button')).find((b) => b.getAttribute('aria-hidden') !== 'true' && (b.textContent ?? '').includes(brand) && (b.textContent ?? '').includes(origin(brand).province))!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const minHeight = (el: HTMLElement) => parseInt(el.style.minHeight, 10);

describe('/cau-chuyen — Hành trình nguyên liệu', () => {
  it('có đúng một h1 là tiêu đề trang, lời dẫn và số nhãn', () => {
    const c = mount();
    const h1 = c.querySelectorAll('h1');
    expect(h1).toHaveLength(1);
    expect(h1[0]!.textContent).toBe('Hành trình nguyên liệu');
    expect(c.textContent).toContain('Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Chạm mốc trên bản đồ gỗ 3D để khám phá xuất xứ.');
    // Mini App: chữ phụ cỡ body-md, giãn dòng 1.5 (không còn chữ 16px màu stone-700).
    expect(c.querySelector('main p')!.className).toContain('max-md:text-[var(--color-text-secondary)]');
    expect(c.querySelector('h2')?.textContent).toBe(`${BRAND_ORIGINS.length} Thương hiệu & Tỉnh thành xuất xứ`);
    expect(headingProblems(c)).toEqual([]);
  });

  it('tên nhãn và tỉnh trên ô nằm trên nền tối nhẹ (D8-1), chữ không bị làm mờ bằng opacity', () => {
    const c = mount();
    const tile = gridTile(c, 'Pơ Lang');
    const scrim = tile.querySelector<HTMLElement>('[data-testid="brand-tile-scrim"]')!;
    expect(scrim.className).toContain('bg-[var(--color-brand-tile-scrim)]');
    expect(scrim.textContent).toContain('Pơ Lang');
    expect(scrim.textContent).toContain('Đắk Lắk');
    expect(scrim.innerHTML).not.toContain('opacity-');
  });

  it('bản đồ SVG tĩnh có nhãn cho trình đọc màn hình', () => {
    const c = mount();
    const svg = c.querySelector('svg[role="img"]');
    expect(svg?.getAttribute('aria-label')).toBe('Bản đồ Gỗ 3D Việt Nam với đầy đủ tỉnh thành và Hoàng Sa, Trường Sa');
  });

  it('8 ô lưới là nút thật cao ít nhất 44px, Tab tới được, nói rõ nhãn và tỉnh', () => {
    const c = mount();
    for (const o of BRAND_ORIGINS) {
      const el = gridTile(c, o.brand);
      expect(el, o.brand).toBeDefined();
      expect(el.tabIndex).toBe(0);
      expect(minHeight(el)).toBeGreaterThanOrEqual(44);
    }
  });

  it('8 ghim bản đồ ẩn khỏi trình đọc màn hình và thứ tự Tab, vùng chạm ít nhất 44px, chạm vẫn mở sheet', () => {
    const c = mount();
    for (const o of BRAND_ORIGINS) {
      const p = pin(c, o.brand);
      expect(p.getAttribute('aria-hidden')).toBe('true');
      expect(p.hasAttribute('aria-label')).toBe(false);
      expect(p.tabIndex).toBe(-1);
      expect(minHeight(p)).toBeGreaterThanOrEqual(44);
    }
    click(pin(c, 'Hector'));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Hector');
  });

  it('không có điều khiển nào thiếu tên trong cây truy cập', () => {
    const c = mount();
    expect(unnamedControls(c)).toEqual([]);
  });
});

describe('/cau-chuyen — sheet từng nhãn', () => {
  it('ô lưới mở sheet có tên nhãn, tỉnh, nguyên liệu và câu chuyện; nút Đóng đóng sheet', async () => {
    const c = mount();
    expect(dialog()).toBeNull();
    click(gridTile(c, 'Visante'));
    const d = dialog()!;
    expect(d.querySelector('h2')?.textContent).toBe('Visante');
    expect(d.textContent).toContain('Khánh Hòa (Nha Trang)');
    expect(d.textContent).toContain('Muối khoáng & rong biển');
    expect(d.textContent).toContain('Visante tận dụng tinh chất muối khoáng');
    click(d.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]')!);
    await flush(1);
    expect(dialog()).toBeNull();
  });

  it.each(BRAND_ORIGINS.map((o) => [o.brand, o.catalogBrand] as const))(
    '%s: "Khám phá sản phẩm" dẫn /san-pham?brand= theo tên nhãn trong catalog (%s)',
    (brand, catalogBrand) => {
      const c = mount();
      click(pin(c, brand));
      const a = Array.from(dialog()!.querySelectorAll('a')).find((x) => x.textContent === `Khám phá sản phẩm ${brand}`)!;
      expect(a.getAttribute('href')).toBe(`/san-pham?brand=${encodeURIComponent(catalogBrand)}`);
    },
  );

  it('hai nhãn từng ra danh sách rỗng nay dẫn tới tên catalog', () => {
    const c = mount();
    click(pin(c, 'Le Plateau'));
    expect(dialog()!.querySelector('a')?.getAttribute('href')).toBe('/san-pham?brand=Le%20Plateau%20Coffee');
    click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]')!);
    click(pin(c, 'Sokfarm'));
    expect(dialog()!.querySelector('a')?.getAttribute('href')).toBe('/san-pham?brand=Sokfram');
  });

  it('bấm Khám phá sản phẩm đóng sheet', async () => {
    const c = mount();
    click(pin(c, 'Hector'));
    const link = dialog()!.querySelector<HTMLAnchorElement>('a')!;
    link.addEventListener('click', (e) => e.preventDefault());
    click(link);
    await flush(1);
    expect(dialog()).toBeNull();
  });
});

// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';
import { BRAND_ORIGINS, brandBrowseTarget } from '@/lib/brand-origins';
import { PAGE_WIDE } from '@/lib/page-frame';
import { BrandStoryView } from './brand-story-view';

const nav = vi.hoisted(() => ({ search: '', suspend: false }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    if (nav.suspend) throw new Promise(() => {});
    return new URLSearchParams(nav.search);
  },
}));

// Cùng ý nghĩa brand-story.tsx của Mini App: 8 nhãn gắn với tỉnh xuất xứ, nhãn trên bản đồ và thẻ cùng chọn một nhãn. Điện thoại mở tấm câu chuyện;
// từ md bảng chi tiết nằm cạnh bản đồ (Master–Detail) nên không mở tấm.

const media = vi.hoisted(() => ({ phone: true }));
let mounted: Rendered[] = [];
const mount = () => {
  const r = render(<BrandStoryView />);
  mounted.push(r);
  return r.container;
};
beforeEach(() => {
  media.phone = true;
  window.matchMedia = ((query: string) => ({ matches: media.phone && query === '(max-width: 767px)', media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  nav.search = '';
  nav.suspend = false;
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

const origin = (brand: string) => BRAND_ORIGINS.find((o) => o.brand === brand)!;
const mapLabel = (c: HTMLElement, brand: string) => c.querySelector<HTMLButtonElement>(`[data-testid="brand-map-label-${origin(brand).id}"]`)!;
const mapPin = (c: HTMLElement, brand: string) => c.querySelector<HTMLElement>(`[data-testid="brand-map-pin-${origin(brand).id}"]`)!;
const card = (c: HTMLElement, brand: string) => c.querySelector<HTMLButtonElement>(`[data-testid="brand-card-${origin(brand).id}"]`)!;
const detail = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="brand-detail"]')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe('/cau-chuyen — Hành trình nguyên liệu', () => {
  it('HTML dựng sẵn ở server có đủ tiêu đề, lời dẫn, 8 nhãn và bảng chi tiết nhãn đầu dù useSearchParams chưa trả được', () => {
    nav.suspend = true;
    const html = renderToString(<BrandStoryView />);
    expect(html).toContain('Hành trình nguyên liệu');
    expect(html).toContain('Chạm tên thương hiệu trên bản đồ vùng nguyên liệu Việt Nam');
    for (const o of BRAND_ORIGINS) expect(html).toContain(o.brand);
    expect(html).toContain(BRAND_ORIGINS[0]!.story);
    expect(html).not.toContain('role="dialog"');
  });

  it('không còn chữ "bản đồ gỗ 3D", emoji hệ điều hành hay hộp đen mờ', () => {
    const c = mount();
    expect(c.textContent).not.toMatch(/gỗ|3D|LED/i);
    expect(c.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(c.innerHTML).not.toContain('brand-tile-scrim');
    expect(c.innerHTML).not.toContain('animate-pulse');
    expect(c.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Bản đồ vùng nguyên liệu Việt Nam, vẽ sơ đồ');
  });

  it('một khung lề duy nhất cho tiêu đề và nội dung: main dùng PAGE_WIDE, không còn md:px-4 lệch 8px', () => {
    const c = mount();
    const main = c.querySelector('main')!;
    for (const cls of PAGE_WIDE.split(' ')) expect(main.classList.contains(cls), cls).toBe(true);
    expect(c.innerHTML).not.toMatch(/(^|[\s"])md:px-4/);
    expect(c.querySelector('h1')!.parentElement!.className).not.toMatch(/\bpx-/);
  });

  it('có đúng một h1 là tiêu đề trang, lời dẫn và số nhãn', () => {
    const c = mount();
    const h1 = c.querySelectorAll('h1');
    expect(h1).toHaveLength(1);
    expect(h1[0]!.textContent).toBe('Hành trình nguyên liệu');
    expect(c.textContent).toContain('Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Chạm tên thương hiệu trên bản đồ vùng nguyên liệu Việt Nam để khám phá xuất xứ.');
    // Mini App: chữ phụ cỡ body-md, giãn dòng 1.5 (không còn chữ 16px màu stone-700).
    expect(c.querySelector('main p')!.className).toContain('max-md:text-[var(--color-text-secondary)]');
    expect(c.querySelector('h2')?.textContent).toBe(`${BRAND_ORIGINS.length} Thương hiệu & Tỉnh thành xuất xứ`);
    expect(headingProblems(c)).toEqual([]);
  });

  it('?brand=<id> chọn sẵn nhãn đó: điện thoại mở tấm của nhãn; id lạ thì không mở', () => {
    nav.search = 'brand=fuwa3e';
    mount();
    expect(dialog()?.textContent).toContain('Fuwa3e');
    mounted.pop()!.unmount();
    nav.search = 'brand=khong-co';
    mount();
    expect(dialog()).toBeNull();
  });

  it('?brand=<id> từ md: bảng chi tiết hiện nhãn đó, không mở tấm', () => {
    media.phone = false;
    nav.search = 'brand=hector';
    const c = mount();
    expect(dialog()).toBeNull();
    expect(detail(c).querySelector('h3')?.textContent).toBe('Hector');
    expect(card(c, 'Hector').dataset.active).toBe('true');
  });

  it('không có điều khiển nào thiếu tên trong cây truy cập', () => {
    const c = mount();
    expect(unnamedControls(c)).toEqual([]);
  });
});

describe('/cau-chuyen — thẻ nhãn', () => {
  it('8 thẻ là nút thật cao ít nhất 44px, Tab tới được, có huy hiệu SVG riêng, tên nhãn, tỉnh và nguyên liệu', () => {
    const c = mount();
    const svgs = new Set<string>();
    for (const o of BRAND_ORIGINS) {
      const el = card(c, o.brand);
      expect(el, o.brand).toBeTruthy();
      expect(el.tagName).toBe('BUTTON');
      expect(el.tabIndex).toBe(0);
      expect(el.className).toContain('min-h-11');
      expect(el.textContent).toContain(o.brand);
      expect(el.textContent).toContain(o.province);
      expect(el.textContent).toContain(o.ingredient);
      expect(el.querySelector('svg[class*="h-3.5"]')).not.toBeNull();
      const badge = el.querySelector<HTMLElement>(`[data-testid="brand-badge-${o.id}"]`)!;
      expect(badge.getAttribute('aria-hidden')).toBe('true');
      const paths = Array.from(badge.querySelectorAll('path'));
      expect(paths.length).toBeGreaterThanOrEqual(4);
      svgs.add(paths.map((p) => p.getAttribute('d')).join('|'));
    }
    expect(svgs.size).toBe(8);
  });

  it('thẻ dùng nền, viền và bóng thẻ bằng token (không gradient, không primitive màu)', () => {
    const c = mount();
    const cls = card(c, 'Pơ Lang').className;
    expect(cls).toContain('bg-[var(--color-bg-surface)]');
    expect(cls).toContain('border-[var(--color-border-subtle)]');
    expect(cls).toContain('[box-shadow:var(--elevation-1)]');
    expect(c.innerHTML).not.toMatch(/gradient|--stone-|--forest-|#[0-9a-f]{6}/i);
  });
});

describe('/cau-chuyen — bản đồ chú thích', () => {
  it('8 nhãn trên bản đồ là nút thật: Tab tới được, không aria-hidden, tên truy cập gồm nhãn và tỉnh', () => {
    const c = mount();
    for (const o of BRAND_ORIGINS) {
      const l = mapLabel(c, o.brand);
      expect(l.tagName).toBe('BUTTON');
      expect(l.tabIndex).toBe(0);
      expect(l.hasAttribute('aria-hidden')).toBe(false);
      expect(l.textContent).toContain(o.brand);
      expect(l.textContent).toContain(o.province);
      expect(l.className).toContain('brandmap-label');
    }
  });

  it('chấm ghim không tương tác: ẩn khỏi trình đọc, không phải nút', () => {
    const c = mount();
    for (const o of BRAND_ORIGINS) {
      const p = mapPin(c, o.brand);
      expect(p.tagName).toBe('SPAN');
      expect(p.getAttribute('aria-hidden')).toBe('true');
    }
    expect(c.querySelectorAll('[data-testid^="brand-map-pin-"] button')).toHaveLength(0);
  });

  it('ba đảo có chấm số trên bản đồ và tên ở dải chú giải', () => {
    const c = mount();
    const legend = c.querySelector('[data-testid="brand-map-legend"]')!;
    for (const name of ['Hoàng Sa', 'Trường Sa', 'Phú Quốc']) expect(legend.textContent).toContain(name);
    expect(c.querySelectorAll('[data-testid^="brand-map-island-"]')).toHaveLength(3);
  });

  it('không có chuyển động vĩnh viễn: ghim và nhãn không dùng animate-pulse; chỉ nhãn đang chọn mang data-active', () => {
    const c = mount();
    expect(c.innerHTML).not.toContain('pulse');
    expect(c.querySelectorAll('.brandmap-label[data-active]')).toHaveLength(1);
    expect(c.querySelectorAll('.brandmap-pin[data-active]')).toHaveLength(1);
    expect(c.querySelectorAll('.brandmap-leader[data-active]')).toHaveLength(1);
  });

  it('nhãn trên bản đồ và thẻ dùng chung nhãn chọn; nhãn đầu chọn sẵn', () => {
    media.phone = false;
    const c = mount();
    expect(mapLabel(c, 'Fuwa3e').dataset.active).toBeDefined();
    expect(card(c, 'Fuwa3e').dataset.active).toBe('true');
    click(mapLabel(c, 'Hector'));
    expect(mapLabel(c, 'Hector').dataset.active).toBeDefined();
    expect(mapPin(c, 'Hector').dataset.active).toBeDefined();
    expect(mapLabel(c, 'Fuwa3e').dataset.active).toBeUndefined();
    expect(card(c, 'Hector').dataset.active).toBe('true');
    expect(card(c, 'Fuwa3e').dataset.active).toBe('false');
    click(card(c, 'Visante'));
    expect(mapLabel(c, 'Visante').dataset.active).toBeDefined();
    expect(mapLabel(c, 'Hector').dataset.active).toBeUndefined();
  });

  it('dưới md bản đồ chỉ sáng nhãn chọn khi tấm chi tiết mở (data-sheet)', () => {
    const c = mount();
    const map = c.querySelector('[data-testid="brand-map"]')!;
    expect(map.hasAttribute('data-sheet')).toBe(false);
    click(mapLabel(c, 'Hector'));
    expect(map.hasAttribute('data-sheet')).toBe(true);
    expect(mapLabel(c, 'Hector').dataset.active).toBeDefined();
  });
});

describe('/cau-chuyen — Master–Detail từ md', () => {
  beforeEach(() => {
    media.phone = false;
  });

  it('bảng chi tiết nằm sau lưới thẻ, ẩn dưới md (hidden md:block), có huy hiệu lớn, tỉnh, nguyên liệu, câu chuyện', () => {
    const c = mount();
    const d = detail(c);
    expect(d.className).toContain('hidden');
    expect(d.className).toContain('md:block');
    expect(c.querySelector('main')!.compareDocumentPosition(d)).toBeTruthy();
    expect(d.querySelector('h3')?.textContent).toBe('Fuwa3e');
    expect(d.textContent).toContain('Thanh Hóa');
    expect(d.textContent).toContain('Enzyme vỏ dứa & bồ hòn');
    expect(d.textContent).toContain(BRAND_ORIGINS[0]!.story);
    expect(d.querySelector('[data-testid="brand-badge-fuwa3e"]')).not.toBeNull();
    expect(d.getAttribute('aria-live')).toBe('polite');
  });

  it('lưới thẻ 2 cột rồi 4 cột ở lg (hàng 2 x 4 vừa khít 8 nhãn)', () => {
    const c = mount();
    const grid = card(c, 'Fuwa3e').parentElement!;
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.className).toContain('lg:grid-cols-4');
    expect(grid.children).toHaveLength(8);
  });

  it('chọn nhãn khác đổi bảng chi tiết, không mở tấm', async () => {
    const c = mount();
    click(card(c, 'Visante'));
    await flush(1);
    expect(dialog()).toBeNull();
    const d = detail(c);
    expect(d.querySelector('h3')?.textContent).toBe('Visante');
    expect(d.textContent).toContain('Khánh Hòa (Nha Trang)');
    expect(d.textContent).toContain('Muối khoáng & rong biển');
    expect(d.textContent).toContain('Visante tận dụng tinh chất muối khoáng');
  });

  it.each(BRAND_ORIGINS.map((o) => [o.brand, o.searchKeyword] as const))('%s: nút chính "Khám phá sản phẩm" là liên kết thật tới /san-pham?q=%s', (brand) => {
    const c = mount();
    click(mapLabel(c, brand));
    const a = detail(c).querySelector<HTMLAnchorElement>('a[data-testid="brand-detail-cta"]')!;
    expect(a.textContent).toBe(`Khám phá sản phẩm ${brand}`);
    expect(a.getAttribute('href')).toBe(brandBrowseTarget(origin(brand), '/san-pham'));
    expect(a.getAttribute('href')).toMatch(/^\/san-pham\?q=/);
    expect(a.getAttribute('href')).not.toContain('brand=');
  });

  it('nút chính cao ít nhất 44px', () => {
    const c = mount();
    expect(detail(c).querySelector('a')!.className).toContain('min-h-11');
  });
});

describe('/cau-chuyen — tấm câu chuyện dưới md', () => {
  it('thẻ mở tấm có tên nhãn, tỉnh, nguyên liệu, câu chuyện; nút Đóng đóng tấm', async () => {
    const c = mount();
    expect(dialog()).toBeNull();
    click(card(c, 'Visante'));
    const d = dialog()!;
    expect(d.querySelector('h2')?.textContent).toBe('Visante');
    expect(d.textContent).toContain('Khánh Hòa (Nha Trang)');
    expect(d.textContent).toContain('Muối khoáng & rong biển');
    expect(d.textContent).toContain('Visante tận dụng tinh chất muối khoáng');
    click(d.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]')!);
    await flush(1);
    expect(dialog()).toBeNull();
  });

  it('nhãn trên bản đồ cũng mở tấm', () => {
    const c = mount();
    click(mapLabel(c, 'Hector'));
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Hector');
  });

  it.each(BRAND_ORIGINS.map((o) => [o.brand] as const))('%s: "Khám phá sản phẩm" dẫn /san-pham?q= theo từ khoá trong tên sản phẩm', (brand) => {
    const c = mount();
    click(mapLabel(c, brand));
    const a = Array.from(dialog()!.querySelectorAll('a')).find((x) => x.textContent === `Khám phá sản phẩm ${brand}`)!;
    expect(a.getAttribute('href')).toBe(brandBrowseTarget(origin(brand), '/san-pham'));
  });

  it('hai nhãn từng ra danh sách rỗng nay tìm theo từ khoá đúng viết trong tên', () => {
    const c = mount();
    click(mapLabel(c, 'Le Plateau'));
    expect(dialog()!.querySelector('a')?.getAttribute('href')).toBe('/san-pham?q=Le+Plateau');
    click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]')!);
    click(mapLabel(c, 'Sokfarm'));
    expect(dialog()!.querySelector('a')?.getAttribute('href')).toBe('/san-pham?q=Sokfarm');
  });

  it('bấm Khám phá sản phẩm đóng tấm', async () => {
    const c = mount();
    click(mapLabel(c, 'Hector'));
    const link = dialog()!.querySelector<HTMLAnchorElement>('a')!;
    link.addEventListener('click', (e) => e.preventDefault());
    click(link);
    await flush(1);
    expect(dialog()).toBeNull();
  });
});

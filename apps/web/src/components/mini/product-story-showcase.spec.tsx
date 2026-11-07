// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetail } from '@tubutree/app-core/api/catalog';
import type { ProductStoryConfig } from '@tubutree/shared-types';
import { act } from 'react';
import { click } from '@/test-utils/dom';
import { resetPreloadCache } from '@tubutree/app-core/commerce/story-preload';
import { mount } from './harness';
import { ProductStoryShowcase } from './product-story-showcase';

const CONFIG: ProductStoryConfig = {
  version: 1,
  enabled: true,
  cutoutUrl: 'https://cdn.test/cutout.png',
  scenes: [
    {
      kind: 'variant_arc',
      items: [
        { variationId: 'v1', label: 'Bưởi', ambient: 'amber' },
        { variationId: 'v2', label: 'Sả chanh', ambient: 'leaf' },
      ],
    },
    {
      kind: 'ingredient_assembly',
      steps: [
        { title: 'Tinh tuyển', body: 'Vỏ bưởi tươi.', layers: [{ id: 'l1', spriteId: 'pomelo-peel', label: 'Vỏ bưởi', from: 'top', xPct: 30, yPct: 30, scale: 1, rotateDeg: 0 }] },
        { title: 'Kết hợp', body: 'Cùng sả chanh.', layers: [{ id: 'l2', spriteId: 'lemongrass', label: 'Sả', from: 'left', xPct: 70, yPct: 60, scale: 1, rotateDeg: 10 }] },
      ],
    },
    {
      kind: 'hud_callouts',
      closing: 'An lành',
      points: [
        { id: 'p1', xPct: 40, yPct: 40, label: 'Bồ kết', value: '12%', barPct: 12, side: 'left' },
        { id: 'p2', xPct: 60, yPct: 70, label: 'Sả', side: 'right' },
      ],
    },
  ],
};

const PRODUCT = {
  id: 'p1', slug: 'xa-phong', brand: 'Tubu', name: 'Xà phòng', shortDesc: null, description: 'Mô tả',
  images: ['https://cdn.test/a.jpg'], thumbnail: null, basePrice: 1, salePrice: null, certifications: [],
  ingredients: null, storyConfig: CONFIG, variations: [
    { id: 'v1', sku: 'a', name: 'Bưởi', attributes: {}, retailPrice: 1, salePrice: null, stock: 5 },
    { id: 'v2', sku: 'b', name: 'Sả chanh', attributes: {}, retailPrice: 1, salePrice: null, stock: 5 },
  ],
} as unknown as ProductDetail;

const q = (c: ParentNode, id: string) => c.querySelector(`[data-testid="${id}"]`);
const qa = (c: ParentNode, id: string) => Array.from(c.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));

let reduced = false;
beforeEach(() => {
  reduced = false;
  window.matchMedia = ((query: string) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  document.body.style.overflow = '';
});

describe('ProductStoryShowcase (web)', () => {
  it('renders nothing when no config', () => {
    const { container } = mount(<ProductStoryShowcase product={{ ...PRODUCT, storyConfig: null, variations: [], ingredients: null, slug: 'khong-co' } as ProductDetail} />);
    expect(q(container, 'product-story')).toBeNull();
  });

  it('sản phẩm của nhãn chủ lực chưa có cấu hình: tự vẽ điểm chỉ Thương hiệu, Quy cách, Hương đọc từ tên cùng câu kết', () => {
    const brand = { ...PRODUCT, storyConfig: null, ingredients: null, variations: [PRODUCT.variations[0]], slug: 'nuoc-giat-huong-bac-ha-fuwa3e-500ml-751754', name: 'Nước giặt hương Bạc hà Fuwa3e 500ml', brand: 'Tubu Tree' } as ProductDetail;
    const { container } = mount(<ProductStoryShowcase product={brand} />);
    const callouts = qa(q(container, 'story-hud')!, 'story-callout').map((c) => c.textContent);
    expect(callouts).toHaveLength(3);
    expect(callouts[0]).toContain('Thương hiệu');
    expect(callouts[0]).toContain('Fuwa3e');
    expect(callouts[1]).toContain('500ml');
    expect(callouts[2]).toContain('Bạc hà');
    expect(q(container, 'story-closing')!.textContent).toBe('Fuwa3e, có tại Tubu Tree');
  });

  it('variant arc: tapping an item calls onSelectVariation and sets ambient', () => {
    const onSelect = vi.fn();
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} selectedVariationId="v1" onSelectVariation={onSelect} />);
    const group = container.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Chọn loại');
    const items = qa(container, 'story-arc-item');
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect((q(container, 'story-stage') as HTMLElement).style.background).toContain('story-ambient-amber');
    click(items[1]!);
    expect(onSelect).toHaveBeenCalledWith('v2');
    expect(qa(container, 'story-arc-item').map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect((q(container, 'story-stage') as HTMLElement).style.background).toContain('story-ambient-leaf');
  });

  it('vòng cung cùng cách vẽ với Mini: biến --arc-*, mục chọn nền theo màu bối cảnh, không chấm màu, mục xa hạ xuống', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} selectedVariationId="v1" />);
    const [on, off] = qa(container, 'story-arc-item');
    expect(container.querySelector('.tubu-story-arc-dot')).toBeNull();
    expect(on!.style.getPropertyValue('--arc-lift')).toBe('0');
    expect(on!.style.getPropertyValue('--arc-scale')).toBe('1.22');
    expect(on!.style.background).toContain('story-ambient-amber');
    expect(Number(off!.style.getPropertyValue('--arc-lift'))).toBeGreaterThan(0);
    expect(off!.style.getPropertyValue('--arc-offset')).toBe('1');
    expect(off!.style.background).toBe('');
    expect(off!.style.transform).toBe('');
  });

  it('step chips switch the active step (aria-current)', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} />);
    const chips = qa(container, 'story-step-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['01', '02']);
    chips.forEach((c) => expect(c.getAttribute('aria-label')!.startsWith(c.textContent!)).toBe(true));
    expect(chips[0]!.getAttribute('aria-current')).toBe('step');
    expect(q(container, 'story-step-panel')!.textContent).toContain('Tinh tuyển');
    expect(qa(container, 'story-layer')).toHaveLength(1);
    click(chips[1]!);
    expect(qa(container, 'story-step-chip')[1]!.getAttribute('aria-current')).toBe('step');
    expect(qa(container, 'story-step-chip')[0]!.hasAttribute('aria-current')).toBe(false);
    expect(q(container, 'story-step-panel')!.textContent).toContain('Cùng sả chanh');
    expect(qa(container, 'story-layer')).toHaveLength(2);
    expect(qa(container, 'story-layer').every((l) => l.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('reduced motion renders all steps statically', () => {
    reduced = true;
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} />);
    expect(q(container, 'product-story')!.getAttribute('data-animated')).toBe('false');
    const list = q(container, 'story-static-steps')!;
    expect(list.tagName).toBe('OL');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(q(container, 'story-step-chip')).toBeNull();
    expect(qa(container, 'story-layer')).toHaveLength(2);
  });

  it('fullscreen: khối sân khấu + chip được ghim, các mốc cuộn nằm ngoài khối đó nên sân khấu không trôi khỏi màn khi cuộn qua mốc', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} fullscreen onClose={() => {}} />);
    const scroll = container.querySelector('.tubu-story-scroll')!;
    const pin = scroll.querySelector(':scope > .tubu-story-pin');
    expect(pin).not.toBeNull();
    expect(pin!.querySelector('[data-testid="story-stage"]')).not.toBeNull();
    expect(pin!.querySelector('[data-testid="story-step-chip"]')).not.toBeNull();
    expect(pin!.querySelector('.tubu-story-sentinel')).toBeNull();
    expect(scroll.querySelectorAll(':scope > .tubu-story-sentinel')).toHaveLength(2);
  });

  it('khung nội tuyến giữ các mốc trong cột bước để md+ ghim sân khấu suốt đường cuộn', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} />);
    expect(container.querySelector('.tubu-story-pin')).toBeNull();
    expect(container.querySelectorAll('.tubu-story-sentinel')).toHaveLength(2);
    expect(q(container, 'story-step-panel')!.closest('.grid')!.contains(container.querySelector('.tubu-story-sentinel'))).toBe(true);
  });

  it('fullscreen: Esc calls onClose, role=dialog, buy bar buttons call handlers', () => {
    const onClose = vi.fn();
    const onAdd = vi.fn();
    const onBuy = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { container, unmount } = mount(<ProductStoryShowcase product={PRODUCT} fullscreen onClose={onClose} onAddToCart={onAdd} onBuyNow={onBuy} />);
    const root = q(container, 'product-story')!;
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(q(container, 'story-close'));
    expect(document.body.style.overflow).toBe('hidden');
    click(q(container, 'story-add-to-cart'));
    click(q(container, 'story-buy-now'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onBuy).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    click(q(container, 'story-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
    opener.remove();
  });

  it('fullscreen buyDisabled: hai nút khoá, nút Mua ngay đổi thành Hết hàng và không gọi xử lý', () => {
    const onAdd = vi.fn();
    const onBuy = vi.fn();
    const { container, unmount } = mount(<ProductStoryShowcase product={PRODUCT} fullscreen buyDisabled onAddToCart={onAdd} onBuyNow={onBuy} />);
    const add = q(container, 'story-add-to-cart') as HTMLButtonElement;
    const buy = q(container, 'story-buy-now') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(buy.disabled).toBe(true);
    expect(buy.textContent).toBe('Hết hàng');
    click(add);
    click(buy);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onBuy).not.toHaveBeenCalled();
    unmount();
  });

  it('HUD callouts render label and value as text', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} />);
    const hud = q(container, 'story-hud')!;
    const callouts = qa(hud, 'story-callout');
    expect(callouts).toHaveLength(2);
    expect(callouts[0]!.textContent).toContain('Bồ kết');
    expect(callouts[0]!.textContent).toContain('12%');
    expect(hud.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toContain('An lành');
  });

  it('hostile label renders as text not HTML', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const config: ProductStoryConfig = {
      ...CONFIG,
      scenes: [{ kind: 'hud_callouts', closing: 'ok', points: [{ id: 'p1', xPct: 10, yPct: 10, label: evil, value: evil, side: 'left' }] }],
    };
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} previewConfig={config} />);
    const callout = q(container, 'story-callout')!;
    expect(callout.querySelector('img')).toBeNull();
    expect(callout.textContent).toContain(evil);
  });

  it('previewConfig overrides product config', () => {
    const preview: ProductStoryConfig = { ...CONFIG, enabled: false, scenes: [{ kind: 'hud_callouts', closing: 'Xem thử', points: [{ id: 'p1', xPct: 10, yPct: 10, label: 'Thử', side: 'left' }] }] };
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} previewConfig={preview} />);
    expect(q(container, 'story-arc-item')).toBeNull();
    expect(q(container, 'story-callout')!.textContent).toContain('Thử');
  });

  it('md layout: root has two-column classes (md:grid-cols-2), stage sticky', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} />);
    const grid = container.querySelector('[data-testid="product-story"] .md\\:grid-cols-2')!;
    expect(grid).not.toBeNull();
    expect(q(grid, 'story-stage')!.parentElement!.className).toContain('tubu-story-sticky');
    expect(q(grid, 'story-step-panel')).not.toBeNull();
  });

  it('md+: ghim dưới header dính của trang (var(--header-h)) để sân khấu và chip không chui xuống dưới header', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} />);
    const stageCol = q(container, 'story-stage')!.parentElement!;
    const stepsCol = q(container, 'story-step-panel')!.parentElement!;
    for (const el of [stageCol, stepsCol]) expect(el.className).toContain('tubu-story-sticky');
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const at = css.indexOf('.tubu-story-sticky {');
    expect(css.slice(css.lastIndexOf('@media', at), at)).toContain('min-width: 48rem');
    const rule = /\.tubu-story-sticky\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('position: sticky');
    expect(rule).toContain('var(--header-h, 0px)');
  });

  it('không có bước nào (chỉ vòng cung và HUD): một cột, sân khấu căn giữa, không để nửa phải trống', () => {
    const arcHud: ProductStoryConfig = { ...CONFIG, scenes: CONFIG.scenes.filter((s) => s.kind !== 'ingredient_assembly') };
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} previewConfig={arcHud} />);
    expect(q(container, 'story-step-chip')).toBeNull();
    const grid = q(container, 'story-stage')!.closest('.grid')!;
    expect(grid.className).not.toContain('md:grid-cols-2');
    expect(grid.className).toContain('md:max-w-lg');
    expect(grid.className).toContain('md:mx-auto');
  });
});

describe('Mini ↔ web: ba điểm lệch nhỏ của dải câu chuyện', () => {
  const rule = (css: string, selector: string): string => {
    // Gộp mọi khối mở đầu dòng bằng selector này; selector ghép xuống dòng (`.a,\n.b {`) cũng tính vào .b.
    const blocks = [...css.matchAll(new RegExp(`^${selector.replace(/\./g, '\\.')} \\{[^}]*\\}`, 'gm'))].map((m) => m[0]);
    expect(blocks.length, `thiếu quy tắc ${selector}`).toBeGreaterThan(0);
    return blocks.join('\n');
  };
  const decl = (block: string, prop: string): string | undefined => new RegExp(`(?:^|[\\s;{])${prop}:\\s*([^;}]+)`).exec(block)?.[1]?.trim();
  const webCss = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
  const miniCss = readFileSync(resolve(__dirname, '../../../../miniapp/src/css/story.css'), 'utf8');

  it('khung toàn màn: cùng nền (surface) ở Mini và web', () => {
    expect(decl(rule(miniCss, '.tubu-story-dialog'), 'background')).toBe('var(--color-bg-surface)');
    expect(decl(rule(webCss, '.tubu-story-full'), 'background')).toBe('var(--color-bg-surface)');
  });

  it('thẻ điểm chỉ HUD: cùng cỡ chữ, đệm, viền, nền và kiểu chữ nhãn/giá trị ở hai app', () => {
    const mini = rule(miniCss, '.tubu-story-callout');
    const web = rule(webCss, '.tubu-story-callout');
    for (const prop of ['padding', 'background', 'width']) expect(decl(web, prop), prop).toBe(decl(mini, prop));
    expect(decl(web, 'border')).toBe(decl(mini, 'border'));
    expect(decl(web, 'border-radius')).toBe(decl(mini, 'border-radius'));
    expect(decl(web, 'font-size')).toBe('var(--type-caption-size)');
    expect(miniCss).toMatch(/\.tubu-story-callout-label,\s*\.tubu-story-callout-value\s*\{[^}]*font-size:\s*var\(--type-caption-size\)/);
    expect(decl(rule(webCss, '.tubu-story-callout-label'), 'font-weight')).toBe(decl(rule(miniCss, '.tubu-story-callout-label'), 'font-weight'));
    expect(decl(rule(webCss, '.tubu-story-callout-label'), 'color')).toBe(decl(rule(miniCss, '.tubu-story-callout-label'), 'color'));
    expect(decl(rule(webCss, '.tubu-story-callout-value'), 'color')).toBe(decl(rule(miniCss, '.tubu-story-callout-value'), 'color'));
    expect(decl(rule(webCss, '.tubu-story-callout-value'), 'font-weight')).toBeUndefined();
  });
});

describe('khung ảnh sản phẩm trên sân khấu (floating-card / cutout)', () => {
  const webCss = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
  const miniCss = readFileSync(resolve(__dirname, '../../../../miniapp/src/css/story.css'), 'utf8');
  const floatingBlock = (css: string, selector: RegExp): string => selector.exec(css)?.[1] ?? '';

  it('CSS thẻ nổi cùng số đo ở Mini và web: bo radius-sheet, viền subtle 1px, bóng elevation-2, nền surface', () => {
    const mini = floatingBlock(miniCss, /\.tubu-story-frame\[data-frame='floating-card'\] \.tubu-story-product \{([^}]*)\}/);
    const web = floatingBlock(webCss, /\.tubu-story-stage\[data-frame='floating-card'\] \.tubu-story-product \{([^}]*)\}/);
    expect(mini).not.toBe('');
    expect(web).not.toBe('');
    for (const re of [/border-radius:\s*var\(--radius-sheet\)/, /border:\s*1px solid var\(--color-border-subtle\)/, /box-shadow:\s*var\(--elevation-2\)/, /background:\s*var\(--color-bg-surface\)/, /overflow:\s*hidden/]) {
      expect(mini).toMatch(re);
      expect(web).toMatch(re);
    }
  });

  it('không có ảnh tách nền thì sân khấu là floating-card; có thì cutout; admin đặt imageFrame thì theo admin', () => {
    const { cutoutUrl: _omit, ...noCut } = CONFIG;
    void _omit;
    const a = mount(<ProductStoryShowcase product={PRODUCT} previewConfig={noCut} />);
    expect(a.container.querySelector('[data-testid="story-stage"]')?.getAttribute('data-frame')).toBe('floating-card');
    a.unmount();
    const b = mount(<ProductStoryShowcase product={PRODUCT} previewConfig={CONFIG} />);
    expect(b.container.querySelector('[data-testid="story-stage"]')?.getAttribute('data-frame')).toBe('cutout');
    b.unmount();
    const c = mount(<ProductStoryShowcase product={PRODUCT} previewConfig={{ ...CONFIG, imageFrame: 'floating-card' }} />);
    expect(c.container.querySelector('[data-testid="story-stage"]')?.getAttribute('data-frame')).toBe('floating-card');
    c.unmount();
  });
});

const imgLayer = (id: string, imageUrl: string) => ({ id, imageUrl, label: id, from: 'top' as const, xPct: 30, yPct: 30, scale: 1, rotateDeg: 0 });
const IMAGE_STORY: ProductStoryConfig = {
  version: 1,
  enabled: true,
  scenes: [
    {
      kind: 'ingredient_assembly',
      steps: [0, 1, 2].map((i) => ({
        title: `Chương ${i + 1}`,
        body: `Nội dung ${i + 1}`,
        layers: [imgLayer(`u${i}`, `/api/ing-${i}.png`), { id: `s${i}`, spriteId: 'lemongrass', label: 'Sả', from: 'left' as const, xPct: 60, yPct: 60, scale: 1, rotateDeg: 0 }],
      })),
    },
  ],
};

describe('W40B: tải trước ảnh chương kế và chuyển chương mượt (web)', () => {
  const loaded: string[] = [];
  beforeEach(() => {
    loaded.length = 0;
    resetPreloadCache();
    vi.stubGlobal(
      'Image',
      class {
        decoding = '';
        setAttribute() {}
        set src(v: string) {
          loaded.push(v);
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('mở ở chương 01 thì tải ảnh nguyên liệu của chương 02; sang chương kế tải tiếp chương sau nó; cuối cùng và quay lại không tải lại', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} previewConfig={IMAGE_STORY} />);
    expect(loaded).toEqual(['/api/ing-1.png']);
    const chips = qa(container, 'story-step-chip');
    click(chips[1]!);
    expect(loaded).toEqual(['/api/ing-1.png', '/api/ing-2.png']);
    click(qa(container, 'story-step-chip')[2]!);
    click(qa(container, 'story-step-chip')[0]!);
    expect(loaded).toEqual(['/api/ing-1.png', '/api/ing-2.png']);
  });

  it('chỉ tải trước khi mục Story đã gần khung nhìn: chưa cuộn tới thì không tốn dữ liệu', () => {
    const observers: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          observers.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mount(<ProductStoryShowcase product={PRODUCT} previewConfig={IMAGE_STORY} />);
    expect(loaded).toEqual([]);
    const fire = (isIntersecting: boolean) =>
      act(() => {
        for (const cb of observers) cb([{ isIntersecting, target: document.body } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      });
    fire(false);
    expect(loaded).toEqual([]);
    fire(true);
    expect(loaded).toEqual(['/api/ing-1.png']);
  });

  it('giảm chuyển động: bản tĩnh đã vẽ mọi lớp nên không tải trước gì thêm', () => {
    reduced = true;
    mount(<ProductStoryShowcase product={PRODUCT} previewConfig={IMAGE_STORY} />);
    expect(loaded).toEqual([]);
  });

  it('đổi chương dựng lại khối nội dung (key theo bước) để chạy lại hiệu ứng vào, chữ đổi theo', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} previewConfig={IMAGE_STORY} />);
    const before = q(container, 'story-step-panel')!.firstElementChild!;
    expect(before.classList.contains('tubu-story-panel-in')).toBe(true);
    click(qa(container, 'story-step-chip')[1]!);
    const after = q(container, 'story-step-panel')!.firstElementChild!;
    expect(after.classList.contains('tubu-story-panel-in')).toBe(true);
    expect(after).not.toBe(before);
    expect(after.textContent).toContain('Chương 2');
  });

  describe('mini.css', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    const line = (sel: string) => new RegExp(`${sel.replace(/[.[\]()']/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('chuyển chương, lớp rơi, nền cảnh và thanh tiến trình dùng ease-story 240ms như Mini', () => {
      expect(line('.tubu-story-panel-in')).toMatch(/animation:\s*tubu-story-panel-in var\(--dur-story\) var\(--ease-story\) both/);
      expect(line(".tubu-story-layer[data-animated='true']")).toMatch(/animation:\s*tubu-story-fall var\(--dur-story\) var\(--ease-story\) both/);
      expect(line('.tubu-story-stage')).toMatch(/transition:\s*background var\(--dur-story\) var\(--ease-story\)/);
      expect(line('.tubu-story-progress > span')).toMatch(/transition:\s*width var\(--dur-story\) var\(--ease-story\)/);
      expect(line('.tubu-story-chip')).toMatch(/transition:\s*transform var\(--p-dur-release\) var\(--p-ease-out\), background-color var\(--dur-story\) var\(--ease-story\), color var\(--dur-story\) var\(--ease-story\)/);
      expect(css).toMatch(/--ease-story:\s*var\(--p-ease-story\)/);
      expect(css).toMatch(/--dur-story:\s*var\(--p-dur-story\)/);
    });

    it('giảm chuyển động tắt hiệu ứng vào của chương và đổi màu chip', () => {
      expect(reduced).toMatch(/\.tubu-story-panel-in/);
      expect(reduced).toMatch(/\.tubu-story-chip/);
      expect(reduced).toMatch(/animation:\s*none;\s*transition:\s*none/);
    });

    it('số đều cho cả dải câu chuyện, chip và nhãn vòng cung; vùng chạm chip, vòng cung, nút đóng, nút mua từ 44px', () => {
      expect(line('.tubu-story')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(line('.tubu-story-chip')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(line('.tubu-story-arc-item')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      for (const sel of ['.tubu-story-chip', '.tubu-story-arc-item', '.tubu-story-close']) {
        expect(line(sel), sel).toMatch(/min-height:\s*2\.75rem/);
        expect(line(sel), sel).toMatch(/min-width:\s*2\.75rem/);
      }
      expect(line('.tubu-story-btn')).toMatch(/min-height:\s*3rem/);
    });
  });
});

describe('W42A: Reel của Trang chủ (reel, addPrice, onNext, position)', () => {
  it('thanh đáy chỉ có "Câu chuyện kế" và "Thêm vào giỏ · giá": không có Mua ngay', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} fullscreen reel addPrice="289.000đ" onNext={() => {}} onClose={() => {}} />);
    const bar = container.querySelector('.tubu-story-bar')!;
    expect(bar.getAttribute('data-reel')).toBe('true');
    expect(q(container, 'story-buy-now')).toBeNull();
    expect(q(container, 'story-add-to-cart')!.textContent).toBe('Thêm vào giỏ · 289.000đ');
    expect(q(container, 'story-next')!.textContent).toBe('Câu chuyện kế');
    expect(q(container, 'story-next')!.getAttribute('aria-label')).toBe('Câu chuyện kế, xem sản phẩm kế tiếp');
    expect(Array.from(bar.children).map((b) => (b as HTMLElement).dataset.testid)).toEqual(['story-next', 'story-add-to-cart']);
  });

  it('không có addPrice thì nút thêm giỏ chỉ ghi "Thêm vào giỏ"; không có onNext thì không có nút kế (món cuối dải)', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} fullscreen reel onClose={() => {}} />);
    expect(q(container, 'story-add-to-cart')!.textContent).toBe('Thêm vào giỏ');
    expect(q(container, 'story-next')).toBeNull();
  });

  it('chạm "Câu chuyện kế" gọi onNext, chạm nút thêm giỏ gọi onAddToCart đúng một lần', () => {
    const onNext = vi.fn();
    const onAdd = vi.fn();
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} fullscreen reel addPrice="1đ" onNext={onNext} onAddToCart={onAdd} onClose={() => {}} />);
    click(q(container, 'story-next'));
    expect(onNext).toHaveBeenCalledTimes(1);
    click(q(container, 'story-add-to-cart'));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('hết hàng: nút thêm giỏ khoá và ghi "Hết hàng" thay giá, không gọi xử lý; nút kế vẫn bấm được', () => {
    const onAdd = vi.fn();
    const onNext = vi.fn();
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} fullscreen reel buyDisabled addPrice="1đ" onNext={onNext} onAddToCart={onAdd} onClose={() => {}} />);
    const add = q(container, 'story-add-to-cart') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.textContent).toBe('Hết hàng');
    click(add);
    expect(onAdd).not.toHaveBeenCalled();
    click(q(container, 'story-next'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('position hiện cạnh tiêu đề đầu khung; thiếu thì không có phần tử vị trí', () => {
    const withPos = mount(<ProductStoryShowcase product={PRODUCT} fullscreen reel position="2/8" onClose={() => {}} />);
    expect(q(withPos.container, 'story-position')!.textContent).toBe('2/8');
    expect(q(withPos.container, 'story-position')!.parentElement!.querySelector('h2')!.textContent).toBe('Câu chuyện sản phẩm');
    const without = mount(<ProductStoryShowcase product={PRODUCT} fullscreen reel onClose={() => {}} />);
    expect(q(without.container, 'story-position')).toBeNull();
  });

  it('Reel luôn có kịch bản dù món chưa cấu hình, và bỏ cảnh chọn phân loại (không có vòng cung)', () => {
    const bare = { ...PRODUCT, storyConfig: null, ingredients: null, slug: 'chua-cau-hinh', name: 'Món mới', brand: 'Hãng X' } as ProductDetail;
    const plain = mount(<ProductStoryShowcase product={bare} fullscreen reel onClose={() => {}} />);
    expect(q(plain.container, 'product-story')).not.toBeNull();
    const configured = mount(<ProductStoryShowcase product={PRODUCT} fullscreen reel onClose={() => {}} />);
    expect(q(configured.container, 'story-arc-item')).toBeNull();
    expect(q(configured.container, 'product-story')).not.toBeNull();
  });

  it('không có reel thì thanh đáy và hành vi cũ giữ nguyên (Thêm vào giỏ + Mua ngay, không có nút kế, không giá trên nút)', () => {
    const { container } = mount(<ProductStoryShowcase product={PRODUCT} fullscreen position="1/3" addPrice="1đ" onNext={() => {}} onClose={() => {}} />);
    expect(q(container, 'story-buy-now')).not.toBeNull();
    expect(q(container, 'story-add-to-cart')!.textContent).toBe('Thêm vào giỏ');
    expect(q(container, 'story-next')).toBeNull();
    expect(container.querySelector('.tubu-story-bar')!.getAttribute('data-reel')).toBeNull();
  });
});

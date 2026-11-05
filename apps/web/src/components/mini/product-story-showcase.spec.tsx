// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetail } from '@tubutree/app-core/api/catalog';
import type { ProductStoryConfig } from '@tubutree/shared-types';
import { click } from '@/test-utils/dom';
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

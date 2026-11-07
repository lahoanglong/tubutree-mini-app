import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ProductDetail } from '@tubutree/app-core/api/catalog';
import type { ProductStoryConfig } from '@tubutree/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPreloadCache } from '@tubutree/app-core/commerce/story-preload';
import { ProductStoryShowcase } from './product-story-showcase';

const baseProduct = {
  id: 'p1',
  slug: 'xa-phong-test',
  brand: 'Tubu',
  name: 'Xà phòng thử',
  shortDesc: null,
  description: '',
  images: ['https://example.com/a.jpg'],
  thumbnail: null,
  basePrice: 100000,
  salePrice: null,
  certifications: [],
  ingredients: null,
  variations: [],
} as unknown as ProductDetail;

const withVars = (n: number): ProductDetail =>
  ({ ...baseProduct, variations: Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, name: `Loại ${i + 1}`, stock: 5 })) }) as unknown as ProductDetail;

const steps = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Tiêu đề ${i + 1}`,
    body: `Nội dung ${i + 1}`,
    layers: [{ id: `l${i + 1}`, spriteId: 'lemongrass', label: `Sả ${i + 1}`, from: 'top' as const, xPct: 30, yPct: 30, scale: 1, rotateDeg: 0 }],
  }));

const fullConfig = (over: { label?: string } = {}): ProductStoryConfig => ({
  version: 1,
  enabled: true,
  scenes: [
    {
      kind: 'variant_arc',
      items: [
        { variationId: 'v1', label: 'Loại 1', ambient: 'leaf' },
        { variationId: 'v2', label: 'Loại 2', ambient: 'amber' },
      ],
    },
    { kind: 'ingredient_assembly', steps: steps(3) },
    {
      kind: 'hud_callouts',
      points: [
        { id: 'h1', xPct: 30, yPct: 30, label: over.label ?? 'Sả chanh', value: '12%', barPct: 12, side: 'left' },
        { id: 'h2', xPct: 70, yPct: 60, label: 'Bồ kết', side: 'right' },
      ],
      closing: 'An lành cho cả nhà',
    },
  ],
});

function mockMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
}

beforeEach(() => mockMatchMedia(false));
afterEach(() => vi.unstubAllGlobals());

describe('ProductStoryShowcase (Mini)', () => {
  it('renders nothing when no config', () => {
    const { container } = render(<ProductStoryShowcase product={baseProduct} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a product with no ingredients and one variation renders nothing', () => {
    const { container } = render(<ProductStoryShowcase product={withVars(1)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('previewConfig overrides product config', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} />);
    expect(screen.getByTestId('product-story')).toHaveAttribute('data-animated', 'true');
  });

  it('khung ảnh: ảnh gốc (không có ảnh tách nền) vào thẻ nổi ở cả sân khấu và khung HUD; có ảnh tách nền thì cutout; admin đặt thì theo admin', () => {
    const { unmount } = render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} />);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-frame', 'floating-card');
    expect(screen.getByTestId('story-hud').querySelector('[data-frame]')).toHaveAttribute('data-frame', 'floating-card');
    unmount();

    const cut = render(<ProductStoryShowcase product={baseProduct} previewConfig={{ ...fullConfig(), cutoutUrl: 'https://example.com/cut.png' }} />);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-frame', 'cutout');
    cut.unmount();

    render(<ProductStoryShowcase product={baseProduct} previewConfig={{ ...fullConfig(), cutoutUrl: 'https://example.com/cut.png', imageFrame: 'floating-card' }} />);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-frame', 'floating-card');
  });

  it('CSS thẻ nổi: bo 24px (radius-sheet), viền mảnh, bóng mềm, nền surface, chỉ áp cho khung floating-card', () => {
    const css = readFileSync(resolve(__dirname, '../../css/story.css'), 'utf8');
    const block = /\.tubu-story-frame\[data-frame='floating-card'\] \.tubu-story-product \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(block).toMatch(/border-radius:\s*var\(--radius-sheet\)/);
    expect(block).toMatch(/border:\s*1px solid var\(--color-border-subtle\)/);
    expect(block).toMatch(/box-shadow:\s*var\(--elevation-2\)/);
    expect(block).toMatch(/background:\s*var\(--color-bg-surface\)/);
    expect(block).toMatch(/overflow:\s*hidden/);
  });

  it('previewConfig draws even when enabled is false', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={{ ...fullConfig(), enabled: false }} />);
    expect(screen.getByTestId('product-story')).toBeInTheDocument();
  });

  it('variant arc: tapping an item calls onSelectVariation with its variationId and sets ambient', () => {
    const onSelect = vi.fn();
    render(<ProductStoryShowcase product={withVars(2)} selectedVariationId="v1" onSelectVariation={onSelect} previewConfig={fullConfig()} />);
    const group = screen.getByRole('radiogroup', { name: 'Chọn loại' });
    const items = within(group).getAllByTestId('story-arc-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('story-stage').style.background).toContain('--color-story-ambient-leaf');
    fireEvent.click(items[1]!);
    expect(onSelect).toHaveBeenCalledWith('v2');
    expect(items[1]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('story-stage').style.background).toContain('--color-story-ambient-amber');
  });

  it('variant arc starts on the item matching selectedVariationId', () => {
    render(<ProductStoryShowcase product={withVars(2)} selectedVariationId="v2" previewConfig={fullConfig()} />);
    expect(screen.getAllByTestId('story-arc-item')[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('steps chips switch the active step (aria-current)', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} />);
    const nav = screen.getByRole('navigation', { name: 'Các bước' });
    const chips = within(nav).getAllByTestId('story-step-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['01', '02', '03']);
    chips.forEach((c) => expect(c.getAttribute('aria-label')!.startsWith(c.textContent!)).toBe(true));
    expect(chips[0]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('story-step-panel')).toHaveTextContent('Tiêu đề 1');
    expect(screen.getAllByTestId('story-layer')).toHaveLength(1);
    fireEvent.click(chips[2]!);
    expect(chips[2]).toHaveAttribute('aria-current', 'step');
    expect(chips[0]).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('story-step-panel')).toHaveTextContent('Tiêu đề 3');
    expect(screen.getByTestId('story-step-panel')).toHaveTextContent('Nội dung 3');
    expect(screen.getAllByTestId('story-layer')).toHaveLength(3);
  });

  it('reduced motion renders all steps statically', () => {
    mockMatchMedia(true);
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} />);
    expect(screen.getByTestId('product-story')).toHaveAttribute('data-animated', 'false');
    const list = screen.getByTestId('story-static-steps');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list).toHaveTextContent('Tiêu đề 2');
    expect(list).toHaveTextContent('Nội dung 3');
    expect(screen.queryByTestId('story-step-chip')).toBeNull();
    for (const l of screen.getAllByTestId('story-layer')) expect(l).toHaveAttribute('data-static', 'true');
  });

  it('HUD callouts render label and value as text', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} />);
    const hud = screen.getByTestId('story-hud');
    const callouts = within(hud).getAllByTestId('story-callout');
    expect(callouts).toHaveLength(2);
    expect(callouts[0]).toHaveTextContent('Sả chanh');
    expect(callouts[0]).toHaveTextContent('12%');
    expect(hud).toHaveTextContent('An lành cho cả nhà');
  });

  it('sản phẩm của nhãn chủ lực chưa có cấu hình: tự vẽ điểm chỉ Thương hiệu, Quy cách, Hương đọc từ tên cùng câu kết', () => {
    const brand = { ...baseProduct, slug: 'nuoc-giat-huong-bac-ha-fuwa3e-500ml-751754', name: 'Nước giặt hương Bạc hà Fuwa3e 500ml', brand: 'Tubu Tree' } as unknown as ProductDetail;
    render(<ProductStoryShowcase product={brand} />);
    const hud = screen.getByTestId('story-hud');
    const callouts = within(hud).getAllByTestId('story-callout');
    expect(callouts).toHaveLength(3);
    expect(callouts[0]).toHaveTextContent('Thương hiệu');
    expect(callouts[0]).toHaveTextContent('Fuwa3e');
    expect(callouts[1]).toHaveTextContent('500ml');
    expect(callouts[2]).toHaveTextContent('Bạc hà');
    expect(hud).toHaveTextContent('Fuwa3e, có tại Tubu Tree');
  });

  it('hostile label renders as text not HTML', () => {
    const hostile = '<img src=x onerror=alert(1)> & "q"';
    const { container } = render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig({ label: hostile })} />);
    for (const c of screen.getAllByTestId('story-callout')) expect(c.querySelector('img')).toBeNull();
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(screen.getAllByTestId('story-callout')[0]).toHaveTextContent(hostile);
  });

  it('fullscreen: Esc calls onClose, role=dialog, buy bar has 2 buttons that call handlers', () => {
    const onClose = vi.fn();
    const onAdd = vi.fn();
    const onBuy = vi.fn();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    document.body.style.overflow = 'scroll';
    const { unmount } = render(
      <ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} fullscreen onClose={onClose} onAddToCart={onAdd} onBuyNow={onBuy} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('story-close')).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByTestId('story-add-to-cart'));
    fireEvent.click(screen.getByTestId('story-buy-now'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onBuy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('story-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
    expect(trigger).toHaveFocus();
    trigger.remove();
    document.body.style.overflow = '';
  });

  it('fullscreen buyDisabled: hai nút khoá, nút Mua ngay đổi thành Hết hàng và không gọi xử lý', () => {
    const onAdd = vi.fn();
    const onBuy = vi.fn();
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} fullscreen buyDisabled onAddToCart={onAdd} onBuyNow={onBuy} />);
    const add = screen.getByTestId('story-add-to-cart');
    const buy = screen.getByTestId('story-buy-now');
    expect(add).toBeDisabled();
    expect(buy).toBeDisabled();
    expect(buy).toHaveTextContent('Hết hàng');
    fireEvent.click(add);
    fireEvent.click(buy);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onBuy).not.toHaveBeenCalled();
  });

  it('fullscreen content scroller reserves room under the pinned bar', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} fullscreen />);
    const css = readFileSync(resolve(__dirname, '../../css/story.css'), 'utf8');
    expect(screen.getByTestId('story-scroll')).toHaveClass('tubu-story-scroll');
    expect(css).toMatch(/\.tubu-story-scroll\s*\{[^}]*padding-bottom:\s*calc\(var\(--story-bar-h\)\s*\+\s*var\(--safe-bottom/);
    expect(css).toMatch(/\.tubu-story-bar\s*\{[^}]*var\(--safe-bottom/);
  });

  it('inline mode has no dialog and no buy bar', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('story-buy-now')).toBeNull();
  });
});

const imgLayer = (id: string, imageUrl: string) => ({ id, imageUrl, label: id, from: 'top' as const, xPct: 30, yPct: 30, scale: 1, rotateDeg: 0 });
const imageStory: ProductStoryConfig = {
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

describe('W40B: tải trước ảnh chương kế và chuyển chương mượt (Mini)', () => {
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

  it('mở ở chương 01 thì tải ảnh nguyên liệu của chương 02; sang chương kế tải tiếp chương sau nó; cuối cùng và quay lại không tải lại', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={imageStory} />);
    expect(loaded).toEqual(['/api/ing-1.png']);
    const chips = screen.getAllByTestId('story-step-chip');
    fireEvent.click(chips[1]!);
    expect(loaded).toEqual(['/api/ing-1.png', '/api/ing-2.png']);
    fireEvent.click(chips[2]!);
    fireEvent.click(chips[0]!);
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
    render(<ProductStoryShowcase product={baseProduct} previewConfig={imageStory} />);
    expect(loaded).toEqual([]);
    act(() => {
      for (const cb of observers) cb([{ isIntersecting: false, target: document.body } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(loaded).toEqual([]);
    act(() => {
      for (const cb of observers) cb([{ isIntersecting: true, target: document.body } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(loaded).toEqual(['/api/ing-1.png']);
  });

  it('giảm chuyển động: bản tĩnh đã vẽ mọi lớp nên không tải trước gì thêm', () => {
    mockMatchMedia(true);
    render(<ProductStoryShowcase product={baseProduct} previewConfig={imageStory} />);
    expect(loaded).toEqual([]);
  });

  it('đổi chương dựng lại khối nội dung (key theo bước) để chạy lại hiệu ứng vào, chữ đổi theo', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={imageStory} />);
    const panel = screen.getByTestId('story-step-panel');
    const before = panel.firstElementChild!;
    expect(before).toHaveClass('tubu-story-panel-in');
    fireEvent.click(screen.getAllByTestId('story-step-chip')[1]!);
    const after = screen.getByTestId('story-step-panel').firstElementChild!;
    expect(after).toHaveClass('tubu-story-panel-in');
    expect(after).not.toBe(before);
    expect(after).toHaveTextContent('Chương 2');
  });

  describe('story.css', () => {
    const css = readFileSync(resolve(__dirname, '../../css/story.css'), 'utf8');
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('chuyển chương, lớp rơi và nền cảnh dùng đường cong ease-story 240ms (token, không số rải rác)', () => {
      expect(rule('.tubu-story-panel-in')).toMatch(/animation:\s*tubu-story-panel-in var\(--dur-story\) var\(--ease-story\) both/);
      expect(rule('.tubu-story-layer')).toMatch(/animation:\s*tubu-story-drop var\(--dur-story\) var\(--ease-story\) both/);
      expect(rule('.tubu-story-stage')).toMatch(/transition:\s*background var\(--dur-story\) var\(--ease-story\)/);
      expect(rule('.tubu-story-chip')).toMatch(/transition:\s*transform var\(--p-dur-release\) var\(--p-ease-out\), background-color var\(--dur-story\) var\(--ease-story\), color var\(--dur-story\) var\(--ease-story\)/);
      const tokens = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
      expect(tokens).toMatch(/--ease-story:\s*var\(--p-ease-story\)/);
      expect(tokens).toMatch(/--dur-story:\s*var\(--p-dur-story\)/);
    });

    it('giảm chuyển động tắt hiệu ứng vào của chương, lớp rơi, nền cảnh và đổi màu chip', () => {
      expect(reduced).toMatch(/\.tubu-story-layer,\s*\.tubu-story-panel-in\s*\{\s*animation:\s*none/);
      expect(reduced).toMatch(/\.tubu-story-stage,\s*\.tubu-story-arc-item,\s*\.tubu-story-chip\s*\{\s*transition:\s*none/);
    });

    it('số đều (tabular-nums) cho chữ bước, thẻ chỉ, chip, nhãn vòng cung và thanh mua của khung toàn màn', () => {
      expect(rule('.tubu-story')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-story-dialog')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-story-chip')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-story-arc-item')).toMatch(/font-variant-numeric:\s*tabular-nums/);
    });

    it('vùng chạm 44px: chip, mục vòng cung và nút đóng', () => {
      for (const sel of ['.tubu-story-chip', '.tubu-story-arc-item']) {
        expect(rule(sel), sel).toMatch(/min-width:\s*44px/);
        expect(rule(sel), sel).toMatch(/min-height:\s*44px/);
      }
      expect(rule('.tubu-story-close')).toMatch(/width:\s*44px/);
      expect(rule('.tubu-story-close')).toMatch(/height:\s*44px/);
    });
  });
});

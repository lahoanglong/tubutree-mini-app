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

/** Ảnh tách nền thật: chỉ lúc này sprite nguyên liệu và chú thích HUD mới được vẽ đè lên ảnh. */
const cutConfig = (over: { label?: string } = {}): ProductStoryConfig => ({ ...fullConfig(over), cutoutUrl: 'https://example.com/cut.png' });

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

  it('khung ảnh: ảnh gốc (không có ảnh tách nền) vào thẻ nổi; có ảnh tách nền thì cutout; admin đặt thì theo admin', () => {
    const { unmount } = render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} />);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-frame', 'floating-card');
    unmount();

    const cut = render(<ProductStoryShowcase product={baseProduct} previewConfig={cutConfig()} />);
    expect(screen.getByTestId('story-stage')).toHaveAttribute('data-frame', 'cutout');
    cut.unmount();

    render(<ProductStoryShowcase product={baseProduct} previewConfig={{ ...cutConfig(), imageFrame: 'floating-card' }} />);
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

  it('mọi chương cùng hiện thành thẻ bấm được; bấm một thẻ chọn chương đó (aria-current) và thả thêm lớp nguyên liệu (ảnh tách nền)', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={cutConfig()} />);
    const nav = screen.getByRole('navigation', { name: 'Các bước' });
    const cards = within(nav).getAllByTestId('story-step-card');
    expect(cards.map((c) => c.querySelector('.tubu-story-num')!.textContent)).toEqual(['01', '02', '03']);
    expect(within(nav).getByRole('list').tagName).toBe('OL');
    expect(cards.every((c) => c.tagName === 'BUTTON' && c.getAttribute('type') === 'button')).toBe(true);
    expect(cards[0]).toHaveTextContent('Tiêu đề 1');
    expect(cards[0]).toHaveTextContent('Nội dung 1');
    expect(cards[2]).toHaveTextContent('Nội dung 3');
    expect(cards[0]).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByTestId('story-layer')).toHaveLength(1);
    fireEvent.click(cards[2]!);
    expect(cards[2]).toHaveAttribute('aria-current', 'step');
    expect(cards[0]).not.toHaveAttribute('aria-current');
    expect(screen.getAllByTestId('story-layer')).toHaveLength(3);
    // Chương chưa chọn vẫn đọc được.
    expect(cards[0]).toHaveTextContent('Nội dung 1');
  });

  it('reduced motion: vẽ mọi lớp ngay (bản tĩnh) mà các chương vẫn là cùng danh sách thẻ', () => {
    mockMatchMedia(true);
    render(<ProductStoryShowcase product={baseProduct} previewConfig={cutConfig()} />);
    expect(screen.getByTestId('product-story')).toHaveAttribute('data-animated', 'false');
    expect(screen.getAllByTestId('story-step-card')).toHaveLength(3);
    expect(screen.queryByTestId('story-static-steps')).toBeNull();
    expect(screen.getAllByTestId('story-layer')).toHaveLength(3);
    for (const l of screen.getAllByTestId('story-layer')) expect(l).toHaveAttribute('data-static', 'true');
  });

  it('HUD callouts (ảnh tách nền): nằm trong khung sân khấu, nhãn và giá trị là chữ; không còn khung ảnh thứ hai; không có chip', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={cutConfig()} />);
    const hud = screen.getByTestId('story-hud');
    expect(screen.getByTestId('story-stage')).toContainElement(hud);
    expect(document.querySelectorAll('.tubu-story-frame')).toHaveLength(1);
    const callouts = within(hud).getAllByTestId('story-callout');
    expect(callouts).toHaveLength(2);
    expect(callouts[0]).toHaveTextContent('Sả chanh');
    expect(callouts[0]).toHaveTextContent('12%');
    expect(screen.getByTestId('story-closing')).toHaveTextContent('An lành cho cả nhà');
    expect(screen.queryByTestId('story-points')).toBeNull();
  });

  it('ảnh poster: không lớp nguyên liệu, không chú thích, không đường nối trên ảnh; điểm nhấn thành chip dưới khung ảnh và chọn chương không thả lớp nào', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} />);
    const stage = screen.getByTestId('story-stage');
    expect(stage).toHaveAttribute('data-frame', 'floating-card');
    expect(stage.querySelectorAll('[data-testid="story-layer"], [data-testid="story-callout"], [data-testid="story-hud"], svg, .tubu-story-dot')).toHaveLength(0);
    const points = screen.getByTestId('story-points');
    expect(points.tagName).toBe('UL');
    expect(points).toHaveAttribute('aria-label', 'Thành phần nổi bật');
    expect(stage).not.toContainElement(points);
    expect(stage.compareDocumentPosition(points) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const chips = within(points).getAllByTestId('story-point');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('Sả chanh');
    expect(chips[0]).toHaveTextContent('12%');
    expect(chips[1]).toHaveTextContent('Bồ kết');
    expect(screen.getByTestId('story-closing')).toHaveTextContent('An lành cho cả nhà');
    fireEvent.click(screen.getAllByTestId('story-step-card')[2]!);
    expect(screen.queryAllByTestId('story-layer')).toHaveLength(0);
    expect(screen.getAllByTestId('story-step-card')[2]).toHaveAttribute('aria-current', 'step');
  });

  it('admin ép imageFrame: floating-card tắt đè dù có ảnh tách nền; cutout bật đè dù không có', () => {
    const a = render(<ProductStoryShowcase product={baseProduct} previewConfig={{ ...cutConfig(), imageFrame: 'floating-card' }} />);
    expect(screen.queryAllByTestId('story-callout')).toHaveLength(0);
    expect(screen.getAllByTestId('story-point')).toHaveLength(2);
    a.unmount();
    render(<ProductStoryShowcase product={baseProduct} previewConfig={{ ...fullConfig(), imageFrame: 'cutout' }} />);
    expect(screen.getAllByTestId('story-callout')).toHaveLength(2);
    expect(screen.queryAllByTestId('story-point')).toHaveLength(0);
  });

  it('sản phẩm của nhãn chủ lực chưa có cấu hình: tự vẽ điểm nhấn Thương hiệu, Quy cách, Hương đọc từ tên cùng câu kết (chip dưới ảnh poster)', () => {
    const brand = { ...baseProduct, slug: 'nuoc-giat-huong-bac-ha-fuwa3e-750ml-aaaaaa', name: 'Nước giặt hương Bạc hà Fuwa3e 750ml', brand: 'Tubu Tree' } as unknown as ProductDetail;
    render(<ProductStoryShowcase product={brand} />);
    expect(screen.queryByTestId('story-hud')).toBeNull();
    expect(screen.queryAllByTestId('story-callout')).toHaveLength(0);
    const chips = within(screen.getByTestId('story-points')).getAllByTestId('story-point');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent('Thương hiệu');
    expect(chips[0]).toHaveTextContent('Fuwa3e');
    expect(chips[1]).toHaveTextContent('750ml');
    expect(chips[2]).toHaveTextContent('Bạc hà');
    expect(screen.getByTestId('story-closing')).toHaveTextContent('Fuwa3e, có tại Tubu Tree');
  });

  it('hostile label renders as text not HTML (cả chú thích trên ảnh tách nền lẫn chip dưới ảnh poster)', () => {
    const hostile = '<img src=x onerror=alert(1)> & "q"';
    const cut = render(<ProductStoryShowcase product={baseProduct} previewConfig={cutConfig({ label: hostile })} />);
    for (const c of screen.getAllByTestId('story-callout')) expect(c.querySelector('img')).toBeNull();
    expect(cut.container.querySelector('img[onerror]')).toBeNull();
    expect(screen.getAllByTestId('story-callout')[0]).toHaveTextContent(hostile);
    cut.unmount();
    const poster = render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig({ label: hostile })} />);
    for (const c of screen.getAllByTestId('story-point')) expect(c.querySelector('img')).toBeNull();
    expect(poster.container.querySelector('img[onerror]')).toBeNull();
    expect(screen.getAllByTestId('story-point')[0]).toHaveTextContent(hostile);
  });

  it('không còn khối chương nào chỉ hiện một bước: không story-step-chip, story-step-panel hay story-static-steps', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} />);
    for (const id of ['story-step-chip', 'story-step-panel', 'story-static-steps']) expect(screen.queryByTestId(id), id).toBeNull();
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
  cutoutUrl: 'https://example.com/cut.png',
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
    const chips = screen.getAllByTestId('story-step-card');
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

  it('ảnh poster (không có ảnh tách nền) không vẽ lớp nguyên liệu nên không tải trước ảnh nào', () => {
    const { cutoutUrl: _omit, ...poster } = imageStory;
    void _omit;
    render(<ProductStoryShowcase product={baseProduct} previewConfig={poster} />);
    fireEvent.click(screen.getAllByTestId('story-step-card')[1]!);
    expect(loaded).toEqual([]);
  });

  it('chọn chương đổi thẻ đang chọn (aria-current) mà không dựng lại các thẻ khác', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={imageStory} />);
    const before = screen.getAllByTestId('story-step-card');
    fireEvent.click(before[1]!);
    const after = screen.getAllByTestId('story-step-card');
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after.map((c) => c.getAttribute('aria-current'))).toEqual([null, 'step', null]);
  });

  describe('story.css', () => {
    const css = readFileSync(resolve(__dirname, '../../css/story.css'), 'utf8');
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('chọn thẻ chương, lớp rơi và nền cảnh dùng đường cong ease-story 240ms (token, không số rải rác)', () => {
      expect(rule('.tubu-story-layer')).toMatch(/animation:\s*tubu-story-drop var\(--dur-story\) var\(--ease-story\) both/);
      expect(rule('.tubu-story-stage')).toMatch(/transition:\s*background var\(--dur-story\) var\(--ease-story\)/);
      expect(rule('.tubu-story-step')).toMatch(/transition:\s*background-color var\(--dur-story\) var\(--ease-story\), border-color var\(--dur-story\) var\(--ease-story\)/);
      const tokens = readFileSync(resolve(__dirname, '../../css/tokens.css'), 'utf8');
      expect(tokens).toMatch(/--ease-story:\s*var\(--p-ease-story\)/);
      expect(tokens).toMatch(/--dur-story:\s*var\(--p-dur-story\)/);
    });

    it('giảm chuyển động tắt lớp rơi, nền cảnh và đổi màu thẻ chương', () => {
      expect(reduced).toMatch(/\.tubu-story-layer\s*\{\s*animation:\s*none/);
      expect(reduced).toMatch(/\.tubu-story-stage,\s*\.tubu-story-arc-item,\s*\.tubu-story-step\s*\{\s*transition:\s*none/);
    });

    it('số đều (tabular-nums) cho chữ chương, chip điểm nhấn, nhãn vòng cung và thanh mua của khung toàn màn', () => {
      expect(rule('.tubu-story')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-story-dialog')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-story-arc-item')).toMatch(/font-variant-numeric:\s*tabular-nums/);
    });

    it('vùng chạm 44px: thẻ chương, mục vòng cung và nút đóng', () => {
      expect(rule('.tubu-story-step')).toMatch(/min-height:\s*44px/);
      expect(rule('.tubu-story-arc-item')).toMatch(/min-width:\s*44px/);
      expect(rule('.tubu-story-arc-item')).toMatch(/min-height:\s*44px/);
      expect(rule('.tubu-story-close')).toMatch(/width:\s*44px/);
      expect(rule('.tubu-story-close')).toMatch(/height:\s*44px/);
    });

    it('không còn khối ghim, mốc cuộn hay chip bước; thẻ chương và chip điểm nhấn chỉ dùng token', () => {
      for (const gone of ['.tubu-story-chips', '.tubu-story-chip', '.tubu-story-panel', '.tubu-story-static', '.tubu-story-progress', '.tubu-story-sentinel', '.tubu-story-pin']) expect(css.includes(gone), gone).toBe(false);
      expect(rule('.tubu-story-step')).toMatch(/border:\s*1px solid var\(--color-border-subtle\)/);
      expect(rule(".tubu-story-step[aria-current='step']")).toMatch(/background:\s*var\(--color-bg-subtle\)/);
      expect(rule('.tubu-story-point')).toMatch(/border:\s*1px solid var\(--color-border-default\)/);
      expect(rule('.tubu-story-hud')).toMatch(/position:\s*absolute/);
    });
  });
});

describe('ProductStoryShowcase (Mini): chế độ Reel', () => {
  const reelProduct = { ...baseProduct, name: 'Nước rửa chén', brand: 'Tubu', certifications: ['USDA'] } as unknown as ProductDetail;

  it('món không cấu hình, không nguyên liệu vẫn có khung toàn màn (kịch bản dự phòng) khi reel; không reel vẫn không vẽ gì', () => {
    const { rerender } = render(<ProductStoryShowcase product={reelProduct} fullscreen />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<ProductStoryShowcase product={reelProduct} fullscreen reel />);
    expect(screen.getByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toBeInTheDocument();
    expect(screen.getByText('Món Tubu Tree chọn')).toBeInTheDocument();
  });

  it('thanh đáy Reel: "Thêm vào giỏ · giá" và "Câu chuyện kế", không có "Mua ngay"', () => {
    const onAdd = vi.fn();
    const onNext = vi.fn();
    render(<ProductStoryShowcase product={reelProduct} fullscreen reel addPrice="49.000đ" onNext={onNext} onAddToCart={onAdd} />);
    const add = screen.getByTestId('story-add-to-cart');
    expect(add).toHaveTextContent('Thêm vào giỏ · 49.000đ');
    expect(screen.queryByTestId('story-buy-now')).toBeNull();
    const next = screen.getByTestId('story-next');
    expect(next).toHaveAccessibleName('Câu chuyện kế, xem sản phẩm kế tiếp');
    expect(next).toHaveTextContent('Câu chuyện kế');
    fireEvent.click(add);
    fireEvent.click(next);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(add.closest('.tubu-story-bar')).toHaveAttribute('data-reel', 'true');
  });

  it('không truyền onNext (món cuối dải): không có nút "Câu chuyện kế"', () => {
    render(<ProductStoryShowcase product={reelProduct} fullscreen reel addPrice="49.000đ" onAddToCart={vi.fn()} />);
    expect(screen.queryByTestId('story-next')).toBeNull();
    expect(screen.getByTestId('story-add-to-cart')).toBeInTheDocument();
  });

  it('không có addPrice: nút chỉ ghi "Thêm vào giỏ"', () => {
    render(<ProductStoryShowcase product={reelProduct} fullscreen reel onAddToCart={vi.fn()} />);
    expect(screen.getByTestId('story-add-to-cart')).toHaveTextContent(/^Thêm vào giỏ$/);
  });

  it('buyDisabled (hết hàng): nút thêm khoá, ghi "Hết hàng", không gọi xử lý; nút kế vẫn dùng được', () => {
    const onAdd = vi.fn();
    const onNext = vi.fn();
    render(<ProductStoryShowcase product={reelProduct} fullscreen reel buyDisabled addPrice="49.000đ" onNext={onNext} onAddToCart={onAdd} />);
    const add = screen.getByTestId('story-add-to-cart');
    expect(add).toBeDisabled();
    expect(add).toHaveTextContent('Hết hàng');
    fireEvent.click(add);
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('story-next'));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('position hiện cạnh tiêu đề đầu khung ("2/8"), có số đều; không truyền thì không có', () => {
    const { rerender } = render(<ProductStoryShowcase product={reelProduct} fullscreen reel position="2/8" />);
    expect(screen.getByTestId('story-position')).toHaveTextContent('2/8');
    expect(screen.getByTestId('story-position').closest('.tubu-reel-heading')).toHaveTextContent('Câu chuyện sản phẩm');
    rerender(<ProductStoryShowcase product={reelProduct} fullscreen reel />);
    expect(screen.queryByTestId('story-position')).toBeNull();
  });

  it('Esc và nút đóng vẫn gọi onClose; nút đóng nhận focus đầu tiên', () => {
    const onClose = vi.fn();
    render(<ProductStoryShowcase product={reelProduct} fullscreen reel onClose={onClose} />);
    expect(screen.getByTestId('story-close')).toHaveFocus();
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('story-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Reel bỏ cảnh chọn phân loại: món nhiều phân loại có cấu hình vòng cung không vẽ chip chọn phân loại', () => {
    render(<ProductStoryShowcase product={withVars(2)} fullscreen reel />);
    expect(screen.queryByTestId('story-arc')).toBeNull();
    expect(screen.queryAllByTestId('story-arc-item')).toHaveLength(0);
  });

  it('chữ cố định của Reel không có "Freeship" lẫn dấu chấm than', () => {
    render(<ProductStoryShowcase product={reelProduct} fullscreen reel addPrice="49.000đ" onNext={vi.fn()} position="1/8" />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).not.toMatch(/freeship/i);
    expect(dialog.textContent).not.toContain('!');
  });

  it('chế độ không-reel giữ nguyên: hai nút Thêm vào giỏ + Mua ngay, không data-reel, không nút kế', () => {
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} fullscreen onNext={vi.fn()} addPrice="1đ" position="1/3" />);
    expect(screen.getByTestId('story-add-to-cart')).toHaveTextContent(/^Thêm vào giỏ$/);
    expect(screen.getByTestId('story-buy-now')).toBeInTheDocument();
    expect(screen.queryByTestId('story-next')).toBeNull();
    expect(screen.getByTestId('story-add-to-cart').closest('.tubu-story-bar')).not.toHaveAttribute('data-reel');
  });
});

describe('css/story-reel.css: thanh đáy Reel', () => {
  const css = readFileSync(resolve(__dirname, '../../css/story-reel.css'), 'utf8');

  it('nút kế co theo nội dung, nút thêm chiếm phần còn lại và được xuống dòng (đọc đủ số tiền)', () => {
    expect(css).toMatch(/\.tubu-story-bar\[data-reel='true'\] > \.tubu-reel-next-btn\s*\{\s*flex:\s*0 0 auto/);
    expect(css).toMatch(/\.tubu-story-bar\[data-reel='true'\] > \*\s*\{\s*flex:\s*1 1 0;\s*min-width:\s*0/);
    expect(css).toMatch(/\.tubu-reel-add-btn[^{]*\{[^}]*white-space:\s*normal/);
  });

  it('dưới 360px nhãn nút kế ẩn (chỉ còn mũi tên, tên truy cập giữ nguyên)', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    try {
      const media = Array.from(style.sheet!.cssRules).find(
        (r) => r.constructor.name === 'CSSMediaRule' && /max-width:\s*359px/.test((r as CSSMediaRule).conditionText ?? (r as CSSMediaRule).media.mediaText),
      ) as CSSMediaRule | undefined;
      expect(media).toBeDefined();
      const inner = Array.from(media!.cssRules) as CSSStyleRule[];
      expect(inner.find((r) => r.selectorText === '.tubu-reel-next-label')!.style.getPropertyValue('display')).toBe('none');
    } finally {
      style.remove();
    }
  });
});

describe('ProductStoryShowcase: nút thêm giỏ / mua ngay khoá chạm đúp khi xử lý trả Promise (W70A)', () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it('khung toàn màn: chạm đúp "Thêm vào giỏ" trong cùng một khung hình chỉ gọi xử lý một lần, xong thì chạm lại được', async () => {
    const d = deferred();
    const onAdd = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(undefined);
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} fullscreen onAddToCart={onAdd} />);
    const add = screen.getByTestId('story-add-to-cart');
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve());
    await act(async () => {
      fireEvent.click(add);
    });
    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it('khung toàn màn: chạm đúp "Mua ngay" chỉ gọi xử lý một lần', async () => {
    const d = deferred();
    const onBuy = vi.fn().mockReturnValueOnce(d.promise);
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} fullscreen onBuyNow={onBuy} />);
    const buy = screen.getByTestId('story-buy-now');
    await act(async () => {
      fireEvent.click(buy);
      fireEvent.click(buy);
    });
    expect(onBuy).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve());
  });

  it('Reel: chạm đúp "Thêm vào giỏ · giá" chỉ gọi xử lý một lần', async () => {
    const reelProduct = { ...baseProduct, name: 'Nước rửa chén' } as unknown as ProductDetail;
    const d = deferred();
    const onAdd = vi.fn().mockReturnValueOnce(d.promise);
    render(<ProductStoryShowcase product={reelProduct} fullscreen reel addPrice="49.000đ" onAddToCart={onAdd} />);
    const add = screen.getByTestId('story-add-to-cart');
    await act(async () => {
      fireEvent.click(add);
      fireEvent.click(add);
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve());
  });

  it('xử lý trả void thì không khoá: bấm dồn vẫn gọi từng lần (không đổi hành vi cũ)', () => {
    const onAdd = vi.fn();
    render(<ProductStoryShowcase product={baseProduct} previewConfig={fullConfig()} fullscreen onAddToCart={onAdd} />);
    const add = screen.getByTestId('story-add-to-cart');
    fireEvent.click(add);
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(2);
  });
});


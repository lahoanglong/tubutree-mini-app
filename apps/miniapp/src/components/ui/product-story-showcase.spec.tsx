import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ProductDetail } from '@tubutree/app-core/api/catalog';
import type { ProductStoryConfig } from '@tubutree/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

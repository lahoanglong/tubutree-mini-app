// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDetail } from '@tubutree/app-core/api/catalog';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { PdpSelectionProvider, usePdpSelection } from '@/components/pdp-selection';
import { PdpStory } from './pdp-story';

const PRODUCT = {
  id: 'p1', slug: 'khong-co-preset', brand: 'Tubu', name: 'Xà phòng', shortDesc: null, description: 'Mô tả', images: ['https://cdn.test/a.jpg'], thumbnail: null,
  basePrice: 1, salePrice: null, certifications: [], ingredients: null,
  storyConfig: {
    version: 1, enabled: true,
    scenes: [
      { kind: 'variant_arc', items: [{ variationId: 'v1', label: 'Bưởi', ambient: 'amber' }, { variationId: 'v2', label: 'Sả', ambient: 'leaf' }] },
      { kind: 'hud_callouts', closing: 'An lành', points: [{ id: 'p1', xPct: 40, yPct: 40, label: 'Bồ kết', side: 'left' }] },
    ],
  },
  variations: [
    { id: 'v1', sku: 'a', name: 'Bưởi', attributes: {}, retailPrice: 1, salePrice: null, stock: 5 },
    { id: 'v2', sku: 'b', name: 'Sả', attributes: {}, retailPrice: 1, salePrice: null, stock: 5 },
  ],
} as unknown as ProductDetail;

let mounted: Rendered[] = [];
const Probe = () => <p data-testid="probe">{usePdpSelection()?.selectedId}</p>;
const mount = async (product: ProductDetail) => {
  const r = render(
    <PdpSelectionProvider initialId="v1">
      <PdpStory product={product} />
      <Probe />
      <button type="button" data-testid="pdp-add-to-cart" onClick={onAdd} />
      <button type="button" data-testid="buy-now" onClick={onBuy} />
    </PdpSelectionProvider>,
  );
  mounted.push(r);
  await flush();
  return r.container;
};
const onAdd = vi.fn();
const onBuy = vi.fn();

beforeEach(() => {
  onAdd.mockClear();
  onBuy.mockClear();
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpStory', () => {
  it('không có cấu hình thì không dựng gì và không có nút mở', async () => {
    const c = await mount({ ...PRODUCT, storyConfig: null, slug: 'khong-co', variations: [] } as unknown as ProductDetail);
    expect(c.querySelector('[data-testid="pdp-story"]')).toBeNull();
    expect(c.querySelector('[data-testid="pdp-story-open"]')).toBeNull();
  });

  it('chọn phân loại ở vòng cung đổi phân loại chung của trang', async () => {
    const c = await mount(PRODUCT);
    expect(c.querySelector('[data-testid="probe"]')!.textContent).toBe('v1');
    click(c.querySelectorAll('[data-testid="story-arc-item"]')[1]!);
    expect(c.querySelector('[data-testid="probe"]')!.textContent).toBe('v2');
  });

  it('nút mở hiện khung toàn màn; Thêm giỏ và Mua ngay đóng khung rồi bấm nút của khối mua', async () => {
    const c = await mount(PRODUCT);
    const open = c.querySelector<HTMLElement>('[data-testid="pdp-story-open"]')!;
    expect(open.className).toContain('min-h-11');
    click(open);
    expect(c.querySelector('[role="dialog"]')).not.toBeNull();
    click(c.querySelector('[data-testid="story-buy-now"]'));
    expect(c.querySelector('[role="dialog"]')).toBeNull();
    await flush();
    expect(onBuy).toHaveBeenCalledTimes(1);
    click(open);
    click(c.querySelector('[data-testid="story-add-to-cart"]'));
    await flush();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

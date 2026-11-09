// @vitest-environment jsdom
import { act } from 'react';
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
let latest: ReturnType<typeof usePdpSelection> = null;
const Probe = () => {
  latest = usePdpSelection();
  return <p data-testid="probe">{latest?.selectedId}</p>;
};
const mount = async (product: ProductDetail, placement?: 'phone' | 'wide') => {
  const r = render(
    <PdpSelectionProvider initialId="v1">
      <PdpStory product={product} placement={placement} />
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
    // Từ md nút canh giữa dưới dải (không còn dính trái): khối, mx-auto, w-fit.
    expect(open.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'md:mx-auto', 'md:w-fit']));
    expect(open.className.split(' ')).not.toContain('md:w-auto');
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
  it('chạm đúp "Thêm vào giỏ" / "Mua ngay" trong cùng một khung hình chỉ bấm nút của khối mua một lần (W70B)', async () => {
    const c = await mount(PRODUCT);
    const open = c.querySelector<HTMLElement>('[data-testid="pdp-story-open"]')!;
    click(open);
    const add = c.querySelector<HTMLElement>('[data-testid="story-add-to-cart"]')!;
    await act(async () => {
      add.click();
      add.click();
    });
    await flush();
    expect(onAdd).toHaveBeenCalledTimes(1);
    click(open);
    const buy = c.querySelector<HTMLElement>('[data-testid="story-buy-now"]')!;
    await act(async () => {
      buy.click();
      buy.click();
    });
    await flush();
    expect(onBuy).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
  it('chọn phân loại ở vòng cung đánh dấu khách đã tự chọn, để tồn kho thật về sau không đổi phân loại dưới tay họ', async () => {
    const c = await mount(PRODUCT);
    expect(latest!.userPicked.current).toBe(false);
    click(c.querySelectorAll('[data-testid="story-arc-item"]')[1]!);
    expect(latest!.userPicked.current).toBe(true);
  });

  it('khối mua báo hết hàng: hai nút của khung toàn màn khoá, báo còn hàng thì mở lại', async () => {
    const c = await mount(PRODUCT);
    click(c.querySelector('[data-testid="pdp-story-open"]'));
    expect((c.querySelector('[data-testid="story-buy-now"]') as HTMLButtonElement).disabled).toBe(false);
    act(() => latest!.setBuyable(false));
    expect((c.querySelector('[data-testid="story-buy-now"]') as HTMLButtonElement).disabled).toBe(true);
    expect((c.querySelector('[data-testid="story-add-to-cart"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => latest!.setBuyable(true));
    expect((c.querySelector('[data-testid="story-buy-now"]') as HTMLButtonElement).disabled).toBe(false);
  });
  it('placement phone: nằm ở cột thông tin sau khối mua (order 7) và ẩn từ md; wide: chỉ hiện từ md', async () => {
    const phone = await mount(PRODUCT, 'phone');
    const p = phone.querySelector('[data-testid="pdp-story"]')!;
    expect(p.className).toContain('md:hidden');
    expect(p.className).toContain('tubu-pdp-order-7');
    expect(p.className.split(' ')).not.toContain('hidden');
    document.body.innerHTML = '';
    const wide = await mount(PRODUCT, 'wide');
    const w = wide.querySelector('[data-testid="pdp-story"]')!;
    expect(w.className.split(' ')).toContain('hidden');
    expect(w.className).toContain('md:block');
    expect(w.className).not.toContain('tubu-pdp-order-7');
  });
});

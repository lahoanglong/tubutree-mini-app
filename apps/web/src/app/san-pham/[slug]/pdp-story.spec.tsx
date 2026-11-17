// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const mount = async (product: ProductDetail) => {
  const r = render(
    <PdpSelectionProvider initialId="v1">
      <PdpStory product={product} />
      <Probe />
    </PdpSelectionProvider>,
  );
  mounted.push(r);
  await flush();
  return r.container;
};

beforeEach(() => {
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

  it('không có nút "Xem câu chuyện sản phẩm" mở lại cùng nội dung dưới dải, và không dựng khung toàn màn (dải đã kể đủ các chương ngay trên trang)', async () => {
    const c = await mount(PRODUCT);
    expect(c.querySelector('[data-testid="pdp-story-open"]')).toBeNull();
    expect(c.textContent).not.toContain('Xem câu chuyện sản phẩm');
    expect(c.querySelector('[role="dialog"]')).toBeNull();
    expect(c.querySelector('[data-fullscreen="true"]')).toBeNull();
    expect(c.querySelectorAll('[data-testid="product-story"]')).toHaveLength(1);
    expect(c.querySelector('[data-testid="pdp-story"] > button')).toBeNull();
  });
  it('chọn phân loại ở vòng cung đánh dấu khách đã tự chọn, để tồn kho thật về sau không đổi phân loại dưới tay họ', async () => {
    const c = await mount(PRODUCT);
    expect(latest!.userPicked.current).toBe(false);
    click(c.querySelectorAll('[data-testid="story-arc-item"]')[1]!);
    expect(latest!.userPicked.current).toBe(true);
  });

  it('một bản duy nhất, mọi khổ (không còn bản riêng cho điện thoại và máy tính), gốc khối mang data-pdp-block="story"', async () => {
    const c = await mount(PRODUCT);
    const all = c.querySelectorAll('[data-testid="pdp-story"]');
    expect(all).toHaveLength(1);
    const el = all[0]!;
    expect(el.getAttribute('data-pdp-block')).toBe('story');
    expect(el.className.split(' ')).not.toContain('hidden');
    expect(el.className).not.toContain('md:hidden');
    expect(el.className).not.toContain('tubu-pdp-order');
  });

  it('chỉ vẽ khi sản phẩm có câu chuyện riêng đang bật: cấu hình tắt (kịch bản mẫu) thì không có khối', async () => {
    const off = { ...PRODUCT, storyConfig: { ...(PRODUCT as unknown as { storyConfig: object }).storyConfig, enabled: false } } as unknown as ProductDetail;
    const c = await mount(off);
    expect(c.querySelector('[data-pdp-block="story"]')).toBeNull();
  });

  it('khung ảnh của dải không lặp ảnh đầu thư viện ngay phía trên', async () => {
    const two = { ...PRODUCT, images: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'] } as unknown as ProductDetail;
    const c = await mount(two);
    const srcs = Array.from(c.querySelectorAll('[data-testid="pdp-story"] img')).map((i) => i.getAttribute('src') ?? '');
    expect(srcs.some((s) => s.includes('b.jpg'))).toBe(true);
    expect(srcs.some((s) => s.includes('a.jpg'))).toBe(false);
  });
});

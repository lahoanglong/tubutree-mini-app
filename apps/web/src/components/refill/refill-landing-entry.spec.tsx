// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

// Lối vào "Tiết kiệm với Refill" (hub Danh mục, Bộ quà tặng): chỉ khi cờ bật VÀ có thẻ gói bán được; cờ tắt thì không gọi trang.
const mocks = vi.hoisted(() => ({ get: vi.fn(), config: {} as Record<string, unknown>, landing: {} as unknown }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));

import { RefillLandingEntry } from './refill-landing-entry';

const offer = { productId: 'p-r', slug: 'refill-a', name: 'Túi Refill a 2L', thumbnail: null, variationId: 'v-r', price: 200_000, compareAt: null, sizeLabel: '2L', inStock: true, tubu: true };
const bottle = { productId: 'b-a', slug: 'chai-a', name: 'Chai a 500ml', thumbnail: null, price: 68_000, compareAt: null, sizeLabel: '500ml', inStock: true };

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RefillLandingEntry className="mt-4" />);
  mounted.push(r);
  await flush(6);
  return r.container;
};

beforeEach(() => {
  mocks.config = { refillFirstEnabled: true };
  mocks.landing = { enabled: true, pairs: [{ bottle, refill: offer, savingPct: 26 }] };
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/config/public') return mocks.config;
    if (path === '/catalog/refill-pairs/landing') return mocks.landing;
    throw new Error(`đường dẫn lạ ${path}`);
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('RefillLandingEntry (tubu-w17-01)', () => {
  it('cờ bật, có thẻ bán được: một liên kết thật tới /tiet-kiem-refill, tiêu đề + dòng phụ', async () => {
    const c = await mount();
    const links = c.querySelectorAll<HTMLAnchorElement>('a[data-testid="refill-landing-entry"]');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/tiet-kiem-refill');
    expect(links[0]!.className).toContain('mt-4');
    expect(links[0]!.textContent).toContain('Tiết kiệm với Refill');
    expect(links[0]!.textContent).toContain('Túi, can Refill rẻ hơn mua chai mới');
    expect(c.querySelectorAll('[role="button"]')).toHaveLength(0);
  });

  it('cờ tắt: không vẽ, không gọi trang', async () => {
    mocks.config = { refillFirstEnabled: false };
    const c = await mount();
    expect(c.innerHTML).toBe('');
    expect(mocks.get.mock.calls.map((x) => x[0])).not.toContain('/catalog/refill-pairs/landing');
  });

  it('cờ bật nhưng không có thẻ bán được (rỗng, gói hết hàng) hay lỗi tải: không vẽ', async () => {
    for (const landing of [{ enabled: true, pairs: [] }, { enabled: true, pairs: [{ bottle, refill: { ...offer, inStock: false }, savingPct: 26 }] }, new Error('down')]) {
      mocks.landing = landing;
      if (landing instanceof Error) mocks.get.mockImplementation(async (path: string) => (path === '/config/public' ? mocks.config : Promise.reject(landing)));
      const c = await mount();
      expect(c.innerHTML).toBe('');
    }
  });
});

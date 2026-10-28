// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ get: vi.fn(), phase: 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SuggestFeed } from './suggest-feed';

const card = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true,
});
const page = (data: unknown[]) => ({ data, meta: { page: 1, limit: 12, total: data.length } });

let mounted: Rendered | null = null;
const mount = async (initial?: ReturnType<typeof page>) => {
  mounted = render(
    <QueryClientProvider client={newTestClient()}>
      <SuggestFeed {...(initial ? { initial: initial as never } : {})} />
    </QueryClientProvider>,
  );
  await flush(8);
  return mounted.container;
};

beforeEach(() => {
  mocks.phase = 'guest';
  mocks.get.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('SuggestFeed (web)', () => {
  it('đã tải xong, rỗng, không lỗi → ẩn cả khối: không tiêu đề, không chip', async () => {
    mocks.get.mockResolvedValue(page([]));
    const c = await mount();
    expect(c.textContent).toBe('');
    expect(c.querySelector('h2')).toBeNull();
  });

  it('trang đầu rỗng do server dựng sẵn (catalog trống) cũng ẩn khối, không chờ tải', async () => {
    const c = await mount(page([]));
    expect(c.textContent).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('đang tải → vẫn giữ tiêu đề, chip và khung chờ', async () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    const c = await mount();
    expect(c.querySelector('h2')?.textContent).toBe('Gợi ý cho bạn');
    expect(c.querySelector('[data-testid="suggest-skeleton"]')).not.toBeNull();
    expect(c.textContent).toContain('Bán chạy');
  });

  it('có sản phẩm → tiêu đề, chip và lưới', async () => {
    mocks.get.mockResolvedValue(page([card(1), card(2)]));
    const c = await mount();
    expect(c.querySelector('h2')?.textContent).toBe('Gợi ý cho bạn');
    expect(c.textContent).toContain('Sản phẩm 1');
    expect(c.textContent).toContain('Bán chạy');
  });

  it('lỗi tải (không phải rỗng) → vẫn hiện khối lỗi kèm "Thử lại", không mất khối im lặng', async () => {
    mocks.get.mockRejectedValue(new Error('x'));
    const c = await mount();
    expect(c.querySelector('[data-testid="home-block-error"]')).not.toBeNull();
    expect(c.querySelector('button[aria-label^="Thử lại"]')).not.toBeNull();
  });
});

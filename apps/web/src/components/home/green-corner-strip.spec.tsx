// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ get: vi.fn(), enabled: true }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get } }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: true, reviewGreenCorner: { enabled: mocks.enabled, rewardPoints: 100, dailyCap: 3, maxPhotos: 3 } }) }));

import { GreenCornerStrip } from './green-corner-strip';

const item = (id: string) => ({
  id,
  rating: 4,
  comment: 'Giặt êm, không bám mùi',
  image: `/reviews/${id}/images/0?v=0123456789`,
  author: 'Lan N.',
  ecoTags: ['soft', 'saving'],
  product: { slug: `nuoc-giat-${id}`, name: `Nước giặt ${id}` },
});

let mounted: Rendered | null = null;
const mount = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mounted = render(
    <QueryClientProvider client={qc}>
      <GreenCornerStrip fallback={<p data-testid="fallback">Cộng đồng</p>} />
    </QueryClientProvider>,
  );
  await flush(5);
  return mounted.container;
};
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  mocks.get.mockReset();
  mocks.enabled = true;
});

describe('GreenCornerStrip web (tubu-w3-01)', () => {
  it('cờ tắt: vẽ thẻ Cộng đồng, không gọi /green-corner', async () => {
    mocks.enabled = false;
    const c = await mount();
    expect(c.querySelector('[data-testid="fallback"]')).not.toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('dưới 3 đánh giá ảnh đã duyệt hay API lỗi: về thẻ Cộng đồng', async () => {
    mocks.get.mockResolvedValue({ enabled: true, items: [item('a'), item('b')] });
    expect((await mount()).querySelector('[data-testid="fallback"]')).not.toBeNull();
    mounted?.unmount();
    mocks.get.mockReset();
    mocks.get.mockRejectedValue(new Error('500'));
    expect((await mount()).querySelector('[data-testid="fallback"]')).not.toBeNull();
  });

  it('đủ 3: tiêu đề, mỗi thẻ là liên kết tới trang sản phẩm kèm nhãn đọc, ảnh qua API, dòng thẻ cảm nhận', async () => {
    mocks.get.mockResolvedValue({ enabled: true, items: [item('a'), item('b'), item('c')] });
    const c = await mount();
    expect(mocks.get).toHaveBeenCalledWith('/green-corner');
    const section = c.querySelector('section[data-testid="green-corner"]')!;
    expect(section.getAttribute('aria-label')).toBe('Khách hàng sống xanh cùng Tubu Tree');
    const links = Array.from(section.querySelectorAll<HTMLAnchorElement>('a.tubu-green-card'));
    expect(links).toHaveLength(3);
    expect(links[0]!.getAttribute('href')).toContain('nuoc-giat-a');
    expect(links[0]!.getAttribute('aria-label')).toBe('Nước giặt a, Lan N. đánh giá 4 sao');
    expect(links[0]!.querySelector('img')!.getAttribute('src')).toMatch(/\/reviews\/a\/images\/0\?v=0123456789$/);
    expect(section.textContent).toContain('Mềm mịn · Tiết kiệm');
    expect(c.querySelector('[data-testid="fallback"]')).toBeNull();
  });
});

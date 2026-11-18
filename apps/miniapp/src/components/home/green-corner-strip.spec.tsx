import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchGreenCorner: vi.fn(), enabled: true }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../hooks/use-public-config', () => ({
  usePublicConfig: () => ({ reviewGreenCorner: { enabled: mocks.enabled, rewardPoints: 100, dailyCap: 3, maxPhotos: 3 } }),
}));
vi.mock('../../services/shop-api', () => ({ fetchGreenCorner: mocks.fetchGreenCorner }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { GreenCornerStrip } from './green-corner-strip';

const item = (id: string) => ({
  id,
  rating: 5,
  comment: 'Bé dùng không bị đỏ',
  image: `/reviews/${id}/images/0?v=0123456789`,
  author: 'Lan N.',
  ecoTags: ['baby_safe'],
  product: { slug: `khan-${id}`, name: `Khăn ${id}` },
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GreenCornerStrip fallback={<p data-testid="fallback">Cộng đồng</p>} />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  mocks.navigate.mockReset();
  mocks.fetchGreenCorner.mockReset();
  mocks.enabled = true;
});

describe('GreenCornerStrip Mini (tubu-w3-01)', () => {
  it('cờ tắt: vẽ thẻ Cộng đồng, không gọi API', () => {
    mocks.enabled = false;
    mount();
    expect(screen.getByTestId('fallback')).toBeTruthy();
    expect(mocks.fetchGreenCorner).not.toHaveBeenCalled();
  });

  it('đang tải vẫn là thẻ Cộng đồng (không có khung chờ co giãn); dưới 3 thẻ thì giữ thẻ Cộng đồng', async () => {
    mocks.fetchGreenCorner.mockResolvedValue({ enabled: true, items: [item('a')] });
    mount();
    expect(screen.getByTestId('fallback')).toBeTruthy();
    await waitFor(() => expect(mocks.fetchGreenCorner).toHaveBeenCalled());
    expect(screen.getByTestId('fallback')).toBeTruthy();
    expect(screen.queryByTestId('green-corner')).toBeNull();
  });

  it('đủ 3: thẻ là nút có nhãn đọc, chạm thì mở trang sản phẩm', async () => {
    mocks.fetchGreenCorner.mockResolvedValue({ enabled: true, items: [item('a'), item('b'), item('c')] });
    mount();
    const card = await screen.findByRole('button', { name: 'Khăn b, Lan N. đánh giá 5 sao' });
    const section = screen.getByTestId('green-corner');
    expect(section.getAttribute('aria-label')).toBe('Khách hàng sống xanh cùng Tubu Tree');
    expect(section.textContent).toContain('An toàn cho bé');
    await userEvent.click(card);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/khan-b');
    expect(screen.queryByTestId('fallback')).toBeNull();
  });
});

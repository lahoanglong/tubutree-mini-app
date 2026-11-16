import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), haptic: vi.fn(), getFeed: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ communityPublicPreview: false, isLoaded: true }) }));
vi.mock('../../services/feed-api', () => ({ getFeed: mocks.getFeed, getFeedPublicPreview: vi.fn() }));

import { CommunityPreview } from './community-preview';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const POST = { id: 'p1', title: 'Lá cúc bị vàng', body: 'x', author: 'An', createdAt: new Date().toISOString(), commentCount: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFeed.mockResolvedValue({ posts: [POST] });
});

describe('Cộng đồng hỏi đáp, thẻ chen trong lưới Gợi ý', () => {
  it('một SectionHeader, tiêu đề h2 chữ Inter, nút "Xem tất cả" mở /feed', async () => {
    wrap(<CommunityPreview />);
    await screen.findByText('Lá cúc bị vàng');
    const header = screen.getByTestId('section-header');
    const title = within(header).getByRole('heading', { level: 2, name: 'Cộng đồng hỏi đáp' });
    expect(title).toHaveStyle({ fontFamily: 'var(--font-ui)', fontWeight: '700' });
    fireEvent.click(within(header).getByRole('button', { name: 'Xem tất cả Cộng đồng hỏi đáp' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/feed');
  });

  it('thẻ chen nằm trong cột của lưới nên không tự đặt đệm ngang (đệm đôi làm thẻ hẹp hơn lưới 32px)', async () => {
    const { container } = wrap(<CommunityPreview />);
    await screen.findByText('Lá cúc bị vàng');
    expect((container.querySelector('section') as HTMLElement).style.padding).toBe('');
  });

  it('đang tải: khung chờ cao đúng bằng thẻ có hai bài (không đẩy thẻ sản phẩm phía dưới), có tiêu đề; tải xong thì bài thay vào cùng chiều cao', async () => {
    let resolve!: (v: unknown) => void;
    mocks.getFeed.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { container } = wrap(<CommunityPreview />);
    const loading = screen.getByTestId('community-preview-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    const skeletonHeight = (loading.querySelector('.tubu-skeleton') as HTMLElement).style.height;
    expect(skeletonHeight).toBe('138px');
    resolve({ posts: [POST, { ...POST, id: 'p2', title: 'Tưới cây lúc nào' }] });
    await screen.findByText('Tưới cây lúc nào');
    expect(container.querySelector('[data-testid="community-preview-loading"]')).toBeNull();
    const card = container.querySelector('section > div:last-child') as HTMLElement;
    // Mỗi dòng cao cố định 68 (viền trên của dòng thứ hai tính trong đó) + viền hai mép: 2 × 68 + 2 = 138.
    expect(card.style.minHeight).toBe(skeletonHeight);
    expect(Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).map((r) => r.style.height)).toEqual(['68px', '68px']);
  });

  it('không có bài hay lỗi: không vẽ gì (không để lại tiêu đề trơ)', async () => {
    mocks.getFeed.mockResolvedValue({ posts: [] });
    const { container } = wrap(<CommunityPreview />);
    await waitFor(() => expect(mocks.getFeed).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

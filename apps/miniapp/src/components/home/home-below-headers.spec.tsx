import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), haptic: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ communityPublicPreview: false, isLoaded: true }) }));
vi.mock('../../services/shop-api', () => ({
  fetchBrands: vi.fn().mockResolvedValue([
    { brand: 'Tubu', count: 4, slug: 'tubu' },
    { brand: 'Nhà Vườn', count: 2, slug: null },
  ]),
}));
vi.mock('../../services/feed-api', () => ({
  getFeed: vi.fn().mockResolvedValue({
    posts: [{ id: 'p1', title: 'Lá cúc bị vàng', body: 'x', author: 'An', createdAt: new Date().toISOString(), commentCount: 2 }],
  }),
  getFeedPublicPreview: vi.fn(),
}));

import { BrandJourney } from './brand-journey';
import { CommunityPreview } from './community-preview';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('Hành trình nguyên liệu và Cộng đồng hỏi đáp dùng SectionHeader (P2 #5)', () => {
  it('Hành trình nguyên liệu: một SectionHeader, tiêu đề h2 chữ Inter, nút "Xem bản đồ" mở /brand-story', async () => {
    wrap(<BrandJourney />);
    const header = screen.getByTestId('section-header');
    const title = within(header).getByRole('heading', { level: 2, name: 'Hành trình nguyên liệu' });
    expect(title).toHaveStyle({ fontFamily: 'var(--font-ui)', fontWeight: '700' });
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    fireEvent.click(within(header).getByRole('button', { name: 'Xem bản đồ Hành trình nguyên liệu' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/brand-story');
  });

  it('Hành trình nguyên liệu: chip nhãn bấm được, nút "Xem bản đồ" ở tiêu đề là điều khiển đọc được duy nhất của trang bản đồ', async () => {
    wrap(<BrandJourney />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tubu' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/brand/tubu');
    expect(screen.getAllByRole('button', { name: /bản đồ/i })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Xem bản đồ Hành trình nguyên liệu' })).toBeTruthy();
  });

  it('Hành trình nguyên liệu: thẻ bản đồ ẩn khỏi trình đọc và khỏi Tab (aria-hidden + tabIndex -1) nhưng chạm vẫn mở bản đồ (H3 #3)', async () => {
    const { container } = wrap(<BrandJourney />);
    await screen.findByRole('button', { name: 'Tubu' });
    const card = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('nhãn Việt'))!;
    expect(card.getAttribute('aria-hidden')).toBe('true');
    expect(card.tabIndex).toBe(-1);
    fireEvent.click(card);
    expect(mocks.navigate).toHaveBeenCalledWith('/brand-story');
  });

  it('Hành trình nguyên liệu: câu mô tả số nhãn vẫn đọc được đúng một lần dù thẻ bản đồ aria-hidden (H3 review)', async () => {
    const { container } = wrap(<BrandJourney />);
    await screen.findByRole('button', { name: 'Tubu' });
    const spokenCopy = Array.from(container.querySelectorAll('span')).filter((e) => e.children.length === 0 && /nhãn Việt/.test(e.textContent ?? '') && !e.closest('[aria-hidden="true"]'));
    expect(spokenCopy).toHaveLength(1);
    expect(spokenCopy[0]!.closest('button')).toBeNull();
  });

  it('Cộng đồng hỏi đáp: một SectionHeader, tiêu đề h2 chữ Inter, nút "Xem tất cả" mở /feed', async () => {
    wrap(<CommunityPreview />);
    await screen.findByText('Lá cúc bị vàng');
    const header = screen.getByTestId('section-header');
    const title = within(header).getByRole('heading', { level: 2, name: 'Cộng đồng hỏi đáp' });
    expect(title).toHaveStyle({ fontFamily: 'var(--font-ui)', fontWeight: '700' });
    fireEvent.click(within(header).getByRole('button', { name: 'Xem tất cả Cộng đồng hỏi đáp' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/feed');
  });
});

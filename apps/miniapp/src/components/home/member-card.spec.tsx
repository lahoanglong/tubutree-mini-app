import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ haptic: vi.fn(), fullName: 'Nguyễn Thị Quay Lại' as string | null, loyalty: vi.fn(() => new Promise(() => {})) }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { user: { fullName: string | null; pointsBalance: number }; status: string }) => unknown) =>
    sel({ user: { fullName: mocks.fullName, pointsBalance: 120 }, status: 'authenticated' }),
}));
vi.mock('../../services/account-api', () => ({ getLoyalty: () => mocks.loyalty() }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ loyalty: { vndPerPointRedeem: 1000 } }) }));
vi.mock('../../hooks/use-check-in', () => ({
  useCheckIn: () => ({ view: { canCheckIn: true, buttonLabel: 'Điểm danh' }, pending: false, checkIn: vi.fn(), message: null }),
}));

import { homeCopy } from '@tubutree/app-core/home-copy';
import { MemberCard, MemberCardSkeleton, MemberCardUnavailable } from './member-card';

const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('MemberCard — lời chào bằng tên gọi (P2 #7)', () => {
  it('họ tên dài chào bằng từ cuối, không cắt "Chào Nguyễ…"', () => {
    mocks.fullName = 'Nguyễn Thị Quay Lại';
    render(<MemberCard />);
    expect(screen.getByText('Chào Lại')).toBeInTheDocument();
    expect(screen.queryByText(/Nguyễn/)).toBeNull();
  });

  it('chưa có họ tên thì chào bạn', () => {
    mocks.fullName = null;
    render(<MemberCard />);
    expect(screen.getByText('Chào bạn')).toBeInTheDocument();
  });

  it('tên gọi ngắn không dính dấu chấm giữa vào hạng: khoảng trắng đầu phần hạng không bị dòng flex nuốt', async () => {
    mocks.fullName = 'Trần Văn An';
    mocks.loyalty.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    render(<MemberCard />);
    const tier = (await screen.findByText(/Mầm Xanh/)).closest('span')!;
    expect(tier.textContent).toMatch(/^\u00A0· /);
    mocks.loyalty.mockImplementation(() => new Promise(() => {}));
  });
});

describe('MemberCardUnavailable', () => {
  it('hiện đúng chữ báo lỗi và nút Thử lại gọi onRetry', () => {
    const onRetry = vi.fn();
    render(<MemberCardUnavailable onRetry={onRetry} />);
    expect(screen.getByRole('region', { name: homeCopy.member.cardLabel })).toHaveTextContent(homeCopy.member.offline);
    fireEvent.click(screen.getByRole('button', { name: homeCopy.member.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('thẻ thành viên nền sáng (HM-05)', () => {
  it('khung thẻ Thử lại không còn gradient xanh đậm và cao đúng HOME_HERO_HEIGHT', () => {
    render(<MemberCardUnavailable onRetry={vi.fn()} />);
    const card = screen.getByRole('region', { name: homeCopy.member.cardLabel }).firstElementChild as HTMLElement;
    expect(card.style.background).not.toContain('gradient');
    expect(card.style.background).toContain('--color-bg-surface');
    expect(card.style.border).toContain('--color-border-subtle');
    expect(card).toHaveStyle({ height: '64px' });
  });

  it('khung chờ không có đệm dưới (vỏ khối giữ khoảng cách)', () => {
    render(<MemberCardSkeleton />);
    expect(screen.getByTestId('member-card-loading').style.padding).toBe('0px 16px');
  });
});

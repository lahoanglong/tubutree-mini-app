import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  haptic: vi.fn(),
  fullName: 'Nguyễn Thị Quay Lại' as string | null,
  loyalty: vi.fn(() => new Promise(() => {})),
  navigate: vi.fn(),
  pathname: '/',
  cfg: { loyalty: { vndPerPointRedeem: 1000 } } as { loyalty: { vndPerPointRedeem: number }; seasonalTheme?: string },
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: mocks.pathname, search: '', state: null }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { user: { fullName: string | null; pointsBalance: number }; status: string }) => unknown) =>
    sel({ user: { fullName: mocks.fullName, pointsBalance: 120 }, status: 'authenticated' }),
}));
vi.mock('../../services/account-api', () => ({ getLoyalty: () => mocks.loyalty() }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../../hooks/use-check-in', () => ({
  useCheckIn: () => ({ view: { canCheckIn: true, buttonLabel: 'Điểm danh' }, pending: false, checkIn: vi.fn(), message: null }),
}));

import { homeCopy } from '@tubutree/app-core/home-copy';
import { HOME_GIFT_HEIGHT } from '@tubutree/app-core/home-layout';
import { MemberCard, MemberCardSkeleton, MemberCardUnavailable } from './member-card';
import { HomeBlockErrorSuppressed } from './home-block-error';

const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('MemberCard — mùa Noel (w57-01)', () => {
  it('theme.seasonal = christmas: không còn nút Điểm danh (điểm danh là "Mở quà" của thẻ cây thông), mùa khác vẫn có', () => {
    mocks.fullName = 'Trần Văn An';
    mocks.cfg = { loyalty: { vndPerPointRedeem: 1000 }, seasonalTheme: 'christmas' };
    const { unmount } = render(<MemberCard />);
    expect(screen.queryByRole('button', { name: 'Điểm danh' })).toBeNull();
    unmount();
    mocks.cfg = { loyalty: { vndPerPointRedeem: 1000 }, seasonalTheme: 'none' };
    render(<MemberCard />);
    expect(screen.getByRole('button', { name: 'Điểm danh' })).toBeInTheDocument();
    mocks.cfg = { loyalty: { vndPerPointRedeem: 1000 } };
  });
});

describe('MemberCard — lời chào bằng tên gọi (P2 #7)', () => {
  it('họ tên dài chào bằng từ cuối, không cắt "Chào Nguyễ…"', () => {
    mocks.fullName = 'Nguyễn Thị Quay Lại';
    render(<MemberCard />);
    expect(screen.getByText('Chào Lại')).toBeInTheDocument();
    expect(screen.queryByText(/Nguyễn/)).toBeNull();
  });

  it('tên bậc dài không bóp lời chào: lời chào không co, tên bậc nhận phần còn lại', async () => {
    mocks.fullName = 'Trần Văn An';
    mocks.loyalty.mockResolvedValue({ tier: { name: 'Đại Sứ Vườn Xanh Bậc Cao Nhất' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    render(<MemberCard />);
    const tier = (await screen.findByText(/Đại Sứ/)).closest('span')!;
    expect(screen.getByText('Chào An').style.flexShrink).toBe('0');
    expect(tier.style.flexGrow).toBe('1');
  });

  it('chưa có tên bậc (loyalty đang tải): lời chào dài một chữ vẫn co được để có "…", không tràn đè nút', () => {
    mocks.fullName = 'Thanhthuy1990shopmyphamthiennhien';
    mocks.loyalty.mockImplementation(() => new Promise(() => {}));
    render(<MemberCard />);
    const greeting = screen.getByText(/^Chào Thanhthuy/);
    expect(greeting.style.flexShrink).not.toBe('0');
    expect(greeting.style.overflow).toBe('hidden');
    expect(greeting.style.minWidth).toBe('0px');
  });

  it('chưa có họ tên thì chào bạn', () => {
    mocks.fullName = null;
    render(<MemberCard />);
    expect(screen.getByText('Chào bạn')).toBeInTheDocument();
  });

  it('tên gọi ngắn không dính dấu chấm giữa vào hạng: khoảng trắng giữa lời chào và hạng là ký tự văn bản thật (flex không vẽ)', async () => {
    mocks.fullName = 'Trần Văn An';
    mocks.loyalty.mockResolvedValue({ tier: { name: 'Mầm Xanh' }, pointsBalance: 120, pointsConvertedBalance: 0 });
    render(<MemberCard />);
    const tier = (await screen.findByText(/Mầm Xanh/)).closest('span')!;
    expect(tier.textContent).toMatch(/^· /);
    expect(tier.previousSibling?.textContent).toBe(' ');
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
    expect(card).toHaveStyle({ height: `${HOME_GIFT_HEIGHT}px` });
  });

  it('thẻ thật và khung chờ cùng cao đúng 64px (dải ngữ cảnh của Trang chủ): đổi giữa chúng không đẩy các khối dưới', () => {
    mocks.fullName = 'Nguyễn Thị Quay Lại';
    expect(HOME_GIFT_HEIGHT).toBe(64);
    const real = render(<MemberCard />);
    const card = screen.getByRole('region').firstElementChild as HTMLElement;
    expect(card).toHaveStyle({ height: '64px' });
    real.unmount();
    const { container } = render(<MemberCardSkeleton />);
    expect(container.querySelector('.tubu-skeleton')).toHaveStyle({ height: '64px' });
  });

  it('khung chờ không có đệm dưới (vỏ khối giữ khoảng cách)', () => {
    render(<MemberCardSkeleton />);
    expect(screen.getByTestId('member-card-loading').style.padding).toBe('0px 16px');
  });
});

describe('MemberCard — dải lỗi cấp trang (một Thử lại cho cả trang)', () => {
  it('điểm lỗi: bình thường có dòng lỗi + Thử lại; khi Trang chủ đã có dải lỗi cấp trang thì chỉ còn số điểm, không nút Thử lại thứ hai', async () => {
    mocks.fullName = 'Nguyễn Thị Quay Lại';
    mocks.loyalty.mockRejectedValue(new Error('500'));
    const first = render(<MemberCard />);
    expect(await screen.findByRole('button', { name: homeCopy.member.retry })).toBeInTheDocument();
    first.unmount();
    render(
      <HomeBlockErrorSuppressed.Provider value>
        <MemberCard />
      </HomeBlockErrorSuppressed.Provider>,
    );
    await screen.findByText('Chào Lại');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: homeCopy.member.retry })).toBeNull();
    expect(screen.queryByText(homeCopy.member.tierFailed)).toBeNull();
    mocks.loyalty.mockImplementation(() => new Promise(() => {}));
  });
});

describe('MemberCard — tên đọc khi tổng quan lỗi', () => {
  it('dòng điểm đổi thành câu báo lỗi thì tên đọc cũng nói câu đó, không còn số điểm không hiển thị', async () => {
    mocks.loyalty.mockRejectedValue(new Error('500'));
    render(<MemberCard />);
    const btn = (await screen.findByText(homeCopy.member.tierFailed)).closest('button')!;
    expect(btn.getAttribute('aria-label')).toContain(homeCopy.member.tierFailed);
    expect(btn.getAttribute('aria-label')).not.toMatch(/\d+ điểm/);
    mocks.loyalty.mockImplementation(() => new Promise(() => {}));
  });
});

describe('MemberCard — mở Ưu đãi (W163)', () => {
  const open = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(homeCopy.member.openLabel) }));
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.pathname = '/';
    mocks.fullName = 'Trần Văn An';
  });

  it('từ Trang chủ (tab gốc) sang Ưu đãi (tab gốc): thay mục hiện tại, không để lịch sử [/, /offers] rồi [/, /offers, /]', () => {
    render(<MemberCard />);
    open();
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/offers', { replace: true });
  });

  it('từ trang không phải tab gốc: đẩy /offers như thường', () => {
    mocks.pathname = '/loyalty';
    render(<MemberCard />);
    open();
    expect(mocks.navigate).toHaveBeenCalledWith('/offers');
  });
});

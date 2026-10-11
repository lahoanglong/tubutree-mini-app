import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LeaderboardEntry } from '../services/feed-api';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  getLeaderboard: vi.fn(),
  auth: { status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous' },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/feed/leaderboard', search: '', state: null }),
}));
vi.mock('../services/feed-api', () => ({ getLeaderboard: mocks.getLeaderboard }));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: mocks.login };
    return sel ? sel(state) : state;
  },
}));

import CommunityLeaderboardPage from './community-leaderboard';

const ENTRY = (author: string, level: number, reputation: number, avatar: string | null = null): LeaderboardEntry => ({
  author,
  avatar,
  reputation,
  level,
  levelName: `Hạng ${level}`,
});

const BOARD = [
  ENTRY('Lan Anh', 4, 980, 'https://img.test/lan.jpg'),
  ENTRY('Minh Tâm', 3, 640),
  ENTRY('Hà My', 2, 410),
  ENTRY('Quốc Bảo', 2, 120),
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommunityLeaderboardPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.getLeaderboard.mockResolvedValue(BOARD);
});

describe('CommunityLeaderboardPage — hành vi giữ nguyên khi chuyển DS v2', () => {
  it('chưa đăng nhập: cổng đăng nhập, bấm nút gọi login, không tải bảng', () => {
    mocks.auth.status = 'anonymous';
    renderPage();
    expect(screen.getByText('Đăng nhập để xem cộng đồng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục với Zalo' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.getLeaderboard).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên: không hiện cổng đăng nhập và không tải bảng', () => {
    mocks.auth.status = 'loading';
    renderPage();
    expect(screen.queryByText('Đăng nhập để xem cộng đồng')).toBeNull();
    expect(mocks.getLeaderboard).not.toHaveBeenCalled();
  });

  it('hiện đúng thứ tự BE trả về, huy chương cho ba hạng đầu và #n cho các hạng sau', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    const text = screen.getByTestId('page').textContent ?? '';
    expect(text.indexOf('Lan Anh')).toBeLessThan(text.indexOf('Minh Tâm'));
    expect(text.indexOf('Minh Tâm')).toBeLessThan(text.indexOf('Hà My'));
    expect(text.indexOf('Hà My')).toBeLessThan(text.indexOf('Quốc Bảo'));
    expect(screen.getByText('🥇')).toBeInTheDocument();
    expect(screen.getByText('🥈')).toBeInTheDocument();
    expect(screen.getByText('🥉')).toBeInTheDocument();
    expect(screen.getByText('#4')).toBeInTheDocument();
  });

  it('mỗi dòng hiện hạng thành viên (emoji + tên hạng) và điểm uy tín', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    expect(screen.getByText('🏆 Hạng 4')).toBeInTheDocument();
    expect(screen.getByText('🌳 Hạng 3')).toBeInTheDocument();
    expect(screen.getAllByText('🌿 Hạng 2')).toHaveLength(2);
    expect(screen.getByText('980 điểm uy tín')).toBeInTheDocument();
    expect(screen.getByText('120 điểm uy tín')).toBeInTheDocument();
  });

  it('có hàng tiêu đề cột Hạng / Thành viên / điểm uy tín', async () => {
    renderPage();
    await screen.findByText('Lan Anh');
    expect(screen.getByText('Hạng')).toBeInTheDocument();
    expect(screen.getByText('Thành viên')).toBeInTheDocument();
    expect(screen.getAllByText('điểm uy tín').length).toBeGreaterThanOrEqual(1);
  });

  it('có ảnh đại diện thì hiện ảnh', async () => {
    const { container } = renderPage();
    await screen.findByText('Lan Anh');
    expect(container.querySelector('img[src="https://img.test/lan.jpg"]')).not.toBeNull();
  });

  it('bảng trống: hiện trạng thái trống', async () => {
    mocks.getLeaderboard.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Chưa có bài viết nào')).toBeInTheDocument();
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    mocks.getLeaderboard.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(BOARD);
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Lan Anh')).toBeInTheDocument();
  });
});

describe('CommunityLeaderboardPage — tiêu đề và biểu tượng (C-076, C-113, C-114)', () => {
  it('có đúng một h1 "Bảng xếp hạng" ở mọi trạng thái', async () => {
    mocks.auth.status = 'loading';
    const restoring = renderPage();
    expect(restoring.container.querySelectorAll('h1')).toHaveLength(1);
    restoring.unmount();

    mocks.auth.status = 'anonymous';
    const gate = renderPage();
    expect(gate.container.querySelectorAll('h1')).toHaveLength(1);
    gate.unmount();

    mocks.auth.status = 'authenticated';
    mocks.getLeaderboard.mockReturnValue(new Promise(() => {}));
    const fetching = renderPage();
    expect(fetching.container.querySelectorAll('h1')).toHaveLength(1);
    fetching.unmount();

    mocks.getLeaderboard.mockRejectedValue(new Error('mất mạng'));
    const failed = renderPage();
    await screen.findByText('mất mạng');
    expect(failed.container.querySelectorAll('h1')).toHaveLength(1);
    failed.unmount();

    mocks.getLeaderboard.mockResolvedValue(BOARD);
    const loaded = renderPage();
    await screen.findByText('Lan Anh');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bảng xếp hạng');
  });

  it('cổng đăng nhập không dùng emoji 🏆 làm hình', () => {
    mocks.auth.status = 'anonymous';
    renderPage();
    expect(screen.queryByText('🏆')).toBeNull();
  });

  it('dòng không có ảnh đại diện dùng icon, không dùng emoji 🌱 làm ảnh thay thế', async () => {
    mocks.getLeaderboard.mockResolvedValue([ENTRY('Minh Tâm', 3, 640)]);
    renderPage();
    await screen.findByText('Minh Tâm');
    expect(screen.getByTestId('page').textContent).not.toContain('🌱');
  });
});

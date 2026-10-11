import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommunityEvent, FeedItem } from '../services/feed-api';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  haptic: vi.fn(),
  listEvents: vi.fn(),
  eventPosts: vi.fn(),
  getCategories: vi.fn(),
  composerProps: { current: null as null | Record<string, unknown> },
  auth: { status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous' },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/feed/events', search: '', state: null }),
}));
vi.mock('../services/feed-api', () => ({
  listEvents: mocks.listEvents,
  eventPosts: mocks.eventPosts,
  getCategories: mocks.getCategories,
}));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: mocks.login };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../components/community/post-card', () => ({
  default: ({ post, onClick }: { post: FeedItem; onClick: () => void }) => (
    <button type="button" onClick={onClick}>{`Bài ${post.id}`}</button>
  ),
}));
vi.mock('../components/community/post-composer', () => ({
  default: (props: { visible: boolean; onPosted: () => void; onClose: () => void }) => {
    mocks.composerProps.current = props as unknown as Record<string, unknown>;
    return props.visible ? (
      <div data-testid="composer">
        <button type="button" onClick={props.onPosted}>đã đăng</button>
      </div>
    ) : null;
  },
}));

import CommunityEventsPage from './community-events';

const DAY = 24 * 3600 * 1000;
const EVENT = (id: string, over: Partial<CommunityEvent> = {}): CommunityEvent => ({
  id,
  title: `Sự kiện ${id}`,
  description: `Mô tả ${id}`,
  coverUrl: null,
  startAt: new Date(Date.now() - 2 * DAY).toISOString(),
  endAt: new Date(Date.now() + 5 * DAY).toISOString(),
  rewardPoints: 5,
  status: 'ACTIVE',
  winnerUserId: null,
  createdAt: new Date(Date.now() - 3 * DAY).toISOString(),
  ...over,
});
const POST = (id: string) => ({ id }) as FeedItem;
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommunityEventsPage />
    </QueryClientProvider>,
  );
}

const openEvent = async (title: string) => {
  fireEvent.click(await screen.findByText(title));
  await screen.findByRole('button', { name: 'Đăng bài dự thi' });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.status = 'authenticated';
  mocks.composerProps.current = null;
  mocks.getCategories.mockResolvedValue([{ id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null }]);
  mocks.listEvents.mockResolvedValue([EVENT('e1'), EVENT('e2', { rewardPoints: 0 })]);
  mocks.eventPosts.mockResolvedValue({ posts: [POST('p1'), POST('p2')], nextCursor: null });
});

describe('CommunityEventsPage — danh sách sự kiện', () => {
  it('chưa đăng nhập: cổng đăng nhập, bấm nút gọi login, không tải sự kiện', () => {
    mocks.auth.status = 'anonymous';
    renderPage();
    expect(screen.getByText('Đăng nhập để xem cộng đồng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục với Zalo' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.listEvents).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên: không hiện cổng đăng nhập và không tải sự kiện', () => {
    mocks.auth.status = 'loading';
    renderPage();
    expect(screen.queryByText('Đăng nhập để xem cộng đồng')).toBeNull();
    expect(mocks.listEvents).not.toHaveBeenCalled();
  });

  it('hiện tiêu đề, mô tả, hạn kết thúc và thưởng của từng sự kiện (chỉ khi thưởng > 0)', async () => {
    renderPage();
    expect(await screen.findByText('Sự kiện e1')).toBeInTheDocument();
    expect(screen.getByText('Mô tả e1')).toBeInTheDocument();
    expect(screen.getAllByText(`Kết thúc: ${fmt(EVENT('e1').endAt)}`, { exact: false })).toHaveLength(2);
    expect(screen.getAllByText(/điểm/)).toHaveLength(1);
    expect(screen.getByText(/5 điểm/)).toBeInTheDocument();
  });

  it('sự kiện đã qua hạn có nhãn "Đã kết thúc"', async () => {
    mocks.listEvents.mockResolvedValue([EVENT('e1', { endAt: new Date(Date.now() - DAY).toISOString() }), EVENT('e2')]);
    renderPage();
    await screen.findByText('Sự kiện e1');
    expect(screen.getAllByText('Đã kết thúc')).toHaveLength(1);
  });

  it('không có sự kiện: hiện trạng thái trống', async () => {
    mocks.listEvents.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Chưa có sự kiện nào')).toBeInTheDocument();
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    mocks.listEvents.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue([EVENT('e1')]);
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Sự kiện e1')).toBeInTheDocument();
  });

  it('bấm thẻ sự kiện: rung nhẹ và tải bài dự thi của sự kiện đó', async () => {
    renderPage();
    await openEvent('Sự kiện e1');
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    await waitFor(() => expect(mocks.eventPosts).toHaveBeenCalledWith('e1', undefined));
  });
});

describe('CommunityEventsPage — chi tiết sự kiện', () => {
  it('hiện thưởng, bài dự thi; bấm bài mở /feed/:id', async () => {
    renderPage();
    await openEvent('Sự kiện e1');
    expect(screen.getByText(/Thưởng:.*5 điểm/)).toBeInTheDocument();
    expect(screen.getByText('Bài dự thi')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Bài p1' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/feed/p1');
  });

  it('nút quay lại danh sách trở về danh sách và rung nhẹ', async () => {
    renderPage();
    await openEvent('Sự kiện e1');
    mocks.haptic.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Sự kiện' }));
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(await screen.findByText('Sự kiện e2')).toBeInTheDocument();
  });

  it('"Đăng bài dự thi" mở khung soạn kèm id + tên sự kiện; đăng xong đóng khung và tải lại bài', async () => {
    renderPage();
    await openEvent('Sự kiện e1');
    await screen.findByRole('button', { name: 'Bài p1' });
    mocks.haptic.mockClear();
    expect(screen.queryByTestId('composer')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng bài dự thi' }));
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(mocks.composerProps.current).toMatchObject({ eventId: 'e1', eventTitle: 'Sự kiện e1' });
    const before = mocks.eventPosts.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'đã đăng' }));
    expect(screen.queryByTestId('composer')).toBeNull();
    await waitFor(() => expect(mocks.eventPosts.mock.calls.length).toBeGreaterThan(before));
  });

  it('sự kiện đã kết thúc: nút "Đăng bài dự thi" bị khoá', async () => {
    mocks.listEvents.mockResolvedValue([EVENT('e1', { endAt: new Date(Date.now() - DAY).toISOString() })]);
    renderPage();
    await openEvent('Sự kiện e1');
    const join = screen.getByRole('button', { name: 'Đăng bài dự thi' });
    expect(join).toBeDisabled();
    fireEvent.click(join);
    expect(screen.queryByTestId('composer')).toBeNull();
  });

  it('chưa có bài dự thi: hiện trạng thái trống', async () => {
    mocks.eventPosts.mockResolvedValueOnce({ posts: [], nextCursor: null });
    renderPage();
    await openEvent('Sự kiện e1');
    expect(await screen.findByText('Chưa có bài viết nào')).toBeInTheDocument();
  });

  it('lỗi tải bài dự thi: báo lỗi và Thử lại tải lại', async () => {
    mocks.eventPosts.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue({ posts: [POST('p1')], nextCursor: null });
    renderPage();
    await openEvent('Sự kiện e1');
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: 'Bài p1' })).toBeInTheDocument();
  });

  it('phân trang: "Xem thêm bài dự thi" nạp trang kế bằng cursor', async () => {
    mocks.eventPosts
      .mockResolvedValueOnce({ posts: [POST('p1')], nextCursor: 'cur-2' })
      .mockResolvedValue({ posts: [POST('p3')], nextCursor: null });
    renderPage();
    await openEvent('Sự kiện e1');
    fireEvent.click(await screen.findByRole('button', { name: 'Xem thêm bài dự thi' }));
    expect(await screen.findByRole('button', { name: 'Bài p3' })).toBeInTheDocument();
    expect(mocks.eventPosts).toHaveBeenLastCalledWith('e1', 'cur-2');
    expect(screen.queryByRole('button', { name: 'Xem thêm bài dự thi' })).toBeNull();
  });
});

describe('CommunityEventsPage — tiêu đề, vùng chạm, biểu tượng (C-076, C-113, C-114)', () => {
  it('có đúng một h1 "Sự kiện" ở mọi trạng thái, kể cả khi xem chi tiết', async () => {
    mocks.auth.status = 'loading';
    const restoring = renderPage();
    expect(restoring.container.querySelectorAll('h1')).toHaveLength(1);
    restoring.unmount();

    mocks.auth.status = 'anonymous';
    const gate = renderPage();
    expect(gate.container.querySelectorAll('h1')).toHaveLength(1);
    gate.unmount();

    mocks.auth.status = 'authenticated';
    mocks.listEvents.mockReturnValue(new Promise(() => {}));
    const fetching = renderPage();
    expect(fetching.container.querySelectorAll('h1')).toHaveLength(1);
    fetching.unmount();

    mocks.listEvents.mockResolvedValue([EVENT('e1')]);
    const loaded = renderPage();
    await screen.findByText('Sự kiện e1');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sự kiện');

    await openEvent('Sự kiện e1');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('thẻ sự kiện là nút bàn phím (Enter mở chi tiết)', async () => {
    renderPage();
    const card = (await screen.findByText('Sự kiện e1')).closest('[role="button"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card!.tabIndex).toBe(0);
    fireEvent.keyDown(card!, { key: 'Enter' });
    await screen.findByRole('button', { name: 'Đăng bài dự thi' });
  });

  it('nút "Sự kiện" quay lại và nút tham gia cao >= 44px', async () => {
    renderPage();
    await openEvent('Sự kiện e1');
    const back = screen.getByRole('button', { name: 'Sự kiện' });
    expect(Number.parseFloat(back.style.minHeight)).toBeGreaterThanOrEqual(44);
    const join = screen.getByRole('button', { name: 'Đăng bài dự thi' });
    expect(Number.parseFloat(join.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('không dùng emoji 🎁 / 🎉 làm biểu tượng', async () => {
    mocks.auth.status = 'anonymous';
    const gate = renderPage();
    expect(gate.container.textContent).not.toContain('🎉');
    gate.unmount();

    mocks.auth.status = 'authenticated';
    const list = renderPage();
    await screen.findByText('Sự kiện e1');
    expect(list.container.textContent).not.toContain('🎁');
    await openEvent('Sự kiện e1');
    expect(list.container.textContent).not.toContain('🎁');
  });
});

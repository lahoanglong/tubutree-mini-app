import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroupBuy } from '../services/groupbuy-api';
import { formatVnd } from '../utils/format';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  login: vi.fn(),
  listGroupBuys: vi.fn(),
  getGroupBuy: vi.fn(),
  joinGroupBuy: vi.fn(),
  shareWithFallback: vi.fn(),
  params: {} as { id?: string },
  auth: { status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous', user: undefined as { referralCode: string } | undefined },
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
  useLocation: () => ({ pathname: '/group-buy', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/groupbuy-api', () => ({
  listGroupBuys: mocks.listGroupBuys,
  getGroupBuy: mocks.getGroupBuy,
  joinGroupBuy: mocks.joinGroupBuy,
}));
vi.mock('../components/share-sheet', () => ({ useShareWithFallback: () => mocks.shareWithFallback }));
vi.mock('../services/api', () => ({ getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi') }));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: mocks.login, user: mocks.auth.user };
    return sel ? sel(state) : state;
  },
}));

import GroupBuyPage from './group-buy';

const HOUR = 3600 * 1000;
const GROUP = (id: string, over: Partial<GroupBuy> = {}): GroupBuy => ({
  id,
  product: { name: `Sản phẩm ${id}`, slug: `sp-${id}`, thumbnail: `https://img.test/${id}.jpg` },
  targetSize: 5,
  currentSize: 2,
  unitPrice: 80_000,
  basePrice: 100_000,
  discountPct: 20,
  status: 'OPEN',
  expiresAt: new Date(Date.now() + 2.5 * HOUR).toISOString(),
  joined: false,
  isOwner: false,
  ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroupBuyPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.params = {};
  mocks.auth.status = 'authenticated';
  mocks.auth.user = undefined;
  mocks.listGroupBuys.mockResolvedValue([GROUP('a'), GROUP('b', { joined: true })]);
  mocks.joinGroupBuy.mockResolvedValue({ joined: true, currentSize: 3, status: 'OPEN' });
});

describe('GroupBuyPage — hành vi giữ nguyên khi chuyển DS v2', () => {
  it('hiện tên, giá nhóm, giá gốc, % giảm, số người và thời hạn của từng nhóm', async () => {
    renderPage();
    expect(await screen.findByText('Sản phẩm a')).toBeInTheDocument();
    expect(screen.getAllByText(formatVnd(80_000))).toHaveLength(2);
    expect(screen.getAllByText(formatVnd(100_000))).toHaveLength(2);
    expect(screen.getAllByText('−20%')).toHaveLength(2);
    expect(screen.getAllByText('2/5 người · còn 2 giờ')).toHaveLength(2);
  });

  it('bấm ảnh sản phẩm mở trang sản phẩm', async () => {
    renderPage();
    fireEvent.click(await screen.findByAltText('Sản phẩm a'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/sp-a');
  });

  it('đã đăng nhập, chưa tham gia: bấm nút gửi đúng id, báo "Đã tham gia nhóm" rồi tải lại danh sách', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() => expect(mocks.joinGroupBuy).toHaveBeenCalledWith('a'));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tham gia nhóm 🛒', type: 'success' }),
    );
    await waitFor(() => expect(mocks.listGroupBuys).toHaveBeenCalledTimes(2));
  });

  it('nhóm đủ người (SUCCESS): báo mã giảm giá đã vào ví', async () => {
    mocks.joinGroupBuy.mockResolvedValue({ joined: true, currentSize: 5, status: 'SUCCESS' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({
        text: '🎉 Nhóm đã đủ người! Mã giảm giá đã vào ví của bạn.',
        type: 'success',
      }),
    );
  });

  it('tham gia lỗi: hiện thông báo lỗi và không tải lại danh sách', async () => {
    mocks.joinGroupBuy.mockRejectedValue(new Error('Nhóm đã hết hạn'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Nhóm đã hết hạn', type: 'error' }));
    expect(mocks.listGroupBuys).toHaveBeenCalledTimes(1);
  });

  it('đã tham gia: nút "Đã tham gia" bị khoá', async () => {
    renderPage();
    const joined = await screen.findByRole('button', { name: 'Đã tham gia' });
    expect(joined).toBeDisabled();
    fireEvent.click(joined);
    expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập: nút "Đăng nhập để tham gia" gọi login, không gửi yêu cầu tham gia, kể cả nhóm đã joined', async () => {
    mocks.auth.status = 'anonymous';
    renderPage();
    const buttons = await screen.findAllByRole('button', { name: 'Đăng nhập để tham gia' });
    expect(buttons).toHaveLength(2);
    expect(buttons[1]).not.toBeDisabled();
    fireEvent.click(buttons[0]!);
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
  });

  it('đang gửi tham gia: bấm lại không gửi thêm', async () => {
    mocks.joinGroupBuy.mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() => expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
  });

  it('chưa có nhóm nào: hiện trạng thái trống, "Khám phá sản phẩm" sang /browse', async () => {
    mocks.listGroupBuys.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Chưa có nhóm mua chung nào')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Khám phá sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('lỗi tải: báo lỗi và Thử lại tải lại', async () => {
    mocks.listGroupBuys.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue([GROUP('a')]);
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Sản phẩm a')).toBeInTheDocument();
  });
});

describe('GroupBuyPage — tiêu đề, vùng chạm, thanh tiến độ (C-076, C-114)', () => {
  it('có đúng một h1 "Mua chung giá tốt" ở mọi trạng thái', async () => {
    mocks.listGroupBuys.mockReturnValue(new Promise(() => {}));
    const loading = renderPage();
    expect(loading.container.querySelectorAll('h1')).toHaveLength(1);
    loading.unmount();

    mocks.listGroupBuys.mockRejectedValue(new Error('mất mạng'));
    const failed = renderPage();
    await screen.findByText('mất mạng');
    expect(failed.container.querySelectorAll('h1')).toHaveLength(1);
    failed.unmount();

    mocks.listGroupBuys.mockResolvedValue([]);
    const empty = renderPage();
    await screen.findByText('Chưa có nhóm mua chung nào');
    expect(empty.container.querySelectorAll('h1')).toHaveLength(1);
    empty.unmount();

    mocks.listGroupBuys.mockResolvedValue([GROUP('a')]);
    const loaded = renderPage();
    await screen.findByText('Sản phẩm a');
    expect(loaded.container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mua chung giá tốt');
  });

  it('nút tham gia cao >= 44px', async () => {
    renderPage();
    const join = await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' });
    expect(Number.parseFloat(join.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('ảnh sản phẩm là nút thật (bàn phím) và có tên là tên sản phẩm', async () => {
    renderPage();
    const open = await screen.findByRole('button', { name: 'Sản phẩm a' });
    expect(open.tagName).toBe('BUTTON');
  });

  it('thanh tiến độ giữ đúng phần trăm (2/5 = 40%) và nhóm không có chỉ tiêu thì 0%', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('a'), GROUP('z', { targetSize: 0, currentSize: 3 })]);
    renderPage();
    await screen.findByText('Sản phẩm a');
    const fills = screen.getAllByTestId('progress-fill');
    expect(fills[0]!.style.width).toBe('40%');
    expect(fills[1]!.style.width).toBe('0%');
  });

  it('ảnh thay thế khi không có ảnh sản phẩm vẫn là nút mở sản phẩm', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('a', { product: { name: 'Sản phẩm a', slug: 'sp-a', thumbnail: null } })]);
    renderPage();
    const open = await screen.findByRole('button', { name: 'Sản phẩm a' });
    fireEvent.click(open);
    expect(mocks.navigate).toHaveBeenCalledWith('/product/sp-a');
  });
});

// ENGAGE-9: người mở nhóm vẫn thấy "Tham gia" (bấm ra lỗi "đã tham gia") và không có cách gửi nhóm cho bạn.
describe('GroupBuyPage — nhóm của mình và mời bạn (ENGAGE-9)', () => {
  it('người mở nhóm thấy "Nhóm của bạn" (khoá) thay vì "Tham gia", kèm nút mời bạn', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('mine', { joined: true, isOwner: true })]);
    renderPage();
    const mine = await screen.findByRole('button', { name: 'Nhóm của bạn' });
    expect(mine).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Tham gia mua chung/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mời bạn bè' })).toBeInTheDocument();
  });

  it('bấm "Mời bạn bè" chia sẻ đường dẫn thẳng tới nhóm qua Zalo, kèm nội dung dán tay dự phòng', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('mine', { joined: true, isOwner: true })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mời bạn bè' }));
    expect(mocks.shareWithFallback).toHaveBeenCalledTimes(1);
    const [params, fallback] = mocks.shareWithFallback.mock.calls[0] as [Record<string, string>, string];
    expect(params).toMatchObject({ path: '/group-buy/mine', title: expect.stringContaining('Sản phẩm mine') });
    expect(params.thumbnail).toBe('https://img.test/mine.jpg');
    expect(fallback).toContain('Sản phẩm mine');
  });

  it('người chia sẻ có mã giới thiệu → đường dẫn nhóm mang ?ref=, nội dung dán tay nêu mã', async () => {
    mocks.auth.user = { referralCode: 'ABCD1234' };
    mocks.listGroupBuys.mockResolvedValue([GROUP('mine', { joined: true, isOwner: true })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mời bạn bè' }));
    const [params, fallback] = mocks.shareWithFallback.mock.calls[0] as [Record<string, string>, string];
    expect(params.path).toBe('/group-buy/mine?ref=ABCD1234');
    expect(fallback).toContain('ABCD1234');
  });

  it('thành viên (không phải người mở) cũng mời được bạn; nhóm chưa tham gia thì không có nút mời', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('a'), GROUP('b', { joined: true })]);
    renderPage();
    await screen.findByText('Sản phẩm a');
    expect(screen.getAllByRole('button', { name: 'Mời bạn bè' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Đã tham gia' })).toBeDisabled();
  });

  it('nhóm đã đóng không còn nút mời', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('done', { joined: true, status: 'SUCCESS' })]);
    renderPage();
    await screen.findByText('Sản phẩm done');
    expect(screen.queryByRole('button', { name: 'Mời bạn bè' })).toBeNull();
  });

  it('mở bằng link /group-buy/:id: nhóm được mời hiện đầu danh sách, không lặp lại ở danh sách chung', async () => {
    mocks.params = { id: 'b' };
    mocks.getGroupBuy.mockResolvedValue(GROUP('b'));
    mocks.listGroupBuys.mockResolvedValue([GROUP('a'), GROUP('b')]);
    renderPage();
    expect(await screen.findByText('Bạn được mời vào nhóm này')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Sản phẩm b')).toHaveLength(1));
    const names = screen.getAllByText(/^Sản phẩm [ab]$/).map((n) => n.textContent);
    expect(names).toEqual(['Sản phẩm b', 'Sản phẩm a']);
    expect(mocks.getGroupBuy).toHaveBeenCalledWith('b');
  });

  it('link tới nhóm đã hết hạn: báo nhóm đã đóng và không cho tham gia', async () => {
    mocks.params = { id: 'old' };
    mocks.getGroupBuy.mockResolvedValue(GROUP('old', { status: 'FAILED' }));
    mocks.listGroupBuys.mockResolvedValue([]);
    renderPage();
    const closed = await screen.findByRole('button', { name: 'Nhóm đã hết hạn' });
    expect(closed).toBeDisabled();
  });

  it('chưa đăng nhập mở link nhóm: không gọi API chi tiết (cần đăng nhập), vẫn xem được danh sách', async () => {
    mocks.auth.status = 'anonymous';
    mocks.params = { id: 'b' };
    renderPage();
    await screen.findByText('Sản phẩm a');
    expect(mocks.getGroupBuy).not.toHaveBeenCalled();
  });

  it('nói rõ cơ chế: đủ người thì nhận mã giảm bằng chênh lệch giá nhóm', async () => {
    renderPage();
    const hints = await screen.findAllByText(`Đủ nhóm: nhận mã giảm ${formatVnd(20_000)}, dùng cho đơn từ ${formatVnd(80_000)}`);
    expect(hints).toHaveLength(2);
  });

  it('R2-BUYERMINI-4: người mở nhóm vào nhóm của chính mình không thấy banner "Bạn được mời"', async () => {
    mocks.params = { id: 'mine' };
    mocks.getGroupBuy.mockResolvedValue(GROUP('mine', { joined: true, isOwner: true }));
    mocks.listGroupBuys.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Nhóm của bạn' })).toBeInTheDocument();
    expect(screen.queryByText('Bạn được mời vào nhóm này')).toBeNull();
  });

  it('R2-BUYERMINI-4: nhóm của mình đã đủ người: mục riêng, hiện mã giảm và nút mua ngay sang trang sản phẩm', async () => {
    mocks.listGroupBuys.mockResolvedValue([
      GROUP('a'),
      GROUP('done', { joined: true, isOwner: true, status: 'SUCCESS', currentSize: 5, couponCode: 'GBUY-DONE-ME' }),
    ]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Nhóm đã đủ người của bạn' })).toBeInTheDocument();
    expect(screen.getByText('GBUY-DONE-ME')).toBeInTheDocument();
    expect(screen.getByText('5/5 người · đã đủ nhóm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Mua ngay với mã giảm ${formatVnd(20_000)}` }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/sp-done');
    expect(screen.queryByRole('button', { name: 'Nhóm đã đủ người' })).toBeNull();
  });
});

import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroupBuy } from '../services/groupbuy-api';
import { formatVnd } from '../utils/format';
import { syncServerClock } from '../utils/server-clock';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  login: vi.fn(),
  listGroupBuys: vi.fn(),
  getGroupBuy: vi.fn(),
  joinGroupBuy: vi.fn(),
  fetchActiveFlashSales: vi.fn(),
  getPublicConfig: vi.fn(),
  shareWithFallback: vi.fn(),
  ensurePhone: vi.fn(),
  params: {} as { id?: string },
  auth: {
    status: 'authenticated' as 'loading' | 'authenticated' | 'anonymous' | 'idle',
    error: undefined as string | undefined,
    user: undefined as { referralCode?: string; phone?: string | null; zaloId?: string | null } | undefined,
  },
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
vi.mock('../services/shop-api', () => ({ fetchActiveFlashSales: mocks.fetchActiveFlashSales, getPublicConfig: mocks.getPublicConfig }));
vi.mock('../components/share-sheet', () => ({ useShareWithFallback: () => mocks.shareWithFallback }));
vi.mock('../services/api', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  getLoadErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  isHttpError: (e: unknown) => (e as { isHttpError?: unknown } | null)?.isHttpError === true,
}));
vi.mock('../store/auth', () => {
  const state = () => ({ status: mocks.auth.status, error: mocks.auth.error, login: mocks.login, user: mocks.auth.user, ensurePhone: mocks.ensurePhone });
  return { useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: state }) };
});

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
  mocks.fetchActiveFlashSales.mockResolvedValue([]);
  mocks.params = {};
  mocks.auth.status = 'authenticated';
  mocks.auth.user = undefined;
  mocks.auth.error = undefined;
  mocks.listGroupBuys.mockResolvedValue([GROUP('a'), GROUP('b', { joined: true })]);
  mocks.joinGroupBuy.mockResolvedValue({ joined: true, currentSize: 3, status: 'OPEN' });
  mocks.shareWithFallback.mockResolvedValue(undefined);
  mocks.getPublicConfig.mockResolvedValue({});
});

describe('GroupBuyPage — hành vi giữ nguyên khi chuyển DS v2', () => {
  it('hiện tên, giá nhóm, giá gốc, % giảm, số người và thời hạn của từng nhóm', async () => {
    renderPage();
    expect(await screen.findByText('Sản phẩm a')).toBeInTheDocument();
    expect(screen.getAllByText(`Giá nhóm ${formatVnd(80_000)}`)).toHaveLength(2);
    expect(screen.getAllByText(`Mua một mình ${formatVnd(100_000)}`)).toHaveLength(2);
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
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tham gia nhóm', type: 'success' }),
    );
    await waitFor(() => expect(mocks.listGroupBuys).toHaveBeenCalledTimes(2));
  });

  it('nhóm đủ người (SUCCESS): báo mã giảm giá đã vào ví', async () => {
    mocks.joinGroupBuy.mockResolvedValue({ joined: true, currentSize: 5, status: 'SUCCESS' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({
        text: 'Nhóm đã đủ người! Mã giảm giá đã vào ví của bạn.',
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

  it('đã tham gia: chữ trạng thái kèm số người còn thiếu, nút chính là "Mời bạn bè", không có nút tham gia', async () => {
    renderPage();
    expect(await screen.findByText(/Bạn đã ở trong nhóm · cần thêm \d+ người/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đã tham gia' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mời bạn bè' })).toBeInTheDocument();
    expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
  });

  it('B-72: Giờ vàng của phân loại giá nhóm dựa trên, còn đắt hơn giá nhóm: "Mua một mình" theo giá Giờ vàng hiện nay, không theo giá lưu', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([{ itemId: 'f', variationId: 'v1', productSlug: 'sp-a', flashPrice: 90_000, retailPrice: 120_000, salePrice: null, endAt: new Date(Date.now() + 3_600_000).toISOString() }]);
    mocks.listGroupBuys.mockResolvedValue([GROUP('a', { unitPrice: 85_000, basePrice: 120_000, variationId: 'v1' })]);
    renderPage();
    expect(await screen.findByText(`Mua một mình ${formatVnd(90_000)}`)).toBeInTheDocument();
    expect(screen.queryByText(`Mua một mình ${formatVnd(120_000)}`)).toBeNull();
  });

  it('B-72: Giờ vàng rẻ hơn cả giá nhóm: không còn nhãn "Mua một mình", ghi "Giờ vàng đang rẻ hơn"; suất của phân loại khác không tính', async () => {
    mocks.fetchActiveFlashSales.mockResolvedValue([{ itemId: 'f', variationId: 'v1', productSlug: 'sp-a', flashPrice: 90_000, retailPrice: 120_000, salePrice: null, endAt: new Date(Date.now() + 3_600_000).toISOString() }]);
    mocks.listGroupBuys.mockResolvedValue([GROUP('a', { unitPrice: 102_000, basePrice: 120_000, variationId: 'v1' })]);
    const first = renderPage();
    expect(await screen.findByText(`Giờ vàng đang rẻ hơn: ${formatVnd(90_000)}`)).toBeInTheDocument();
    expect(screen.queryByText(/Mua một mình/)).toBeNull();
    first.unmount();
    mocks.fetchActiveFlashSales.mockResolvedValue([{ ...({ itemId: 'f', variationId: 'v1', productSlug: 'sp-a', flashPrice: 90_000, retailPrice: 120_000, salePrice: null, endAt: new Date(Date.now() + 3_600_000).toISOString() }), variationId: 'v-khac' }]);
    renderPage();
    expect(await screen.findByText(`Mua một mình ${formatVnd(120_000)}`)).toBeInTheDocument();
  });

  it('B-72: ghi giá nhóm và giá mua một mình, không gạch giá', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('a', { unitPrice: 102_000, basePrice: 120_000, discountPct: 15 })]);
    renderPage();
    expect(await screen.findByText(`Giá nhóm ${formatVnd(102_000)}`)).toBeInTheDocument();
    const solo = screen.getByText(`Mua một mình ${formatVnd(120_000)}`);
    expect(solo).toBeInTheDocument();
    expect((solo as HTMLElement).style.textDecoration).not.toContain('line-through');
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

  it('chạm Tham gia lúc app còn khôi phục phiên: chờ phiên rồi tham gia đúng nhóm đó, một lần dù chạm nhiều', async () => {
    mocks.auth.status = 'loading';
    let done!: () => void;
    mocks.login.mockReturnValue(new Promise<void>((r) => (done = r)));
    renderPage();
    const btn = (await screen.findAllByRole('button', { name: 'Đăng nhập để tham gia' }))[0]!;
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
    mocks.auth.status = 'authenticated';
    done();
    await waitFor(() => expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1));
    expect(mocks.joinGroupBuy).toHaveBeenCalledWith('a');
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('chạm nhóm thứ hai lúc nhóm đầu đang chờ phiên: login một lần, chỉ tham gia nhóm đầu', async () => {
    mocks.auth.status = 'loading';
    mocks.listGroupBuys.mockResolvedValue([GROUP('a'), GROUP('c')]);
    let done!: () => void;
    mocks.login.mockReturnValue(new Promise<void>((r) => (done = r)));
    renderPage();
    const btns = await screen.findAllByRole('button', { name: 'Đăng nhập để tham gia' });
    fireEvent.click(btns[0]!);
    fireEvent.click(btns[1]!);
    mocks.auth.status = 'authenticated';
    done();
    await waitFor(() => expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
    expect(mocks.joinGroupBuy).toHaveBeenCalledWith('a');
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('chạm Tham gia lúc khôi phục phiên mà phiên không ra: không tham gia', async () => {
    mocks.auth.status = 'loading';
    let done!: () => void;
    mocks.login.mockReturnValue(new Promise<void>((r) => (done = r)));
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Đăng nhập để tham gia' }))[0]!);
    mocks.auth.status = 'idle';
    done();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
  });

  it('tài khoản bị khoá: bấm "Đăng nhập để tham gia" thì báo lời khoá của máy chủ, không gửi yêu cầu tham gia', async () => {
    mocks.auth.status = 'idle';
    mocks.auth.error = 'Tài khoản đã bị khoá. Liên hệ Tubu Tree để được hỗ trợ.';
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Đăng nhập để tham gia' }))[0]!);
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Tài khoản đã bị khoá. Liên hệ Tubu Tree để được hỗ trợ.', type: 'error' }),
    );
    expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
  });

  it('khách thường bấm "Đăng nhập để tham gia": không có thanh báo lỗi', async () => {
    mocks.auth.status = 'idle';
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Đăng nhập để tham gia' }))[0]!);
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
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
  it('người mở nhóm thấy chữ trạng thái thay vì "Tham gia", nút chính là mời bạn', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('mine', { joined: true, isOwner: true })]);
    renderPage();
    expect(await screen.findByText(/Bạn đã ở trong nhóm/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nhóm của bạn' })).toBeNull();
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

  it('mô tả thẻ chia sẻ nhóm mở bằng ưu đãi khách mới: có mã chào mừng thật thì nêu đúng số, chưa có thì câu không số', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('mine', { joined: true, isOwner: true })]);
    const { unmount } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mời bạn bè' }));
    const plain = (mocks.shareWithFallback.mock.calls[0] as [Record<string, string>, string])[0].description!;
    expect(plain.startsWith('Tubu Tree tặng khách mới mã giảm giá cho đơn đầu. Còn thiếu ')).toBe(true);
    unmount();
    mocks.shareWithFallback.mockClear();
    mocks.getPublicConfig.mockResolvedValue({ newCustomer: { welcomeVoucher: { amount: 30000, minOrder: 199000 } } });
    renderPage();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalledTimes(2));
    await screen.findByRole('button', { name: 'Mời bạn bè' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mời bạn bè' }));
    const withOffer = (mocks.shareWithFallback.mock.calls[0] as [Record<string, string>, string])[0].description!;
    expect(withOffer.startsWith('Tubu Tree tặng khách mới mã 30.000đ cho đơn đầu từ 199k. Còn thiếu ')).toBe(true);
    expect(withOffer.length).toBeLessThanOrEqual(400);
  });

  it('thành viên (không phải người mở) cũng mời được bạn; nhóm chưa tham gia thì không có nút mời', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('a'), GROUP('b', { joined: true })]);
    renderPage();
    await screen.findByText('Sản phẩm a');
    expect(screen.getAllByRole('button', { name: 'Mời bạn bè' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Đã tham gia' })).toBeNull();
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

  it('chưa đăng nhập mở link nhóm: vẫn gọi API chi tiết (công khai), hiện thẻ nhóm được mời với nút "Đăng nhập để tham gia"', async () => {
    mocks.auth.status = 'anonymous';
    mocks.params = { id: 'b' };
    mocks.getGroupBuy.mockResolvedValue(GROUP('b'));
    renderPage();
    expect(await screen.findByText('Bạn được mời vào nhóm này')).toBeInTheDocument();
    expect(mocks.getGroupBuy).toHaveBeenCalledWith('b');
    expect(screen.getAllByText('Sản phẩm b')).toHaveLength(1);
    const buttons = screen.getAllByRole('button', { name: 'Đăng nhập để tham gia' });
    fireEvent.click(buttons[0]!);
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
  });

  it('nói rõ cơ chế: đủ người thì nhận mã giảm theo % của nhóm (mã giảm % trên biến thể khách mua, không phải số tiền cố định)', async () => {
    renderPage();
    const hints = await screen.findAllByText(`Đủ nhóm: mỗi người nhận mã giảm giá 20% cho đơn từ ${formatVnd(80_000)}`);
    expect(hints).toHaveLength(2);
    expect(screen.queryByText(new RegExp(`mã giảm ${formatVnd(20_000)}`))).toBeNull();
  });

  it('E-100: "Còn thiếu N người" là một dòng riêng, tách khỏi điều nhận được khi đủ nhóm; người đã trong nhóm có dòng trạng thái riêng nên không lặp', async () => {
    renderPage();
    // Nhóm a chưa tham gia (2/5), nhóm b đã tham gia.
    expect(await screen.findAllByText('Còn thiếu 3 người')).toHaveLength(1);
    expect(screen.getByText('Bạn đã ở trong nhóm · cần thêm 3 người')).toBeInTheDocument();
  });

  it('E-100: nhóm đã đủ người không có dòng "Còn thiếu"', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('a', { currentSize: 5, status: 'SUCCESS', joined: true })]);
    renderPage();
    await screen.findByText('Sản phẩm a');
    expect(screen.queryByText(/Còn thiếu/)).toBeNull();
    expect(screen.queryByText(/^Đủ nhóm:/)).toBeNull();
  });

  it('Q18: đơn từ ghi đúng đơn tối thiểu của mã (biến thể rẻ nhất), không phải giá nhóm của sản phẩm', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('a', { unitPrice: 365_500, basePrice: 430_000, minOrder: 102_000, discountPct: 15 })]);
    renderPage();
    expect((await screen.findAllByText(`Đủ nhóm: mỗi người nhận mã giảm giá 15% cho đơn từ ${formatVnd(102_000)}`)).length).toBeGreaterThan(0);
  });

  it('R2-BUYERMINI-4: người mở nhóm vào nhóm của chính mình không thấy banner "Bạn được mời"', async () => {
    mocks.params = { id: 'mine' };
    mocks.getGroupBuy.mockResolvedValue(GROUP('mine', { joined: true, isOwner: true }));
    mocks.listGroupBuys.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Bạn đã ở trong nhóm/)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Mua ngay với mã giảm giá 20%' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/sp-done', { state: { variationId: undefined, applyCoupon: 'GBUY-DONE-ME' } });
    expect(screen.queryByRole('button', { name: 'Nhóm đã đủ người' })).toBeNull();
  });

  it('E-9: nút "Mua ngay với mã" gửi sang trang sản phẩm kèm phân loại của nhóm và mã của người xem để trang áp mã sau khi thêm giỏ', async () => {
    mocks.listGroupBuys.mockResolvedValue([
      GROUP('done', { joined: true, status: 'SUCCESS', currentSize: 5, couponCode: 'GBUY-DONE-ME', variationId: 'v-rep' }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mua ngay với mã giảm giá 20%' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/sp-done', { state: { variationId: 'v-rep', applyCoupon: 'GBUY-DONE-ME' } });
  });

  it('E-9: bấm ảnh sản phẩm của nhóm đủ người vẫn mở trang sản phẩm trơn, không áp mã', async () => {
    mocks.listGroupBuys.mockResolvedValue([
      GROUP('done', { joined: true, status: 'SUCCESS', currentSize: 5, couponCode: 'GBUY-DONE-ME' }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByAltText('Sản phẩm done'));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/sp-done');
  });
});

describe('GroupBuyPage — tài khoản khách bấm Tham gia (E-11)', () => {
  const GUEST_USER = { phone: null, zaloId: 'guest_dev1' };
  const joinButton = () => screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' });

  it('tài khoản khách: gọi ensurePhone trước, liên kết xong mới gửi tham gia', async () => {
    mocks.auth.user = GUEST_USER;
    mocks.ensurePhone.mockResolvedValue('0912345678');
    renderPage();
    fireEvent.click(await joinButton());
    await waitFor(() => expect(mocks.joinGroupBuy).toHaveBeenCalledWith('a'));
    expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);
  });

  it('ensurePhone trả null (không liên kết được): dừng, không gọi API tham gia, nói khách cần làm gì', async () => {
    mocks.auth.user = GUEST_USER;
    mocks.ensurePhone.mockResolvedValue(null);
    renderPage();
    fireEvent.click(await joinButton());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', text: expect.stringContaining('số điện thoại') })));
    expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
  });

  it('ensurePhone ném lỗi: xử lý như không liên kết được, không gọi API tham gia', async () => {
    mocks.auth.user = GUEST_USER;
    mocks.ensurePhone.mockRejectedValue(new Error('Zalo từ chối'));
    renderPage();
    fireEvent.click(await joinButton());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' })));
    expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
  });

  it('bấm đúp khi đang chờ liên kết chỉ mở một lần xin số điện thoại', async () => {
    mocks.auth.user = GUEST_USER;
    let release: (v: string | null) => void = () => undefined;
    mocks.ensurePhone.mockReturnValue(new Promise<string | null>((r) => (release = r)));
    renderPage();
    const btn = await joinButton();
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);
    release(null);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
  });

  it('tài khoản thật (có số điện thoại hoặc Zalo thật): tham gia thẳng, không gọi ensurePhone', async () => {
    mocks.auth.user = { phone: '0912345678', zaloId: 'z1' };
    renderPage();
    fireEvent.click(await joinButton());
    await waitFor(() => expect(mocks.joinGroupBuy).toHaveBeenCalledWith('a'));
    expect(mocks.ensurePhone).not.toHaveBeenCalled();
  });
});

describe('GroupBuyPage — khoá chạm đúp Tham gia (W75A)', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  it('chạm đúp "Tham gia" trong cùng một khung hình chỉ gửi một lần, báo thành công một lần', async () => {
    const d = deferred();
    mocks.joinGroupBuy.mockReturnValueOnce(d.promise);
    mocks.listGroupBuys.mockResolvedValue([GROUP('a')]);
    renderPage();
    const join = await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' });
    await act(async () => {
      fireEvent.click(join);
      fireEvent.click(join);
    });
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ joined: true, currentSize: 3, status: 'OPEN' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tham gia nhóm', type: 'success' }));
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });

  it('hai nhóm khác nhau trong cùng một khung hình đều gửi (khoá theo nhóm)', async () => {
    mocks.listGroupBuys.mockResolvedValue([GROUP('a'), GROUP('b')]);
    mocks.joinGroupBuy.mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findAllByRole('button', { name: 'Tham gia mua chung (−20%)' });
    const [a, b] = screen.getAllByRole('button', { name: 'Tham gia mua chung (−20%)' });
    await act(async () => {
      fireEvent.click(a!);
      fireEvent.click(b!);
    });
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(2);
    expect(mocks.joinGroupBuy).toHaveBeenCalledWith('a');
    expect(mocks.joinGroupBuy).toHaveBeenCalledWith('b');
  });

  it('tham gia lỗi thì nhả khoá của nhóm: bấm lại gửi lần hai', async () => {
    mocks.joinGroupBuy.mockRejectedValueOnce(new Error('Nhóm đã hết hạn')).mockResolvedValue({ joined: true, currentSize: 3, status: 'OPEN' });
    mocks.listGroupBuys.mockResolvedValue([GROUP('a')]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Nhóm đã hết hạn', type: 'error' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() => expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(2));
  });
});

describe('GroupBuyPage — khoá giữ tới khi danh sách về, khoá "Mời bạn bè" (W87A)', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const JOINED = { joined: true, currentSize: 3, status: 'OPEN' as const };

  it('tham gia xong mà danh sách chưa về: nút vẫn bận (chưa thành "Mời bạn bè") và bấm thêm không gửi lần hai; danh sách về thì thành viên', async () => {
    const refreshed = deferred<GroupBuy[]>();
    mocks.listGroupBuys.mockResolvedValueOnce([GROUP('a')]).mockReturnValueOnce(refreshed.promise);
    mocks.joinGroupBuy.mockResolvedValue(JOINED);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tham gia nhóm', type: 'success' }));
    await waitFor(() => expect(mocks.listGroupBuys).toHaveBeenCalledTimes(2));
    const stale = screen.getByRole('button', { name: 'Tham gia mua chung (−20%)' });
    expect(stale).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(stale);
    fireEvent.click(stale);
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
    await act(async () => refreshed.resolve([GROUP('a', { joined: true, currentSize: 3 })]));
    expect(await screen.findByRole('button', { name: 'Mời bạn bè' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tham gia mua chung/ })).toBeNull();
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
  });

  it('nhóm được mời qua liên kết: tham gia xong thẻ chờ cả danh sách chung lẫn chi tiết nhóm làm mới về rồi mới nhả khoá', async () => {
    mocks.params = { id: 'inv' };
    const refreshed = deferred<GroupBuy>();
    mocks.listGroupBuys.mockResolvedValue([]);
    mocks.getGroupBuy.mockResolvedValueOnce(GROUP('inv')).mockReturnValueOnce(refreshed.promise);
    mocks.joinGroupBuy.mockResolvedValue(JOINED);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() => expect(mocks.getGroupBuy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tham gia nhóm', type: 'success' }));
    const stale = screen.getByRole('button', { name: 'Tham gia mua chung (−20%)' });
    expect(stale).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(stale);
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
    await act(async () => refreshed.resolve(GROUP('inv', { joined: true, currentSize: 3 })));
    expect(await screen.findByRole('button', { name: 'Mời bạn bè' })).toBeInTheDocument();
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
  });

  describe('"Mời bạn bè"', () => {
    const MINE = () => mocks.listGroupBuys.mockResolvedValue([GROUP('mine', { joined: true, isOwner: true })]);

    it('chạm đúp trong cùng một khung hình chỉ mở hộp chia sẻ một lần', async () => {
      const share = deferred<void>();
      mocks.shareWithFallback.mockReturnValueOnce(share.promise);
      MINE();
      renderPage();
      const invite = await screen.findByRole('button', { name: 'Mời bạn bè' });
      await act(async () => {
        fireEvent.click(invite);
        fireEvent.click(invite);
      });
      expect(mocks.shareWithFallback).toHaveBeenCalledTimes(1);
      await act(async () => share.resolve());
    });

    it('hai cú chạm ở hai lần act liên tiếp (hộp chia sẻ chưa đóng): vẫn chỉ một lần', async () => {
      const share = deferred<void>();
      mocks.shareWithFallback.mockReturnValueOnce(share.promise);
      MINE();
      renderPage();
      const invite = await screen.findByRole('button', { name: 'Mời bạn bè' });
      await act(async () => {
        fireEvent.click(invite);
      });
      await act(async () => {
        fireEvent.click(invite);
      });
      expect(mocks.shareWithFallback).toHaveBeenCalledTimes(1);
      await act(async () => share.resolve());
    });

    it('hộp chia sẻ đóng (xong hoặc khách huỷ) thì nhả khoá: bấm lại mở lần hai', async () => {
      const share = deferred<void>();
      mocks.shareWithFallback.mockReturnValueOnce(share.promise).mockResolvedValue(undefined);
      MINE();
      renderPage();
      const invite = await screen.findByRole('button', { name: 'Mời bạn bè' });
      fireEvent.click(invite);
      expect(mocks.shareWithFallback).toHaveBeenCalledTimes(1);
      await act(async () => share.resolve());
      fireEvent.click(screen.getByRole('button', { name: 'Mời bạn bè' }));
      expect(mocks.shareWithFallback).toHaveBeenCalledTimes(2);
    });
  });
});

describe('GroupBuyPage — "Thử lại" danh sách khoá chạm đúp (W87A)', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  // Chỉ ca còn dữ liệu cũ mà lần làm mới lỗi mới chứng minh được khoá của nút: truy vấn chưa có dữ liệu thì refetch thứ hai bị react-query gộp.
  async function renderWithRefreshError() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <GroupBuyPage />
      </QueryClientProvider>,
    );
    await screen.findByText('Sản phẩm a');
    mocks.listGroupBuys.mockRejectedValueOnce(new Error('mất mạng'));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['group-buy'] });
    });
    return screen.findByRole('button', { name: 'Thử lại' });
  }

  it('chạm đúp trong cùng một khung hình chỉ tải lại một lần', async () => {
    const retry = await renderWithRefreshError();
    const next = deferred<GroupBuy[]>();
    mocks.listGroupBuys.mockReturnValueOnce(next.promise);
    const before = mocks.listGroupBuys.mock.calls.length;
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.listGroupBuys.mock.calls.length - before).toBe(1);
    await act(async () => next.resolve([GROUP('a')]));
    expect(await screen.findByText('Sản phẩm a')).toBeInTheDocument();
  });

  it('hai cú chạm ở hai lần act liên tiếp (lượt tải chưa về) vẫn chỉ một lần', async () => {
    const retry = await renderWithRefreshError();
    const next = deferred<GroupBuy[]>();
    mocks.listGroupBuys.mockReturnValueOnce(next.promise);
    const before = mocks.listGroupBuys.mock.calls.length;
    await act(async () => {
      fireEvent.click(retry);
    });
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(mocks.listGroupBuys.mock.calls.length - before).toBe(1);
    await act(async () => next.resolve([GROUP('a')]));
    expect(await screen.findByText('Sản phẩm a')).toBeInTheDocument();
  });
});

describe('GroupBuyPage — khoá giữ có hạn khi việc kéo dài mãi (W87A)', () => {
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    // shouldAdvanceTime để bộ đếm giờ của react-query và waitFor vẫn chạy; chỉ cần giả setTimeout để tua tới hạn.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it('tham gia xong mà danh sách không về: còn khoá ở 3 giây, nhả sau 4 giây', async () => {
    mocks.listGroupBuys.mockResolvedValueOnce([GROUP('a')]).mockReturnValueOnce(new Promise(() => undefined));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã tham gia nhóm', type: 'success' }));
    await waitFor(() => expect(mocks.listGroupBuys).toHaveBeenCalledTimes(2));
    await advance(3_000);
    expect(screen.getByRole('button', { name: 'Tham gia mua chung (−20%)' })).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
    await advance(1_500);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tham gia mua chung (−20%)' })).not.toHaveAttribute('aria-busy'));
    fireEvent.click(screen.getByRole('button', { name: 'Tham gia mua chung (−20%)' }));
    await waitFor(() => expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(2));
  });

  it('hộp chia sẻ treo mãi: "Mời bạn bè" còn khoá ở 29 giây, nhả sau 30 giây', async () => {
    mocks.shareWithFallback.mockReturnValueOnce(new Promise(() => undefined));
    mocks.listGroupBuys.mockResolvedValue([GROUP('mine', { joined: true, isOwner: true })]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mời bạn bè' }));
    expect(mocks.shareWithFallback).toHaveBeenCalledTimes(1);
    await advance(29_000);
    fireEvent.click(screen.getByRole('button', { name: 'Mời bạn bè' }));
    expect(mocks.shareWithFallback).toHaveBeenCalledTimes(1);
    await advance(1_500);
    fireEvent.click(screen.getByRole('button', { name: 'Mời bạn bè' }));
    expect(mocks.shareWithFallback).toHaveBeenCalledTimes(2);
  });
});

describe('GroupBuyPage — tải lại nhóm khi máy chủ từ chối tham gia, nhóm quá hạn chưa bị cron đóng (W102A)', () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const httpError = (status: number, message: string) => Object.assign(new Error(message), { isHttpError: true, response: { status } });
  const JOIN = 'Tham gia mua chung (−20%)';

  it.each([
    [400, 'Nhóm đã đủ người hoặc đã đóng.'],
    [404, 'Không tìm thấy nhóm mua chung.'],
    [409, 'Nhóm đã đóng.'],
  ])('máy chủ trả %i: báo đúng câu của máy chủ, tải lại danh sách và nhóm đã đóng không còn nút "Tham gia"', async (status, message) => {
    mocks.listGroupBuys.mockResolvedValueOnce([GROUP('a')]).mockResolvedValue([]);
    mocks.joinGroupBuy.mockRejectedValue(httpError(status, message));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: JOIN }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
    await waitFor(() => expect(mocks.listGroupBuys).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Chưa có nhóm mua chung nào')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: JOIN })).toBeNull();
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
  });

  it('"Bạn đã tham gia nhóm này rồi" (đã vào từ máy khác hoặc lần bấm trước): tải lại thì thẻ thành "Mời bạn bè", không còn nút tham gia', async () => {
    mocks.listGroupBuys.mockResolvedValueOnce([GROUP('a')]).mockResolvedValue([GROUP('a', { joined: true, currentSize: 3 })]);
    mocks.joinGroupBuy.mockRejectedValue(httpError(400, 'Bạn đã tham gia nhóm này rồi.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: JOIN }));
    expect(await screen.findByRole('button', { name: 'Mời bạn bè' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: JOIN })).toBeNull();
  });

  it('thẻ giữ khoá tới khi danh sách tải lại về: lúc đó bấm thêm không gửi lần hai, về rồi thẻ hiện đúng trạng thái', async () => {
    const refreshed = deferred<GroupBuy[]>();
    mocks.listGroupBuys.mockResolvedValueOnce([GROUP('a')]).mockReturnValueOnce(refreshed.promise);
    mocks.joinGroupBuy.mockRejectedValue(httpError(400, 'Nhóm đã đủ người hoặc đã đóng.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: JOIN }));
    await waitFor(() => expect(mocks.listGroupBuys).toHaveBeenCalledTimes(2));
    const stale = screen.getByRole('button', { name: JOIN });
    expect(stale).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(stale);
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
    await act(async () => refreshed.resolve([]));
    expect(await screen.findByText('Chưa có nhóm mua chung nào')).toBeInTheDocument();
    expect(mocks.joinGroupBuy).toHaveBeenCalledTimes(1);
  });

  it('nhóm mở bằng liên kết: lỗi 400 tải lại cả chi tiết nhóm lẫn danh sách chung', async () => {
    mocks.params = { id: 'inv' };
    mocks.listGroupBuys.mockResolvedValue([]);
    mocks.getGroupBuy.mockResolvedValueOnce(GROUP('inv')).mockResolvedValue(GROUP('inv', { status: 'SUCCESS', joined: false }));
    mocks.joinGroupBuy.mockRejectedValue(httpError(400, 'Nhóm đã đóng.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: JOIN }));
    await waitFor(() => expect(mocks.getGroupBuy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.listGroupBuys).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Nhóm đã đủ người' })).toBeDisabled();
  });

  it.each([
    ['mất mạng hoặc hết thời gian (không có phản hồi)', new Error('Mạng chưa ổn định')],
    ['hết phiên (401): tải lại cũng 401', httpError(401, 'Phiên đăng nhập đã hết hạn.')],
    ['máy chủ bận (500)', httpError(500, 'Máy chủ đang bận, bạn thử lại sau nhé.')],
    ['cổng lỗi lúc triển khai (502)', httpError(502, 'Máy chủ đang bận, bạn thử lại sau nhé.')],
  ])('%s: báo lỗi, không tải lại danh sách (tải lại hỏng sẽ thay cả danh sách bằng màn lỗi)', async (_label, error) => {
    mocks.joinGroupBuy.mockRejectedValue(error);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: JOIN }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: (error as Error).message, type: 'error' }));
    expect(mocks.listGroupBuys).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: JOIN })).toBeInTheDocument();
  });

  describe('nhóm quá hạn mà cron 15 phút chưa đóng (API vẫn trả OPEN)', () => {
    const PAST = () => new Date(Date.now() - 60_000).toISOString();

    it('nhóm được mời qua liên kết: ghi "Nhóm đã hết hạn", nút bị khoá, không gửi yêu cầu tham gia', async () => {
      mocks.params = { id: 'late' };
      mocks.getGroupBuy.mockResolvedValue(GROUP('late', { expiresAt: PAST() }));
      mocks.listGroupBuys.mockResolvedValue([]);
      renderPage();
      const closed = await screen.findByRole('button', { name: 'Nhóm đã hết hạn' });
      expect(closed).toBeDisabled();
      expect(screen.getByText('2/5 người · đã hết hạn')).toBeInTheDocument();
      fireEvent.click(closed);
      expect(mocks.joinGroupBuy).not.toHaveBeenCalled();
    });

    it('thành viên của nhóm quá hạn: không còn nút "Mời bạn bè" (mời vào nhóm không tham gia được nữa)', async () => {
      mocks.listGroupBuys.mockResolvedValue([GROUP('mine', { joined: true, isOwner: true, expiresAt: PAST() })]);
      renderPage();
      expect(await screen.findByRole('button', { name: 'Nhóm đã hết hạn' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Mời bạn bè' })).toBeNull();
    });

    it('đúng mốc hết hạn (bằng giờ máy chủ) đã tính là hết hạn, như máy chủ (expiresAt <= now)', async () => {
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      try {
        mocks.listGroupBuys.mockResolvedValue([GROUP('edge', { expiresAt: new Date(now).toISOString() })]);
        renderPage();
        expect(await screen.findByRole('button', { name: 'Nhóm đã hết hạn' })).toBeDisabled();
      } finally {
        clock.mockRestore();
      }
    });

    it('điện thoại chạy chậm hơn máy chủ 10 phút: hạn tính theo giờ máy chủ, nhóm đã hết hạn thật dù đồng hồ máy còn 5 phút', async () => {
      syncServerClock(new Date(Date.now() + 10 * 60_000).toISOString());
      try {
        mocks.listGroupBuys.mockResolvedValue([GROUP('skew', { expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() })]);
        renderPage();
        expect(await screen.findByRole('button', { name: 'Nhóm đã hết hạn' })).toBeDisabled();
        expect(screen.getByText('2/5 người · đã hết hạn')).toBeInTheDocument();
      } finally {
        syncServerClock(new Date().toISOString());
      }
    });

    it('nhóm còn hạn một phút vẫn cho tham gia', async () => {
      mocks.listGroupBuys.mockResolvedValue([GROUP('soon', { expiresAt: new Date(Date.now() + 60_000).toISOString() })]);
      renderPage();
      expect(await screen.findByRole('button', { name: JOIN })).not.toBeDisabled();
    });
  });
});

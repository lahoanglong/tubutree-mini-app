import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  phase: 'authenticated' as 'authenticated' | 'guest' | 'loading',
  guest: false,
  login: vi.fn(),
  coreGet: vi.fn(),
  claimCoupon: vi.fn(),
  notify: vi.fn(),
  use: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div className="zaui-page">{children}</div>,
  useNavigate: () => mocks.navigate,
}));
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../services/coupon-claim', () => ({ claimCoupon: mocks.claimCoupon }));
vi.mock('../hooks/use-notify', () => ({ useNotify: () => ({ notify: mocks.notify }) }));
vi.mock('../hooks/use-coupon-use', () => ({ useCouponUse: () => ({ copy: vi.fn(), use: mocks.use }) }));
vi.mock('../hooks/use-auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('../store/auth', () => {
  const state = () => ({
    status: mocks.phase === 'authenticated' ? 'authenticated' : 'idle',
    error: undefined,
    user: mocks.phase === 'authenticated' ? { id: 'u1', fullName: 'Lan', phone: mocks.guest ? null : '0901234567', zaloId: mocks.guest ? 'guest_1' : 'z1' } : null,
    ensurePhoneOrThrow: vi.fn(),
    login: mocks.login,
  });
  const useAuthStore = Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(state()) : state()), { getState: () => state() });
  return { useAuthStore };
});
vi.mock('../components/back-button', () => ({ default: () => null }));
vi.mock('../components/pull-to-refresh', () => ({ PullToRefresh: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import VouchersPage from './vouchers';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;
const DAY = 86_400_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const httpError = (status: number, message: string) => ({ isHttpError: true, response: { status, data: { message } } });

const collectable = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  title: null,
  type: 'AMOUNT',
  value: 30_000,
  minOrder: 199_000,
  maxDiscount: null,
  startAt: iso(-DAY),
  endAt: iso(20 * DAY),
  newCustomerOnly: false,
  claimedCount: 0,
  usageLimit: null,
  ...over,
});
const wallet = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  type: 'AMOUNT',
  value: 30_000,
  minOrder: 199_000,
  maxDiscount: null,
  endAt: iso(20 * DAY),
  ...over,
});

let responses: Record<string, unknown>;
const callsTo = (path: string) => mocks.coreGet.mock.calls.filter(([p]) => p === path);

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}
function renderAt(url = '/vouchers') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]} future={FUTURE}>
        <VouchersPage />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const tabs = () => within(screen.getByRole('tablist', { name: 'Nhóm mã giảm giá' }));
const pickTab = (name: string) => fireEvent.click(tabs().getByRole('tab', { name }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'authenticated';
  mocks.guest = false;
  responses = {
    '/coupons/collectable': [collectable('NEW10', { title: 'Chào bạn mới' }), collectable('SHIP', { type: 'FREESHIP', value: 0 })],
    '/coupons/collectable/mine': { claimed: [], newCustomerOnly: [] },
    '/me/coupons': [],
    '/me/coupons/history': [],
  };
  mocks.coreGet.mockImplementation(async (path: string) => {
    const r = responses[path];
    if ((r as { isHttpError?: boolean } | undefined)?.isHttpError) throw r;
    return r;
  });
  mocks.claimCoupon.mockResolvedValue({ code: 'NEW10', alreadyClaimed: false });
});

describe('VouchersPage (Mini)', () => {
  it('khách chưa đăng nhập: tab Nhận mã gọi kho công khai, không gọi ví; thấy thẻ và nút Lưu mã', async () => {
    mocks.phase = 'guest';
    renderAt();
    expect(await screen.findByText('Giảm 30.000đ')).toBeInTheDocument();
    expect(callsTo('/coupons/collectable')).toHaveLength(1);
    expect(callsTo('/me/coupons')).toHaveLength(0);
    expect(callsTo('/me/coupons/history')).toHaveLength(0);
    expect(callsTo('/coupons/collectable/mine')).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(2);
    expect(tabs().getByRole('tab', { name: 'Nhận mã' })).toHaveAttribute('aria-selected', 'true');
  });

  it('khách chưa đăng nhập bấm Lưu mã: mở đăng nhập, không gọi POST claim', async () => {
    mocks.phase = 'guest';
    renderAt();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Lưu mã' }))[0]!);
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1));
    expect(mocks.claimCoupon).not.toHaveBeenCalled();
  });

  it('đã đăng nhập bấm Lưu mã: gọi claim đúng mã, báo đã lưu, rồi thẻ thành Dùng ngay', async () => {
    renderAt();
    const save = await screen.findAllByRole('button', { name: 'Lưu mã' });
    responses['/me/coupons'] = [wallet('NEW10')];
    fireEvent.click(save[0]!);
    await waitFor(() => expect(mocks.claimCoupon).toHaveBeenCalledWith('NEW10'));
    expect(mocks.notify).toHaveBeenCalledWith({ text: 'Đã lưu vào Mã của tôi', type: 'success' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Dùng ngay' })).toHaveLength(1));
    expect(screen.getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
  });

  it('sau khi lưu mã, ví làm mới xong rồi mới hỏi lại phần đã nhận: thẻ không nháy Đã dùng giữa hai lần tải', async () => {
    renderAt();
    const save = await screen.findAllByRole('button', { name: 'Lưu mã' });
    let releaseWallet: (v: unknown) => void = () => undefined;
    const mineBefore = callsTo('/coupons/collectable/mine').length;
    mocks.coreGet.mockImplementation(async (path: string) => {
      if (path === '/me/coupons') return new Promise((r) => (releaseWallet = r));
      if (path === '/coupons/collectable/mine') return { claimed: ['NEW10'], newCustomerOnly: [] };
      return responses[path];
    });
    fireEvent.click(save[0]!);
    await waitFor(() => expect(callsTo('/me/coupons').length).toBeGreaterThanOrEqual(2));
    // Ví chưa về: chưa được hỏi lại "đã nhận", nếu không mã vừa lưu hiện Đã dùng khi ví còn cũ.
    expect(callsTo('/coupons/collectable/mine')).toHaveLength(mineBefore);
    expect(screen.queryByText('Đã dùng')).toBeNull();
    releaseWallet([wallet('NEW10')]);
    await waitFor(() => expect(callsTo('/coupons/collectable/mine').length).toBe(mineBefore + 1));
    expect(await screen.findByRole('button', { name: 'Dùng ngay' })).toBeInTheDocument();
    expect(screen.queryByText('Đã dùng')).toBeNull();
  });

  it('mã đã có trong ví hiện Dùng ngay ngay từ đầu; bấm gọi use với đúng mã', async () => {
    responses['/me/coupons'] = [wallet('NEW10')];
    renderAt();
    const use = await screen.findByRole('button', { name: 'Dùng ngay' });
    fireEvent.click(use);
    expect(mocks.use).toHaveBeenCalledWith('NEW10');
    expect(mocks.claimCoupon).not.toHaveBeenCalled();
  });

  it('claim lỗi hết lượt: báo câu của máy chủ và tải lại kho, thẻ chuyển Đã hết lượt', async () => {
    renderAt();
    const save = await screen.findAllByRole('button', { name: 'Lưu mã' });
    mocks.claimCoupon.mockRejectedValue(httpError(400, 'Mã giảm giá đã hết lượt nhận.'));
    responses['/coupons/collectable'] = [
      collectable('NEW10', { title: 'Chào bạn mới', usageLimit: 1, claimedCount: 1 }),
      collectable('SHIP', { type: 'FREESHIP', value: 0 }),
    ];
    fireEvent.click(save[0]!);
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ text: 'Mã giảm giá đã hết lượt nhận.', type: 'error' }));
    await waitFor(() => expect(callsTo('/coupons/collectable').length).toBeGreaterThanOrEqual(2));
    // Route kho có max-age=15: lần tải lại sau lỗi phải đổi khoá cache HTTP, không thì lấy lại bản cũ.
    expect(callsTo('/coupons/collectable').some(([, opts]) => typeof (opts as { query?: { fresh?: unknown } } | undefined)?.query?.fresh === 'number')).toBe(true);
    expect(await screen.findByText('Đã hết lượt')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
  });

  it('mã đã nhận mà đã dùng hết lượt cá nhân (ví không còn): không có nút Lưu mã, thẻ ghi Đã dùng, mã chưa nhận vẫn Lưu được', async () => {
    responses['/coupons/collectable/mine'] = { claimed: ['NEW10'], newCustomerOnly: [] };
    renderAt();
    await screen.findByText('Đã dùng');
    expect(screen.getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Dùng ngay' })).toBeNull();
    expect(callsTo('/coupons/collectable/mine')).toHaveLength(1);
  });

  it('mã chỉ dành khách mới mà khách đã có đơn: ghi lý do, không có nút Lưu mã', async () => {
    responses['/coupons/collectable'] = [collectable('NEWONLY', { newCustomerOnly: true }), collectable('SHIP', { type: 'FREESHIP', value: 0 })];
    responses['/coupons/collectable/mine'] = { claimed: [], newCustomerOnly: ['NEWONLY'] };
    renderAt();
    expect(await screen.findByText('Chỉ dành cho khách đặt đơn đầu tiên')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
  });

  it('mã khách-mới đã nhận mà khách đã có đơn (claimedIneligible): ghi "không còn áp dụng", không ghi Đã dùng, không có nút Lưu mã hay Dùng ngay', async () => {
    responses['/coupons/collectable'] = [collectable('NEWONLY', { newCustomerOnly: true }), collectable('SHIP', { type: 'FREESHIP', value: 0 })];
    responses['/coupons/collectable/mine'] = { claimed: ['NEWONLY'], newCustomerOnly: [], claimedIneligible: ['NEWONLY'] };
    renderAt();
    expect(await screen.findByText('Chỉ dành cho khách đặt đơn đầu tiên, nên không còn áp dụng')).toBeInTheDocument();
    expect(screen.queryByText('Đã dùng')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Dùng ngay' })).toBeNull();
  });

  it('ví tải lỗi: mã đã nhận không bị ghi Đã dùng, không có nút Dùng ngay, có dải báo lỗi và Thử lại tải lại ví', async () => {
    responses['/coupons/collectable/mine'] = { claimed: ['NEW10'], newCustomerOnly: [] };
    responses['/me/coupons'] = httpError(500, 'x');
    renderAt();
    expect(await screen.findByText('Chưa tải được mã bạn đã lưu')).toBeInTheDocument();
    expect(screen.queryByText('Đã dùng')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dùng ngay' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
    const before = callsTo('/me/coupons').length;
    responses['/me/coupons'] = [wallet('NEW10')];
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(callsTo('/me/coupons').length).toBeGreaterThan(before));
    expect(await screen.findByRole('button', { name: 'Dùng ngay' })).toBeInTheDocument();
    expect(screen.queryByText('Chưa tải được mã bạn đã lưu')).toBeNull();
  });

  it('phần riêng của khách chưa tải xong thì chưa vẽ thẻ (không nháy nút Lưu mã rồi biến mất)', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.coreGet.mockImplementation(async (path: string) => {
      if (path === '/coupons/collectable/mine') return new Promise((r) => (release = r));
      return responses[path];
    });
    renderAt();
    await waitFor(() => expect(callsTo('/coupons/collectable/mine')).toHaveLength(1));
    expect(screen.queryByRole('button', { name: 'Lưu mã' })).toBeNull();
    release({ claimed: ['NEW10'], newCustomerOnly: [] });
    expect(await screen.findByText('Đã dùng')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Lưu mã' })).toHaveLength(1);
  });

  it('phần riêng của khách lỗi mạng: vẫn vẽ kho như cũ (máy chủ từ chối lúc nhận)', async () => {
    responses['/coupons/collectable/mine'] = httpError(500, 'x');
    renderAt();
    expect(await screen.findAllByRole('button', { name: 'Lưu mã' })).toHaveLength(2);
  });

  it('tài khoản khách chưa liên kết bị từ chối: hiện đúng câu của máy chủ, không mở đăng nhập', async () => {
    mocks.guest = true;
    renderAt();
    const save = await screen.findAllByRole('button', { name: 'Lưu mã' });
    mocks.claimCoupon.mockRejectedValue(httpError(400, 'Bạn cần đăng nhập Zalo để nhận mã.'));
    fireEvent.click(save[0]!);
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith({ text: 'Bạn cần đăng nhập Zalo để nhận mã.', type: 'error' }));
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('mã còn ít lượt hiện "Còn n lượt"; tên admin đặt hiện ở dòng meta', async () => {
    responses['/coupons/collectable'] = [collectable('NEW10', { title: 'Chào bạn mới', usageLimit: 5, claimedCount: 2 })];
    renderAt();
    expect(await screen.findByText('Còn 3 lượt')).toBeInTheDocument();
    expect(screen.getByTestId('voucher-meta').textContent).toContain('Chào bạn mới · Đơn từ 199k · NEW10');
  });

  it('có chữ "Mỗi đơn dùng 1 mã" trên trang', async () => {
    renderAt();
    expect(await screen.findByText('Mỗi đơn dùng 1 mã')).toBeInTheDocument();
  });

  it('chip Miễn phí giao hàng chỉ giữ mã freeship, chip có tên đọc và trạng thái chọn; không có chip Của shop', async () => {
    renderAt();
    await screen.findByText('Giảm 30.000đ');
    expect(screen.queryByRole('button', { name: 'Của shop' })).toBeNull();
    const chip = screen.getByRole('button', { name: 'Miễn phí giao hàng' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Giảm 30.000đ')).toBeNull();
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Miễn phí giao hàng']);
    fireEvent.click(screen.getByRole('button', { name: 'Giảm giá' }));
    expect(screen.getByText('Giảm 30.000đ')).toBeInTheDocument();
  });

  it('bộ lọc không có mã nào khớp: chữ "Không có mã nào ở mục này", bỏ lọc quay lại danh sách', async () => {
    responses['/coupons/collectable'] = [collectable('NEW10')];
    renderAt();
    await screen.findByText('Giảm 30.000đ');
    fireEvent.click(screen.getByRole('button', { name: 'Miễn phí giao hàng' }));
    expect(screen.getByText('Không có mã nào ở mục này')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    expect(screen.getByText('Giảm 30.000đ')).toBeInTheDocument();
  });

  it('đổi tab đặt lại bộ lọc và ghi ?tab= (replace) lên URL', async () => {
    responses['/me/coupons'] = [wallet('OWN')];
    renderAt();
    await screen.findByText('Giảm 30.000đ');
    fireEvent.click(screen.getByRole('button', { name: 'Miễn phí giao hàng' }));
    pickTab('Mã của tôi');
    expect(screen.getByTestId('loc').textContent).toBe('/vouchers?tab=mine');
    expect(screen.getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true');
    pickTab('Nhận mã');
    expect(screen.getByTestId('loc').textContent).toBe('/vouchers');
  });

  it('Mã của tôi, khách chưa đăng nhập: lời mời đăng nhập, không gọi ví', async () => {
    mocks.phase = 'guest';
    renderAt('/vouchers?tab=mine');
    expect(await screen.findByText('Đăng nhập để xem ưu đãi')).toBeInTheDocument();
    expect(callsTo('/me/coupons')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập ngay' }));
    expect(mocks.login).toHaveBeenCalledTimes(1);
  });

  it('Mã của tôi, đã đăng nhập: thẻ ví có Dùng ngay, tài khoản khách thấy thẻ mời liên kết Zalo', async () => {
    mocks.guest = true;
    responses['/me/coupons'] = [wallet('OWN', { endAt: iso(2 * DAY) })];
    renderAt('/vouchers?tab=mine');
    expect(await screen.findByRole('button', { name: 'Dùng ngay' })).toBeInTheDocument();
    expect(screen.getByText('Liên kết Zalo để giữ điểm và nhận quà')).toBeInTheDocument();
    expect(screen.getByText('Còn 2 ngày')).toBeInTheDocument();
  });

  it('Đã dùng–hết hạn: gọi lịch sử, thẻ đã dùng và hết hạn không có nút', async () => {
    responses['/me/coupons/history'] = [
      { code: 'USED1', title: null, type: 'AMOUNT', value: 20_000, minOrder: null, maxDiscount: null, endAt: iso(5 * DAY), state: 'used', usedAt: iso(-3600_000) },
      { code: 'OLD1', title: null, type: 'FREESHIP', value: 0, minOrder: null, maxDiscount: null, endAt: iso(-2 * DAY), state: 'expired', usedAt: null },
    ];
    renderAt('/vouchers?tab=history');
    expect(await screen.findByText('Đã dùng')).toBeInTheDocument();
    expect(screen.getByText('Đã hết hạn')).toBeInTheDocument();
    expect(callsTo('/me/coupons/history')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Lưu mã|Dùng ngay/ })).toBeNull();
  });

  it('kho lỗi 500: khối lỗi tại chỗ có Thử lại, bấm thì gọi lại và vẽ được danh sách', async () => {
    responses['/coupons/collectable'] = httpError(500, 'Lỗi máy chủ');
    renderAt();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.getByText('Chưa tải được mã giảm giá')).toBeInTheDocument();
    responses['/coupons/collectable'] = [collectable('NEW10')];
    fireEvent.click(retry);
    expect(await screen.findByText('Giảm 30.000đ')).toBeInTheDocument();
    expect(callsTo('/coupons/collectable')).toHaveLength(2);
  });

  it('mọi tab rỗng đều có chữ rỗng riêng', async () => {
    responses['/coupons/collectable'] = [];
    renderAt();
    expect(await screen.findByText('Hôm nay chưa có mã mới')).toBeInTheDocument();
    pickTab('Mã của tôi');
    expect(await screen.findByText('Bạn chưa có mã nào dùng được')).toBeInTheDocument();
    pickTab('Đã dùng–hết hạn');
    expect(await screen.findByText('Chưa có mã đã dùng hoặc hết hạn')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tất cả' })).toBeNull();
  });
});

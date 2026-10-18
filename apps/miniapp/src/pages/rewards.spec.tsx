import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  keySeq: 0,
  params: {} as Record<string, string>,
  location: { pathname: '/', search: '', state: null as unknown },
  auth: { status: 'authenticated' as 'idle' | 'loading' | 'authenticated' | 'error' },
  login: vi.fn(),
  ensurePhone: vi.fn(),
  publicConfig: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } },
  getLoyaltyRewards: vi.fn(),
  redeemLoyaltyReward: vi.fn(),
  getLoyalty: vi.fn(),
  buyTree: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div role="dialog">{children}</div> : null),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
  useParams: () => mocks.params,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/api', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
  isNotFoundError: (e: unknown) => (e as { status?: number } | null)?.status === 404,
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { status: mocks.auth.status, login: mocks.login, ensurePhone: mocks.ensurePhone };
    return sel ? sel(state) : state;
  },
}));
vi.mock('../utils/idempotency', () => ({ newIdempotencyKey: () => `key-${++mocks.keySeq}` }));
vi.mock('../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.publicConfig }));
vi.mock('../services/account-api', async (importOriginal) => {
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getLoyaltyRewards: mocks.getLoyaltyRewards,
    redeemLoyaltyReward: mocks.redeemLoyaltyReward,
    getLoyalty: mocks.getLoyalty,
  };
});
vi.mock('../services/game-api', () => ({ buyTree: mocks.buyTree }));
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  invalidateAfterRedeem: mocks.invalidate,
}));

import RewardsPage, { openingHoursText } from './rewards';
import { makeGiftRedemption, makeRewardCatalog, makeRewardItem } from '../services/waste-test-fixtures';
import { describeNested, findNestedInteractive } from '../components/ui/nested-interactive';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <RewardsPage />
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keySeq = 0;
  mocks.getLoyaltyRewards.mockResolvedValue(makeRewardCatalog());
  mocks.getLoyalty.mockResolvedValue({ pointsBalance: 30_000, pointsConvertedBalance: 5000, lockedPoints: 0, redeemablePoints: 30_000 });
});
const card = (name: string) => screen.getByText(name).closest('[data-reward]') as HTMLElement;

describe('/rewards Kho quà (§4.8)', () => {
  it('số dư tổng hai lô, ghi chú luật, liên kết "Quà của tôi"', async () => {
    renderPage();
    expect(await screen.findByText('35.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('Đổi quà dùng được 30.000 điểm')).toBeInTheDocument();
    expect(screen.getByText('Điểm không hết hạn chỉ dùng khi thanh toán và góp quỹ trồng cây, không dùng để đổi mã giảm giá hay quà.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Quà của tôi/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/rewards/mine');
  });
  it('ba tab theo loại quà', async () => {
    renderPage();
    expect((await screen.findAllByRole('tab')).map((t) => t.textContent)).toEqual(['Mã giảm giá', 'Cây và hạt', 'Quà nhỏ']);
    expect(screen.getByText('Miễn phí vận chuyển')).toBeInTheDocument();
    expect(screen.queryByText('Gói hạt giống Tubu')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Cây và hạt' }));
    expect(screen.getByText('Gói hạt giống Tubu')).toBeInTheDocument();
    expect(screen.getByText('Góp quỹ trồng cây')).toBeInTheDocument();
  });
  it('đủ điểm → nút "Đổi"; thiếu → "Cần thêm N điểm" + thanh tiến độ', async () => {
    renderPage();
    expect(within(await waitFor(() => card('Miễn phí vận chuyển'))).getByRole('button', { name: 'Đổi' })).toBeEnabled();
    const c50 = card('Giảm 50.000đ');
    expect(within(c50).getByText('Cần thêm 20.000 điểm')).toBeInTheDocument();
    expect(within(c50).getByTestId('progress-fill')).toHaveStyle({ width: '60%' });
    expect(within(c50).queryByRole('button', { name: 'Đổi' })).toBeNull();
  });
  it('"Đã hết" theo soldOut của máy chủ: không có thanh tiến độ, không "Cần thêm"', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Quà nhỏ' }));
    const bag = card('Túi vải Tubu');
    expect(within(bag).getByText('Đã hết')).toBeInTheDocument();
    expect(within(bag).queryByTestId('progress-fill')).toBeNull();
    expect(within(bag).queryByText(/Cần thêm/)).toBeNull();
  });
  it('tồn kho và nơi nhận trên thẻ gói hạt', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Cây và hạt' }));
    expect(within(card('Gói hạt giống Tubu')).getByText('Còn 3')).toBeInTheDocument();
    expect(within(card('Gói hạt giống Tubu')).getByText('Nhận tại kho Tubu TP.HCM')).toBeInTheDocument();
  });
  it('xác nhận: điểm còn lại sau đổi; quà nhận ở kho kèm địa chỉ, giờ mở, hạn nhận 60 ngày', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Cây và hạt' }));
    fireEvent.click(within(card('Gói hạt giống Tubu')).getByRole('button', { name: 'Đổi' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('-25.000 điểm')).toBeInTheDocument();
    expect(within(sheet).getByText('10.000 điểm')).toBeInTheDocument();
    expect(within(sheet).getByText('Kho Tubu TP.HCM')).toBeInTheDocument();
    expect(within(sheet).getByText('99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM')).toBeInTheDocument();
    expect(within(sheet).getByText('T2 08:00–17:00')).toBeInTheDocument();
    expect(within(sheet).getByText('Hạn nhận 60 ngày')).toBeInTheDocument();
    expect(mocks.redeemLoyaltyReward).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/hoặc điểm nhận/);
  });
  it('đổi mã giảm giá: một lần dù chạm đúp, có Idempotency-Key, mã vào ví, làm mới khoá', async () => {
    let resolve!: (v: unknown) => void;
    mocks.redeemLoyaltyReward.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();
    fireEvent.click(within(await waitFor(() => card('Miễn phí vận chuyển'))).getByRole('button', { name: 'Đổi' }));
    const ok = within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' });
    fireEvent.click(ok); fireEvent.click(ok);
    resolve({ success: true, message: 'ok', pointsSpent: 20_000, remainingPoints: 10_000, redemption: makeGiftRedemption({ giftKind: 'VOUCHER', status: 'FULFILLED', code: null, couponCode: 'FREESHIP-ABC' }), coupon: { code: 'FREESHIP-ABC', type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, endAt: '2026-11-16T16:59:59.000Z' } });
    expect(await screen.findByText('Mã FREESHIP-ABC đã vào ví mã giảm giá')).toBeInTheDocument();
    expect(mocks.redeemLoyaltyReward).toHaveBeenCalledTimes(1);
    expect(mocks.redeemLoyaltyReward).toHaveBeenCalledWith('reward-freeship', 'key-2');
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });
  it('lỗi mạng: báo câu máy chủ, đổi lại CÙNG quà dùng CÙNG khoá', async () => {
    mocks.redeemLoyaltyReward.mockRejectedValueOnce(new Error('Quà này đã hết hoặc đã ngừng đổi')).mockResolvedValue({ success: true, message: 'ok', pointsSpent: 20_000, remainingPoints: 10_000, redemption: makeGiftRedemption({ giftKind: 'VOUCHER' }), coupon: { code: 'X', type: 'FREESHIP', value: 0, minOrder: null, maxDiscount: null, endAt: '2026-11-16T16:59:59.000Z' } });
    renderPage();
    fireEvent.click(within(await waitFor(() => card('Miễn phí vận chuyển'))).getByRole('button', { name: 'Đổi' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Quà này đã hết hoặc đã ngừng đổi', type: 'error' })));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    await waitFor(() => expect(mocks.redeemLoyaltyReward).toHaveBeenCalledTimes(2));
    expect(mocks.redeemLoyaltyReward.mock.calls.map((c) => c[1])).toEqual(['key-2', 'key-2']);
  });
  it('lỗi mạng, đóng khung rồi mở lại CÙNG quà → vẫn CÙNG khoá (§16.1)', async () => {
    mocks.redeemLoyaltyReward.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue({ success: true, message: 'ok', pointsSpent: 20_000, remainingPoints: 10_000, redemption: makeGiftRedemption({ giftKind: 'VOUCHER' }), coupon: { code: 'X', type: 'FREESHIP', value: 0, minOrder: null, maxDiscount: null, endAt: '2026-11-16T16:59:59.000Z' } });
    renderPage();
    fireEvent.click(within(await waitFor(() => card('Miễn phí vận chuyển'))).getByRole('button', { name: 'Đổi' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(card('Miễn phí vận chuyển')).getByRole('button', { name: 'Đổi' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    await waitFor(() => expect(mocks.redeemLoyaltyReward).toHaveBeenCalledTimes(2));
    const [k1, k2] = mocks.redeemLoyaltyReward.mock.calls.map((c) => c[1]);
    expect(k2).toBe(k1);
  });
  it('gói hạt: kết quả là mã QG- cỡ lớn, hạn nhận, dẫn tới Quà của tôi', async () => {
    mocks.redeemLoyaltyReward.mockResolvedValue({ success: true, message: 'ok', pointsSpent: 25_000, remainingPoints: 5000, redemption: makeGiftRedemption(), coupon: null });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Cây và hạt' }));
    fireEvent.click(within(card('Gói hạt giống Tubu')).getByRole('button', { name: 'Đổi' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    expect(await screen.findByText('QG-8K2M9P4T')).toBeInTheDocument();
    expect(screen.getByText('Hạn nhận 17/12/2026')).toBeInTheDocument();
    expect(screen.getByText('Mang mã này tới kho Tubu TP.HCM để nhận quà')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/hoặc điểm nhận/);
  });
  it('góp quỹ trồng cây đi qua POST /game/tree/buy, không qua đường đổi quà; không hứa cây cụ thể, không mã chứng nhận', async () => {
    mocks.getLoyaltyRewards.mockResolvedValue(makeRewardCatalog({ rewards: [makeRewardItem({ id: 'gift-tree', kind: 'TREE', name: 'Góp quỹ trồng cây', pointsCost: 30_000, canRedeem: true, voucher: null })] }));
    mocks.buyTree.mockResolvedValue({ certificateCode: 'CERT-123', treeType: 'Sao đen', cost: 30_000, pointsUsed: 30_000, pointsUsedConverted: 0 });
    const { container } = renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Cây và hạt' }));
    fireEvent.click(within(card('Góp quỹ trồng cây')).getByRole('button', { name: 'Đổi' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    expect(await screen.findByText('Bạn đã góp một cây vào quỹ trồng cây của Tubu')).toBeInTheDocument();
    expect(mocks.buyTree).toHaveBeenCalledWith('key-2');
    expect(mocks.redeemLoyaltyReward).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/CERT-123|Sao đen/);
  });
  it('đủ điểm nhưng phần đổi được đang khoá → nút "Chờ mở khoá điểm" bị tắt', async () => {
    mocks.getLoyaltyRewards.mockResolvedValue(makeRewardCatalog({ redeemablePoints: 14_000, rewards: [makeRewardItem({ canRedeem: false, pointsCost: 10_000 })] }));
    renderPage();
    const c = await waitFor(() => card('Miễn phí vận chuyển'));
    expect(within(c).getByRole('button', { name: 'Chờ mở khoá điểm' })).toBeDisabled();
    expect(within(c).queryByText(/Cần thêm/)).toBeNull();
  });
  it('openingHoursText: nhiều ngày, nhiều khung giờ', () => {
    expect(openingHoursText({ MON: [{ open: '08:00', close: '12:00' }, { open: '13:00', close: '17:00' }], TUE: [{ open: '08:00', close: '17:00' }] })).toBe('T2 08:00–12:00, 13:00–17:00 · T3 08:00–17:00');
  });
  it('lỗi tải danh mục → ErrorState + Thử lại', async () => {
    mocks.getLoyaltyRewards.mockRejectedValueOnce(new Error('mất mạng')).mockResolvedValue(makeRewardCatalog());
    renderPage();
    expect(await screen.findByText('mất mạng')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Miễn phí vận chuyển')).toBeInTheDocument();
  });
  it('một PageHeader, không lồng nút', async () => {
    const { container } = renderPage();
    await screen.findByText('Miễn phí vận chuyển');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(findNestedInteractive(container).map(describeNested)).toEqual([]);
  });
});

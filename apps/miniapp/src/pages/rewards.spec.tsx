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
  publicConfig: { isLoaded: true, loyalty: undefined as undefined | { maxRedeemPct?: number; pointExpireMonths?: number }, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } },
  getLoyaltyRewards: vi.fn(),
  redeemLoyaltyReward: vi.fn(),
  getLoyalty: vi.fn(),
  buyTree: vi.fn(),
  invalidate: vi.fn(),
  getCart: vi.fn(),
  applyCoupon: vi.fn(),
  coreGet: vi.fn(),
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
vi.mock('../services/core-http', () => ({ coreHttp: { get: mocks.coreGet } }));
vi.mock('../services/game-api', () => ({ buyTree: mocks.buyTree }));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCart: mocks.getCart,
  applyCoupon: mocks.applyCoupon,
}));
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
  mocks.getCart.mockResolvedValue({ itemCount: 0 });
  mocks.applyCoupon.mockResolvedValue({ couponCode: 'FREESHIP-ABC', discount: 0, freeship: true });
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
  it('ghi chú luật dùng điểm từ cấu hình công khai; không hiện khi cấu hình chưa tải', async () => {
    mocks.publicConfig.loyalty = { maxRedeemPct: 0.2, pointExpireMonths: 12 };
    try {
      renderPage();
      expect(await screen.findByText('Điểm Xanh thường dùng tối đa 20% giá trị hàng Tubu trong đơn, không trừ vào phí ship. Điểm Xanh thường có hạn 12 tháng kể từ ngày nhận, điểm cũ được dùng trước.')).toBeInTheDocument();
    } finally {
      mocks.publicConfig.loyalty = undefined;
    }
  });
  it('không lặp số dư: dòng "Đổi quà dùng được" chỉ hiện khi khác tổng', async () => {
    mocks.getLoyaltyRewards.mockResolvedValue(makeRewardCatalog({ pointsBalance: 42_000, pointsConvertedBalance: 0, lockedPoints: 0, redeemablePoints: 42_000 }));
    renderPage();
    expect(await screen.findByText('42.000 điểm')).toBeInTheDocument();
    expect(screen.queryByText(/Đổi quà dùng được/)).toBeNull();
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
  it('thẻ quà: biểu tượng theo loại, giá và nút Đổi cùng một hàng', async () => {
    renderPage();
    const voucher = await waitFor(() => card('Miễn phí vận chuyển'));
    expect(within(voucher).getByTestId('reward-icon').querySelector('svg.lucide-ticket')).not.toBeNull();
    const price = within(voucher).getByText(/điểm$/, { selector: 'div' });
    const button = within(voucher).getByRole('button', { name: 'Đổi' });
    expect(price.parentElement).toBe(button.parentElement);
    fireEvent.click(screen.getByRole('tab', { name: 'Cây và hạt' }));
    expect(within(card('Gói hạt giống Tubu')).getByTestId('reward-icon').querySelector('svg.lucide-leaf')).not.toBeNull();
    expect(within(card('Góp quỹ trồng cây')).getByTestId('reward-icon').querySelector('svg.lucide-sprout')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Quà nhỏ' }));
    expect(within(card('Túi vải Tubu')).getByTestId('reward-icon').querySelector('svg.lucide-gift')).not.toBeNull();
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
  it('đổi lỗi: làm mới danh sách quà để số dư và tồn hiện đúng', async () => {
    mocks.redeemLoyaltyReward.mockRejectedValueOnce(new Error('Quà này đã hết hoặc đã ngừng đổi'));
    const { invalidate } = renderPage();
    fireEvent.click(within(await waitFor(() => card('Miễn phí vận chuyển'))).getByRole('button', { name: 'Đổi' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loyalty-rewards'] });
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
  it('làm mới danh mục sau khi đổi lỗi → vẫn hiện mã QG- (điểm đã trừ), không thay cả trang bằng ErrorState', async () => {
    mocks.redeemLoyaltyReward.mockResolvedValue({ success: true, message: 'ok', pointsSpent: 25_000, remainingPoints: 5000, redemption: makeGiftRedemption(), coupon: null });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Cây và hạt' }));
    fireEvent.click(within(card('Gói hạt giống Tubu')).getByRole('button', { name: 'Đổi' }));
    mocks.getLoyaltyRewards.mockRejectedValue(new Error('mất mạng'));
    mocks.invalidate.mockImplementationOnce((qc: QueryClient) => qc.invalidateQueries({ queryKey: ['loyalty-rewards'] }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    expect(await screen.findByText('QG-8K2M9P4T')).toBeInTheDocument();
    expect(mocks.getLoyaltyRewards).toHaveBeenCalledTimes(2);
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
  it('hạng đã được freeship: quà freeship xuống cuối, ghi rõ hạng, không còn nút Đổi và không còn nhãn "Phổ biến"', async () => {
    mocks.getLoyaltyRewards.mockResolvedValue(
      makeRewardCatalog({
        tierFreeShip: { tierName: 'Lộc Biếc', freeFrom: 99_000 },
        rewards: [
          makeRewardItem({ label: 'Phổ biến' }),
          makeRewardItem({ id: 'reward-discount-50k', name: 'Giảm 50.000đ', pointsCost: 20_000, voucher: { type: 'AMOUNT', value: 50000, minOrder: 300000, maxDiscount: null, validDays: 30 }, sortOrder: 2 }),
        ],
      }),
    );
    renderPage();
    await screen.findByText('Giảm 50.000đ');
    const names = Array.from(document.querySelectorAll('[data-reward]')).map((el) => el.textContent ?? '');
    expect(names[0]).toContain('Giảm 50.000đ');
    expect(names[1]).toContain('Miễn phí vận chuyển');
    const free = card('Miễn phí vận chuyển');
    expect(within(free).getByText('Hạng Lộc Biếc đã được miễn phí giao hàng')).toBeInTheDocument();
    expect(within(free).queryByRole('button', { name: 'Đổi' })).toBeNull();
    expect(within(free).queryByText('Phổ biến')).toBeNull();
    expect(within(card('Giảm 50.000đ')).getByRole('button', { name: 'Đổi' })).toBeEnabled();
  });
  it('hạng chưa freeship tới ngưỡng của mã: quà freeship vẫn đổi được như cũ', async () => {
    mocks.getLoyaltyRewards.mockResolvedValue(makeRewardCatalog({ tierFreeShip: { tierName: 'Mầm Xanh', freeFrom: 199_000 } }));
    renderPage();
    expect(within(await waitFor(() => card('Miễn phí vận chuyển'))).getByRole('button', { name: 'Đổi' })).toBeEnabled();
  });
  it('quà nhận tại kho: thẻ ghi "Chỉ nhận tại kho TP.HCM"; mã giảm giá thì không; xác nhận hỏi lại kèm địa chỉ kho', async () => {
    renderPage();
    expect(within(await waitFor(() => card('Miễn phí vận chuyển'))).queryByText('Chỉ nhận tại kho TP.HCM')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Cây và hạt' }));
    expect(within(card('Gói hạt giống Tubu')).getByText('Chỉ nhận tại kho TP.HCM')).toBeInTheDocument();
    expect(within(card('Góp quỹ trồng cây')).queryByText('Chỉ nhận tại kho TP.HCM')).toBeNull();
    fireEvent.click(within(card('Gói hạt giống Tubu')).getByRole('button', { name: 'Đổi' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/Quà này chỉ nhận tại kho TP\.HCM, không giao tận nhà: Kho Tubu TP\.HCM, 99 Nguyễn Văn Linh, Phường Tân Phong, TP\.HCM\. Bạn vẫn muốn đổi\?/)).toBeInTheDocument();
  });
  it('đổi mã giảm giá xong: "Dùng ngay" khi giỏ có hàng → chọn sẵn mã rồi tới giỏ', async () => {
    mocks.getCart.mockResolvedValue({ itemCount: 2 });
    mocks.redeemLoyaltyReward.mockResolvedValue({ success: true, message: 'ok', pointsSpent: 20_000, remainingPoints: 10_000, redemption: makeGiftRedemption({ giftKind: 'VOUCHER', status: 'FULFILLED', code: null, couponCode: 'FREESHIP-ABC' }), coupon: { code: 'FREESHIP-ABC', type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, endAt: '2026-11-16T16:59:59.000Z' } });
    renderPage();
    await waitFor(() => expect(mocks.getCart).toHaveBeenCalled());
    fireEvent.click(within(await waitFor(() => card('Miễn phí vận chuyển'))).getByRole('button', { name: 'Đổi' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    await screen.findByText('Mã FREESHIP-ABC đã vào ví mã giảm giá');
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
    expect(mocks.applyCoupon).toHaveBeenCalledWith('FREESHIP-ABC');
  });
  it('đổi mã giảm giá xong: "Dùng ngay" khi giỏ trống → tới danh sách sản phẩm, không gọi áp mã', async () => {
    mocks.redeemLoyaltyReward.mockResolvedValue({ success: true, message: 'ok', pointsSpent: 20_000, remainingPoints: 10_000, redemption: makeGiftRedemption({ giftKind: 'VOUCHER', status: 'FULFILLED', code: null, couponCode: 'FREESHIP-ABC' }), coupon: { code: 'FREESHIP-ABC', type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, endAt: '2026-11-16T16:59:59.000Z' } });
    renderPage();
    fireEvent.click(within(await waitFor(() => card('Miễn phí vận chuyển'))).getByRole('button', { name: 'Đổi' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xác nhận đổi' }));
    await screen.findByText('Mã FREESHIP-ABC đã vào ví mã giảm giá');
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/browse'));
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });
  it('khách chưa đăng nhập: xem được quà và giá, có nút "Đăng nhập để đổi", không có nút Đổi, không gọi API của khách', async () => {
    mocks.auth.status = 'idle';
    mocks.coreGet.mockResolvedValue({
      rewards: [makeRewardItem({ canRedeem: false }), makeRewardItem({ id: 'seed', kind: 'SEED_PACK', name: 'Gói hạt giống', pointsCost: 40_000, canRedeem: false })],
      giftClaimDays: 60, claimPoint: null, tiers: [], rates: {}, pointExpireMonths: 12,
    });
    renderPage();
    expect(await screen.findByText('Miễn phí vận chuyển')).toBeInTheDocument();
    expect(screen.getByText('20.000 điểm')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đổi' })).toBeNull();
    expect(mocks.coreGet).toHaveBeenCalledWith('/loyalty/preview');
    expect(mocks.getLoyaltyRewards).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập để đổi' }));
    expect(mocks.login).toHaveBeenCalled();
    mocks.auth.status = 'authenticated';
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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@tubutree/shared-types';

const mocks = vi.hoisted(() => ({
  storage: {} as Record<string, string>,
  post: vi.fn(),
  navigate: vi.fn(),
  cartCount: 0,
  enabled: true,
  configFails: false,
  hangRemove: false,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, title, children, footer }: { visible: boolean; title?: string; children: ReactNode; footer?: ReactNode }) =>
    visible ? (
      <div data-testid="sheet">
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null,
  useNavigate: () => mocks.navigate,
}));
vi.mock('zmp-sdk/apis', () => ({
  getStorage: async ({ keys }: { keys: string[] }) => Object.fromEntries(keys.filter((k) => k in mocks.storage).map((k) => [k, mocks.storage[k]])),
  setStorage: async ({ data }: { data: Record<string, string> }) => {
    Object.assign(mocks.storage, data);
    return {};
  },
  removeStorage: async ({ keys }: { keys: string[] }) => {
    if (mocks.hangRemove) return new Promise(() => {});
    for (const k of keys) delete mocks.storage[k];
    return {};
  },
}));
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { post: mocks.post },
}));
vi.mock('../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicConfig: async () => {
    if (mocks.configFails) throw new Error('config lỗi');
    return { loyalty: { marketplaceClaimEnabled: mocks.enabled } };
  },
}));
vi.mock('../hooks/use-cart-count', () => ({ useCartCount: () => mocks.cartCount }));

import { useAuthStore } from '../store/auth';
import { CouponClaimGate, isGuestUser } from './coupon-claim-gate';
import { PENDING_CLAIM_KEY } from '../services/coupon-claim';
import { getCardGiftNote, setCardGiftNote } from '../services/card-gift-note';

const REAL: AuthUser = { id: 'u1', zaloId: 'z1', phone: '0912345678', role: 'CUSTOMER', referralCode: 'R', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0 } as AuthUser;
const GUEST: AuthUser = { ...REAL, zaloId: 'guest_dev1', phone: null };
const CLAIMED = {
  code: 'SHOPEE-AB12CD34',
  type: 'AMOUNT',
  value: 30000,
  minOrder: 99000,
  maxDiscount: null,
  endAt: '2026-12-31T16:59:59.000Z',
  newCustomerOnly: true,
  alreadyClaimed: false,
};
const httpError = (status: number | undefined, message?: string) => ({
  isHttpError: true,
  ...(status ? { response: { status, data: { message } } } : {}),
});

function setAuth(user: AuthUser | null, status: 'authenticated' | 'idle' | 'loading' = 'authenticated', ensurePhoneOrThrow = vi.fn()) {
  act(() => useAuthStore.setState({ user, status, ensurePhoneOrThrow }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderGate() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CouponClaimGate />
    </QueryClientProvider>,
  );
}

describe('CouponClaimGate — nhận ưu đãi từ thẻ QR hộp hàng (D2-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storage = {};
    mocks.cartCount = 0;
    mocks.hangRemove = false;
    window.history.replaceState({}, '', '/');
  });

  it('mở link ?claim= khi đã đăng nhập Zalo: nhận vào ví, hiện sheet ưu đãi, xoá mã chờ; "Dùng ngay" đi mua sắm', async () => {
    window.history.replaceState({}, '', '/?claim=shopee-ab12cd34');
    mocks.post.mockResolvedValue({ data: CLAIMED });
    setAuth(REAL);
    renderGate();
    expect(await screen.findByText('Bạn nhận được ưu đãi')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith('/coupons/claim', { code: 'SHOPEE-AB12CD34' });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Giảm 30.000đ cho đơn từ 99.000đ')).toBeInTheDocument();
    expect(screen.getByText('Dành cho đơn đầu tiên của bạn tại Tubu Tree.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.storage[PENDING_CLAIM_KEY]).toBeUndefined());
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('trên /points/scan: nút chính là "Tích điểm đơn này" (đóng sheet, không đi mua sắm); "Xem ưu đãi" mới đi mua sắm', async () => {
    window.history.replaceState({}, '', '/points/scan?src=shopee&card=2611&claim=shopee-ab12cd34');
    mocks.post.mockResolvedValue({ data: CLAIMED });
    setAuth(REAL);
    renderGate();
    expect(await screen.findByText('Bạn nhận được ưu đãi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dùng ngay' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tích điểm đơn này' }));
    await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument());
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('trên /points/scan khi cờ tích điểm đơn sàn tắt: giữ "Dùng ngay", không hứa "Tích điểm đơn này"', async () => {
    mocks.enabled = false;
    window.history.replaceState({}, '', '/points/scan?src=shopee&card=2611&claim=SHOPEE-AB12CD34');
    mocks.post.mockResolvedValue({ data: CLAIMED });
    setAuth(REAL);
    renderGate();
    expect(await screen.findByText('Bạn nhận được ưu đãi')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dùng ngay' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Tích điểm đơn này' })).toBeNull();
    mocks.enabled = true;
  });

  it('trên /points/scan khi config lỗi/chưa tải: coi như tắt, giữ "Dùng ngay"', async () => {
    mocks.configFails = true;
    window.history.replaceState({}, '', '/points/scan?src=shopee&card=2611&claim=SHOPEE-AB12CD34');
    mocks.post.mockResolvedValue({ data: CLAIMED });
    setAuth(REAL);
    renderGate();
    expect(await screen.findByText('Bạn nhận được ưu đãi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dùng ngay' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tích điểm đơn này' })).toBeNull();
    mocks.configFails = false;
  });

  it('trên /points/scan: "Xem ưu đãi" đi mua sắm', async () => {
    window.history.replaceState({}, '', '/points/scan?claim=SHOPEE-AB12CD34');
    mocks.post.mockResolvedValue({ data: CLAIMED });
    setAuth(REAL);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Xem ưu đãi' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('trên /points/scan: khách cũ gặp thẻ "chỉ khách mới" thì không mở sheet lỗi, để lại ghi chú nhẹ cho màn tích điểm', async () => {
    window.history.replaceState({}, '', '/points/scan?claim=SHOPEE-AB12CD34');
    mocks.post.mockRejectedValue(httpError(400, 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.'));
    setAuth(REAL);
    renderGate();
    await waitFor(() => expect(getCardGiftNote()).toBe('new-customers-only'));
    expect(screen.queryByTestId('sheet')).toBeNull();
    await waitFor(() => expect(mocks.storage[PENDING_CLAIM_KEY]).toBeUndefined());
    setCardGiftNote(null);
  });

  it('ngoài /points/scan: "chỉ khách mới" vẫn hiện sheet "Chưa nhận được ưu đãi"', async () => {
    window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
    mocks.post.mockRejectedValue(httpError(400, 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.'));
    setAuth(REAL);
    renderGate();
    expect(await screen.findByText('Chưa nhận được ưu đãi')).toBeInTheDocument();
    expect(getCardGiftNote()).toBeNull();
  });

  it.each([
    ['cờ tích điểm đơn sàn tắt', { enabled: false, configFails: false }],
    ['config lỗi', { enabled: true, configFails: true }],
  ])('trên /points/scan khi %s: "chỉ khách mới" vẫn hiện sheet lỗi, không lặng lẽ đóng và không để ghi chú', async (_n, state) => {
    mocks.enabled = state.enabled;
    mocks.configFails = state.configFails;
    window.history.replaceState({}, '', '/points/scan?claim=SHOPEE-AB12CD34');
    mocks.post.mockRejectedValue(httpError(400, 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.'));
    setAuth(REAL);
    renderGate();
    expect(await screen.findByText('Chưa nhận được ưu đãi')).toBeInTheDocument();
    expect(getCardGiftNote()).toBeNull();
    mocks.enabled = true;
    mocks.configFails = false;
  });

  it('giỏ đã có hàng: "Dùng ngay" mở giỏ', async () => {
    window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
    mocks.cartCount = 2;
    mocks.post.mockResolvedValue({ data: { ...CLAIMED, alreadyClaimed: true } });
    setAuth(REAL);
    renderGate();
    expect(await screen.findByText('Ưu đãi đã có trong ví của bạn')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng ngay' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/cart');
  });

  it('tài khoản khách (chưa đăng nhập Zalo): giữ mã trên máy, mời đăng nhập; đăng nhập xong tự nhận', async () => {
    window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
    mocks.post.mockResolvedValue({ data: CLAIMED });
    const ensurePhone = vi.fn(async () => {
      useAuthStore.setState({ user: { ...GUEST, phone: '0912345678' } });
      return '0912345678';
    });
    setAuth(GUEST, 'authenticated', ensurePhone);
    renderGate();
    expect(await screen.findByText('Đăng nhập Zalo để nhận ưu đãi')).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập bằng Zalo' }));
    expect(await screen.findByText('Bạn nhận được ưu đãi')).toBeInTheDocument();
    expect(ensurePhone).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('khách từ chối đăng nhập: báo chưa đăng nhập được, mã vẫn giữ để lần sau', async () => {
    window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
    setAuth(GUEST, 'authenticated', vi.fn().mockResolvedValue(null));
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập bằng Zalo' }));
    expect(await screen.findByText('Chưa đăng nhập được. Bạn thử lại nhé.')).toBeInTheDocument();
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument());
  });

  it('liên kết Zalo bị máy chủ từ chối (409): sheet nói lời máy chủ, mã vẫn giữ trên máy', async () => {
    window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
    setAuth(GUEST, 'authenticated', vi.fn().mockRejectedValue(httpError(409, 'Số điện thoại này đã gắn với tài khoản Zalo khác.')));
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập bằng Zalo' }));
    expect(await screen.findByText('Số điện thoại này đã gắn với tài khoản Zalo khác.')).toBeInTheDocument();
    expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34');
  });

  it('lần mở sau (không còn link) đã đăng nhập: mã chờ trên máy tự vào ví', async () => {
    mocks.storage[PENDING_CLAIM_KEY] = 'SHOPEE-AB12CD34';
    mocks.post.mockResolvedValue({ data: CLAIMED });
    setAuth(REAL);
    renderGate();
    expect(await screen.findByText('Bạn nhận được ưu đãi')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledWith('/coupons/claim', { code: 'SHOPEE-AB12CD34' });
  });

  it('chưa có phiên (đang khôi phục): chưa gọi máy chủ, chỉ lưu mã', async () => {
    window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
    setAuth(null, 'loading');
    renderGate();
    await waitFor(() => expect(mocks.storage[PENDING_CLAIM_KEY]).toBe('SHOPEE-AB12CD34'));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sheet')).not.toBeInTheDocument();
  });

  it('thẻ đã có người khác nhận: báo đúng lý do của máy chủ, bỏ mã chờ, chỉ còn nút Đã hiểu', async () => {
    window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
    mocks.post.mockRejectedValue(httpError(400, 'Mã giảm giá này đã được tài khoản khác nhận.'));
    setAuth(REAL);
    renderGate();
    expect(await screen.findByText('Mã giảm giá này đã được tài khoản khác nhận.')).toBeInTheDocument();
    expect(screen.getByText('Chưa nhận được ưu đãi')).toBeInTheDocument();
    await waitFor(() => expect(mocks.storage[PENDING_CLAIM_KEY]).toBeUndefined());
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đã hiểu' })).toBeInTheDocument();
  });

  it('mất mạng: giữ mã chờ, cho thử lại; thử lại thành công thì hiện ưu đãi', async () => {
    window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
    mocks.post.mockRejectedValueOnce(httpError(undefined)).mockResolvedValueOnce({ data: CLAIMED });
    setAuth(REAL);
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Bạn nhận được ưu đãi')).toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('không có link và không có mã chờ: không hiện gì, không gọi máy chủ', async () => {
    setAuth(REAL);
    renderGate();
    await act(async () => {});
    expect(screen.queryByTestId('sheet')).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  describe('khoá khi đang bận, báo lỗi, số đều (W63A)', () => {
    const CLAIMING_LINE = 'Tubu Tree đang thêm ưu đãi từ thẻ của bạn vào ví.';

    it('đang nhận mã: nút Đóng và phím Esc không đóng sheet; nhận xong vẫn hiện ưu đãi rồi mới đóng được', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      const claim = deferred<{ data: typeof CLAIMED }>();
      mocks.post.mockReturnValue(claim.promise);
      setAuth(REAL);
      renderGate();
      expect(await screen.findByText(CLAIMING_LINE)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByText(CLAIMING_LINE)).toBeInTheDocument();
      await act(async () => claim.resolve({ data: CLAIMED }));
      expect(await screen.findByText('Bạn nhận được ưu đãi')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
      await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument());
    });

    it('đang đăng nhập: "Để sau" bị khoá, nút Đóng và Esc không đóng sheet; đăng nhập xong thì đóng được', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      const login = deferred<string | null>();
      setAuth(GUEST, 'authenticated', vi.fn(() => login.promise));
      renderGate();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập bằng Zalo' }));
      expect(screen.getByRole('button', { name: 'Để sau' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByText('Đăng nhập Zalo để nhận ưu đãi')).toBeInTheDocument();
      await act(async () => login.resolve(null));
      expect(await screen.findByText('Chưa đăng nhập được. Bạn thử lại nhé.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Để sau' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
      await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument());
    });

    it('bấm "Để sau" ngay trong lúc React chưa vẽ lại cờ đăng nhập: ref chặn, sheet không đóng', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      const login = deferred<string | null>();
      const ensurePhone = vi.fn(() => login.promise);
      setAuth(GUEST, 'authenticated', ensurePhone);
      renderGate();
      const loginBtn = await screen.findByRole('button', { name: 'Đăng nhập bằng Zalo' });
      const laterBtn = screen.getByRole('button', { name: 'Để sau' });
      act(() => {
        loginBtn.click();
        laterBtn.click();
      });
      expect(ensurePhone).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Đăng nhập Zalo để nhận ưu đãi')).toBeInTheDocument();
      await act(async () => login.resolve(null));
      expect(await screen.findByText('Chưa đăng nhập được. Bạn thử lại nhé.')).toBeInTheDocument();
    });

    it('thẻ bị từ chối: dòng lý do là role="alert" (duy nhất), chữ không đổi số đều', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      mocks.post.mockRejectedValue(httpError(400, 'Mã giảm giá này đã được tài khoản khác nhận.'));
      setAuth(REAL);
      renderGate();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Mã giảm giá này đã được tài khoản khác nhận.');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getByText('Mã giảm giá này đã được tài khoản khác nhận.').style.fontVariantNumeric).toBe('');
    });

    it('chưa đăng nhập được: chỉ dòng lỗi đăng nhập là role="alert" tông danger, câu mời đăng nhập thì không', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      setAuth(GUEST, 'authenticated', vi.fn().mockResolvedValue(null));
      renderGate();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập bằng Zalo' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Chưa đăng nhập được. Bạn thử lại nhé.');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getByText('Chưa đăng nhập được. Bạn thử lại nhé.').style.color).toBe('var(--color-text-danger)');
      const intro = screen.getByText(/Ưu đãi từ thẻ trong hộp hàng dành cho tài khoản Zalo/);
      expect(intro.closest('[role="alert"]')).toBeNull();
      expect(intro.style.color).toBe('var(--color-text-primary)');
      expect(intro.style.fontVariantNumeric).toBe('');
      expect(screen.getByText('Chưa đăng nhập được. Bạn thử lại nhé.').style.fontVariantNumeric).toBe('');
    });

    it('xoá mã chờ treo (bridge ZMP không trả lời): nhận xong vẫn hiện ưu đãi và đóng được, sheet không kẹt', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      mocks.hangRemove = true;
      mocks.post.mockResolvedValue({ data: CLAIMED });
      setAuth(REAL);
      renderGate();
      expect(await screen.findByText('Bạn nhận được ưu đãi')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
      await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument());
    });

    it('xoá mã chờ treo: thẻ bị từ chối vẫn hiện lý do, không kẹt ở "Đang nhận ưu đãi"', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      mocks.hangRemove = true;
      mocks.post.mockRejectedValue(httpError(400, 'Mã giảm giá này đã được tài khoản khác nhận.'));
      setAuth(REAL);
      renderGate();
      expect(await screen.findByRole('alert')).toHaveTextContent('Mã giảm giá này đã được tài khoản khác nhận.');
      fireEvent.click(screen.getByRole('button', { name: 'Đã hiểu' }));
      await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument());
    });

    it('xoá mã chờ treo trên /points/scan: khách cũ gặp thẻ "chỉ khách mới" vẫn được ghi chú nhẹ, sheet không kẹt', async () => {
      window.history.replaceState({}, '', '/points/scan?claim=SHOPEE-AB12CD34');
      mocks.hangRemove = true;
      mocks.post.mockRejectedValue(httpError(400, 'Mã này chỉ dành cho khách đặt đơn đầu tiên tại Tubu Tree.'));
      setAuth(REAL);
      renderGate();
      await waitFor(() => expect(getCardGiftNote()).toBe('new-customers-only'));
      expect(screen.queryByTestId('sheet')).toBeNull();
      await act(async () => {});
      expect(mocks.post).toHaveBeenCalledTimes(1);
      setCardGiftNote(null);
    });

    it('đăng nhập lại sau lỗi: dòng lỗi cũ mất trong lúc chờ, lỗi lần hai dựng thẻ alert mới để được đọc lại', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      const second = deferred<string | null>();
      const ensurePhone = vi.fn().mockResolvedValueOnce(null).mockImplementationOnce(() => second.promise);
      setAuth(GUEST, 'authenticated', ensurePhone);
      renderGate();
      fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập bằng Zalo' }));
      const first = await screen.findByRole('alert');
      fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập bằng Zalo' }));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText('Chưa đăng nhập được. Bạn thử lại nhé.')).toBeNull();
      await act(async () => second.resolve(null));
      const again = await screen.findByRole('alert');
      expect(again).toHaveTextContent('Chưa đăng nhập được. Bạn thử lại nhé.');
      expect(again).not.toBe(first);
      expect(ensurePhone).toHaveBeenCalledTimes(2);
    });

    it('mời đăng nhập khi chưa có lỗi: không có role="alert"', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      setAuth(GUEST);
      renderGate();
      expect(await screen.findByText('Đăng nhập Zalo để nhận ưu đãi')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('đang nhận mã: câu giải thích không là alert và không đổi số đều', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      mocks.post.mockReturnValue(new Promise(() => {}));
      setAuth(REAL);
      renderGate();
      const line = await screen.findByText(CLAIMING_LINE);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(line.style.fontVariantNumeric).toBe('');
    });

    it('ưu đãi đã nhận: mức giảm và hạn dùng dùng số đều, không có role="alert"', async () => {
      window.history.replaceState({}, '', '/?claim=SHOPEE-AB12CD34');
      mocks.post.mockResolvedValue({ data: CLAIMED });
      setAuth(REAL);
      renderGate();
      const offer = await screen.findByText('Giảm 30.000đ cho đơn từ 99.000đ');
      expect(offer.style.fontVariantNumeric).toBe('tabular-nums');
      expect(screen.getByText(/Hạn dùng đến 31\/12\/2026/).style.fontVariantNumeric).toBe('tabular-nums');
      expect(screen.getByText('Dành cho đơn đầu tiên của bạn tại Tubu Tree.').style.fontVariantNumeric).toBe('tabular-nums');
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('isGuestUser khớp luật khách thật của máy chủ', () => {
    expect(isGuestUser(REAL)).toBe(false);
    expect(isGuestUser(GUEST)).toBe(true);
    expect(isGuestUser({ phone: '0912345678', zaloId: 'guest_dev1' })).toBe(false);
    expect(isGuestUser({ phone: null, zaloId: null })).toBe(true);
  });
});

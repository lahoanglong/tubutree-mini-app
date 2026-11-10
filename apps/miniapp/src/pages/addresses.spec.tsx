import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAddresses: vi.fn(),
  updateAddress: vi.fn(),
  deleteAddress: vi.fn(),
  openSnackbar: vi.fn(),
  authStatus: 'authenticated' as string,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/addresses', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({ getAddresses: mocks.getAddresses }));
vi.mock('../services/account-api', () => ({ updateAddress: mocks.updateAddress, deleteAddress: mocks.deleteAddress }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../components/address-form', () => ({
  AddressForm: ({ initial, onSaved }: { initial: { id: string } | null; onSaved: (a: unknown) => void }) => (
    <div>
      form
      <button type="button" onClick={() => onSaved({ ...initial, ward: 'P2' })}>
        Lưu thử
      </button>
    </div>
  ),
}));

import AddressesPage from './addresses';
import { haptic } from '../utils/haptic';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
import { HttpError } from '../services/http';

const ADDR = {
  id: 'a1', recipient: 'Lan', phone: '0900000000', street: '1 Lê Lợi', ward: 'P1', district: 'Q1', province: 'HCM', isDefault: false,
};

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function renderPage(qc = newClient()) {
  return render(<QueryClientProvider client={qc}><AddressesPage /></QueryClientProvider>);
}

describe('Sổ địa chỉ: nút hành động (C-078)', () => {
  // Trong một worker jsdom, lần dựng và truy vấn đầu tiên (khởi động lạnh) tốn hàng trăm ms và chạy ngay trong lần gọi đầu của lệnh chờ,
  // ăn mất ngân sách 1 giây của nó: ca đầu file rớt ngẫu nhiên khi máy bận. Chạy trước một vòng ở đây để chi phí rơi vào hook; hạn 8 giây
  // chỉ để vòng khởi động này không tự rớt, không nới lệnh chờ của ca nào.
  beforeAll(async () => {
    mocks.getAddresses.mockResolvedValue([ADDR]);
    const { unmount } = renderPage();
    await screen.findByRole('button', { name: 'Đặt mặc định' }, { timeout: 8000 });
    unmount();
  }, 20_000);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAddresses.mockResolvedValue([ADDR]);
    mocks.updateAddress.mockResolvedValue({});
  });

  it('Đặt mặc định / Sửa / Xoá là nút thật, vùng chạm tối thiểu 44x44 (R2-BUYERMINI-12)', async () => {
    renderPage();
    for (const name of ['Đặt mặc định', 'Sửa', 'Xoá']) {
      const btn = await screen.findByRole('button', { name });
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.style.minHeight).toBe('44px');
      expect(btn.style.minWidth).toBe('44px');
    }
  });

  it('bấm Đặt mặc định gọi API', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt mặc định' }));
    await waitFor(() => expect(mocks.updateAddress).toHaveBeenCalledWith('a1', { isDefault: true }));
  });

  it('bấm Xoá mở hộp xác nhận', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá' }));
    expect(await screen.findByText('Xoá địa chỉ này?')).toBeInTheDocument();
  });
});

describe('Sổ địa chỉ: khung trang DS v2 (C-076, C-114)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getAddresses.mockResolvedValue([ADDR]);
    mocks.updateAddress.mockResolvedValue({});
    mocks.deleteAddress.mockResolvedValue({});
  });

  it('đúng một h1 "Sổ địa chỉ" ở mọi trạng thái: đang tải, có địa chỉ, trống, lỗi', async () => {
    mocks.authStatus = 'loading';
    const loading = renderPage();
    expect(mocks.getAddresses).not.toHaveBeenCalled();
    expect(loading.container.querySelectorAll('.tubu-skeleton').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sổ địa chỉ');
    loading.unmount();

    mocks.authStatus = 'authenticated';
    const list = renderPage();
    await screen.findByText(/Lan · 0900000000/);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    list.unmount();

    mocks.getAddresses.mockResolvedValue([]);
    const empty = renderPage();
    await screen.findByText('Bạn chưa có địa chỉ giao hàng nào');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    empty.unmount();

    mocks.getAddresses.mockRejectedValue(new Error('boom'));
    renderPage();
    await screen.findByRole('button', { name: 'Thử lại' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('lỗi tải: "Thử lại" gọi lại API', async () => {
    mocks.getAddresses.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([ADDR]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Lan · 0900000000/)).toBeInTheDocument();
  });

  it('địa chỉ mặc định có nhãn "Mặc định" và không có nút "Đặt mặc định"', async () => {
    mocks.getAddresses.mockResolvedValue([{ ...ADDR, isDefault: true }]);
    renderPage();
    await screen.findByText(/Lan · 0900000000/);
    expect(screen.getByText('Mặc định')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đặt mặc định' })).toBeNull();
  });

  it('"Thêm địa chỉ mới" mở khung có tiêu đề h2 "Thêm địa chỉ"; "Sửa" mở khung "Sửa địa chỉ"', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm địa chỉ mới' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Thêm địa chỉ' })).toBeInTheDocument();
    expect(screen.getByText('form')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Sửa địa chỉ' })).toBeInTheDocument();
  });

  it('xác nhận xoá: "Huỷ" đóng khung và không gọi API', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá' }));
    const dialogTitle = await screen.findByRole('heading', { level: 2, name: 'Xoá địa chỉ này?' });
    expect(dialogTitle).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByText('Xoá địa chỉ này?')).toBeNull();
    expect(mocks.deleteAddress).not.toHaveBeenCalled();
  });

  it('xác nhận xoá: "Xoá" trong khung gọi deleteAddress đúng id, báo thành công và đóng khung', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá' }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Xoá địa chỉ này?' });
    const sheet = title.closest('[data-testid="page"] > div') as HTMLElement;
    fireEvent.click(within(sheet).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã xoá địa chỉ.', type: 'success' }));
    await waitFor(() => expect(screen.queryByText('Xoá địa chỉ này?')).toBeNull());
  });
});

describe('Sổ địa chỉ: đổi địa chỉ thì báo giá thanh toán đang lưu phải tính lại (W33)', () => {
  // Báo giá của trang thanh toán giữ 10 giây (staleTime). Khách sửa địa chỉ rồi quay lại trong 10 giây mà báo giá không bị đánh dấu cũ
  // thì trang vẫn hiện phí ship theo địa chỉ trước, và lúc đặt máy chủ báo tổng tiền đổi.
  const QUOTE_KEY = ['quote', 'a1', 0, null, 'i1'];
  const QUOTE_STALE_MS = 10_000;
  const reopenCheckout = (qc: QueryClient, queryFn: () => Promise<unknown>) =>
    qc.fetchQuery({ queryKey: QUOTE_KEY, queryFn, staleTime: QUOTE_STALE_MS });

  let qc: QueryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAddresses.mockResolvedValue([ADDR]);
    mocks.updateAddress.mockResolvedValue({});
    mocks.deleteAddress.mockResolvedValue({});
    qc = newClient();
    qc.setQueryData(QUOTE_KEY, { shippingFee: 20_000, total: 70_000 });
  });

  it('chứng: không đổi gì thì quay lại thanh toán dùng lại báo giá đang lưu', async () => {
    const quoteFn = vi.fn().mockResolvedValue({ shippingFee: 30_000, total: 80_000 });
    renderPage(qc);
    await screen.findByRole('button', { name: 'Sửa' });
    await expect(reopenCheckout(qc, quoteFn)).resolves.toEqual({ shippingFee: 20_000, total: 70_000 });
    expect(quoteFn).not.toHaveBeenCalled();
  });

  it('sửa địa chỉ xong → quay lại thanh toán trong 10 giây là báo giá được tính lại', async () => {
    const quoteFn = vi.fn().mockResolvedValue({ shippingFee: 30_000, total: 80_000 });
    renderPage(qc);
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thử' }));
    await waitFor(() => expect(screen.queryByText('form')).toBeNull());
    await expect(reopenCheckout(qc, quoteFn)).resolves.toEqual({ shippingFee: 30_000, total: 80_000 });
    expect(quoteFn).toHaveBeenCalledTimes(1);
  });

  it('thêm địa chỉ, đặt mặc định, xoá địa chỉ → báo giá đang lưu cũng bị tính lại', async () => {
    renderPage(qc);
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm địa chỉ mới' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thử' }));
    await waitFor(() => expect(qc.getQueryState(QUOTE_KEY)?.isInvalidated).toBe(true));

    qc.setQueryData(QUOTE_KEY, { shippingFee: 20_000, total: 70_000 });
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt mặc định' }));
    await waitFor(() => expect(mocks.updateAddress).toHaveBeenCalled());
    await waitFor(() => expect(qc.getQueryState(QUOTE_KEY)?.isInvalidated).toBe(true));

    qc.setQueryData(QUOTE_KEY, { shippingFee: 20_000, total: 70_000 });
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá' }));
    const title = await screen.findByRole('heading', { level: 2, name: 'Xoá địa chỉ này?' });
    fireEvent.click(within(title.closest('[data-testid="page"] > div') as HTMLElement).getByRole('button', { name: 'Xoá' }));
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledWith('a1'));
    await waitFor(() => expect(qc.getQueryState(QUOTE_KEY)?.isInvalidated).toBe(true));
  });
});

describe('Sổ địa chỉ: Đặt mặc định và Xoá khoá chạm đúp (W76A)', () => {
  const ADDR2 = { ...ADDR, id: 'a2', recipient: 'Mai' };
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const successToasts = () => mocks.openSnackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'success');
  // Mở khung xác nhận xoá của địa chỉ thứ `index` rồi trả nút "Xoá" trong khung.
  const openDelete = async (index = 0) => {
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xoá' }))[index]!);
    const title = await screen.findByRole('heading', { level: 2, name: 'Xoá địa chỉ này?' });
    return within(title.closest('[data-testid="page"] > div') as HTMLElement).getByRole('button', { name: 'Xoá' });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getAddresses.mockResolvedValue([ADDR]);
    mocks.updateAddress.mockResolvedValue({});
    mocks.deleteAddress.mockResolvedValue({});
  });

  it('chạm đúp "Đặt mặc định" trong cùng một khung hình chỉ gọi API một lần', async () => {
    const d = deferred();
    mocks.updateAddress.mockReturnValueOnce(d.promise);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đặt mặc định' });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({}));
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('đang đặt mặc định: nút aria-busy mà không bị disabled (giữ focus), xong thì hết busy', async () => {
    const d = deferred();
    mocks.updateAddress.mockReturnValueOnce(d.promise);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đặt mặc định' });
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveFocus();
    await act(async () => d.resolve({}));
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
  });

  it('đặt mặc định lỗi thì báo lỗi, nhả khoá, bấm lại gọi lần hai', async () => {
    mocks.updateAddress.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt mặc định' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    fireEvent.click(screen.getByRole('button', { name: 'Đặt mặc định' }));
    await waitFor(() => expect(mocks.updateAddress).toHaveBeenCalledTimes(2));
  });

  it('hai địa chỉ khác nhau đặt mặc định trong một khung hình: cả hai cùng đi, chỉ nút của địa chỉ đang gửi báo busy', async () => {
    const d1 = deferred();
    const d2 = deferred();
    mocks.getAddresses.mockResolvedValue([ADDR, ADDR2]);
    mocks.updateAddress.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    renderPage();
    const [first, second] = await screen.findAllByRole('button', { name: 'Đặt mặc định' });
    await act(async () => {
      fireEvent.click(first!);
      fireEvent.click(second!);
    });
    expect(mocks.updateAddress.mock.calls).toEqual([['a1', { isDefault: true }], ['a2', { isDefault: true }]]);
    await act(async () => {
      d1.resolve({});
      d2.resolve({});
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(3));
  });

  it('chỉ nút của địa chỉ đang đặt mặc định báo busy, địa chỉ kia vẫn bấm được', async () => {
    const d = deferred();
    mocks.getAddresses.mockResolvedValue([ADDR, ADDR2]);
    mocks.updateAddress.mockReturnValueOnce(d.promise);
    renderPage();
    const [first, second] = await screen.findAllByRole('button', { name: 'Đặt mặc định' });
    fireEvent.click(first!);
    await waitFor(() => expect(first).toHaveAttribute('aria-busy', 'true'));
    expect(second).not.toHaveAttribute('aria-busy');
    expect(second).not.toBeDisabled();
    await act(async () => d.resolve({}));
  });

  it('chạm đúp "Xoá" trong khung xác nhận trong cùng một khung hình chỉ xoá một lần', async () => {
    const d = deferred();
    mocks.deleteAddress.mockReturnValueOnce(d.promise);
    renderPage();
    const del = await openDelete();
    await act(async () => {
      fireEvent.click(del);
      fireEvent.click(del);
    });
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(del).toHaveAttribute('aria-busy', 'true'));
    await act(async () => d.resolve({}));
    await waitFor(() => expect(screen.queryByText('Xoá địa chỉ này?')).toBeNull());
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    expect(successToasts()).toHaveLength(1);
  });

  it('xoá lỗi thì báo lỗi, giữ khung, nhả khoá, bấm lại xoá lần hai', async () => {
    mocks.deleteAddress.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    renderPage();
    const del = await openDelete();
    fireEvent.click(del);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(screen.getByText('Xoá địa chỉ này?')).toBeInTheDocument();
    fireEvent.click(del);
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Xoá địa chỉ này?')).toBeNull());
  });

  it('Đặt mặc định rồi Xoá cùng một địa chỉ trong một khung hình chỉ gửi lệnh đầu; xong thì nhả khoá', async () => {
    const d = deferred();
    mocks.updateAddress.mockReturnValueOnce(d.promise);
    renderPage();
    const setDefault = await screen.findByRole('button', { name: 'Đặt mặc định' });
    const del = await openDelete();
    await act(async () => {
      fireEvent.click(setDefault);
      fireEvent.click(del);
    });
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
    expect(mocks.deleteAddress).not.toHaveBeenCalled();
    await waitFor(() => expect(del).toHaveAttribute('aria-busy', 'true'));
    await act(async () => d.resolve({}));
    await waitFor(() => expect(del).not.toHaveAttribute('aria-busy'));
    fireEvent.click(del);
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledWith('a1'));
  });

  it('Xoá rồi Đặt mặc định cùng một địa chỉ trong một khung hình chỉ gửi lệnh xoá', async () => {
    const d = deferred();
    mocks.deleteAddress.mockReturnValueOnce(d.promise);
    renderPage();
    const setDefault = await screen.findByRole('button', { name: 'Đặt mặc định' });
    const del = await openDelete();
    await act(async () => {
      fireEvent.click(del);
      fireEvent.click(setDefault);
    });
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    expect(mocks.updateAddress).not.toHaveBeenCalled();
    await waitFor(() => expect(setDefault).toHaveAttribute('aria-busy', 'true'));
    await act(async () => d.resolve({}));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã xoá địa chỉ.', type: 'success' }));
    expect(mocks.updateAddress).not.toHaveBeenCalled();
  });

  it('Đặt mặc định địa chỉ này và Xoá địa chỉ khác trong một khung hình: cả hai cùng đi', async () => {
    const d = deferred();
    mocks.getAddresses.mockResolvedValue([ADDR, ADDR2]);
    mocks.updateAddress.mockReturnValueOnce(d.promise);
    renderPage();
    const [setDefaultFirst] = await screen.findAllByRole('button', { name: 'Đặt mặc định' });
    const del = await openDelete(1);
    await act(async () => {
      fireEvent.click(setDefaultFirst!);
      fireEvent.click(del);
    });
    expect(mocks.updateAddress).toHaveBeenCalledWith('a1', { isDefault: true });
    expect(mocks.deleteAddress).toHaveBeenCalledWith('a2');
    await act(async () => d.resolve({}));
  });
});

describe('Sổ địa chỉ: khoá giữ tới khi danh sách tải lại xong, có hạn chờ (W88A)', () => {
  const ADDR2 = { ...ADDR, id: 'a2', recipient: 'Mai' };
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const never = () => new Promise<unknown[]>(() => undefined);
  // Chuỗi lệnh của react-query chạy lệch vài ms giờ giả so với lúc bấm, và trạng thái bận tới React qua bộ đếm giờ 0ms: nên "tới hạn" là hạn cộng biên nhỏ rồi xả thêm vài nhịp.
  const pastCap = async () => {
    await vi.advanceTimersByTimeAsync(50);
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
  };
  // Mở khung xác nhận xoá của địa chỉ thứ `index` rồi trả nút "Xoá" trong khung.
  const openDelete = async (index = 0) => {
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xoá' }))[index]!);
    const title = await screen.findByRole('heading', { level: 2, name: 'Xoá địa chỉ này?' });
    return within(title.closest('[data-testid="page"] > div') as HTMLElement).getByRole('button', { name: 'Xoá' });
  };
  const cardOfA = () => screen.queryByText(/Lan · 0900000000/);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getAddresses.mockReset();
    mocks.updateAddress.mockReset().mockResolvedValue({});
    mocks.deleteAddress.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('đặt mặc định xong mà danh sách mới chưa về: nút vẫn báo bận, chạm tiếp không gọi API lần hai; danh sách về thì thẻ thành Mặc định', async () => {
    const refetch = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR]).mockReturnValueOnce(refetch.promise);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đặt mặc định' });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
    await act(async () => refetch.resolve([{ ...ADDR, isDefault: true }]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đặt mặc định' })).toBeNull());
    expect(screen.getByText('Mặc định')).toBeInTheDocument();
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
  });

  it('xoá xong mà danh sách mới chưa về: thẻ địa chỉ đã xoá biến mất ngay, không còn nút Đặt mặc định / Sửa / Xoá của nó, địa chỉ kia còn nguyên', async () => {
    const refetch = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockReturnValueOnce(refetch.promise);
    renderPage();
    const del = await openDelete(0);
    await act(async () => {
      fireEvent.click(del);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(mocks.deleteAddress).toHaveBeenCalledWith('a1');
    expect(cardOfA()).toBeNull();
    expect(screen.getByText(/Mai · 0900000000/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Đặt mặc định' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Sửa' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Xoá' })).toHaveLength(1);
    await act(async () => refetch.resolve([ADDR2]));
    expect(cardOfA()).toBeNull();
    expect(mocks.updateAddress).not.toHaveBeenCalled();
  });

  it('xoá xong mà tải lại danh sách lỗi: thẻ đã xoá vẫn không quay lại', async () => {
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockRejectedValueOnce(new Error('offline'));
    renderPage();
    const del = await openDelete(0);
    await act(async () => {
      fireEvent.click(del);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(cardOfA()).toBeNull();
    expect(screen.getByText(/Mai · 0900000000/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Đặt mặc định' })).toHaveLength(1);
  });

  it('xoá A rồi đặt mặc định B trước khi lần tải lại của A về (lần sau huỷ lần trước): A vẫn vắng mặt ở mọi bước', async () => {
    const afterDelete = deferred<unknown[]>();
    const afterDefault = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockReturnValueOnce(afterDelete.promise).mockReturnValueOnce(afterDefault.promise);
    renderPage();
    const del = await openDelete(0);
    await act(async () => {
      fireEvent.click(del);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(cardOfA()).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Đặt mặc định' }));
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(3));
    expect(mocks.updateAddress).toHaveBeenCalledWith('a2', { isDefault: true });
    expect(cardOfA()).toBeNull();
    await act(async () => afterDelete.resolve([ADDR, ADDR2]));
    expect(cardOfA()).toBeNull();
    await act(async () => afterDefault.resolve([{ ...ADDR2, isDefault: true }]));
    expect(await screen.findByText('Mặc định')).toBeInTheDocument();
    expect(cardOfA()).toBeNull();
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
  });

  it('tải lại danh sách treo mãi: khoá đặt mặc định nhả đúng sau LOCK_REFRESH_WAIT_MS, chưa tới hạn thì chạm tiếp bị từ chối', async () => {
    mocks.getAddresses.mockResolvedValueOnce([ADDR]).mockReturnValueOnce(never()).mockResolvedValue([ADDR]);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đặt mặc định' });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.getAddresses).toHaveBeenCalledTimes(2);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
      fireEvent.click(btn);
    });
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await pastCap();
    });
    expect(btn).not.toHaveAttribute('aria-busy');
    await act(async () => {
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.updateAddress).toHaveBeenCalledTimes(2);
  });

  it('tải lại danh sách treo mãi: khoá xoá nhả đúng sau LOCK_REFRESH_WAIT_MS (nút Xoá của thẻ khác bị khoá tới lúc đó)', async () => {
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockReturnValueOnce(never()).mockResolvedValue([ADDR2]);
    renderPage();
    const del = await openDelete(0);
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(del);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    const otherDelete = screen.getByRole('button', { name: 'Xoá' });
    expect(otherDelete).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
    });
    expect(otherDelete).toBeDisabled();
    await act(async () => {
      await pastCap();
    });
    expect(otherDelete).not.toBeDisabled();
  });
});

describe('Sổ địa chỉ: kiểm hồi quy khoá sau lỗi tải lại (đã đúng từ trước W88A, không chứng minh sửa của wave này)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getAddresses.mockReset();
    mocks.updateAddress.mockReset().mockResolvedValue({});
  });

  it('tải lại danh sách lỗi thì khoá vẫn nhả: nút hết bận, bấm lại gửi được', async () => {
    mocks.getAddresses.mockResolvedValueOnce([ADDR]).mockRejectedValueOnce(new Error('offline')).mockResolvedValue([ADDR]);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đặt mặc định' });
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mocks.updateAddress).toHaveBeenCalledTimes(2);
  });
});

describe('Sổ địa chỉ: máy chủ từ chối vì sổ không còn khớp thì tải lại rồi mới nhả khoá (W108A)', () => {
  const ADDR2 = { ...ADDR, id: 'a2', recipient: 'Mai' };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };
  const never = () => new Promise<unknown[]>(() => undefined);
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'error');
  const pastCap = async () => {
    await vi.advanceTimersByTimeAsync(50);
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
  };
  const openDelete = async (index = 0) => {
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xoá' }))[index]!);
    const title = await screen.findByRole('heading', { level: 2, name: 'Xoá địa chỉ này?' });
    return within(title.closest('[data-testid="page"] > div') as HTMLElement).getByRole('button', { name: 'Xoá' });
  };
  const cardOfA = () => screen.queryByText(/Lan · 0900000000/);
  const TEMPORARY: [string, unknown][] = [
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['máy chủ lỗi 500', serverError('Internal Server Error', 500)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
    ['lỗi không phải HTTP', new Error('boom')],
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getAddresses.mockReset();
    mocks.updateAddress.mockReset().mockResolvedValue({});
    mocks.deleteAddress.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([400, 409])('đặt mặc định bị từ chối %i: báo lỗi một lần, tải lại danh sách, nút bận tới khi danh sách về rồi mới nhận cú chạm mới', async (status) => {
    const refetch = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR]).mockReturnValueOnce(refetch.promise).mockResolvedValue([ADDR]);
    mocks.updateAddress.mockRejectedValueOnce(serverError('Không đặt mặc định được.', status)).mockResolvedValue({});
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đặt mặc định' });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(errorToasts()).toHaveLength(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
    await act(async () => refetch.resolve([ADDR]));
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    expect(errorToasts()).toHaveLength(1);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.updateAddress).toHaveBeenCalledTimes(2));
  });

  it('đặt mặc định bị 404 (địa chỉ đã xoá ở máy khác): thẻ biến mất ngay, không đợi danh sách mới, địa chỉ kia còn nguyên', async () => {
    const refetch = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockReturnValueOnce(refetch.promise);
    mocks.updateAddress.mockRejectedValueOnce(serverError('Không tìm thấy địa chỉ.', 404));
    renderPage();
    const [first] = await screen.findAllByRole('button', { name: 'Đặt mặc định' });
    await act(async () => {
      fireEvent.click(first!);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(cardOfA()).toBeNull();
    expect(screen.getByText(/Mai · 0900000000/)).toBeInTheDocument();
    await act(async () => refetch.resolve([ADDR2]));
    expect(cardOfA()).toBeNull();
    expect(screen.getByText(/Mai · 0900000000/)).toBeInTheDocument();
  });

  it.each(TEMPORARY)('đặt mặc định gặp %s: không nói gì về sổ thật nên không tải lại, khoá nhả ngay', async (_label, error) => {
    mocks.getAddresses.mockResolvedValue([ADDR]);
    mocks.updateAddress.mockRejectedValueOnce(error).mockResolvedValue({});
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đặt mặc định' });
    fireEvent.click(btn);
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.getAddresses).toHaveBeenCalledTimes(1);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.updateAddress).toHaveBeenCalledTimes(2));
  });

  it('đặt mặc định bị từ chối mà danh sách tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS, chưa tới hạn thì chạm tiếp bị từ chối', async () => {
    mocks.getAddresses.mockResolvedValueOnce([ADDR]).mockReturnValueOnce(never()).mockResolvedValue([ADDR]);
    mocks.updateAddress.mockRejectedValueOnce(serverError('Không đặt mặc định được.', 409)).mockResolvedValue({});
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Đặt mặc định' });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.getAddresses).toHaveBeenCalledTimes(2);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
      fireEvent.click(btn);
    });
    expect(mocks.updateAddress).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await pastCap();
    });
    expect(btn).not.toHaveAttribute('aria-busy');
    await act(async () => {
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.updateAddress).toHaveBeenCalledTimes(2);
  });

  it('xoá bị 404 (địa chỉ đã xoá ở máy khác): báo lỗi một lần, thẻ biến mất ngay và khung xác nhận đóng, không đợi danh sách mới', async () => {
    const refetch = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockReturnValueOnce(refetch.promise);
    mocks.deleteAddress.mockRejectedValueOnce(serverError('Không tìm thấy địa chỉ.', 404));
    renderPage();
    const del = await openDelete(0);
    await act(async () => {
      fireEvent.click(del);
      fireEvent.click(del);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    expect(errorToasts()).toHaveLength(1);
    expect(cardOfA()).toBeNull();
    expect(screen.queryByText('Xoá địa chỉ này?')).toBeNull();
    expect(screen.getByText(/Mai · 0900000000/)).toBeInTheDocument();
    await act(async () => refetch.resolve([ADDR2]));
    expect(cardOfA()).toBeNull();
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
  });

  it.each([400, 409])('xoá bị từ chối %i (địa chỉ còn, vd đang gắn gói giao định kỳ): tải lại, khung xác nhận ở lại, nút bận tới khi danh sách về rồi mới nhận cú chạm mới', async (status) => {
    const refetch = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR]).mockReturnValueOnce(refetch.promise).mockResolvedValue([ADDR]);
    mocks.deleteAddress.mockRejectedValueOnce(serverError('Địa chỉ đang dùng cho gói giao định kỳ.', status)).mockResolvedValue({});
    renderPage();
    let del = await openDelete();
    await act(async () => {
      fireEvent.click(del);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(errorToasts()).toHaveLength(1);
    expect(screen.getByText('Xoá địa chỉ này?')).toBeInTheDocument();
    expect(cardOfA()).not.toBeNull();
    expect(del).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(del);
    });
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    await act(async () => refetch.resolve([ADDR]));
    // W114A: khung xác nhận chỉ có nút Xoá nên đóng ngay sau khi danh sách mới về; mở lại để chạm lần hai.
    await waitFor(() => expect(screen.queryByText('Xoá địa chỉ này?')).toBeNull());
    del = await openDelete();
    await waitFor(() => expect(del).not.toHaveAttribute('aria-busy'));
    fireEvent.click(del);
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledTimes(2));
  });

  it.each(TEMPORARY)('xoá gặp %s: không nói gì về sổ thật nên không tải lại, khung ở lại, khoá nhả ngay', async (_label, error) => {
    mocks.getAddresses.mockResolvedValue([ADDR]);
    mocks.deleteAddress.mockRejectedValueOnce(error).mockResolvedValue({});
    renderPage();
    const del = await openDelete();
    fireEvent.click(del);
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await waitFor(() => expect(del).not.toHaveAttribute('aria-busy'));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.getAddresses).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Xoá địa chỉ này?')).toBeInTheDocument();
    fireEvent.click(del);
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledTimes(2));
  });

  it('xoá bị từ chối mà danh sách tải lại treo mãi: khoá nhả đúng sau LOCK_REFRESH_WAIT_MS (nút Xoá của thẻ khác bị khoá tới lúc đó)', async () => {
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockReturnValueOnce(never()).mockResolvedValue([ADDR, ADDR2]);
    mocks.deleteAddress.mockRejectedValueOnce(serverError('Địa chỉ đang dùng cho gói giao định kỳ.', 409));
    renderPage();
    let del = await openDelete(0);
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(del);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    expect(del).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 1);
      fireEvent.click(del);
    });
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    expect(del).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await pastCap();
    });
    // W114A: khung xác nhận đóng cùng lúc khoá nhả; mở lại (truy vấn đồng bộ vì đồng hồ giả chặn findBy) để soi nút Xoá.
    expect(screen.queryByText('Xoá địa chỉ này?')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Xoá' })[0]!);
    const reopened = screen.getByRole('heading', { level: 2, name: 'Xoá địa chỉ này?' });
    del = within(reopened.closest('[data-testid="page"] > div') as HTMLElement).getByRole('button', { name: 'Xoá' });
    expect(del).not.toHaveAttribute('aria-busy');
  });
});

// W114A: khung xác nhận xoá chỉ có nút Xoá nên đóng khi máy chủ từ chối hẳn (400/404/409/422): 400/409 đóng SAU khi sổ mới về (nút Xoá báo bận tới lúc đó), 404 đóng ngay cùng lúc thẻ bị gỡ, 422 đóng ngay không tải lại. Mất mạng, quá hạn, 5xx, 401: khung ở lại, nhả khoá ngay.
describe('Sổ địa chỉ: khung xác nhận xoá đóng khi máy chủ từ chối hẳn (W114A)', () => {
  const ADDR2 = { ...ADDR, id: 'a2', recipient: 'Mai' };
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message }, headers: {} });
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const errorToasts = () => mocks.openSnackbar.mock.calls.filter(([a]) => (a as { type: string }).type === 'error');
  const TITLE = 'Xoá địa chỉ này?';
  const dialogGone = () => waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
  const openDelete = async (index = 0) => {
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xoá' }))[index]!);
    const title = await screen.findByRole('heading', { level: 2, name: TITLE });
    return within(title.closest('[data-testid="page"] > div') as HTMLElement).getByRole('button', { name: 'Xoá' });
  };
  function renderSpied() {
    const qc = newClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    renderPage(qc);
    return { qc, invalidate };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authStatus = 'authenticated';
    mocks.getAddresses.mockReset();
    mocks.updateAddress.mockReset().mockResolvedValue({});
    mocks.deleteAddress.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [400, 'Địa chỉ đang dùng cho gói giao định kỳ.'],
    [409, 'Địa chỉ vừa được dùng cho một gói giao định kỳ.'],
  ])('bị từ chối %i: báo lỗi một lần, tải lại ["addresses"], khung còn mở và nút bận tới khi sổ về, rồi đóng và nhả khoá', async (status, message) => {
    const refetch = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR]).mockReturnValueOnce(refetch.promise).mockResolvedValue([ADDR]);
    mocks.deleteAddress.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue({});
    const { invalidate } = renderSpied();
    const del = await openDelete();
    await act(async () => {
      fireEvent.click(del);
      fireEvent.click(del);
      fireEvent.click(del);
    });
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['addresses'] });
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);
    expect(errorToasts()).toEqual([[{ text: message, type: 'error' }]]);
    // Sổ mới chưa về: khung còn mở, nút Xoá báo bận, chạm thêm không gọi API.
    await settle();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(del).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(del);
    });
    expect(mocks.deleteAddress).toHaveBeenCalledTimes(1);

    await act(async () => refetch.resolve([ADDR]));
    await dialogGone();
    expect(errorToasts()).toHaveLength(1);
    const again = await openDelete();
    expect(again).not.toHaveAttribute('aria-busy');
    fireEvent.click(again);
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledTimes(2));
  });

  it('bị từ chối 422: khung đóng và báo lỗi một lần, không tải lại sổ, khoá nhả ngay', async () => {
    mocks.getAddresses.mockResolvedValue([ADDR]);
    mocks.deleteAddress.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue({});
    renderSpied();
    const del = await openDelete();
    fireEvent.click(del);
    await waitFor(() => expect(errorToasts()).toEqual([[{ text: 'Dữ liệu không hợp lệ', type: 'error' }]]));
    await dialogGone();
    await settle();
    expect(mocks.getAddresses).toHaveBeenCalledTimes(1);
    const again = await openDelete();
    expect(again).not.toHaveAttribute('aria-busy');
    fireEvent.click(again);
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledTimes(2));
  });

  it('bị từ chối 404: khung đóng cùng lúc thẻ bị gỡ, không đợi sổ mới (khoá vẫn giữ tới khi sổ về)', async () => {
    const refetch = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockReturnValueOnce(refetch.promise).mockResolvedValue([ADDR2]);
    mocks.deleteAddress.mockRejectedValueOnce(serverError('Không tìm thấy địa chỉ.', 404));
    renderSpied();
    const del = await openDelete(0);
    fireEvent.click(del);
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    await dialogGone();
    expect(screen.queryByText(/Lan · 0900000000/)).toBeNull();
    expect(errorToasts()).toHaveLength(1);
    // Sổ chưa về: nút Xoá của thẻ còn lại vẫn khoá (lệnh xoá chưa nhả).
    expect(screen.getByRole('button', { name: 'Xoá' })).toBeDisabled();
    await act(async () => refetch.resolve([ADDR2]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xoá' })).toBeEnabled());
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['hết thời gian (ECONNABORTED)', new HttpError('timeout of 15000ms exceeded', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
  ])('%s: khung ở lại, khoá nhả ngay, không tải lại sổ, bấm lại gọi lần hai', async (_label, error) => {
    mocks.getAddresses.mockResolvedValue([ADDR]);
    mocks.deleteAddress.mockRejectedValueOnce(error).mockResolvedValue({});
    renderSpied();
    const del = await openDelete();
    fireEvent.click(del);
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await waitFor(() => expect(del).not.toHaveAttribute('aria-busy'));
    await settle();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(mocks.getAddresses).toHaveBeenCalledTimes(1);
    fireEvent.click(del);
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledTimes(2));
  });

  it('sổ tải lại treo mãi: khung còn mở và bận ở LOCK_REFRESH_WAIT_MS - 500, hết hạn thì đóng và nhả khoá', async () => {
    mocks.getAddresses.mockResolvedValueOnce([ADDR]).mockReturnValueOnce(new Promise<unknown[]>(() => undefined)).mockResolvedValue([ADDR]);
    mocks.deleteAddress.mockRejectedValueOnce(serverError('Địa chỉ đang dùng cho gói giao định kỳ.', 409)).mockResolvedValue({});
    renderSpied();
    const del = await openDelete();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(del);
      await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(screen.getByText(TITLE)).toBeInTheDocument();
      expect(del).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      await dialogGone();
    } finally {
      vi.useRealTimers();
    }
    const again = await openDelete();
    expect(again).not.toHaveAttribute('aria-busy');
    fireEvent.click(again);
    await waitFor(() => expect(mocks.deleteAddress).toHaveBeenCalledTimes(2));
  });

  it('khách đã đóng khung lúc lệnh bay: lỗi 409 tới không mở lại khung nào, khoá giữ tới khi sổ về', async () => {
    const d = deferred<unknown>();
    const refetch = deferred<unknown[]>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockReturnValueOnce(refetch.promise).mockResolvedValue([ADDR, ADDR2]);
    mocks.deleteAddress.mockReturnValueOnce(d.promise);
    renderSpied();
    const del = await openDelete(0);
    await act(async () => {
      fireEvent.click(del);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await dialogGone();
    await act(async () => d.reject(serverError('Địa chỉ đang dùng cho gói giao định kỳ.', 409)));
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    expect(errorToasts()).toHaveLength(1);
    expect(screen.queryByText(TITLE)).toBeNull();
    await act(async () => refetch.resolve([ADDR, ADDR2]));
    await settle();
    expect(screen.queryByText(TITLE)).toBeNull();
    const again = await openDelete(0);
    expect(again).not.toHaveAttribute('aria-busy');
  });

  it('khung xoá của địa chỉ khác đang mở: Đặt mặc định của địa chỉ này bị 404 gỡ thẻ này nhưng không đóng khung của địa chỉ kia', async () => {
    const d = deferred<unknown>();
    mocks.getAddresses.mockResolvedValueOnce([ADDR, ADDR2]).mockResolvedValue([ADDR2]);
    mocks.updateAddress.mockReturnValueOnce(d.promise);
    renderSpied();
    const [setDefaultFirst] = await screen.findAllByRole('button', { name: 'Đặt mặc định' });
    await openDelete(1);
    await act(async () => {
      fireEvent.click(setDefaultFirst!);
    });
    await act(async () => d.reject(serverError('Không tìm thấy địa chỉ.', 404)));
    await waitFor(() => expect(errorToasts()).toHaveLength(1));
    await settle();
    expect(screen.queryByText(/Lan · 0900000000/)).toBeNull();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
  });
});

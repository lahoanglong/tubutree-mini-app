import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

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

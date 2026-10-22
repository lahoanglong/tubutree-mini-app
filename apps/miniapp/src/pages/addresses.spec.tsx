import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../components/address-form', () => ({ AddressForm: () => <div>form</div> }));

import AddressesPage from './addresses';

const ADDR = {
  id: 'a1', recipient: 'Lan', phone: '0900000000', street: '1 Lê Lợi', ward: 'P1', district: 'Q1', province: 'HCM', isDefault: false,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AddressesPage /></QueryClientProvider>);
}

describe('Sổ địa chỉ: nút hành động (C-078)', () => {
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

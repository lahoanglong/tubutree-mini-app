import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ getAddresses: vi.fn(), updateAddress: vi.fn(), deleteAddress: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('zmp-ui')>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div>{children}</div> : null),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({ getAddresses: mocks.getAddresses }));
vi.mock('../services/account-api', () => ({ updateAddress: mocks.updateAddress, deleteAddress: mocks.deleteAddress }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
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

  it('Đặt mặc định / Sửa / Xóa là nút thật, cao 44px', async () => {
    renderPage();
    for (const name of ['Đặt mặc định', 'Sửa', 'Xóa']) {
      const btn = await screen.findByRole('button', { name });
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.style.minHeight).toBe('44px');
    }
  });

  it('bấm Đặt mặc định gọi API', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Đặt mặc định' }));
    await waitFor(() => expect(mocks.updateAddress).toHaveBeenCalledWith('a1', { isDefault: true }));
  });

  it('bấm Xóa mở hộp xác nhận', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa' }));
    expect(await screen.findByText('Xóa địa chỉ này?')).toBeInTheDocument();
  });
});

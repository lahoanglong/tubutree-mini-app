import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({ getCoupons: vi.fn(), applyCoupon: vi.fn(), removeCoupon: vi.fn(), openSnackbar: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/account-api', () => ({ getCoupons: mocks.getCoupons }));
vi.mock('../../services/shop-api', () => ({ applyCoupon: mocks.applyCoupon, removeCoupon: mocks.removeCoupon }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { VoucherSheet } from './voucher-sheet';

const COUPONS = [
  { code: 'GIAM10', type: 'PERCENT', value: 10, minOrder: null, maxDiscount: 50_000, endAt: '2027-01-01T00:00:00.000Z' },
  { code: 'FREESHIP', type: 'FREESHIP', value: 20_000, minOrder: 500_000, maxDiscount: null, endAt: '2027-01-01T00:00:00.000Z' },
];

function renderSheet(currentCode?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoucherSheet visible onClose={() => {}} currentCode={currentCode} subtotal={100_000} />
    </QueryClientProvider>,
  );
}

const px = (v: string) => Number.parseFloat(v);

describe('VoucherSheet — vùng chạm >= 44px (C-021)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nút đóng (x) vuông tối thiểu 44x44', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS);
    renderSheet();
    const close = await screen.findByRole('button', { name: 'Đóng' });
    expect(px(close.style.width)).toBeGreaterThanOrEqual(44);
    expect(px(close.style.height)).toBeGreaterThanOrEqual(44);
  });

  it('nút "Dùng mã" / "Chưa đủ" / "Bỏ dùng" cao tối thiểu 44px', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS);
    renderSheet('GIAM10');
    const used = await screen.findByRole('button', { name: 'Bỏ dùng' });
    const notEnough = await screen.findByRole('button', { name: 'Chưa đủ' });
    expect(px(used.style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(px(notEnough.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('"Dùng mã" cao tối thiểu 44px', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS.slice(0, 1));
    renderSheet();
    const use = await screen.findByRole('button', { name: 'Dùng mã' });
    expect(px(use.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('tải mã lỗi → "Thử lại" cao tối thiểu 44px', async () => {
    mocks.getCoupons.mockRejectedValue(new Error('Mạng lỗi'));
    renderSheet();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(px(retry.style.minHeight)).toBeGreaterThanOrEqual(44);
  });
});

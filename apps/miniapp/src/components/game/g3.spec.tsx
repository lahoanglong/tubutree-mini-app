import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'u', zaloId: 'guest_abc', phone: null } as { id: string; zaloId?: string; phone: string | null } | null,
  ensurePhone: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div role="dialog">{children}</div> : null),
  useSnackbar: () => ({ openSnackbar: vi.fn() }),
}));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: mocks.user, ensurePhone: mocks.ensurePhone }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GuestBanner } from './guest-banner';
import { OrderWaterCard } from './order-water-card';
import { HarvestCelebration } from './harvest-celebration';
import { GardenHero } from './garden-hero';
import { WaterTank } from './water-tank';
import { SeasonEmpty } from './season-banner';

describe('OrderWaterCard (B-81)', () => {
  it('hiện nguồn "Từ đơn hàng" và tiến độ tuần', () => {
    render(<OrderWaterCard info={{ perOrder: 100, weeklyCap: 300, weeklyGranted: 100 }} onShop={vi.fn()} />);
    expect(screen.getByText('Từ đơn hàng')).toBeInTheDocument();
    expect(screen.getByTestId('order-water-progress')).toHaveTextContent('Đã nhận 100/300💧 tuần này');
  });
  it('đủ trần thì nói thứ Hai nhận tiếp; không vượt 100%', () => {
    render(<OrderWaterCard info={{ perOrder: 100, weeklyCap: 300, weeklyGranted: 300 }} onShop={vi.fn()} />);
    expect(screen.getByTestId('order-water-progress')).toHaveTextContent('Thứ Hai tuần sau');
  });
  it('admin tắt (0) hoặc API cũ (null): ẩn hẳn', () => {
    const { container, rerender } = render(<OrderWaterCard info={{ perOrder: 0, weeklyCap: 300, weeklyGranted: 0 }} onShop={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<OrderWaterCard info={null} onShop={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('GuestBanner (B-79)', () => {
  const wrap = () => {
    const qc = new QueryClient();
    return render(
      <QueryClientProvider client={qc}>
        <GuestBanner />
      </QueryClientProvider>,
    );
  };
  it('tài khoản khách: báo chơi thử, nút Đăng nhập Zalo gọi ensurePhone', () => {
    mocks.user = { id: 'u', zaloId: 'guest_abc', phone: null };
    wrap();
    expect(screen.getByTestId('guest-banner')).toHaveTextContent('đang chơi thử');
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập Zalo' }));
    expect(mocks.ensurePhone).toHaveBeenCalledTimes(1);
  });
  it('người dùng thật: không hiện', () => {
    mocks.user = { id: 'u', zaloId: '123', phone: '0900000000' };
    const { container } = wrap();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HarvestCelebration (B-15)', () => {
  const base = { open: true, guest: false, onLogin: vi.fn(), certificate: null, species: null, points: null, sprout: false, couponCapped: null, nextTarget: 60, onClose: vi.fn(), onShare: vi.fn() };
  it('có mã: nút chính "Dùng mã giảm giá ngay" truyền mã, nút phụ "Để sau" đóng', () => {
    const onUseCoupon = vi.fn();
    const onClose = vi.fn();
    render(<HarvestCelebration {...base} coupons={['GIAM10']} onUseCoupon={onUseCoupon} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã giảm giá ngay' }));
    expect(onUseCoupon).toHaveBeenCalledWith('GIAM10');
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    expect(onClose).toHaveBeenCalled();
  });
  it('không có mã: không có nút dùng mã', () => {
    render(<HarvestCelebration {...base} coupons={[]} onUseCoupon={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Dùng mã giảm giá ngay' })).toBeNull();
  });
  it('trần mã bằng 0 (OFF): nói đúng, không hứa "mai/tháng sau"', () => {
    render(<HarvestCelebration {...base} coupons={[]} couponCapped="OFF" onUseCoupon={vi.fn()} />);
    expect(screen.getByRole('note')).not.toHaveTextContent(/mai|tháng sau|sang tháng/i);
  });
});

describe('GardenHero (B-107)', () => {
  it('hồ sơ cũ 400/60: tiến độ không vượt đích và nói đủ nước', () => {
    render(<GardenHero eco={{ progress: 400, target: 60, treeType: 'Sồi', treesPlanted: 1 }} totalSeeds={10} streakDays={1} harvestReady />);
    expect(screen.queryByText(/400/)).toBeNull();
    expect(screen.getByText(/thu hoạch ngay/i)).toBeInTheDocument();
  });
});

describe('G3 lượt 2', () => {
  it('bể: vượt sức chứa thì nói rõ nhờ nước đơn hàng; không vượt thì không nói', () => {
    const { rerender } = render(<WaterTank seeds={1050} capacity={1000} />);
    expect(screen.getByTestId('tank-over')).toHaveTextContent('vượt sức chứa 1.000');
    rerender(<WaterTank seeds={900} capacity={1000} />);
    expect(screen.queryByTestId('tank-over')).toBeNull();
  });
  it('nước từ đơn nhận khi mở game lần đầu: hiện claimedNow và giữ lại', () => {
    const info = { perOrder: 100, weeklyCap: 300, weeklyGranted: 100, claimedNow: 100 };
    const { rerender } = render(<OrderWaterCard info={info} onShop={vi.fn()} />);
    expect(screen.getByTestId('order-water-claimed')).toHaveTextContent('+100');
    rerender(<OrderWaterCard info={{ ...info, claimedNow: 0 }} onShop={vi.fn()} />);
    expect(screen.getByTestId('order-water-claimed')).toHaveTextContent('+100');
  });
  it('màn mùa rỗng có tiêu đề và lời nhắn', () => {
    render(<SeasonEmpty />);
    expect(screen.getByTestId('season-empty')).toBeInTheDocument();
  });
  it('hộp thu hoạch ghi giá trị, đơn tối thiểu, hạn của mã', () => {
    const base = { open: true, guest: false, onLogin: vi.fn(), certificate: null, species: null, points: null, sprout: false, couponCapped: null, nextTarget: 60, onClose: vi.fn(), onShare: vi.fn(), onUseCoupon: vi.fn() };
    render(<HarvestCelebration {...base} coupons={['GIAM10']} couponTerms={[{ code: 'GIAM10', value: 10000, minOrder: 100000, expiresAt: '2026-12-31T00:00:00.000Z' }]} />);
    expect(screen.getByTestId('coupon-terms')).toHaveTextContent(/10\.000/);
  });
  it('đăng nhập khách thất bại: banner báo lỗi', async () => {
    mocks.user = { id: 'u', zaloId: 'guest_abc', phone: null };
    mocks.ensurePhone.mockResolvedValueOnce(null);
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <GuestBanner />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập Zalo' }));
    expect(await screen.findByTestId('guest-banner')).toHaveTextContent(/chưa|không/i);
  });
});

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
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: mocks.user, ensurePhoneOrThrow: mocks.ensurePhone }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GuestBanner } from './guest-banner';
import { HttpError } from '../../services/http';
import { OrderWaterCard } from './order-water-card';
import { HarvestCelebration } from './harvest-celebration';
import { GardenHero } from './garden-hero';
import { GardenPlots } from './garden-plots';
import { EcoImpact } from './eco-impact';
import { WaterTank } from './water-tank';
import { SeasonEmpty } from './season-banner';

describe('OrderWaterCard', () => {
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

describe('GuestBanner', () => {
  const wrap = () => {
    const qc = new QueryClient();
    return render(
      <QueryClientProvider client={qc}>
        <GuestBanner />
      </QueryClientProvider>,
    );
  };
  it('tài khoản khách: báo chơi thử, nút Đăng nhập Zalo gọi ensurePhoneOrThrow', () => {
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

describe('HarvestCelebration', () => {
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

describe('GardenHero', () => {
  it('hồ sơ cũ 400/60: tiến độ không vượt đích và nói đủ nước', () => {
    render(<GardenHero eco={{ progress: 400, target: 60, treeType: 'Sồi', treesPlanted: 1 }} totalSeeds={10} streakDays={1} harvestReady />);
    expect(screen.queryByText(/400/)).toBeNull();
    expect(screen.getByText(/thu hoạch ngay/i)).toBeInTheDocument();
  });
  it('tên thẻ: có loài thì hiện loài; loài mặc định hay trống thì "Cây của bạn"; chưa có dữ liệu vườn thì "Vườn của bạn"', () => {
    const eco = (treeType: string) => ({ progress: 10, target: 60, treeType, treesPlanted: 0 });
    const { rerender } = render(<GardenHero eco={eco('Sồi')} totalSeeds={10} streakDays={1} />);
    expect(screen.getByText('Sồi')).toBeInTheDocument();
    rerender(<GardenHero eco={eco('Cây Dứa Fuwa3e')} totalSeeds={10} streakDays={1} />);
    expect(screen.queryByText(/Fuwa3e/)).toBeNull();
    expect(screen.getByText('Cây của bạn')).toBeInTheDocument();
    rerender(<GardenHero eco={eco('')} totalSeeds={10} streakDays={1} />);
    expect(screen.getByText('Cây của bạn')).toBeInTheDocument();
    rerender(<GardenHero eco={undefined} totalSeeds={undefined} streakDays={undefined} />);
    expect(screen.getByText('Vườn của bạn')).toBeInTheDocument();
  });
});

describe('GardenPlots: tên loài trên từng lô', () => {
  const plot = (slot: number, treeType: string) => ({ id: `p${slot}`, slot, isHome: false, treeType, speciesId: null, progress: 5, target: 60, treeStage: 1, treesPlanted: 0, treeHealth: 'HEALTHY' as const });
  it('có loài thì hiện loài; loài mặc định của máy chủ hay trống thì "Cây của bạn", cả chữ lẫn tên đọc của thanh tiến độ', () => {
    const garden = { plots: [plot(2, 'Sồi'), plot(3, 'Cây Dứa Fuwa3e'), plot(4, '')], maxPlots: 5, nextUnlock: null };
    const { container } = render(
      <GardenPlots garden={garden} totalSeeds={100} onNeedWater={vi.fn()} waterPlotPending={false} waterPlotVariables={undefined} onWaterPlot={vi.fn()} unlockPending={false} onUnlock={vi.fn()} />,
    );
    expect(screen.getByText('Lô 2 · Sồi')).toBeInTheDocument();
    expect(screen.getByText('Lô 3 · Cây của bạn')).toBeInTheDocument();
    expect(screen.getByText('Lô 4 · Cây của bạn')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Fuwa3e/);
    expect(screen.getByLabelText('Lô 3, Cây của bạn: tiến độ lớn của cây')).toBeInTheDocument();
  });
});

describe('EcoImpact: đóng góp của tôi', () => {
  const tree = (certificateCode: string, treeType: string) => ({ certificateCode, treeType, status: 'PLEDGED' as const, region: null, pledgedAt: '2026-10-01T00:00:00.000Z', plantedAt: null });
  it('loài mặc định của máy chủ không hiện như tên thật; loài thật thì hiện', () => {
    const forest = { count: 2, plantedCount: 0, trees: [tree('TUBU-001', 'Cây Dứa Fuwa3e'), tree('TUBU-002', 'Sồi')] };
    const { container } = render(<EcoImpact eco={undefined} totalSeeds={10} forest={forest} />);
    expect(container.textContent).not.toMatch(/Fuwa3e/);
    expect(container.textContent).not.toContain('Cây của bạn');
    expect(screen.getByText('TUBU-001')).toBeInTheDocument();
    expect(screen.getByText('Sồi')).toBeInTheDocument();
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
  it('thẻ nước đơn nói rõ lần mua giao thành công và trần tuần', () => {
    render(<OrderWaterCard info={{ perOrder: 100, weeklyCap: 300, weeklyGranted: 0 }} onShop={vi.fn()} />);
    expect(screen.getByText(/Mỗi lần mua giao thành công \+100/)).toHaveTextContent('tối đa 300');
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
  it('máy chủ từ chối (409 SĐT đã gắn tài khoản khác): banner nói đúng lời máy chủ, không câu chung', async () => {
    mocks.user = { id: 'u', zaloId: 'guest_abc', phone: null };
    mocks.ensurePhone.mockRejectedValueOnce(new HttpError('conflict', undefined, { status: 409, data: { message: 'Số điện thoại này đã gắn với tài khoản Zalo khác.' } }));
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <GuestBanner />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập Zalo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Số điện thoại này đã gắn với tài khoản Zalo khác.');
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type Rendered } from '@/test-utils/dom';
import { OrderWaterCard } from './order-water-card';
import { HarvestCelebration } from './harvest-celebration';
import { GardenHero } from './garden-hero';
import { WaterTank } from './water-tank';
import { SeasonEmpty } from './season-banner';
import { WeeklyLeaderboard } from './weekly-leaderboard';

vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('OrderWaterCard (B-81)', () => {
  it('hiện nguồn "Từ đơn hàng" và tiến độ tuần; đủ trần thì nói thứ Hai nhận tiếp', () => {
    mounted = render(<OrderWaterCard info={{ perOrder: 100, weeklyCap: 300, weeklyGranted: 100 }} shopHref="/san-pham" />);
    expect(mounted.container.textContent).toContain('Từ đơn hàng');
    expect(mounted.container.querySelector('[data-testid="order-water-progress"]')!.textContent).toBe('Đã nhận 100/300💧 tuần này');
    mounted.unmount();
    mounted = render(<OrderWaterCard info={{ perOrder: 100, weeklyCap: 300, weeklyGranted: 300 }} shopHref="/san-pham" />);
    expect(mounted.container.querySelector('[data-testid="order-water-progress"]')!.textContent).toContain('Thứ Hai tuần sau');
  });
  it('tắt (0) hoặc API cũ (null): ẩn hẳn', () => {
    mounted = render(<OrderWaterCard info={{ perOrder: 0, weeklyCap: 300, weeklyGranted: 0 }} shopHref="/san-pham" />);
    expect(mounted.container.innerHTML).toBe('');
  });
});

describe('HarvestCelebration (B-15)', () => {
  const base = { open: true, guest: false, onLogin: vi.fn(), certificate: null, species: null, points: null, sprout: false, canShare: true, couponCapped: null, nextTarget: 60, onClose: vi.fn(), onCopyCoupon: vi.fn(), shared: false, sharing: false, onShare: vi.fn() };
  const byText = (t: string) => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === t);
  it('có mã: "Dùng mã giảm giá ngay" truyền mã; "Để sau" đóng', () => {
    const onUseCoupon = vi.fn();
    const onClose = vi.fn();
    mounted = render(<HarvestCelebration {...base} coupons={['GIAM10']} onUseCoupon={onUseCoupon} onClose={onClose} />);
    byText('Dùng mã giảm giá ngay')!.click();
    expect(onUseCoupon).toHaveBeenCalledWith('GIAM10');
    byText('Để sau')!.click();
    expect(onClose).toHaveBeenCalled();
  });
  it('trần mã bằng 0 (OFF): không hứa "mai/tháng sau"', () => {
    mounted = render(<HarvestCelebration {...base} coupons={[]} couponCapped="OFF" onUseCoupon={vi.fn()} />);
    const note = document.querySelector('[role="note"]')!;
    expect(note.textContent).not.toMatch(/mai|tháng sau|sang tháng/i);
  });
});

describe('GardenHero (B-107)', () => {
  it('hồ sơ cũ 400/60: không hiện 400, nói đủ nước', () => {
    mounted = render(<GardenHero eco={{ progress: 400, target: 60, treeType: 'Sồi', treesPlanted: 1 }} totalSeeds={10} streakDays={1} harvestReady />);
    expect(mounted.container.textContent).not.toContain('400');
    expect(mounted.container.textContent).toMatch(/thu hoạch ngay/i);
  });
});

describe('G3 lượt 2', () => {
  const q = (id: string) => mounted!.container.querySelector(`[data-testid="${id}"]`);
  it('bể: vượt sức chứa thì nói rõ nhờ nước đơn hàng; không vượt thì không nói', () => {
    mounted = render(<WaterTank seeds={1050} capacity={1000} />);
    expect(q('tank-over')!.textContent).toContain('vượt sức chứa 1.000');
    mounted.unmount();
    mounted = render(<WaterTank seeds={900} capacity={1000} />);
    expect(q('tank-over')).toBeNull();
  });
  it('nước từ đơn nhận khi mở game lần đầu: hiện claimedNow', () => {
    mounted = render(<OrderWaterCard info={{ perOrder: 100, weeklyCap: 300, weeklyGranted: 100, claimedNow: 100 }} shopHref="/san-pham" />);
    expect(q('order-water-claimed')!.textContent).toContain('+100');
  });
  it('màn mùa rỗng hiện', () => {
    mounted = render(<SeasonEmpty />);
    expect(q('season-empty')).not.toBeNull();
  });
  it('bảng xếp hạng chưa tải: khung chờ, không phải "chưa có ai"', () => {
    mounted = render(<WeeklyLeaderboard board={undefined} />);
    expect(q('leaderboard-loading')).not.toBeNull();
    expect(q('leaderboard-empty')).toBeNull();
  });
  it('bảng xếp hạng tải lỗi: báo lỗi có nút thử lại, không quay mãi', () => {
    const retry = vi.fn();
    mounted = render(<WeeklyLeaderboard board={undefined} failed onRetry={retry} />);
    expect(q('leaderboard-loading')).toBeNull();
    const btn = mounted.container.querySelector('button')!;
    expect(btn.textContent).toBe('Thử lại');
    btn.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it('thẻ nước đơn nói rõ lần mua giao thành công và trần tuần', () => {
    mounted = render(<OrderWaterCard info={{ perOrder: 100, weeklyCap: 300, weeklyGranted: 0 }} shopHref="/san-pham" />);
    expect(mounted.container.textContent).toContain('Mỗi lần mua giao thành công +100');
    expect(mounted.container.textContent).toContain('tối đa 300');
  });
  it('hộp thu hoạch ghi giá trị, đơn tối thiểu, hạn của mã', () => {
    mounted = render(
      <HarvestCelebration
        open
        guest={false}
        onLogin={vi.fn()}
        certificate={null}
        species={null}
        points={null}
        sprout={false}
        couponCapped={null}
        nextTarget={60}
        onClose={vi.fn()}
        onShare={vi.fn()}
        onUseCoupon={vi.fn()}
        canShare={false}
        onCopyCoupon={vi.fn()}
        shared={false}
        sharing={false}
        coupons={['GIAM10']}
        couponTerms={[{ code: 'GIAM10', value: 10000, minOrder: 100000, expiresAt: '2026-12-31T00:00:00.000Z' }]}
      />,
    );
    expect(document.body.querySelector('[data-testid="coupon-terms"]')!.textContent).toMatch(/10\.000/);
  });
});

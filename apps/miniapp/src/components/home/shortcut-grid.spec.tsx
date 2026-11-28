import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  cfg: { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } } as Record<string, unknown>,
  openRequests: false,
  recycleHook: vi.fn(),
  gardenDot: false,
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/' }),
}));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => mocks.cfg }));
vi.mock('../../hooks/use-recycle-open-requests', () => ({
  useRecycleOpenRequests: (authed: boolean, paused: boolean) => {
    mocks.recycleHook(authed, paused);
    return mocks.openRequests;
  },
}));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../hooks/use-engagement-dots', () => ({ useEngagementDots: () => ({ garden: mocks.gardenDot, profile: false, checkInElsewhere: false }) }));
vi.mock('./earn-sheet', () => ({ EarnSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Kiếm tiền cùng Tubu" /> : null) }));

import { recordVisit, resetNavTrail } from '../../lib/smart-nav';
import { SHORTCUT_ROUTES } from './shortcut-visuals';
import { ShortcutGrid } from './shortcut-grid';

const MORE = 'Thêm lối tắt';
const rows = (dialog: HTMLElement) => within(dialog).getAllByRole('button').filter((b) => b.getAttribute('aria-label') !== 'Đóng');
const cells = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('.tubu-shortcut-grid > button'));
const cellIds = (c: HTMLElement) => cells(c).map((b) => b.dataset.pillar ?? b.dataset.shortcut ?? 'more');
const openMore = async () => {
  fireEvent.click(screen.getByRole('button', { name: MORE }));
  return screen.findByRole('dialog', { name: MORE });
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cfg = { isLoaded: true, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
  mocks.openRequests = false;
  mocks.gardenDot = false;
});

describe('ShortcutGrid Mini App: MỘT lưới biểu tượng 4 cột × 2 hàng (W47)', () => {
  it('8 ô: sáu lối vào hệ sinh thái, Mã giảm giá, rồi "Thêm"; không còn thẻ chính, ô phụ hay viên lối tắt', () => {
    const { container } = render(<ShortcutGrid />);
    expect(screen.getByTestId('shortcut-grid')).toBeInTheDocument();
    expect(cellIds(container)).toEqual(['retail', 'garden', 'recycle', 'groupBuy', 'subscription', 'rewards', 'coupons', 'more']);
    expect(container.querySelectorAll('[data-tier], .tubu-bento-card--hero, .tubu-chip, .tubu-quick-pill')).toHaveLength(0);
    expect(cells(container).map((b) => b.querySelector('[data-shortcut-label]')?.textContent)).toEqual([
      'Giờ vàng',
      'Vườn Xanh',
      'Đổi rác',
      'Mua chung',
      'Định kỳ',
      'Kho quà',
      'Mã giảm giá',
      'Thêm',
    ]);
  });

  it('lối vào hệ sinh thái đi đúng route Mini App; Mã giảm giá đi đích lối tắt của Mini App', () => {
    const { container } = render(<ShortcutGrid />);
    const expected = ['/flash-sale', '/game', '/recycle', '/group-buy', '/subscriptions', '/offers?tab=rewards'];
    cells(container)
      .filter((b) => b.dataset.pillar)
      .forEach((b, i) => {
        fireEvent.click(b);
        expect(mocks.navigate).toHaveBeenLastCalledWith(expected[i]);
      });
    fireEvent.click(container.querySelector<HTMLButtonElement>('[data-shortcut="coupons"]')!);
    expect(mocks.navigate.mock.calls.at(-1)![0]).toBe(SHORTCUT_ROUTES.coupons);
  });

  it('tên đọc mỗi ô bắt đầu bằng đúng nhãn nhìn thấy (WCAG 2.5.3) và nói phụ đề cho trình đọc màn hình', () => {
    const { container } = render(<ShortcutGrid />);
    for (const b of cells(container)) {
      const visible = b.querySelector('[data-shortcut-label]')!.textContent!;
      expect(b.getAttribute('aria-label')!.startsWith(visible), `${b.getAttribute('aria-label')} / ${visible}`).toBe(true);
    }
    expect(container.querySelector('[data-pillar="retail"]')?.getAttribute('aria-label')).toBe('Giờ vàng (Mua lẻ · Giờ vàng). Giá tốt theo giờ');
    expect(container.querySelector('[data-pillar="recycle"]')?.getAttribute('aria-label')).toBe('Đổi rác. Miễn ship đơn sau, nhận Điểm Xanh');
  });

  it('"Thêm" mở hộp thoại chỉ gồm lối tắt chưa lên lưới (Cộng đồng, Bộ quà tặng, Kiếm tiền): không lặp Giờ vàng, không có Đơn hàng', async () => {
    render(<ShortcutGrid />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await openMore();
    const names = rows(dialog).map((b) => b.textContent ?? '');
    expect(names).toHaveLength(3);
    expect(names.map((t) => t.split(/\s/)[0])).toEqual(['Cộng', 'Bộ', 'Kiếm']);
    expect(names.some((t) => /Giờ vàng|Đơn hàng|Mã giảm giá/.test(t))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: /Cộng đồng/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/feed');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: MORE })).toBeNull());
  });

  it('"Bộ quà tặng" trong hộp thoại mở /gift-combos qua smartNavigate', async () => {
    window.history.replaceState({ idx: 0 }, '');
    render(<ShortcutGrid />);
    fireEvent.click(within(await openMore()).getByRole('button', { name: /Bộ quà tặng/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith(SHORTCUT_ROUTES.gifts);
  });

  it('vừa từ Bộ quà tặng về Trang chủ: chạm lại thì lùi thật một mục, không chồng thêm bản sao /gift-combos', async () => {
    resetNavTrail();
    window.history.replaceState({ idx: 0 }, '');
    recordVisit(SHORTCUT_ROUTES.gifts!);
    window.history.replaceState({ idx: 1 }, '');
    render(<ShortcutGrid />);
    fireEvent.click(within(await openMore()).getByRole('button', { name: /Bộ quà tặng/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith(-1);
    resetNavTrail();
    window.history.replaceState({ idx: 0 }, '');
  });

  it('"Kiếm tiền" trong hộp thoại mở bảng chọn thay vì điều hướng', async () => {
    render(<ShortcutGrid />);
    const dialog = await openMore();
    mocks.navigate.mockClear();
    fireEvent.click(within(dialog).getByRole('button', { name: /Kiếm tiền/ }));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog', { name: 'Kiếm tiền cùng Tubu' })).toBeInTheDocument();
  });

  it('Đổi rác tạm dừng mà khách còn yêu cầu đang mở: ô Đổi rác ghi "Yêu cầu", đọc đủ "Yêu cầu của tôi" và dẫn vào /recycle/requests', () => {
    mocks.cfg = { isLoaded: true, waste: { enabled: false }, loyalty: { marketplaceClaimEnabled: false } };
    mocks.openRequests = true;
    const { container } = render(<ShortcutGrid />);
    expect(mocks.recycleHook).toHaveBeenCalledWith(true, true);
    const cell = container.querySelector<HTMLButtonElement>('[data-pillar="recycle"]')!;
    expect(cell.querySelector('[data-shortcut-label]')?.textContent).toBe('Yêu cầu');
    expect(cell.getAttribute('aria-label')).toContain('Yêu cầu của tôi');
    fireEvent.click(cell);
    expect(mocks.navigate).toHaveBeenLastCalledWith('/recycle/requests');
    expect(cells(container)).toHaveLength(8);
  });

  it('cấu hình đang chờ vẫn đủ 8 ô (CLS = 0); chương trình đang chạy thì không hỏi yêu cầu đang mở', () => {
    mocks.cfg = { isLoaded: false, isPending: true, waste: { enabled: false } };
    const pending = render(<ShortcutGrid />);
    expect(cells(pending.container)).toHaveLength(8);
    pending.unmount();
    mocks.cfg = { isLoaded: true, waste: { enabled: true } };
    render(<ShortcutGrid />);
    expect(mocks.recycleHook).toHaveBeenLastCalledWith(true, false);
  });
});

describe('ShortcutGrid Mini App: Giờ vàng đã biết và con số tiết kiệm lấy từ cấu hình', () => {
  it('flashLive=false: bỏ ô Giờ vàng, Cộng đồng lên lưới, vẫn 8 ô; hộp thoại "Thêm" không liệt kê Giờ vàng', async () => {
    const { container } = render(<ShortcutGrid flashLive={false} />);
    expect(container.querySelector('[data-pillar="retail"]')).toBeNull();
    expect(cellIds(container)).toEqual(['garden', 'recycle', 'groupBuy', 'subscription', 'rewards', 'coupons', 'community', 'more']);
    const dialog = await openMore();
    expect(rows(dialog).some((b) => /Giờ vàng/.test(b.textContent ?? ''))).toBe(false);
  });

  it('flashLive=true hay chưa biết (undefined): giữ ô Giờ vàng đầu lưới', () => {
    for (const flashLive of [true, undefined]) {
      const { container, unmount } = render(<ShortcutGrid flashLive={flashLive} />);
      expect(cellIds(container)[0]).toBe('retail');
      unmount();
    }
  });

  it('Mua xoay vòng nói con số tiết kiệm CHỈ khi cấu hình đã về: 0,12 → 12% từ máy chủ, không còn số cố định trong mã', () => {
    mocks.cfg = { isLoaded: true, subscribeDiscountPct: 0.12, waste: { enabled: true }, loyalty: { marketplaceClaimEnabled: true } };
    const first = render(<ShortcutGrid />);
    const label = (c: HTMLElement) => c.querySelector('[data-pillar="subscription"]')!.getAttribute('aria-label') ?? '';
    expect(label(first.container)).toContain('12%');
    expect(label(first.container)).not.toContain('17%');
    first.unmount();

    mocks.cfg = { isLoaded: false, isPending: true, subscribeDiscountPct: 0.17, waste: { enabled: false } };
    const loading = render(<ShortcutGrid />);
    expect(label(loading.container)).not.toMatch(/\d+%/);
    loading.unmount();

    mocks.cfg = { isLoaded: true, subscribeDiscountPct: 0, waste: { enabled: true } };
    const zero = render(<ShortcutGrid />);
    expect(label(zero.container)).not.toMatch(/\d+%/);
  });
});

describe('ShortcutGrid Mini App: chấm nhắc ở ô Vườn Xanh (W42)', () => {
  it('có việc hôm nay: chấm trên biểu tượng ô Vườn Xanh, nhãn đọc nói rõ; không có việc thì không chấm', () => {
    mocks.gardenDot = true;
    const on = render(<ShortcutGrid />);
    const cell = on.container.querySelector<HTMLElement>('[data-pillar="garden"]')!;
    expect(within(cell).getByTestId('garden-card-dot')).toHaveClass('tubu-remind-dot', 'tubu-remind-dot--card');
    expect(cell.getAttribute('aria-label')).toBe('Vườn Xanh, có việc hôm nay. Tưới cây mỗi ngày nhận quà thật');
    on.unmount();
    mocks.gardenDot = false;
    const off = render(<ShortcutGrid />);
    expect(off.container.querySelector('[data-testid="garden-card-dot"]')).toBeNull();
    expect(off.container.querySelector('[data-pillar="garden"]')?.getAttribute('aria-label')).toBe('Vườn Xanh. Tưới cây mỗi ngày nhận quà thật');
  });
});

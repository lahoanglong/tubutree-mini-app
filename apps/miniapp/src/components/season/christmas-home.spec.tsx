import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';

const vn = (iso: string) => Date.parse(`${iso}+07:00`);

const mocks = vi.hoisted(() => ({
  authStatus: 'authenticated' as string,
  status: undefined as Partial<CheckInStatusResponse> | undefined,
  statusError: false,
  pending: false,
  checkIn: vi.fn(),
  login: vi.fn(async () => {}),
  haptic: vi.fn(),
  now: 0,
}));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: mocks.authStatus }) }));
vi.mock('../../hooks/use-check-in', () => ({
  useCheckIn: (enabled: boolean) => ({
    status: enabled ? mocks.status : undefined,
    statusQ: { isError: mocks.statusError },
    view: null,
    pending: mocks.pending,
    checkIn: mocks.checkIn,
  }),
}));
vi.mock('../../hooks/use-login-notice', () => ({ useLoginWithNotice: () => mocks.login }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));
vi.mock('../../utils/server-clock', () => ({ serverNow: () => mocks.now }));

import { SHAKE_MS } from '@tubutree/app-core/seasonal/christmas-hero';
import ChristmasHome, { ChristmasHomeHero } from './christmas-home';

const withQuery = (qc: QueryClient) => (ui: ReactElement) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
const render = (ui: ReactElement) => {
  const wrap = withQuery(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const r = rtlRender(wrap(ui));
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) };
};

const OPEN_STATUS: Partial<CheckInStatusResponse> = { checkedInToday: false, todayPoints: 1000, todayWater: 10, pointsDone: false, waterDone: false, checkInDays: ['2026-12-14'] };

function setMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduced && q.includes('reduce'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  mocks.authStatus = 'authenticated';
  mocks.status = { ...OPEN_STATUS };
  mocks.statusError = false;
  mocks.pending = false;
  mocks.checkIn.mockReset();
  mocks.login.mockClear();
  mocks.now = vn('2026-12-16T10:00:00');
  localStorage.clear();
  setMatchMedia(false);
});
afterEach(() => {
  vi.useRealTimers();
});

const cta = () => screen.getByTestId('christmas-cta');

describe('ChristmasHomeHero: rung cây → hộp quà rơi → mở quà = điểm danh một lần mỗi ngày', () => {
  it('rung cây, hộp rơi sau SHAKE_MS, "Mở quà" gọi điểm danh đúng một lần dù bấm đúp', () => {
    const { rerender } = render(<ChristmasHomeHero snowOn onToggleSnow={() => {}} />);
    expect(cta()).toHaveTextContent('Rung cây nhận quà');
    expect(screen.queryByTestId('christmas-gift')).toBeNull();

    fireEvent.click(cta());
    expect(cta()).toHaveTextContent('Cây đang rung…');
    expect(cta()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('christmas-burst')).toBeInTheDocument();
    expect(mocks.haptic).toHaveBeenCalledWith('light');

    act(() => void vi.advanceTimersByTime(SHAKE_MS));
    expect(cta()).toHaveTextContent('Mở quà');
    expect(screen.getByTestId('christmas-gift').getAttribute('class')).toContain('is-dropped');
    expect(screen.getByText('Nhận +1.000 Điểm Xanh · +10 giọt nước')).toBeInTheDocument();

    fireEvent.click(cta());
    fireEvent.click(cta());
    expect(mocks.checkIn).toHaveBeenCalledTimes(1);
    expect(cta()).toHaveTextContent('Đang mở quà…');

    // Máy chủ báo nhận đủ: hộp mở, không còn nút, đếm tới quà mới.
    mocks.status = { ...OPEN_STATUS, checkedInToday: true, todayPoints: 0, todayWater: 0 };
    act(() => (mocks.checkIn.mock.calls[0]![0] as (ok: boolean) => void)(true));
    rerender(<ChristmasHomeHero snowOn onToggleSnow={() => {}} />);
    expect(screen.queryByTestId('christmas-cta')).toBeNull();
    expect(screen.getByText('Đã mở quà hôm nay')).toBeInTheDocument();
    expect(screen.getByText('Nhận +1.000 Điểm Xanh · +10 giọt nước')).toBeInTheDocument();
    expect(screen.getByText(/^Quà mới sau 14:00:00$/)).toBeInTheDocument();
    expect(screen.getByTestId('christmas-gift').getAttribute('class')).toContain('is-open');

    // Rung cây lần nữa chỉ cho vui: không gọi điểm danh lần hai.
    fireEvent.click(screen.getByTestId('christmas-tree'));
    act(() => void vi.advanceTimersByTime(SHAKE_MS));
    expect(mocks.checkIn).toHaveBeenCalledTimes(1);
  });

  it('mở quà lỗi hay chỉ nhận một phần: hộp đóng lại, "Mở quà" bấm lại được', () => {
    render(<ChristmasHomeHero snowOn={false} />);
    fireEvent.click(cta());
    act(() => void vi.advanceTimersByTime(SHAKE_MS));
    fireEvent.click(cta());
    act(() => (mocks.checkIn.mock.calls[0]![0] as (ok: boolean) => void)(false));
    expect(cta()).toHaveTextContent('Mở quà');
    expect(cta()).not.toHaveAttribute('aria-busy');
    fireEvent.click(cta());
    expect(mocks.checkIn).toHaveBeenCalledTimes(2);
  });

  it('bấm "Mở quà" lúc 23:59:55 mà máy chủ trả lời sau 00:00 giờ VN: thẻ ngày mới về đầu, không kẹt "đã mở" (đồng hồ thẻ đọc lại giờ khi sang opened)', () => {
    mocks.now = vn('2026-12-16T23:59:50');
    render(<ChristmasHomeHero snowOn={false} />);
    fireEvent.click(cta());
    act(() => void vi.advanceTimersByTime(SHAKE_MS));
    fireEvent.click(cta());
    mocks.now = vn('2026-12-17T00:00:05');
    act(() => (mocks.checkIn.mock.calls[0]![0] as (ok: boolean) => void)(true));
    expect(cta()).toHaveTextContent('Rung cây nhận quà');
  });

  it('phiên đang khôi phục: "Mở quà" báo bận, bấm không gọi gì', () => {
    mocks.authStatus = 'loading';
    render(<ChristmasHomeHero snowOn={false} />);
    fireEvent.click(cta());
    act(() => void vi.advanceTimersByTime(SHAKE_MS));
    expect(cta()).toHaveTextContent('Mở quà');
    expect(cta()).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(cta());
    expect(mocks.checkIn).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it('đã nhận hôm nay (máy khác hay thẻ thành viên): không nút, hộp mở sẵn, chạm cây không gọi API', () => {
    mocks.status = { ...OPEN_STATUS, checkedInToday: true };
    render(<ChristmasHomeHero snowOn={false} />);
    expect(screen.queryByTestId('christmas-cta')).toBeNull();
    expect(screen.getByText('Quà hôm nay đã mở')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('christmas-tree'));
    act(() => void vi.advanceTimersByTime(SHAKE_MS));
    expect(mocks.checkIn).not.toHaveBeenCalled();
    expect(screen.queryByTestId('christmas-cta')).toBeNull();
  });

  it('khách chưa đăng nhập: mở hộp thấy lời chúc và nút đăng nhập, không gọi điểm danh', () => {
    mocks.authStatus = 'guest';
    render(<ChristmasHomeHero snowOn={false} />);
    fireEvent.click(cta());
    act(() => void vi.advanceTimersByTime(SHAKE_MS));
    fireEvent.click(cta());
    expect(screen.getByText('Giáng sinh an lành!')).toBeInTheDocument();
    expect(screen.getByText('Đăng nhập để nhận Điểm Xanh và giọt nước mỗi ngày')).toBeInTheDocument();
    expect(cta()).toHaveTextContent('Đăng nhập nhận quà');
    fireEvent.click(cta());
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });

  it('trước 14/12: dòng phụ báo ngày mở lịch, mọi ô khoá, ô đầu chưa đếm giờ (còn hơn 1 ngày)', () => {
    mocks.now = vn('2026-11-28T18:00:00');
    mocks.status = { ...OPEN_STATUS, checkInDays: [] };
    render(<ChristmasHomeHero snowOn={false} />);
    expect(screen.getByText('Lịch quà 12 ngày mở từ 14/12 · còn 16 ngày')).toBeInTheDocument();
    const tiles = screen.getByTestId('advent-strip').querySelectorAll('.tubu-xmas-tile');
    expect(tiles).toHaveLength(12);
    expect([...tiles].every((t) => t.getAttribute('data-state') === 'locked')).toBe(true);
    expect(screen.getByTestId('advent-strip')).toHaveAttribute('aria-label', 'Lịch quà 12 ngày, đã mở 0/12');
  });
});

describe('vùng chạm', () => {
  it('mọi nút của thẻ mang lớp tự khai vùng chạm 44px (hit-target-guard.spec đọc đúng các lớp này trong seasonal-christmas.css)', () => {
    const { container } = render(<ChristmasHomeHero snowOn onToggleSnow={() => {}} />);
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b.className).toMatch(/^tubu-xmas-(tree-btn|cta|snow-toggle)$/);
  });
});

describe('AdventGreenStrip (giờ VN)', () => {
  it('16/12 21:30: 14/12 đã mở (tích), 15/12 lỡ, 16/12 vàng hôm nay, 17/12 đếm 02:30, còn lại khoá', () => {
    mocks.now = vn('2026-12-16T21:30:00');
    render(<ChristmasHomeHero snowOn={false} />);
    const tiles = [...screen.getByTestId('advent-strip').querySelectorAll<HTMLElement>('.tubu-xmas-tile')];
    expect(tiles.slice(0, 5).map((t) => t.dataset.state)).toEqual(['claimed', 'missed', 'open', 'locked', 'locked']);
    expect(tiles[2]!.dataset.today).toBe('true');
    expect(tiles[3]).toHaveTextContent('02:30');
    expect(tiles[4]!.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Ngày 3, 16/12: mở quà hôm nay')).toBeInTheDocument();
  });

  it('khách chưa đăng nhập không có ô đã mở', () => {
    mocks.authStatus = 'guest';
    render(<ChristmasHomeHero snowOn={false} />);
    const states = [...screen.getByTestId('advent-strip').querySelectorAll<HTMLElement>('.tubu-xmas-tile')].map((t) => t.dataset.state);
    expect(states.slice(0, 3)).toEqual(['missed', 'missed', 'open']);
  });
});

describe('ChristmasHome: tuyết, nút ❄️, dây đèn', () => {
  it('tuyết 18–24 bông gắn vào body; ❄️ tắt thì gỡ hẳn và nhớ trên máy', () => {
    const { unmount } = render(<ChristmasHome />);
    const snow = document.body.querySelector('[data-testid="christmas-snow"]')!;
    expect(snow.parentElement).toBe(document.body);
    const n = snow.querySelectorAll('.tubu-xmas-flake').length;
    expect(n).toBeGreaterThanOrEqual(18);
    expect(n).toBeLessThanOrEqual(24);
    const toggle = screen.getByTestId('christmas-snow-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(document.querySelector('[data-testid="christmas-snow"]')).toBeNull();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('tubu_snow_off')).toBe('1');
    unmount();
    render(<ChristmasHome />);
    expect(document.querySelector('[data-testid="christmas-snow"]')).toBeNull();
  });

  it('app chạy nền: tuyết tạm dừng', () => {
    render(<ChristmasHome />);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(document.querySelector('[data-testid="christmas-snow"]')!.className).toContain('is-paused');
    hidden.mockRestore();
  });

  it('máy bật giảm chuyển động: không tuyết, không nút ❄️', () => {
    setMatchMedia(true);
    render(<ChristmasHome />);
    expect(document.querySelector('[data-testid="christmas-snow"]')).toBeNull();
    expect(screen.queryByTestId('christmas-snow-toggle')).toBeNull();
  });

  it('dây đèn gắn vào vỏ header Trang chủ, không thêm phần tử nào vào luồng trang', () => {
    const header = document.createElement('div');
    header.setAttribute('data-home-block', 'search');
    document.body.appendChild(header);
    const { unmount } = render(<ChristmasHome />);
    const garland = header.querySelector('[data-testid="christmas-garland"]');
    expect(garland).not.toBeNull();
    expect(garland).toHaveAttribute('aria-hidden', 'true');
    unmount();
    expect(header.childElementCount).toBe(0);
    header.remove();
  });
});

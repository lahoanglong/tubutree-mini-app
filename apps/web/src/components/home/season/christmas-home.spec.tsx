// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';
import { click, render, type Rendered } from '@/test-utils/dom';

const vn = (iso: string) => Date.parse(`${iso}+07:00`);

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  status: undefined as Partial<CheckInStatusResponse> | undefined,
  message: null as { text: string; error: boolean } | null,
  checkIn: vi.fn(),
  push: vi.fn(),
  now: 0,
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: {} }));
vi.mock('@/lib/use-check-in', () => ({
  useCheckIn: (enabled: boolean) => ({ status: enabled ? mocks.status : undefined, statusQ: { isError: false }, view: null, pending: false, checkIn: mocks.checkIn, message: mocks.message }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@tubutree/app-core/server-clock', () => ({ serverNow: () => mocks.now }));

import { SHAKE_MS } from '@tubutree/app-core/seasonal/christmas-hero';
import ChristmasHome, { ChristmasHomeHero } from './christmas-home';

const OPEN_STATUS: Partial<CheckInStatusResponse> = { checkedInToday: false, todayPoints: 1000, todayWater: 10, pointsDone: false, waterDone: false, checkInDays: ['2026-12-14'] };

function setMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
}

let mounted: Rendered | null = null;
const mount = (ui: React.ReactElement) => {
  mounted = render(ui);
  return mounted.container;
};
const cta = () => document.querySelector<HTMLButtonElement>('[data-testid="christmas-cta"]');
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  mocks.phase = 'authenticated';
  mocks.status = { ...OPEN_STATUS };
  mocks.message = null;
  mocks.checkIn.mockReset();
  mocks.push.mockReset();
  mocks.now = vn('2026-12-16T10:00:00');
  localStorage.clear();
  setMatchMedia(false);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

describe('ChristmasHomeHero web (cùng luồng với Mini App)', () => {
  it('rung cây → hộp rơi → "Mở quà" gọi điểm danh một lần; nhận xong thì hết nút', () => {
    const c = mount(<ChristmasHomeHero snowOn onToggleSnow={() => {}} />);
    expect(cta()!.textContent).toBe('Rung cây nhận quà');
    click(cta());
    expect(cta()!.getAttribute('aria-busy')).toBe('true');
    tick(SHAKE_MS);
    expect(cta()!.textContent).toBe('Mở quà');
    expect(c.textContent).toContain('Nhận +1.000 Điểm Xanh · +10 giọt nước');
    click(cta());
    click(cta());
    expect(mocks.checkIn).toHaveBeenCalledTimes(1);
    mocks.status = { ...OPEN_STATUS, checkedInToday: true, todayPoints: 0, todayWater: 0 };
    act(() => (mocks.checkIn.mock.calls[0]![0] as (ok: boolean) => void)(true));
    expect(cta()).toBeNull();
    expect(c.textContent).toContain('Đã mở quà hôm nay');
    expect(c.textContent).toContain('Quà mới sau 14:00:00');
  });

  it('mở quà lỗi: câu lỗi của máy chủ thay dòng phụ, "Mở quà" bấm lại được', () => {
    const c = mount(<ChristmasHomeHero snowOn={false} />);
    click(cta());
    tick(SHAKE_MS);
    click(cta());
    mocks.message = { text: 'Mất kết nối, thử lại sau', error: true };
    act(() => (mocks.checkIn.mock.calls[0]![0] as (ok: boolean) => void)(false));
    expect(cta()!.textContent).toBe('Mở quà');
    expect(c.querySelector('[role="status"]')!.textContent).toBe('Mất kết nối, thử lại sau');
  });

  it('bấm "Mở quà" lúc 23:59:55 mà máy chủ trả lời sau 00:00 giờ VN: thẻ ngày mới về đầu, không kẹt "đã mở" (đồng hồ thẻ đọc lại giờ khi sang opened)', () => {
    mocks.now = vn('2026-12-16T23:59:50');
    mount(<ChristmasHomeHero snowOn={false} />);
    click(cta());
    tick(SHAKE_MS);
    click(cta());
    mocks.now = vn('2026-12-17T00:00:05');
    act(() => (mocks.checkIn.mock.calls[0]![0] as (ok: boolean) => void)(true));
    expect(cta()!.textContent).toBe('Rung cây nhận quà');
  });

  it('phiên đang khôi phục: "Mở quà" báo bận, bấm không gọi gì', () => {
    mocks.phase = 'loading';
    mount(<ChristmasHomeHero snowOn={false} />);
    click(cta());
    tick(SHAKE_MS);
    expect(cta()!.textContent).toBe('Mở quà');
    expect(cta()!.getAttribute('aria-busy')).toBe('true');
    click(cta());
    expect(mocks.checkIn).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('khách chưa đăng nhập: lời chúc + "Đăng nhập nhận quà" mở trang đăng nhập rồi quay về Trang chủ', () => {
    mocks.phase = 'guest';
    const c = mount(<ChristmasHomeHero snowOn={false} />);
    click(cta());
    tick(SHAKE_MS);
    click(cta());
    expect(c.textContent).toContain('Giáng sinh an lành!');
    click(cta());
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2F');
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });

  it('lịch quà 16/12 21:30 giờ VN: đã mở, lỡ, hôm nay, đếm 02:30', () => {
    mocks.now = vn('2026-12-16T21:30:00');
    const c = mount(<ChristmasHomeHero snowOn={false} />);
    const tiles = [...c.querySelectorAll<HTMLElement>('.tubu-xmas-tile')];
    expect(tiles).toHaveLength(12);
    expect(tiles.slice(0, 4).map((t) => t.dataset.state)).toEqual(['claimed', 'missed', 'open', 'locked']);
    expect(tiles[3]!.textContent).toContain('02:30');
  });
});

describe('ChristmasHome web: tuyết, ❄️, dây đèn', () => {
  it('tuyết gắn vào body, ❄️ tắt thì gỡ và nhớ; dây đèn chỉ ở khổ điện thoại', () => {
    const header = document.createElement('div');
    header.setAttribute('data-home-block', 'search');
    document.body.appendChild(header);
    mount(<ChristmasHome />);
    expect(document.body.querySelector(':scope > [data-testid="christmas-snow"]')).not.toBeNull();
    expect(header.querySelector('[data-testid="christmas-garland"]')!.className).toContain('is-phone-only');
    click(document.querySelector('[data-testid="christmas-snow-toggle"]'));
    expect(document.querySelector('[data-testid="christmas-snow"]')).toBeNull();
    expect(localStorage.getItem('tubu_snow_off')).toBe('1');
    mounted!.unmount();
    mounted = null;
    header.remove();
  });

  it('giảm chuyển động: không tuyết, không nút ❄️', () => {
    setMatchMedia(true);
    mount(<ChristmasHome />);
    expect(document.querySelector('[data-testid="christmas-snow"]')).toBeNull();
    expect(document.querySelector('[data-testid="christmas-snow-toggle"]')).toBeNull();
  });
});

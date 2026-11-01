// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';
import { click, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ status: null as CheckInStatusResponse | null, checkIn: vi.fn() }));
vi.mock('@/lib/use-check-in', () => ({
  useCheckIn: () => ({
    status: mocks.status,
    statusQ: { isLoading: false, isError: false, refetch: vi.fn() },
    view: mocks.status ? { canCheckIn: !mocks.status.checkedInToday, buttonLabel: mocks.status.checkedInToday ? 'Đã điểm danh' : 'Điểm danh' } : null,
    pending: false,
    checkIn: mocks.checkIn,
    message: null,
  }),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/uu-dai' }));

import { DailyCheckInCard } from './daily-check-in-card';

const REWARDS = Array.from({ length: 7 }, (_, i) => ({ day: i + 1, points: 1000, claimed: false, isToday: i === 0 }));
const base: CheckInStatusResponse = {
  checkedInToday: false,
  streakDays: 0,
  currentCycleDay: 1,
  todayPoints: 1000,
  todayWater: 10,
  pointsDone: false,
  waterDone: false,
  rewards: REWARDS,
};

let mounted: Rendered | null = null;
beforeEach(() => {
  mocks.status = null;
  mocks.checkIn.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('DailyCheckInCard (web): khách vãng lai không được hứa Điểm Xanh', () => {
  it('tiêu đề "Điểm danh mỗi ngày" dưới 22px: Inter, không Fraunces (Q1)', () => {
    mocks.status = base;
    mounted = render(<DailyCheckInCard authed />);
    const h = Array.from(mounted.container.querySelectorAll<HTMLElement>('h2')).find((e) => e.textContent === 'Điểm danh mỗi ngày')!;
    expect(h.style.fontFamily).toContain('--font-ui');
    expect(h.style.fontFamily).not.toContain('--font-display');
  });

  it('user thật: hứa "+1.000 Điểm Xanh · +10 giọt nước", không có câu mời đăng nhập', () => {
    mocks.status = base;
    mounted = render(<DailyCheckInCard authed />);
    expect(mounted.container.textContent).toContain('Hôm nay nhận +1.000 Điểm Xanh · +10 giọt nước');
    expect(mounted.container.querySelector('[data-testid="guest-points-note"]')).toBeNull();
    expect(mounted.container.querySelector('[aria-label="Ngày 1: +1.000 Điểm Xanh"]')).not.toBeNull();
  });

  it('khách vãng lai: giọt nước vẫn hiện, không chữ "+N Điểm Xanh", có câu mời và liên kết đăng nhập quay lại đúng trang', () => {
    mocks.status = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };
    mounted = render(<DailyCheckInCard authed />);
    const text = mounted.container.textContent ?? '';
    expect(text).toContain('Hôm nay nhận +10 giọt nước');
    expect(text).not.toMatch(/\+[\d.]+ Điểm Xanh/);
    const note = mounted.container.querySelector('[data-testid="guest-points-note"]')!;
    expect(note.textContent).toContain('Đăng nhập Zalo để nhận Điểm Xanh');
    const link = note.querySelector('a')!;
    expect(link.textContent).toBe('Đăng nhập Zalo');
    expect(link.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fuu-dai');
    expect(mounted.container.querySelector('[aria-label="Ngày 1"]')).not.toBeNull();
    expect(text).not.toContain('Một lần bấm nhận cả Điểm Xanh');
  });
});

describe('DailyCheckInCard compact (web, Ưu đãi): luật gập lại', () => {
  const toggleOf = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  const ruleOf = (c: HTMLElement) => c.querySelector<HTMLElement>(`#${CSS.escape(toggleOf(c).getAttribute('aria-controls')!)}`)!;

  it('luật gập sẵn sau nút "Luật điểm danh" (aria-expanded); bấm mở đoạn luật, bấm lại gập; không còn luật đứng sẵn', () => {
    mocks.status = base;
    mounted = render(<DailyCheckInCard authed compact />);
    const c = mounted.container;
    expect(toggleOf(c).textContent).toBe('Luật');
    expect(toggleOf(c).getAttribute('aria-label')).toBe('Luật điểm danh');
    expect(toggleOf(c).getAttribute('aria-expanded')).toBe('false');
    expect(ruleOf(c).hidden).toBe(true);
    expect(ruleOf(c).textContent).toContain('Một lần bấm nhận cả Điểm Xanh và giọt nước');
    click(toggleOf(c));
    expect(toggleOf(c).getAttribute('aria-expanded')).toBe('true');
    expect(ruleOf(c).hidden).toBe(false);
    click(toggleOf(c));
    expect(ruleOf(c).hidden).toBe(true);
  });

  it('nút Điểm danh nằm hàng tiêu đề, đúng một nút Điểm danh, bấm gọi checkIn; bản đầy đủ không có nút luật', () => {
    mocks.status = base;
    mounted = render(<DailyCheckInCard authed compact />);
    const c = mounted.container;
    const buttons = [...c.querySelectorAll('button')].filter((b) => b.textContent === 'Điểm danh');
    expect(buttons).toHaveLength(1);
    expect(c.querySelector('h2')!.parentElement!.parentElement!.contains(buttons[0]!)).toBe(true);
    click(buttons[0]!);
    expect(mocks.checkIn).toHaveBeenCalledTimes(1);
    mounted.unmount();
    mounted = render(<DailyCheckInCard authed />);
    expect(mounted.container.querySelector('button[aria-expanded]')).toBeNull();
    expect(mounted.container.textContent).toContain('Một lần bấm nhận cả Điểm Xanh và giọt nước');
  });

  it('nút luật đứng cạnh "Ngày n/7" dưới tiêu đề; đoạn luật mở ngay dưới hàng đầu, trước 7 ô', () => {
    mocks.status = base;
    mounted = render(<DailyCheckInCard authed compact />);
    const c = mounted.container;
    const heading = c.querySelector('h2')!;
    expect(heading.parentElement!.contains(toggleOf(c))).toBe(true);
    expect(heading.parentElement!.textContent).toContain('Ngày 1/7');
    const firstDay = c.querySelector('[aria-label="Ngày 1: +1.000 Điểm Xanh"]')!;
    expect(ruleOf(c).compareDocumentPosition(firstDay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hàng cuối dưới 7 ô luôn có một dòng chữ nhỏ: phần thưởng hôm nay, hoặc "đã điểm danh" khi xong (thẻ không đổi cao sau khi điểm danh)', () => {
    mocks.status = base;
    mounted = render(<DailyCheckInCard authed compact />);
    expect(mounted.container.textContent).toContain('Nhận +1.000 Điểm Xanh · +10 giọt nước');
    expect(mounted.container.textContent).not.toContain('Hôm nay bạn đã điểm danh rồi');
    mounted.unmount();
    mocks.status = { ...base, checkedInToday: true, todayPoints: 0, todayWater: 0, pointsDone: true, waterDone: true };
    mounted = render(<DailyCheckInCard authed compact />);
    expect(mounted.container.textContent).toContain('Hôm nay bạn đã điểm danh rồi');
    expect(mounted.container.textContent).not.toContain('Hôm nay nhận');
    mounted.unmount();
    mounted = render(<DailyCheckInCard authed />);
    expect(mounted.container.textContent).not.toContain('Hôm nay bạn đã điểm danh rồi');
  });

  it('đã điểm danh hôm nay: nút khoá nhưng vẫn thấy ("Đã điểm danh"), nút luật vẫn bấm mở được', () => {
    mocks.status = { ...base, checkedInToday: true };
    mounted = render(<DailyCheckInCard authed compact />);
    const c = mounted.container;
    const done = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Đã điểm danh')!;
    expect(done).toBeTruthy();
    click(done);
    expect(mocks.checkIn).not.toHaveBeenCalled();
    click(c.querySelector('button[aria-expanded]')!);
    expect(c.querySelector<HTMLElement>('#' + CSS.escape(c.querySelector('button[aria-expanded]')!.getAttribute('aria-controls')!))!.hidden).toBe(false);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';
import { act } from 'react';
import type { ComponentProps } from 'react';
import { byText, click, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  status: null as CheckInStatusResponse | null,
  checkIn: vi.fn(),
  pending: false,
  statusQ: { isLoading: false, isError: false, isFetching: false, error: null as unknown, refetch: vi.fn() },
}));
// Bọc Button để đọc onPress mới nhất: nút đang chờ bị khoá thật nên chỉ gọi thẳng onPress mới chứng minh được guard của thẻ.
const ctl = vi.hoisted(() => ({ buttons: new Map<string, { onPress?: () => unknown }>() }));
vi.mock('@/components/mini', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/mini')>();
  return {
    ...orig,
    Button: (p: ComponentProps<typeof orig.Button>) => {
      ctl.buttons.set(String(p.children), p as { onPress?: () => unknown });
      return <orig.Button {...p} />;
    },
  };
});
vi.mock('@/lib/use-check-in', () => ({
  useCheckIn: () => ({
    status: mocks.status,
    statusQ: mocks.statusQ,
    view: mocks.status ? { canCheckIn: !mocks.status.checkedInToday, buttonLabel: mocks.status.checkedInToday ? 'Đã điểm danh' : 'Điểm danh' } : null,
    pending: mocks.pending,
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
  mocks.pending = false;
  mocks.statusQ = { isLoading: false, isError: false, isFetching: false, error: null, refetch: vi.fn() };
  ctl.buttons.clear();
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
const press = () => ctl.buttons.get('Điểm danh')!.onPress!();
const checkInButton = () => byText(mounted!.container, 'button', 'Điểm danh')!;
const noteOf = (c: HTMLElement) => c.querySelector('[data-testid="guest-points-note"]');
const GUEST: CheckInStatusResponse = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };

describe('DailyCheckInCard (web): khoá điểm danh đồng bộ', () => {
  beforeEach(() => {
    mocks.status = base;
  });

  it.each([[true], [false]])('hai cú bấm sát nhau trước khi vẽ lại (compact=%s): checkIn chỉ gọi một lần', (compact) => {
    mounted = render(<DailyCheckInCard authed compact={compact} />);
    act(() => {
      press();
      press();
    });
    expect(mocks.checkIn).toHaveBeenCalledTimes(1);
  });

  it.each([[true], [false]])('hai cú bấm vào nút sát nhau (compact=%s) cũng chỉ một lần điểm danh', (compact) => {
    mounted = render(<DailyCheckInCard authed compact={compact} />);
    const btn = checkInButton();
    act(() => {
      click(btn);
      click(btn);
    });
    expect(mocks.checkIn).toHaveBeenCalledTimes(1);
  });

  it('checkIn xong thì bấm tiếp được: khoá chỉ giữ trong lúc checkIn còn chạy', async () => {
    mounted = render(<DailyCheckInCard authed />);
    await act(async () => {
      press();
    });
    await act(async () => {
      press();
    });
    expect(mocks.checkIn).toHaveBeenCalledTimes(2);
  });

  it('checkIn trả Promise: khoá giữ tới khi Promise xong rồi nhả', async () => {
    const pending = deferred<void>();
    mocks.checkIn.mockReturnValue(pending.promise);
    mounted = render(<DailyCheckInCard authed />);
    await act(async () => {
      press();
    });
    await act(async () => {
      press();
    });
    expect(mocks.checkIn).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    await act(async () => {
      press();
    });
    expect(mocks.checkIn).toHaveBeenCalledTimes(2);
  });

  it('đang chờ (pending): bấm bị bỏ qua dù khoá ref chưa giữ; nút báo bận', () => {
    mocks.pending = true;
    mounted = render(<DailyCheckInCard authed />);
    press();
    expect(mocks.checkIn).not.toHaveBeenCalled();
    expect(checkInButton().getAttribute('aria-busy')).toBe('true');
  });
});

describe('DailyCheckInCard (web): tải trạng thái lỗi', () => {
  it('Thử lại gọi tải lại một lần; đang tải dở (isFetching) thì không gọi chồng', () => {
    const refetch = vi.fn();
    mocks.statusQ = { isLoading: false, isError: true, isFetching: true, error: new Error('Mất mạng'), refetch };
    mounted = render(<DailyCheckInCard authed />);
    click(byText(mounted.container, 'button', /Thử lại/));
    expect(refetch).not.toHaveBeenCalled();
    mocks.statusQ.isFetching = false;
    act(() => mounted!.root.render(<DailyCheckInCard authed />));
    click(byText(mounted.container, 'button', /Thử lại/));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('DailyCheckInCard (web): guestNote như Mini', () => {
  it('mặc định và guestNote={true}: khách có ghi chú mời đăng nhập, ở cả bản đầy đủ lẫn bản gọn', () => {
    mocks.status = GUEST;
    mounted = render(<DailyCheckInCard authed />);
    expect(noteOf(mounted.container)).not.toBeNull();
    mounted.unmount();
    mounted = render(<DailyCheckInCard authed compact guestNote />);
    expect(noteOf(mounted.container)).not.toBeNull();
  });

  it('guestNote={false} (trang đã có thẻ mời ở trên): không vẽ ghi chú dù pointsBlocked, bản đầy đủ lẫn bản gọn; giọt nước vẫn hiện', () => {
    mocks.status = GUEST;
    mounted = render(<DailyCheckInCard authed guestNote={false} />);
    expect(noteOf(mounted.container)).toBeNull();
    expect(mounted.container.textContent).toContain('Hôm nay nhận +10 giọt nước');
    mounted.unmount();
    mounted = render(<DailyCheckInCard authed compact guestNote={false} />);
    expect(noteOf(mounted.container)).toBeNull();
  });

  it('không pointsBlocked: guestNote không ảnh hưởng, vẫn không có ghi chú', () => {
    mocks.status = base;
    mounted = render(<DailyCheckInCard authed guestNote />);
    expect(noteOf(mounted.container)).toBeNull();
  });
});

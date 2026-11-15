// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as 'authenticated' | 'guest',
  arcade: { games: { dew_catcher: { bestScore: 0, plays: 0, used: 0, cap: 3 }, refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 } } } as unknown,
  arcadeCalls: 0,
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/core-http', () => ({ coreHttp: {} }));
vi.mock('@tubutree/app-core/queries/game', () => ({
  gameArcadeStatusQuery: () => ({
    queryKey: ['game', 'arcade'],
    queryFn: async () => {
      mocks.arcadeCalls += 1;
      return mocks.arcade;
    },
  }),
}));

import { WeekRhythm, type WeekRhythmProps } from './week-rhythm';

// Thứ 4, 11/11/2026, 10:00 giờ VN. Tuần: Thứ 2 = 09/11 … Chủ nhật = 15/11.
const NOW = new Date('2026-11-11T03:00:00Z');
const KEY = 'tubu.week-rhythm.v1.anon';

let mounted: Rendered[] = [];
function renderRhythm(props: Partial<WeekRhythmProps> = {}) {
  const r = render(<WeekRhythm streakDays={undefined} lastCheckInAt={null} activeToday={false} {...props} />);
  mounted.push(r);
  return r;
}
const cells = (r: Rendered) => Array.from(r.container.querySelectorAll('[data-testid="week-rhythm"] li'));
const states = (r: Rendered) => cells(r).map((c) => c.getAttribute('data-state'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  mocks.phase = 'authenticated';
  mocks.arcadeCalls = 0;
  mocks.arcade = { games: { dew_catcher: { bestScore: 0, plays: 0, used: 0, cap: 3 }, refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 } } };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('WeekRhythm (web)', () => {
  it('một nhóm có tên đọc được, bảy ô T2…CN, tiêu đề và đếm 0/7; không có nút nào (chỉ để xem)', async () => {
    const r = renderRhythm();
    await flush();
    const group = r.container.querySelector('[role="group"]')!;
    expect(group.getAttribute('aria-label')).toBe('Nhịp Sống Xanh 7 Ngày, đã chăm vườn 0 trên 7 ngày');
    expect(group.textContent).toContain('Nhịp Sống Xanh 7 Ngày');
    expect(group.textContent).toContain('0/7');
    expect(cells(r).map((c) => c.textContent)).toEqual(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
    expect(group.querySelectorAll('button, a')).toHaveLength(0);
  });

  it('chuỗi kết thúc hôm qua: hai ngày trước đầy 💧, hôm nay mở và có aria-current', async () => {
    const r = renderRhythm({ streakDays: 2, lastCheckInAt: '2026-11-10T08:00:00+07:00' });
    await flush();
    expect(states(r)).toEqual(['done', 'done', 'today-open', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(r.container.textContent).toContain('2/7');
    const today = cells(r)[2]!;
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(today.getAttribute('aria-label')).toBe('Thứ Tư: hôm nay chưa chăm vườn');
    expect(cells(r)[1]!.getAttribute('aria-label')).toBe('Thứ Ba: đã chăm vườn');
    expect(cells(r)[0]!.textContent).toBe('💧');
  });

  it('hôm nay đã tưới: ô hôm nay đầy, đếm tăng, và ngày được ghi lên máy', async () => {
    const r = renderRhythm({ streakDays: 1, lastCheckInAt: '2026-11-11T09:00:00+07:00', activeToday: true });
    await flush();
    expect(states(r).slice(0, 3)).toEqual(['missed', 'missed', 'done']);
    expect(r.container.textContent).toContain('1/7');
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? '[]')).toEqual(['2026-11-11']);
  });

  it('ngày chỉ chơi mini game đã ghi trên máy hôm trước vẫn được tính', async () => {
    window.localStorage.setItem(KEY, JSON.stringify(['2026-11-09']));
    const r = renderRhythm();
    await flush();
    expect(states(r).slice(0, 3)).toEqual(['done', 'missed', 'today-open']);
  });

  it('chơi mini game hôm nay (trạng thái Arcade) đủ để ô hôm nay đầy dù chưa tưới', async () => {
    mocks.arcade = { games: { dew_catcher: { bestScore: 120, plays: 1, used: 1, cap: 3 }, refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 } } };
    const r = renderRhythm();
    await flush();
    expect(states(r)[2]).toBe('done');
    expect(r.container.textContent).toContain('1/7');
  });

  it('chưa đăng nhập: không gọi trạng thái Arcade, ô hôm nay vẫn mở', async () => {
    mocks.phase = 'guest';
    const r = renderRhythm();
    await flush();
    expect(mocks.arcadeCalls).toBe(0);
    expect(states(r)[2]).toBe('today-open');
  });

  it('bộ nhớ máy hỏng hoặc sai kiểu: dải vẫn vẽ đủ bảy ô, không ném lỗi', async () => {
    window.localStorage.setItem(KEY, '{oops');
    const r = renderRhythm();
    await flush();
    expect(cells(r)).toHaveLength(7);
    window.localStorage.setItem(KEY, '{"a":1}');
    const r2 = renderRhythm();
    await flush();
    expect(cells(r2)).toHaveLength(7);
  });
});

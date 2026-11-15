import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  real: false,
  arcade: { games: { dew_catcher: { bestScore: 0, plays: 0, used: 0, cap: 3 }, refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 } } } as unknown,
}));
vi.mock('../../hooks/use-real-user', () => ({ useRealUser: () => mocks.real }));
vi.mock('../../services/arcade-api', () => ({
  arcadeStatusQuery: { queryKey: ['game', 'arcade'], queryFn: async () => mocks.arcade },
}));

import { WeekRhythm, type WeekRhythmProps } from './week-rhythm';

// Thứ 4, 11/11/2026, 10:00 giờ VN. Tuần: Thứ 2 = 09/11 … Chủ nhật = 15/11.
const NOW = new Date('2026-11-11T03:00:00Z');
const KEY = 'tubu.week-rhythm.v1.anon';

function renderRhythm(props: Partial<WeekRhythmProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WeekRhythm streakDays={undefined} lastCheckInAt={null} activeToday={false} {...props} />
    </QueryClientProvider>,
  );
}
const cells = () => Array.from(screen.getByTestId('week-rhythm').querySelectorAll('li'));
const states = () => cells().map((c) => c.getAttribute('data-state'));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  mocks.real = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('WeekRhythm', () => {
  it('một nhóm có tên đọc được, bảy ô T2…CN, tiêu đề và đếm 0/7; không có nút nào (chỉ để xem)', () => {
    renderRhythm();
    expect(screen.getByRole('group', { name: /Nhịp Sống Xanh 7 Ngày, đã chăm vườn 0 trên 7 ngày/ })).toBeInTheDocument();
    expect(screen.getByText('Nhịp Sống Xanh 7 Ngày')).toBeInTheDocument();
    expect(screen.getByText('0/7')).toBeInTheDocument();
    expect(cells().map((c) => c.textContent)).toEqual(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('chuỗi kết thúc hôm qua: hai ngày trước đầy 💧, hôm nay mở và có aria-current', () => {
    renderRhythm({ streakDays: 2, lastCheckInAt: '2026-11-10T08:00:00+07:00' });
    expect(states()).toEqual(['done', 'done', 'today-open', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(screen.getByText('2/7')).toBeInTheDocument();
    const today = cells()[2]!;
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(today.getAttribute('aria-label')).toBe('Thứ Tư: hôm nay chưa chăm vườn');
    expect(cells()[1]!.getAttribute('aria-label')).toBe('Thứ Ba: đã chăm vườn');
    expect(cells()[0]!.textContent).toBe('💧');
  });

  it('hôm nay đã tưới: ô hôm nay đầy, đếm tăng, và ngày được ghi lên máy', async () => {
    renderRhythm({ streakDays: 1, lastCheckInAt: '2026-11-11T09:00:00+07:00', activeToday: true });
    expect(states().slice(0, 3)).toEqual(['missed', 'missed', 'done']);
    expect(screen.getByText('1/7')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(KEY) ?? '[]')).toEqual(['2026-11-11']));
  });

  it('ngày chỉ chơi mini game đã ghi trên máy hôm trước vẫn được tính', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['2026-11-09']));
    renderRhythm();
    expect(states().slice(0, 3)).toEqual(['done', 'missed', 'today-open']);
  });

  it('chơi mini game hôm nay (trạng thái Arcade của khách thật) đủ để ô hôm nay đầy dù chưa tưới', async () => {
    mocks.real = true;
    mocks.arcade = { games: { dew_catcher: { bestScore: 120, plays: 1, used: 1, cap: 3 }, refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 } } };
    renderRhythm();
    await waitFor(() => expect(states()[2]).toBe('done'));
    expect(screen.getByText('1/7')).toBeInTheDocument();
  });

  it('khách chưa phải khách thật không gọi trạng thái Arcade: ô hôm nay vẫn mở', async () => {
    mocks.real = false;
    mocks.arcade = { games: { dew_catcher: { bestScore: 9, plays: 1, used: 2, cap: 3 }, refill_rush: { bestScore: 0, plays: 0, used: 0, cap: 3 } } };
    renderRhythm();
    await Promise.resolve();
    expect(states()[2]).toBe('today-open');
  });

  it('bộ nhớ máy hỏng hoặc sai kiểu: dải vẫn vẽ đủ bảy ô, không ném lỗi', () => {
    window.localStorage.setItem(KEY, '{oops');
    renderRhythm();
    expect(cells()).toHaveLength(7);
    window.localStorage.setItem(KEY, '{"a":1}');
    renderRhythm();
    expect(screen.getAllByTestId('week-rhythm')).toHaveLength(2);
  });
});

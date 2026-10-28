import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameProfile } from '../../services/game-api';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { CheckInStreak } from './checkin-streak';

const PROFILE = { streakDays: 12, totalSeeds: 500, streakFreezes: 1, lastDewAt: null, lastCheckInAt: null } as unknown as GameProfile;

function renderStreak(profile: GameProfile = PROFILE, extra: Partial<React.ComponentProps<typeof CheckInStreak>> = {}) {
  return render(
    <CheckInStreak
      profile={profile}
      {...extra}
      onBuyFreeze={() => {}}
      freezePending={false}
      onCollectDew={() => {}}
      dewPending={false}
      onNeedWater={() => {}}
    />,
  );
}

describe('CheckInStreak', () => {
  it('không có nút "Điểm danh" thứ hai: nút điểm danh duy nhất của Vườn nằm trên cây', () => {
    renderStreak();
    expect(screen.queryByRole('button', { name: /^(Đã )?[Đđ]iểm danh$/ })).not.toBeInTheDocument();
  });

  it('"Mua" không co lại trong hàng chật', () => {
    renderStreak();
    expect(screen.getByRole('button', { name: /^Mua/ }).style.flexShrink).toBe('0');
  });

  it('thiếu nước mua vé: nút nói rõ việc, và câu giọt sương có số', () => {
    renderStreak({ ...PROFILE, totalSeeds: 0, streakFreezeCost: 80, dewSeeds: 15 } as unknown as GameProfile);
    expect(screen.getByRole('button', { name: 'Giữ chuỗi (cần thêm 80💧)' })).toBeInTheDocument();
    expect(screen.getByText(/Giọt sương sáng tặng 15💧 mỗi ngày/)).toBeInTheDocument();
  });

  const REWARDS = (claimedThrough: number) => Array.from({ length: 7 }, (_, i) => ({ day: i + 1, points: 1000, claimed: i + 1 <= claimedThrough, isToday: i + 1 === claimedThrough + 1 }));
  const STATUS = (claimedThrough: number, streakDays: number) =>
    ({ checkedInToday: false, streakDays, streakDay: claimedThrough + 1, currentCycleDay: claimedThrough + 1, rewards: REWARDS(claimedThrough) }) as never;
  const doneCells = (c: HTMLElement) => c.querySelectorAll('div[style*="action-primary-bg"]').length;

  it('lịch 7 ngày theo trạng thái chung (cùng nguồn với Ưu đãi): đã nhận 3 ngày thì 3 ô đầy', () => {
    const { container } = renderStreak({ ...PROFILE, streakDays: 12 } as unknown as GameProfile, { status: STATUS(3, 3) });
    expect(doneCells(container)).toBe(3);
    expect(screen.getByText(/Chuỗi 3 ngày/)).toBeInTheDocument();
  });

  it('chuỗi hôm qua đúng 7 (sang vòng mới): trạng thái chung nói chưa ô nào nhận, không tô cả 7 ô', () => {
    const { container } = renderStreak({ ...PROFILE, streakDays: 7 } as unknown as GameProfile, { status: STATUS(0, 7) });
    expect(doneCells(container)).toBe(0);
  });

  it('chưa có trạng thái chung: dựng tạm từ hồ sơ Vườn như trước', () => {
    const { container } = renderStreak({ ...PROFILE, streakDays: 2 } as unknown as GameProfile);
    expect(doneCells(container)).toBe(2);
  });

  it('trạng thái chung tải lỗi: một dòng báo + Thử lại gọi lại việc tải', () => {
    const retry = vi.fn();
    renderStreak(PROFILE, { statusError: true, onRetryStatus: retry });
    expect(screen.getByText('Chưa tải được lịch điểm danh')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

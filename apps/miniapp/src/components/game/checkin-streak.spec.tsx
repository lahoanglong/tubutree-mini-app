import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameProfile } from '../../services/game-api';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { CheckInStreak } from './checkin-streak';

const PROFILE = { streakDays: 12, totalSeeds: 500, streakFreezes: 1, lastDewAt: null, lastCheckInAt: null } as unknown as GameProfile;

function renderStreak(profile: GameProfile = PROFILE, allDone = false) {
  return render(
    <CheckInStreak
      profile={profile}
      allDone={allDone}
      onCheckIn={() => {}}
      checkInPending={false}
      onBuyFreeze={() => {}}
      freezePending={false}
      onCollectDew={() => {}}
      dewPending={false}
      onNeedWater={() => {}}
    />,
  );
}

describe('CheckInStreak — nút trong hàng chật', () => {
  it('"Điểm danh" và "Mua" không co lại cạnh tiêu đề dài: nhãn không bị cắt thành "Điểm d…"', () => {
    renderStreak();
    expect(screen.getByRole('button', { name: 'Điểm danh' }).style.flexShrink).toBe('0');
    expect(screen.getByRole('button', { name: /^Mua/ }).style.flexShrink).toBe('0');
  });

  it('đã điểm danh hôm nay: nút "Đã điểm danh" cũng giữ nguyên bề rộng', () => {
    renderStreak({ ...PROFILE, lastCheckInAt: new Date().toISOString() }, true);
    expect(screen.getByRole('button', { name: 'Đã điểm danh' }).style.flexShrink).toBe('0');
  });

  it('xong giọt nước nhưng Điểm Xanh còn thiếu (trạng thái gộp chưa xong): nút vẫn bấm được để nhận nốt, không bị khoá', () => {
    renderStreak({ ...PROFILE, lastCheckInAt: new Date().toISOString() }, false);
    expect(screen.getByRole('button', { name: 'Điểm danh' })).toBeEnabled();
  });
});

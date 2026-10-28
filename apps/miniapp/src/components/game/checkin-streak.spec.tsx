import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameProfile } from '../../services/game-api';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { CheckInStreak } from './checkin-streak';

const PROFILE = { streakDays: 12, totalSeeds: 500, streakFreezes: 1, lastDewAt: null, lastCheckInAt: null } as unknown as GameProfile;

function renderStreak(profile: GameProfile = PROFILE) {
  return render(
    <CheckInStreak
      profile={profile}
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
});

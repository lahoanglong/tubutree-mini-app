import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GameProfile } from '../../services/game-api';

vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { TreeActions } from './tree-actions';

// Phần nước đã nhận hôm nay (lastCheckInAt là hôm nay), còn phần điểm danh Điểm Xanh dở: nút chuyển sang nhãn "nhận điểm".
const PROFILE = { totalSeeds: 5, lastCheckInAt: new Date().toISOString(), lastDewAt: null, harvestReady: false } as unknown as GameProfile;

function renderActions(extra: Partial<React.ComponentProps<typeof TreeActions>> = {}, onClaim = vi.fn()) {
  render(<TreeActions profile={PROFILE} pointsPending pending={false} onClaim={onClaim} onWater={() => {}} onHarvest={() => {}} onEarn={() => {}} {...extra} />);
  return onClaim;
}

describe('TreeActions: nhãn khi còn dở phần điểm danh', () => {
  it('user thật: "Nhận Điểm Xanh hôm nay"', () => {
    renderActions();
    expect(screen.getByRole('button', { name: 'Nhận Điểm Xanh hôm nay' })).toBeInTheDocument();
  });

  it('khách vãng lai (pointsBlocked): "Điểm danh hôm nay", không hứa Điểm Xanh, vẫn gọi onClaim', () => {
    const onClaim = renderActions({ pointsBlocked: true });
    expect(screen.queryByRole('button', { name: /Điểm Xanh/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Điểm danh hôm nay' }));
    expect(onClaim).toHaveBeenCalledTimes(1);
  });
});

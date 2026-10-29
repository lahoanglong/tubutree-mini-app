import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionItem } from '@tubutree/app-core/api/game';

const mocks = vi.hoisted(() => ({ ensurePhone: vi.fn() }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ ensurePhoneOrThrow: mocks.ensurePhone }),
}));

import { MissionsCard } from './missions-card';

const DONE: MissionItem = { code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', rewardPoints: 20_000, progress: 1, goal: 1, completed: true, claimed: false };
const OPEN: MissionItem = { code: 'REVIEW_3', title: 'Nhà phê bình', rewardPoints: 15_000, progress: 1, goal: 3, completed: false, claimed: false };

function card(missions: MissionItem[], onClaim = vi.fn()) {
  return render(<MissionsCard missions={missions} streakDays={0} claimPending={false} claimVariables={undefined} onClaim={onClaim} />);
}

describe('MissionsCard: khách vãng lai không được hứa Điểm Xanh', () => {
  beforeEach(() => mocks.ensurePhone.mockReset());

  it('user thật: có "+N Điểm Xanh" và nút Nhận thưởng khi đủ điều kiện, không có câu mời đăng nhập', () => {
    const onClaim = vi.fn();
    card([DONE, OPEN], onClaim);
    expect(screen.getByText('+20.000 Điểm Xanh')).toBeInTheDocument();
    expect(screen.queryByTestId('guest-points-note')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nhận thưởng' }));
    expect(onClaim).toHaveBeenCalledWith('FIRST_ORDER');
  });

  it('khách vãng lai: một câu mời đăng nhập cho cả thẻ, không chữ "+N Điểm Xanh", không nút Nhận thưởng; tiến độ vẫn hiện', () => {
    card([{ ...DONE, pointsBlocked: 'GUEST' }, { ...OPEN, pointsBlocked: 'GUEST' }]);
    expect(screen.getAllByTestId('guest-points-note')).toHaveLength(1);
    expect(screen.getByTestId('guest-points-note')).toHaveTextContent('Đăng nhập Zalo để nhận Điểm Xanh');
    expect(screen.queryByText(/\+[\d.]+ Điểm Xanh/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nhận thưởng' })).not.toBeInTheDocument();
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('nút Đăng nhập Zalo gọi luồng liên kết sẵn có', async () => {
    mocks.ensurePhone.mockResolvedValue('0901234567');
    card([{ ...DONE, pointsBlocked: 'GUEST' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập Zalo' }));
    await waitFor(() => expect(mocks.ensurePhone).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đăng nhập Zalo' })).toBeEnabled());
  });
});

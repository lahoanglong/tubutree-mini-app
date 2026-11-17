import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MissionItem } from '@tubutree/app-core/api/game';
import type { DailyMissionsResponse } from '@tubutree/shared-types';

const mocks = vi.hoisted(() => ({ ensurePhone: vi.fn(), status: 'unauthenticated' as string, get: vi.fn(), post: vi.fn(), snack: vi.fn() }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ ensurePhoneOrThrow: mocks.ensurePhone, status: mocks.status }),
}));
vi.mock('../../services/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('zmp-ui', async (orig) => ({ ...(await orig<typeof import('zmp-ui')>()), useSnackbar: () => ({ openSnackbar: mocks.snack }) }));

import { MissionsCard } from './missions-card';

const wrap = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;

const DONE: MissionItem = { code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', rewardPoints: 20_000, progress: 1, goal: 1, completed: true, claimed: false };
const OPEN: MissionItem = { code: 'REVIEW_3', title: 'Nhà phê bình', rewardPoints: 15_000, progress: 1, goal: 3, completed: false, claimed: false };

function card(missions: MissionItem[], onClaim = vi.fn()) {
  return render(wrap(<MissionsCard missions={missions} streakDays={0} claimPending={false} claimVariables={undefined} onClaim={onClaim} onGo={vi.fn()} />));
}

describe('MissionsCard: khách vãng lai không được hứa Điểm Xanh', () => {
  beforeEach(() => {
    mocks.ensurePhone.mockReset();
    mocks.status = 'unauthenticated';
  });

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

const DAILY: DailyMissionsResponse = {
  enabled: true,
  dayKey: '2026-11-17',
  missions: [
    { id: 'DAILY_QUIZ', done: true, claimed: true },
    { id: 'DAILY_STORY', done: true, claimed: false },
    { id: 'DAILY_WATER', done: false, claimed: false },
  ],
  water: 5,
  bonusPoints: 10,
  bonusClaimed: false,
  pointsBlocked: false,
  waterLeft: 35,
  pointsLeft: 100,
  quizPending: false,
};

describe('MissionsCard: phần Hôm nay (nhiệm vụ hằng ngày)', () => {
  beforeEach(() => {
    mocks.status = 'authenticated';
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.snack.mockReset();
  });

  it('cờ tắt: thẻ như cũ, không có phần Hôm nay, nhiệm vụ một lần hiện ngay', async () => {
    mocks.get.mockResolvedValue({ enabled: false });
    card([DONE, OPEN]);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/game/daily'));
    expect(screen.queryByTestId('daily-missions')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhận thưởng' })).toBeInTheDocument();
  });

  it('API cũ (404): thẻ như cũ', async () => {
    mocks.get.mockRejectedValue(Object.assign(new Error('404'), { status: 404 }));
    card([DONE, OPEN]);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    expect(screen.queryByTestId('daily-missions')).not.toBeInTheDocument();
    expect(screen.getByText('Đơn hàng đầu tiên')).toBeInTheDocument();
  });

  it('cờ bật: 3 dòng Hôm nay đứng đầu, nhiệm vụ một lần thu sau một nút', async () => {
    mocks.get.mockResolvedValue(DAILY);
    card([{ ...DONE, claimed: true }, OPEN]);
    expect(await screen.findByTestId('daily-missions')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('Xong cả 3 nhiệm vụ: +10 Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhận thưởng: Xem một sản phẩm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Làm nhiệm vụ: Tưới cây' })).toBeInTheDocument();
    expect(screen.queryByText('Nhà phê bình')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xem nhiệm vụ một lần (2)' }));
    expect(screen.getByText('Nhà phê bình')).toBeInTheDocument();
  });

  it('nhiệm vụ một lần có thưởng chờ nhận: mở sẵn, không có nút gập', async () => {
    mocks.get.mockResolvedValue(DAILY);
    card([DONE, OPEN]);
    expect(await screen.findByTestId('daily-missions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhận thưởng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Xem nhiệm vụ một lần/ })).not.toBeInTheDocument();
  });

  it('tài khoản mới chưa đủ tuổi: báo chờ, không báo lỗi chung', async () => {
    mocks.get.mockResolvedValue(DAILY);
    mocks.post.mockRejectedValue({ status: 403, code: 'DAILY_TOO_NEW' });
    card([OPEN]);
    fireEvent.click(await screen.findByRole('button', { name: 'Nhận thưởng: Xem một sản phẩm' }));
    await waitFor(() => expect(mocks.snack).toHaveBeenCalledWith({ text: 'Tài khoản mới tạo chưa nhận được thưởng nhiệm vụ, bạn quay lại sau nhé.', type: 'error' }));
  });

  it('nhận thưởng: gửi mã thiết bị game 32 ký tự, báo thưởng thật', async () => {
    mocks.get.mockResolvedValue(DAILY);
    mocks.post.mockResolvedValue({ id: 'DAILY_STORY', water: 5, points: 0, bonus: false, capped: [], totalSeeds: 105 });
    card([DONE]);
    fireEvent.click(await screen.findByRole('button', { name: 'Nhận thưởng: Xem một sản phẩm' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const [path, body] = mocks.post.mock.calls[0]!;
    expect(path).toBe('/game/daily/DAILY_STORY/claim');
    expect((body as { deviceId: string }).deviceId).toMatch(/^[0-9a-f]{32}$/);
    await waitFor(() => expect(mocks.snack).toHaveBeenCalledWith({ text: 'Đã nhận +5 💧', type: 'success' }));
  });
});

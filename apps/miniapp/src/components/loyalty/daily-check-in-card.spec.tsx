import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckInStatusResponse } from '@tubutree/app-core/api/loyalty';

const mocks = vi.hoisted(() => ({
  status: null as CheckInStatusResponse | null,
  ensurePhone: vi.fn(),
  checkIn: vi.fn(),
}));
vi.mock('../../hooks/use-check-in', () => ({
  useCheckIn: () => ({
    status: mocks.status,
    statusQ: { isLoading: false, isError: false, refetch: vi.fn() },
    view: mocks.status ? { canCheckIn: !mocks.status.checkedInToday, buttonLabel: mocks.status.checkedInToday ? 'Đã điểm danh' : 'Điểm danh' } : null,
    pending: false,
    checkIn: mocks.checkIn,
  }),
}));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ ensurePhoneOrThrow: mocks.ensurePhone }),
}));

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

describe('DailyCheckInCard: khách vãng lai không được hứa Điểm Xanh', () => {
  beforeEach(() => {
    mocks.ensurePhone.mockReset();
    mocks.status = null;
  });

  it('user thật: hứa "+1.000 Điểm Xanh · +10 giọt nước", không có câu mời đăng nhập', () => {
    mocks.status = base;
    render(<DailyCheckInCard authed />);
    expect(screen.getByText('Hôm nay nhận +1.000 Điểm Xanh · +10 giọt nước')).toBeInTheDocument();
    expect(screen.queryByTestId('guest-points-note')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ngày 1: +1.000 Điểm Xanh')).toBeInTheDocument();
  });

  it('tiêu đề "Điểm danh mỗi ngày" dưới 22px: Inter, không Fraunces (Q1)', () => {
    mocks.status = base;
    render(<DailyCheckInCard authed />);
    const h = screen.getByRole('heading', { name: 'Điểm danh mỗi ngày' });
    expect(h.style.fontFamily).toContain('--font-ui');
    expect(h.style.fontFamily).not.toContain('--font-display');
  });

  it('khách vãng lai: giọt nước vẫn hiện, không chữ "+N Điểm Xanh", có câu và nút đăng nhập Zalo', async () => {
    mocks.status = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };
    render(<DailyCheckInCard authed />);
    expect(screen.getByText('Hôm nay nhận +10 giọt nước')).toBeInTheDocument();
    const note = await screen.findByTestId('guest-points-note');
    expect(note).toHaveTextContent('Đăng nhập Zalo để nhận Điểm Xanh');
    expect(screen.queryByText(/\+[\d.]+ Điểm Xanh/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ngày 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Điểm danh' })).toBeEnabled();
  });

  it('guestNote={false} (đã có thẻ mời liên kết Zalo ở trên): không vẽ ghi chú dù pointsBlocked; mặc định vẫn có', async () => {
    mocks.status = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };
    const { unmount } = render(<DailyCheckInCard authed guestNote={false} />);
    expect(screen.getByText('Hôm nay nhận +10 giọt nước')).toBeInTheDocument();
    // Ghi chú là chunk nạp lười: nạp trước rồi chờ một nhịp, để "không thấy" nghĩa là không vẽ chứ không phải chưa tới.
    await import('./guest-points-note');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('guest-points-note')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đăng nhập Zalo' })).not.toBeInTheDocument();
    unmount();
    render(<DailyCheckInCard authed />);
    expect(await screen.findByTestId('guest-points-note')).toBeInTheDocument();
  });

  it('nút Đăng nhập Zalo gọi luồng liên kết sẵn có (ensurePhoneOrThrow)', async () => {
    mocks.ensurePhone.mockResolvedValue('0901234567');
    mocks.status = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };
    render(<DailyCheckInCard authed />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập Zalo' }));
    await waitFor(() => expect(mocks.ensurePhone).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Đăng nhập Zalo' })).toBeEnabled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('khách từ chối chia sẻ số điện thoại: báo thử lại, nút bấm lại được', async () => {
    mocks.ensurePhone.mockResolvedValue(null);
    mocks.status = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };
    render(<DailyCheckInCard authed />);
    fireEvent.click(await screen.findByRole('button', { name: 'Đăng nhập Zalo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa đăng nhập được Zalo. Bạn thử lại nhé.');
  });

  it('khách đã điểm danh hôm nay: vẫn có câu mời, thể lệ không nhắc Điểm Xanh', async () => {
    mocks.status = { ...base, checkedInToday: true, todayPoints: 0, pointsBlocked: 'GUEST' };
    render(<DailyCheckInCard authed />);
    expect(await screen.findByTestId('guest-points-note')).toBeInTheDocument();
    const rule = screen.getByTestId('daily-check-in').textContent ?? '';
    expect(rule).toContain('nhận giọt nước');
    expect(rule).not.toContain('Một lần bấm nhận cả Điểm Xanh');
  });
});

describe('DailyCheckInCard compact (Ưu đãi): luật gập lại', () => {
  beforeEach(() => {
    mocks.checkIn.mockReset();
    mocks.status = base;
  });

  it('luật gập sẵn sau nút "Luật điểm danh" (aria-expanded); bấm mở đoạn luật, bấm lại gập; không còn luật đứng sẵn', () => {
    render(<DailyCheckInCard authed compact />);
    const toggle = screen.getByRole('button', { name: 'Luật điểm danh' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const rule = screen.getByText(/Một lần bấm nhận cả Điểm Xanh và giọt nước/);
    expect(rule).not.toBeVisible();
    expect(toggle.getAttribute('aria-controls')).toBe(rule.parentElement!.id);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(rule).toBeVisible();
    fireEvent.click(toggle);
    expect(rule).not.toBeVisible();
  });

  it('nút Điểm danh nằm hàng tiêu đề (không full-width ở dòng riêng), vẫn đúng một nút Điểm danh và bấm gọi checkIn', () => {
    render(<DailyCheckInCard authed compact />);
    const heading = screen.getByRole('heading', { name: 'Điểm danh mỗi ngày' });
    const button = screen.getByRole('button', { name: 'Điểm danh' });
    expect(heading.parentElement!.parentElement).toContainElement(button);
    fireEvent.click(button);
    expect(mocks.checkIn).toHaveBeenCalledTimes(1);
  });

  it('khách vãng lai: mở luật chỉ thấy bản không nhắc Điểm Xanh; bản đầy đủ vẫn vẽ luật sẵn và không có nút luật', async () => {
    mocks.status = { ...base, todayPoints: 0, pointsBlocked: 'GUEST' };
    const { unmount } = render(<DailyCheckInCard authed compact />);
    fireEvent.click(screen.getByRole('button', { name: 'Luật điểm danh' }));
    const text = screen.getByTestId('daily-check-in').textContent ?? '';
    expect(text).toContain('nhận giọt nước');
    expect(text).not.toContain('Một lần bấm nhận cả Điểm Xanh');
    unmount();
    mocks.status = base;
    render(<DailyCheckInCard authed />);
    expect(screen.queryByRole('button', { name: 'Luật điểm danh' })).toBeNull();
    expect(screen.getByText(/Một lần bấm nhận cả Điểm Xanh và giọt nước/)).toBeVisible();
  });

  it('nút luật đứng cạnh "Ngày n/7" dưới tiêu đề: chữ nhìn thấy "Luật", tên đọc "Luật điểm danh"; đoạn luật mở ngay dưới hàng đầu, trước 7 ô', () => {
    render(<DailyCheckInCard authed compact />);
    const toggle = screen.getByRole('button', { name: 'Luật điểm danh' });
    expect(toggle).toHaveTextContent(/^Luật$/);
    const heading = screen.getByRole('heading', { name: 'Điểm danh mỗi ngày' });
    expect(heading.parentElement).toContainElement(toggle);
    expect(heading.parentElement).toHaveTextContent('Ngày 1/7');
    const rule = screen.getByText(/Một lần bấm nhận cả Điểm Xanh và giọt nước/).parentElement!;
    const firstDay = screen.getByLabelText('Ngày 1: +1.000 Điểm Xanh');
    expect(rule.compareDocumentPosition(firstDay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hàng cuối dưới 7 ô luôn có một dòng chữ nhỏ: phần thưởng hôm nay, hoặc "đã điểm danh" khi xong (thẻ không đổi cao sau khi điểm danh)', () => {
    const { unmount } = render(<DailyCheckInCard authed compact />);
    expect(screen.getByText('Nhận +1.000 Điểm Xanh · +10 giọt nước')).toBeInTheDocument();
    expect(screen.queryByText('Hôm nay bạn đã điểm danh rồi')).toBeNull();
    unmount();
    mocks.status = { ...base, checkedInToday: true, todayPoints: 0, todayWater: 0, pointsDone: true, waterDone: true };
    const done = render(<DailyCheckInCard authed compact />);
    expect(screen.getByText('Hôm nay bạn đã điểm danh rồi')).toBeInTheDocument();
    expect(screen.queryByText(/Hôm nay nhận/)).toBeNull();
    done.unmount();
    // Bản đầy đủ (trang Điểm Xanh) không có dòng này: nút khoá đã đủ nói.
    render(<DailyCheckInCard authed />);
    expect(screen.queryByText('Hôm nay bạn đã điểm danh rồi')).toBeNull();
  });

  it('đã điểm danh hôm nay: nút khoá nhưng vẫn thấy ("Đã điểm danh"), nút luật vẫn bấm mở được', () => {
    mocks.status = { ...base, checkedInToday: true };
    render(<DailyCheckInCard authed compact />);
    const done = screen.getByRole('button', { name: 'Đã điểm danh' });
    expect(done).toBeVisible();
    fireEvent.click(done);
    expect(mocks.checkIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Luật điểm danh' }));
    expect(screen.getByText(/Một lần bấm nhận cả Điểm Xanh và giọt nước/)).toBeVisible();
  });
});

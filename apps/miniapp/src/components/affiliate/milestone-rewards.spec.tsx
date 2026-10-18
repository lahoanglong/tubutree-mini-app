import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CtvMilestoneItem, CtvMilestonesResponse } from '../../services/affiliate-api';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), claim: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/affiliate-api', () => ({ claimCtvMilestone: mocks.claim }));
vi.mock('../../services/api', () => ({ getErrorMessage: (e: unknown) => (e as Error).message }));

import { MilestoneRewards } from './milestone-rewards';

const m = (id: string, over: Partial<CtvMilestoneItem> = {}): CtvMilestoneItem => ({
  id, title: `Mốc ${id}`, threshold: 1_000_000, rewardPoints: 50, description: `Doanh số ${id}`,
  achieved: false, claimed: false, canClaim: false, progressPct: 40, ...over,
});
const claimable = (id: string, pts = 50) => m(id, { achieved: true, canClaim: true, progressPct: 100, rewardPoints: pts });

const data = (over: Partial<CtvMilestonesResponse> = {}): CtvMilestonesResponse => ({
  monthKey: '2026-10', currentRevenue: 4_000_000, pendingRevenue: 0, holdDays: 20,
  milestones: [m('A', { claimed: true, achieved: true, progressPct: 100 }), claimable('B', 200), m('C', { threshold: 5_000_000 })],
  previousMonth: null, ...over,
});

let qc: QueryClient;
function renderRewards(d: CtvMilestonesResponse) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MilestoneRewards data={d} /></QueryClientProvider>);
}

describe('MilestoneRewards — danh sách gọn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mỗi mốc một dòng: thưởng bằng điểm, đã nhận có nhãn, đạt chưa nhận có nút, chưa đạt có chữ còn thiếu', () => {
    renderRewards(data());
    expect(screen.getByText('+200 điểm')).toBeInTheDocument();
    expect(screen.getAllByText('+50 điểm')).toHaveLength(2);
    expect(screen.getByText('Đã nhận')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nhận thưởng' })).toBeInTheDocument();
    expect(screen.getByText('Còn thiếu 1.000.000đ doanh số đã chốt')).toBeInTheDocument();
    expect(screen.getByText('Thưởng mốc doanh số tháng')).toBeInTheDocument();
    expect(screen.getByText(/tháng 10\/2026/)).toBeInTheDocument();
  });

  it('một mốc nhận được: không có nút Nhận tất cả, nút trên dòng gọi đúng mốc và tháng', async () => {
    mocks.claim.mockResolvedValue({ success: true, message: 'Đã cộng 200 điểm', rewardPoints: 200, monthKey: '2026-10' });
    renderRewards(data());
    expect(screen.queryByRole('button', { name: /Nhận tất cả/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nhận thưởng' }));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledWith('B', '2026-10'));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cộng 200 điểm', type: 'success' });
  });

  it('không có mốc nào: không vẽ gì', () => {
    const { container } = renderRewards(data({ milestones: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it('còn thưởng tháng trước chưa nhận: có nhóm riêng, hạn nhận nói rõ', () => {
    renderRewards(data({ previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1')] } }));
    expect(screen.getByText(/Thưởng tháng 9\/2026 chưa nhận/)).toBeInTheDocument();
    expect(screen.getByText('Mốc P1')).toBeInTheDocument();
  });
});

describe('MilestoneRewards — Nhận tất cả', () => {
  beforeEach(() => vi.clearAllMocks());
  const two = () => data({
    milestones: [claimable('B', 200), claimable('C', 50)],
    previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1', 100)] },
  });

  it('từ 2 mốc nhận được trở lên: hiện nút ghi số mốc và tổng điểm', () => {
    renderRewards(two());
    expect(screen.getByRole('button', { name: 'Nhận tất cả (3 mốc, +350 điểm)' })).toBeInTheDocument();
  });

  it('gọi API từng mốc tuần tự, tháng trước trước, mốc sau chỉ bắt đầu khi mốc trước xong', async () => {
    const releases: Array<() => void> = [];
    mocks.claim.mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve({ success: true, message: 'ok', rewardPoints: 1, monthKey: 'x' }))),
    );
    renderRewards(two());
    fireEvent.click(screen.getByRole('button', { name: /Nhận tất cả/ }));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(1));
    expect(mocks.claim).toHaveBeenNthCalledWith(1, 'P1', '2026-09');
    releases[0]!();
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(2));
    expect(mocks.claim).toHaveBeenNthCalledWith(2, 'B', '2026-10');
    releases[1]!();
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(3));
    expect(mocks.claim).toHaveBeenNthCalledWith(3, 'C', '2026-10');
    releases[2]!();
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã nhận 3 mốc thưởng.', type: 'success' }));
  });

  it('đang chạy: nút báo bận và bấm thêm không gọi lần nữa', async () => {
    mocks.claim.mockReturnValue(new Promise(() => {}));
    renderRewards(two());
    const btn = screen.getByRole('button', { name: /Nhận tất cả/ });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(btn);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it('một mốc lỗi: các mốc còn lại vẫn nhận, lỗi báo đúng tên mốc, danh sách tải lại', async () => {
    mocks.claim
      .mockResolvedValueOnce({ success: true, message: 'ok', rewardPoints: 100, monthKey: '2026-09' })
      .mockRejectedValueOnce(new Error('Mốc này đã nhận rồi'))
      .mockResolvedValueOnce({ success: true, message: 'ok', rewardPoints: 50, monthKey: '2026-10' });
    const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderRewards(two());
    fireEvent.click(screen.getByRole('button', { name: /Nhận tất cả/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Mốc B: Mốc này đã nhận rồi');
    expect(alert).not.toHaveTextContent('Mốc C');
    expect(mocks.claim).toHaveBeenCalledTimes(3);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã nhận 2/3 mốc. Có 1 mốc chưa nhận được, xem bên dưới.', type: 'warning' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['affiliate-milestones'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['loyalty'] });
    invalidate.mockRestore();
  });

  it('mọi mốc lỗi: báo lỗi, không báo thành công', async () => {
    mocks.claim.mockRejectedValue(new Error('Lỗi mạng'));
    renderRewards(two());
    fireEvent.click(screen.getByRole('button', { name: /Nhận tất cả/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Mốc P1: Lỗi mạng');
    expect(alert).toHaveTextContent('Mốc B: Lỗi mạng');
    expect(alert).toHaveTextContent('Mốc C: Lỗi mạng');
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Chưa nhận được mốc nào. Xem lý do bên dưới.', type: 'error' });
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('bấm lại thì xoá danh sách lỗi cũ', async () => {
    mocks.claim.mockRejectedValueOnce(new Error('A hỏng')).mockResolvedValue({ success: true, message: 'ok', rewardPoints: 1, monthKey: 'x' });
    renderRewards(data({ milestones: [claimable('B'), claimable('C')] }));
    fireEvent.click(screen.getByRole('button', { name: /Nhận tất cả/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mốc B: A hỏng');
    fireEvent.click(screen.getByRole('button', { name: /Nhận tất cả/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import type { CtvMilestoneItem, CtvMilestonesResponse } from '../../services/affiliate-api';
import { LOCK_REFRESH_WAIT_MS } from '../../utils/settle-within';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), claim: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/affiliate-api', () => ({ claimCtvMilestone: mocks.claim }));
vi.mock('../../services/api', () => ({ getErrorMessage: (e: unknown) => (e as Error).message, getLoadErrorMessage: (e: unknown) => (e as Error).message }));

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

  it('mặc định chỉ hiện mốc nhận được và mốc kế tiếp; "Xem tất cả" mở đủ, "Thu gọn" gập lại', () => {
    renderRewards(data());
    expect(screen.getByText('Mốc B')).toBeInTheDocument();
    expect(screen.getByText('Mốc C')).toBeInTheDocument();
    expect(screen.queryByText('Mốc A')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả 3 mốc' }));
    expect(screen.getByText('Mốc A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn' }));
    expect(screen.queryByText('Mốc A')).toBeNull();
  });

  it('mỗi mốc một dòng: thưởng bằng điểm, đã nhận có nhãn, đạt chưa nhận có nút, chưa đạt có chữ còn thiếu', () => {
    renderRewards(data());
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả 3 mốc' }));
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
    expect(alert).toHaveTextContent('Mốc B (tháng 10/2026): Mốc này đã nhận rồi');
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
    expect(alert).toHaveTextContent('Mốc P1 (tháng 9/2026): Lỗi mạng');
    expect(alert).toHaveTextContent('Mốc B (tháng 10/2026): Lỗi mạng');
    expect(alert).toHaveTextContent('Mốc C (tháng 10/2026): Lỗi mạng');
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Chưa nhận được mốc nào. Xem lý do bên dưới.', type: 'error' });
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('cùng một mốc lỗi ở cả hai tháng: hai dòng riêng, mỗi dòng ghi đúng tháng, không trùng key', async () => {
    mocks.claim.mockRejectedValue(new Error('Lỗi mạng'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRewards(data({
      milestones: [claimable('B')],
      previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('B')] },
    }));
    fireEvent.click(screen.getByRole('button', { name: /Nhận tất cả/ }));
    const alert = await screen.findByRole('alert');
    expect(Array.from(alert.children).map((c) => c.textContent)).toEqual([
      'Mốc B (tháng 9/2026): Lỗi mạng',
      'Mốc B (tháng 10/2026): Lỗi mạng',
    ]);
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key');
    consoleError.mockRestore();
  });

  it('bấm lại thì xoá danh sách lỗi cũ', async () => {
    mocks.claim.mockRejectedValueOnce(new Error('A hỏng')).mockResolvedValue({ success: true, message: 'ok', rewardPoints: 1, monthKey: 'x' });
    renderRewards(data({ milestones: [claimable('B'), claimable('C')] }));
    fireEvent.click(screen.getByRole('button', { name: /Nhận tất cả/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mốc B (tháng 10/2026): A hỏng');
    fireEvent.click(screen.getByRole('button', { name: /Nhận tất cả/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

const OK = { success: true, message: 'ok', rewardPoints: 1, monthKey: 'x' };
const neverSettles = () => new Promise<never>(() => {});
const two = () =>
  data({
    milestones: [claimable('B', 200), claimable('C', 50)],
    previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1', 100)] },
  });
const allBtn = () => screen.getByRole('button', { name: /Nhận tất cả/ });
const rowBtns = () => screen.getAllByRole('button', { name: 'Nhận thưởng' });

describe('MilestoneRewards — aria-controls của nút Xem tất cả / Thu gọn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nút trỏ tới đúng danh sách mốc tháng này, dù đang gập hay mở; nhóm tháng trước nằm ngoài danh sách', () => {
    renderRewards(data({ previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1')] } }));
    const toggle = screen.getByRole('button', { name: 'Xem tất cả 3 mốc' });
    const id = toggle.getAttribute('aria-controls')!;
    expect(id).toBeTruthy();
    const list = document.getElementById(id)!;
    expect(list).not.toBeNull();
    expect(within(list).getByText('Mốc B')).toBeInTheDocument();
    expect(within(list).queryByText('Mốc A')).toBeNull();
    expect(within(list).queryByText('Mốc P1')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Thu gọn' })).toHaveAttribute('aria-controls', id);
    expect(within(document.getElementById(id)!).getByText('Mốc A')).toBeInTheDocument();
  });

  it('hai thẻ cùng trang có id danh sách khác nhau (không trùng id)', () => {
    qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MilestoneRewards data={data()} />
        <MilestoneRewards data={data()} />
      </QueryClientProvider>,
    );
    const ids = screen.getAllByRole('button', { name: 'Xem tất cả 3 mốc' }).map((b) => b.getAttribute('aria-controls'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('MilestoneRewards — khoá nhận thưởng đồng bộ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockReset();
  });

  it('hai cú chạm sát nhau vào cùng "Nhận thưởng" trước khi vẽ lại: chỉ gọi API một lần', async () => {
    mocks.claim.mockReturnValue(neverSettles());
    renderRewards(data());
    const btn = screen.getByRole('button', { name: 'Nhận thưởng' });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it('hai cú chạm sát nhau vào "Nhận tất cả": chỉ một lượt (mốc đầu chỉ gọi một lần)', async () => {
    mocks.claim.mockReturnValue(neverSettles());
    renderRewards(two());
    const btn = allBtn();
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledWith('P1', '2026-09');
  });

  it('"Nhận thưởng" rồi "Nhận tất cả" cùng một nhịp: chỉ lượt đầu chạy', async () => {
    mocks.claim.mockReturnValue(neverSettles());
    renderRewards(two());
    const row = rowBtns().at(-1)!;
    const all = allBtn();
    await act(async () => {
      fireEvent.click(row);
      fireEvent.click(all);
    });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledWith('C', '2026-10');
  });

  it('"Nhận tất cả" rồi "Nhận thưởng" cùng một nhịp: chỉ lượt đầu chạy', async () => {
    mocks.claim.mockReturnValue(neverSettles());
    renderRewards(two());
    const row = rowBtns().at(-1)!;
    const all = allBtn();
    await act(async () => {
      fireEvent.click(all);
      fireEvent.click(row);
    });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.claim).toHaveBeenCalledWith('P1', '2026-09');
  });

  it('nhận xong (thành công) thì nhận tiếp được: khoá nhả khi mutation kết thúc', async () => {
    mocks.claim.mockResolvedValue(OK);
    renderRewards(data());
    fireEvent.click(screen.getByRole('button', { name: 'Nhận thưởng' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Nhận thưởng' }));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(2));
  });

  it('nhận lỗi thì nhận lại được: khoá nhả cả khi mutation lỗi', async () => {
    mocks.claim.mockRejectedValue(new Error('Mạng chập chờn'));
    renderRewards(data());
    fireEvent.click(screen.getByRole('button', { name: 'Nhận thưởng' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Mạng chập chờn', type: 'error' }));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Nhận thưởng' }));
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(2));
  });

  it('Nhận tất cả xong thì nhận lại được: khoá nhả khi cả lượt kết thúc', async () => {
    mocks.claim.mockResolvedValue(OK);
    renderRewards(two());
    fireEvent.click(allBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã nhận 3 mốc thưởng.', type: 'success' }));
    await act(async () => {});
    fireEvent.click(allBtn());
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(6));
  });

  it('Nhận tất cả với mọi mốc lỗi vẫn nhả khoá để thử lại', async () => {
    mocks.claim.mockRejectedValue(new Error('Lỗi mạng'));
    renderRewards(two());
    fireEvent.click(allBtn());
    await screen.findByRole('alert');
    await act(async () => {});
    fireEvent.click(allBtn());
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(6));
  });
});

describe('MilestoneRewards — làm mới sau khi nhận', () => {
  let inv: MockInstance<QueryClient['invalidateQueries']>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockReset();
    inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
  });
  afterEach(() => inv.mockRestore());
  const keys = () => inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

  it('Nhận tất cả có mốc nhận được: tải lại danh sách mốc và Điểm Xanh', async () => {
    mocks.claim.mockResolvedValue(OK);
    renderRewards(two());
    fireEvent.click(allBtn());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(keys()).toContain('["affiliate-milestones"]');
    expect(keys()).toContain('["loyalty"]');
  });

  it('Nhận tất cả một phần lỗi (done > 0): vẫn tải lại cả hai', async () => {
    mocks.claim.mockResolvedValueOnce(OK).mockRejectedValueOnce(new Error('Đã nhận rồi')).mockResolvedValueOnce(OK);
    renderRewards(two());
    fireEvent.click(allBtn());
    await screen.findByRole('alert');
    expect(keys()).toContain('["affiliate-milestones"]');
    expect(keys()).toContain('["loyalty"]');
  });

  it('Nhận tất cả mà mọi mốc lỗi (done === 0): chỉ tải lại danh sách mốc, không tải lại Điểm Xanh', async () => {
    mocks.claim.mockRejectedValue(new Error('Lỗi mạng'));
    renderRewards(two());
    fireEvent.click(allBtn());
    await screen.findByRole('alert');
    expect(keys()).toContain('["affiliate-milestones"]');
    expect(keys()).not.toContain('["loyalty"]');
  });

  it('Nhận thưởng một mốc thành công: tải lại danh sách mốc và Điểm Xanh', async () => {
    mocks.claim.mockResolvedValue(OK);
    renderRewards(data());
    fireEvent.click(screen.getByRole('button', { name: 'Nhận thưởng' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledTimes(1));
    expect(keys()).toContain('["affiliate-milestones"]');
    expect(keys()).toContain('["loyalty"]');
  });

  it('Nhận thưởng một mốc lỗi: chỉ tải lại danh sách mốc cho khớp backend', async () => {
    mocks.claim.mockRejectedValue(new Error('Chưa đạt'));
    renderRewards(data());
    fireEvent.click(screen.getByRole('button', { name: 'Nhận thưởng' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Chưa đạt', type: 'error' }));
    expect(keys()).toContain('["affiliate-milestones"]');
    expect(keys()).not.toContain('["loyalty"]');
  });
});

describe('MilestoneRewards — giữ khoá tới khi dữ liệu mới về', () => {
  let inv: MockInstance<QueryClient['invalidateQueries']>;
  let finishRefresh: () => void;
  const two = () => data({
    milestones: [claimable('B', 200), claimable('C', 50)],
    previousMonth: { monthKey: '2026-09', revenue: 3_000_000, milestones: [claimable('P1', 100)] },
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockReset();
    // Tải lại chưa xong: danh sách vẫn là bản cũ, còn nút "Nhận thưởng" của mốc vừa nhận.
    const pending = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries').mockImplementation(() => pending);
  });
  afterEach(() => {
    inv.mockRestore();
    vi.useRealTimers();
  });

  it('nhận một mốc thành công nhưng danh sách chưa tải lại: chạm tiếp không gọi API lần hai, tải xong mới nhận lại được', async () => {
    mocks.claim.mockResolvedValue(OK);
    renderRewards(data());
    const btn = screen.getByRole('button', { name: 'Nhận thưởng' });
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'ok', type: 'success' }));
    await act(async () => {});
    fireEvent.click(btn);
    await act(async () => {});
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => finishRefresh());
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(2));
  });

  it('nhận một mốc lỗi (đã nhận ở máy khác) nhưng danh sách chưa tải lại: nút không nhận lại để ra lần lỗi thứ hai', async () => {
    mocks.claim.mockRejectedValue(new Error('Bạn đã nhận thưởng mốc này rồi.'));
    renderRewards(data());
    const btn = screen.getByRole('button', { name: 'Nhận thưởng' });
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Bạn đã nhận thưởng mốc này rồi.', type: 'error' }));
    await act(async () => {});
    fireEvent.click(btn);
    await act(async () => {});
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    await act(async () => finishRefresh());
    await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy', 'true'));
  });

  it('Nhận tất cả xong nhưng danh sách chưa tải lại: cả hai nút giữ khoá, chạm tiếp không gọi API', async () => {
    mocks.claim.mockResolvedValue(OK);
    renderRewards(two());
    const all = screen.getByRole('button', { name: /Nhận tất cả/ });
    const rows = screen.getAllByRole('button', { name: 'Nhận thưởng' });
    fireEvent.click(all);
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã nhận 3 mốc thưởng.', type: 'success' }));
    await act(async () => {});
    expect(mocks.claim).toHaveBeenCalledTimes(3);
    fireEvent.click(all);
    for (const row of rows) fireEvent.click(row);
    await act(async () => {});
    expect(mocks.claim).toHaveBeenCalledTimes(3);
    await act(async () => finishRefresh());
    await waitFor(() => expect(all).not.toHaveAttribute('aria-busy', 'true'));
    fireEvent.click(all);
    await waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(6));
  });

  it('dữ liệu mới không về (mạng chập chờn): nhả khoá sau hạn chờ, không giữ nút mãi', async () => {
    vi.useFakeTimers();
    mocks.claim.mockResolvedValue(OK);
    renderRewards(data());
    const btn = screen.getByRole('button', { name: 'Nhận thưởng' });
    fireEvent.click(btn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 200);
    });
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'ok', type: 'success' });
    fireEvent.click(btn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    fireEvent.click(btn);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.claim).toHaveBeenCalledTimes(2);
  });

  it('Nhận tất cả mà dữ liệu mới không về: nhả khoá sau hạn chờ, nhận lại được', async () => {
    vi.useFakeTimers();
    mocks.claim.mockResolvedValue(OK);
    renderRewards(two());
    const all = screen.getByRole('button', { name: /Nhận tất cả/ });
    fireEvent.click(all);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 200);
    });
    expect(mocks.claim).toHaveBeenCalledTimes(3);
    fireEvent.click(all);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.claim).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    fireEvent.click(all);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.claim).toHaveBeenCalledTimes(6);
  });
});

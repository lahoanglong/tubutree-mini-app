import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  submitDeskPerk: vi.fn(),
  getDeskPointReport: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Sheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? <div role="dialog">{children}</div> : null),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/api', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'lỗi'),
}));
vi.mock('../services/waste-api', async (orig) => ({
  ...(await orig<object>()),
  submitDeskPerk: mocks.submitDeskPerk,
  getDeskPointReport: mocks.getDeskPointReport,
}));

import { WasteDeskPerk, WasteDeskReport, vnMonthKey } from './waste-desk-perk';
import { makeDeskPoint, WAREHOUSE_DESK } from '../services/waste-test-fixtures';

function renderWith(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WasteDeskPerk (§4.10, §5.6)', () => {
  it('đại lý: thẻ ưu đãi tách khỏi Điểm Xanh, nội dung hiện tại', () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    expect(screen.getByText('Ưu đãi riêng của cửa hàng')).toBeInTheDocument();
    expect(screen.getByText('Cửa hàng tự chịu, không liên quan Điểm Xanh')).toBeInTheDocument();
    expect(screen.getByText('Giảm 10% hoá đơn đầu')).toBeInTheDocument();
  });
  it('"Chỉnh sửa" chỉ với OWNER', () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint({ myRole: 'STAFF' })} />);
    expect(screen.queryByRole('button', { name: 'Chỉnh sửa' })).toBeNull();
  });
  it('nội dung đang chờ duyệt → "Đang chờ Tubu duyệt"', () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint({ perkPendingText: 'Tặng túi vải' })} />);
    expect(screen.getByText('Đang chờ Tubu duyệt: Tặng túi vải')).toBeInTheDocument();
  });
  it('OWNER gửi nội dung mới → PUT perk, báo chờ duyệt, làm mới desk', async () => {
    mocks.submitDeskPerk.mockResolvedValue(makeDeskPoint({ perkPendingText: 'Tặng túi vải' }));
    const { qc } = renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(await screen.findByLabelText('Nội dung ưu đãi'), { target: { value: '  Tặng túi vải  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(mocks.submitDeskPerk).toHaveBeenCalledWith('pt-1', { perkText: 'Tặng túi vải' }));
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã gửi, chờ Tubu duyệt' }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['waste', 'desk'] });
  });
  it('kho Tubu → không render gì', () => {
    const { container } = renderWith(<WasteDeskPerk point={WAREHOUSE_DESK} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('chưa có ưu đãi → "Chưa có ưu đãi"', () => {
    renderWith(<WasteDeskPerk point={makeDeskPoint({ perkText: null })} />);
    expect(screen.getByText('Chưa có ưu đãi')).toBeInTheDocument();
  });
  it('gửi duyệt lỗi → snackbar câu của máy chủ', async () => {
    mocks.submitDeskPerk.mockRejectedValue(new Error('Bạn không phải chủ điểm'));
    renderWith(<WasteDeskPerk point={makeDeskPoint()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa' }));
    fireEvent.change(await screen.findByLabelText('Nội dung ưu đãi'), { target: { value: 'Tặng túi vải' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi duyệt' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Bạn không phải chủ điểm', type: 'error' })));
  });
});

describe('WasteDeskReport (§15.3)', () => {
  it('tháng theo giờ VN, kể cả khi máy ở UTC', () => {
    expect(vnMonthKey(new Date('2026-10-31T17:30:00.000Z'))).toBe('2026-11');
    expect(vnMonthKey(new Date('2026-10-31T16:59:00.000Z'))).toBe('2026-10');
  });
  it('báo cáo tháng: số lượt, điểm, hạn mức đã dùng, số món', async () => {
    mocks.getDeskPointReport.mockResolvedValue({ pointId: 'pt-1', month: '2026-10', confirmations: 12, pointsAwarded: 120_000, quotaUsed: 120_000, units: [{ itemId: 'item-carton', itemName: 'Thùng carton', unitLabel: 'thùng', qty: 80 }] });
    renderWith(<WasteDeskReport pointId="pt-1" />);
    expect(await screen.findByText('12 lượt xác nhận')).toBeInTheDocument();
    expect(screen.getByText('Tubu đã cộng 120.000 điểm cho khách')).toBeInTheDocument();
    expect(screen.getByText('Thùng carton: 80 thùng')).toBeInTheDocument();
    expect(mocks.getDeskPointReport).toHaveBeenCalledWith('pt-1', expect.stringMatching(/^\d{4}-\d{2}$/));
  });
  it('báo cáo lỗi → "Chưa tải được báo cáo", "Thử lại" tải lại', async () => {
    mocks.getDeskPointReport.mockRejectedValueOnce(new Error('x')).mockResolvedValue({ pointId: 'pt-1', month: '2026-10', confirmations: 3, pointsAwarded: 0, quotaUsed: 0, units: [] });
    renderWith(<WasteDeskReport pointId="pt-1" />);
    expect(await screen.findByText('Chưa tải được báo cáo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('3 lượt xác nhận')).toBeInTheDocument();
  });
});

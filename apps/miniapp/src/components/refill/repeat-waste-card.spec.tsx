import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WasteItemDTO, WastePointDTO, WasteRequestDetailDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getWasteRequest: vi.fn(),
  getWastePoints: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/waste-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getWasteRequest: mocks.getWasteRequest,
  getWastePoints: mocks.getWastePoints,
}));

import { RepeatWasteCard } from './repeat-waste-card';

const REQUEST: WasteRequestSummaryDTO = {
  id: 'r1',
  code: 'DR-1',
  method: 'DROP_OFF',
  status: 'COMPLETED',
  closeReason: null,
  createdAt: '2026-11-01T03:00:00.000Z',
  expiresAt: null,
  estimatedPoints: 30,
  pointsAwarded: 30,
  pointName: 'Điểm nhận Long Bình',
  orderCode: null,
  lines: [
    { itemName: 'Chai nhựa', unitLabel: 'chai', declaredQty: 5 },
    { itemName: 'Lon nhôm', unitLabel: 'lon', declaredQty: 3 },
    { itemName: 'Pin', unitLabel: 'viên', declaredQty: 2 },
  ],
};
const line = (itemId: string, declaredQty: number) => ({
  itemId, itemName: itemId, unitLabel: 'cái', unitsPerPoint: 1, pointsPerGroup: 1, dropsPerUnit: 1, gramsPerUnit: null, declaredQty, receivedQty: declaredQty, shortfallReason: null, pointsAwarded: 1,
});
const DETAIL = {
  ...REQUEST,
  lines: [line('i1', 5), line('i2', 3), line('i3', 2)],
  point: { id: 'pt1', kind: 'PARTNER', name: 'Điểm nhận Long Bình', addressLine: '', communeName: '', provinceName: '', phone: null, openingHours: {} },
  pointAvailable: true,
} as unknown as WasteRequestDetailDTO;
const POINT = {
  id: 'pt1', kind: 'PARTNER', name: 'Điểm nhận Long Bình', addressLine: '1 Đường A', provinceCode: '75', provinceName: 'Đồng Nai', communeCode: '1', communeName: 'Long Bình',
  lat: null, lng: null, phone: null, openingHours: {}, acceptedItemIds: ['i1', 'i2', 'i3'], perkText: null, quotaFull: false, distanceKm: null,
} as unknown as WastePointDTO;
const item = (id: string, status: 'ACTIVE' | 'COMING_SOON' = 'ACTIVE') => ({ id, status }) as unknown as WasteItemDTO;

function renderCard(items = [item('i1'), item('i2'), item('i3')], methods: ('DROP_OFF' | 'MAIL_IN')[] = ['DROP_OFF', 'MAIL_IN']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RepeatWasteCard request={REQUEST} methodLabel="Mang tới điểm nhận" items={items} methods={methods} newHref="/recycle/new" />
    </QueryClientProvider>,
  );
}

describe('Mini RepeatWasteCard: "Gửi lại như lần trước" (waste.repeat_request_enabled)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWasteRequest.mockResolvedValue(DETAIL);
    mocks.getWastePoints.mockResolvedValue([POINT]);
  });

  it('thẻ ghi cách gửi, điểm nhận và số loại; một nút chính, "Tạo yêu cầu mới" là lối phụ', () => {
    renderCard();
    expect(screen.getByText('Gửi lại như lần trước')).toBeInTheDocument();
    expect(screen.getByText('Mang tới điểm nhận Long Bình · 3 loại')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tạo yêu cầu mới'));
    expect(mocks.navigate).toHaveBeenCalledWith('/recycle/new');
  });

  it('"Gửi lại": mở bước chọn loại rác với nháp đủ loại, số lượng, cách gửi và điểm nhận lần trước; không có ô đồng ý điền sẵn', async () => {
    renderCard();
    fireEvent.click(screen.getByText('Gửi lại'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    expect(mocks.getWasteRequest).toHaveBeenCalledWith('r1');
    const [path, opts] = mocks.navigate.mock.calls[0]!;
    expect(path).toBe('/recycle/new');
    expect(opts).toEqual({
      state: {
        draft: {
          lines: { i1: 5, i2: 3, i3: 2 },
          method: 'DROP_OFF',
          pointId: 'pt1',
          pickedPoint: POINT,
          provinceCode: null,
          nearby: null,
          repeat: { items: null, method: null },
        },
      },
    });
    expect(JSON.stringify(opts)).not.toMatch(/consent/i);
  });

  it('loại rác nay ngừng nhận và cách gửi lần trước đã tắt: bỏ phần đó, nói ở đúng bước', async () => {
    renderCard([item('i1'), item('i2'), item('i3', 'COMING_SOON')], ['MAIL_IN']);
    fireEvent.click(screen.getByText('Gửi lại'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
    const draft = mocks.navigate.mock.calls[0]![1].state.draft;
    expect(draft.lines).toEqual({ i1: 5, i2: 3 });
    expect(draft.method).toBeNull();
    expect(draft.pointId).toBeNull();
    expect(draft.repeat).toEqual({ items: 'Đã bỏ 1 loại rác nay không còn nhận', method: 'Cách gửi hoặc điểm nhận lần trước nay tạm đóng, bạn chọn lại nhé' });
  });

  it('không tải được yêu cầu cũ: báo lỗi, không chuyển trang, bấm lại được', async () => {
    mocks.getWasteRequest.mockRejectedValueOnce(new Error('mạng'));
    renderCard();
    fireEvent.click(screen.getByText('Gửi lại'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Gửi lại'));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledTimes(1));
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WasteItemDTO, WastePointDTO, WasteRequestDetailDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const state = vi.hoisted(() => ({
  push: vi.fn(),
  detail: vi.fn<() => Promise<unknown>>(),
  points: vi.fn<() => Promise<unknown>>(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@tubutree/app-core/queries/waste', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tubutree/app-core/queries/waste')>()),
  wasteRequestQuery: (_http: unknown, id: string) => ({ queryKey: ['waste', 'request', id], queryFn: () => state.detail() }),
  wastePointsQuery: (_http: unknown, p: string | null) => ({ queryKey: ['waste', 'points', p], queryFn: () => state.points() }),
}));

import { RepeatWasteCard } from './repeat-waste-card';
import { clearRepeatNotes, readRepeatNotes } from './repeat-notes';
import { loadDraft, peekResume } from '@/lib/recycle-wizard';

const REQUEST: WasteRequestSummaryDTO = {
  id: 'r1', code: 'DR-1', method: 'DROP_OFF', status: 'COMPLETED', closeReason: null, createdAt: '2026-11-01T03:00:00.000Z', expiresAt: null,
  estimatedPoints: 30, pointsAwarded: 30, pointName: 'Điểm nhận Long Bình', orderCode: null,
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

let mounted: Rendered[] = [];
const mount = (items = [item('i1'), item('i2'), item('i3')], methods: ('DROP_OFF' | 'MAIL_IN')[] = ['DROP_OFF', 'MAIL_IN']) => {
  const r = render(<RepeatWasteCard request={REQUEST} methodLabel="Mang tới điểm nhận" items={items} methods={methods} newHref="/doi-rac/tao" />);
  mounted.push(r);
  return r;
};
const btn = (c: HTMLElement, text: string) => Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) ?? null;

beforeEach(() => {
  sessionStorage.clear();
  state.push.mockReset();
  state.detail.mockReset();
  state.detail.mockResolvedValue(DETAIL);
  state.points.mockReset();
  state.points.mockResolvedValue([POINT]);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('web RepeatWasteCard: "Gửi lại như lần trước" (waste.repeat_request_enabled)', () => {
  it('thẻ ghi cách gửi, điểm nhận và số loại; "Tạo yêu cầu mới" là lối phụ, không mang nháp', () => {
    const { container } = mount();
    expect(container.textContent).toContain('Gửi lại như lần trước');
    expect(container.textContent).toContain('Mang tới điểm nhận Long Bình · 3 loại');
    click(btn(container, 'Tạo yêu cầu mới'));
    expect(state.push).toHaveBeenCalledWith('/doi-rac/tao');
    expect(loadDraft()).toBeNull();
    expect(peekResume()).toBe(false);
  });

  it('"Gửi lại": lưu nháp đủ loại, số lượng, cách gửi và điểm nhận lần trước rồi mở bước 1 ở chế độ nối tiếp; không lưu ô đồng ý', async () => {
    const { container } = mount();
    click(btn(container, 'Gửi lại'));
    await flush(6);
    expect(state.push).toHaveBeenCalledWith('/doi-rac/tao');
    expect(loadDraft()).toEqual({ lines: { i1: 5, i2: 3, i3: 2 }, method: 'DROP_OFF', pointId: 'pt1', pickedPoint: POINT, provinceCode: null });
    expect(peekResume()).toBe(true);
    expect(readRepeatNotes()).toBeNull();
    expect(JSON.stringify(Object.values(sessionStorage))).not.toMatch(/consent/i);
  });

  it('loại rác nay ngừng nhận và cách gửi lần trước đã tắt: bỏ phần đó, lời báo đi kèm cho đúng bước', async () => {
    const { container } = mount([item('i1'), item('i2'), item('i3', 'COMING_SOON')], ['MAIL_IN']);
    click(btn(container, 'Gửi lại'));
    await flush(6);
    expect(loadDraft()).toMatchObject({ lines: { i1: 5, i2: 3 }, method: null, pointId: null });
    expect(readRepeatNotes()).toEqual({ items: 'Đã bỏ 1 loại rác nay không còn nhận', method: 'Cách gửi hoặc điểm nhận lần trước nay tạm đóng, bạn chọn lại nhé' });
    clearRepeatNotes();
    expect(readRepeatNotes()).toBeNull();
  });

  it('không tải được yêu cầu cũ: báo lỗi tại chỗ, không chuyển trang', async () => {
    state.detail.mockRejectedValueOnce(new Error('mạng'));
    const { container } = mount();
    click(btn(container, 'Gửi lại'));
    await flush(6);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(state.push).not.toHaveBeenCalled();
  });
});

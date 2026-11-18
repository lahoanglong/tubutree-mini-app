import { describe, expect, it } from 'vitest';
import type { WastePointDTO, WasteRequestDetailDTO, WasteRequestSummaryDTO } from '@tubutree/shared-types';
import { buildRepeatDraft, lastCompletedRequest, repeatCardView } from './repeat-waste';

const summary = (o: Partial<WasteRequestSummaryDTO>): WasteRequestSummaryDTO => ({
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
  ...o,
});

const point = (o: Partial<WastePointDTO> = {}): WastePointDTO => ({
  id: 'pt1',
  kind: 'PARTNER',
  name: 'Điểm nhận Long Bình',
  addressLine: '1 Đường A',
  provinceCode: '75',
  provinceName: 'Đồng Nai',
  communeCode: '1',
  communeName: 'Long Bình',
  lat: null,
  lng: null,
  phone: null,
  openingHours: {} as WastePointDTO['openingHours'],
  acceptedItemIds: ['i1', 'i2', 'i3'],
  perkText: null,
  quotaFull: false,
  distanceKm: null,
  ...o,
});

const detailLine = (itemId: string, declaredQty: number) => ({
  itemId,
  itemName: itemId,
  unitLabel: 'cái',
  unitsPerPoint: 1,
  pointsPerGroup: 1,
  dropsPerUnit: 1,
  gramsPerUnit: null,
  declaredQty,
  receivedQty: declaredQty,
  shortfallReason: null,
  pointsAwarded: 1,
});

const detail = (o: Partial<WasteRequestDetailDTO> = {}): WasteRequestDetailDTO =>
  ({
    ...summary({}),
    lines: [detailLine('i1', 5), detailLine('i2', 3), detailLine('i3', 2)],
    point: { id: 'pt1', kind: 'PARTNER', name: 'Điểm nhận Long Bình', addressLine: '', communeName: '', provinceName: '', phone: null, openingHours: {} },
    pointAvailable: true,
    ...o,
  }) as WasteRequestDetailDTO;

const ITEMS = [
  { id: 'i1', status: 'ACTIVE' as const },
  { id: 'i2', status: 'ACTIVE' as const },
  { id: 'i3', status: 'ACTIVE' as const },
];

describe('lastCompletedRequest', () => {
  it('lấy yêu cầu HOÀN TẤT mới nhất, bỏ qua đang mở/huỷ/bị từ chối', () => {
    const list = [
      summary({ id: 'old', createdAt: '2026-10-01T00:00:00.000Z' }),
      summary({ id: 'open', status: 'OPEN', createdAt: '2026-11-10T00:00:00.000Z' }),
      summary({ id: 'new', createdAt: '2026-11-05T00:00:00.000Z' }),
      summary({ id: 'rej', status: 'REJECTED', createdAt: '2026-11-12T00:00:00.000Z' }),
    ];
    expect(lastCompletedRequest(list)?.id).toBe('new');
  });

  it('chưa có yêu cầu hoàn tất nào thì null (màn giữ lối vào cũ)', () => {
    expect(lastCompletedRequest([summary({ status: 'CANCELLED' })])).toBeNull();
    expect(lastCompletedRequest(undefined)).toBeNull();
  });
});

describe('repeatCardView', () => {
  it('"Mang tới điểm nhận Long Bình · 3 loại", không lặp chữ "điểm nhận"', () => {
    const v = repeatCardView(summary({}), 'Mang tới điểm nhận');
    expect(v).toEqual({ title: 'Gửi lại như lần trước', subtitle: 'Mang tới điểm nhận Long Bình · 3 loại', cta: 'Gửi lại', newRequest: 'Tạo yêu cầu mới' });
  });

  it('cách gửi khác không có điểm nhận', () => {
    expect(repeatCardView(summary({ method: 'MAIL_IN', pointName: 'Kho Tubu HCM' }), 'Gửi về kho Tubu HCM').subtitle).toBe('Gửi về kho Tubu HCM · 3 loại');
  });
});

describe('buildRepeatDraft', () => {
  it('đủ hợp lệ: điền sẵn loại rác, số lượng, cách gửi và điểm nhận; không ghi chú', () => {
    const d = buildRepeatDraft({ detail: detail(), items: ITEMS, enabledMethods: ['DROP_OFF', 'MAIL_IN'], points: [point()] });
    expect(d.lines).toEqual({ i1: 5, i2: 3, i3: 2 });
    expect(d.method).toBe('DROP_OFF');
    expect(d.pointId).toBe('pt1');
    expect(d.pickedPoint?.id).toBe('pt1');
    expect(d.itemsNote).toBeNull();
    expect(d.methodNote).toBeNull();
  });

  it('loại rác ngừng nhận bị bỏ và nói ở bước chọn loại', () => {
    const d = buildRepeatDraft({ detail: detail(), items: [ITEMS[0]!, { id: 'i2', status: 'COMING_SOON' }], enabledMethods: ['DROP_OFF'], points: [point()] });
    expect(d.lines).toEqual({ i1: 5 });
    expect(d.itemsNote).toBe('Đã bỏ 2 loại rác nay không còn nhận');
  });

  it('cách gửi tạm đóng: bỏ cách gửi và điểm, nói ở bước cách gửi', () => {
    const d = buildRepeatDraft({ detail: detail(), items: ITEMS, enabledMethods: ['MAIL_IN'], points: [point()] });
    expect(d.method).toBeNull();
    expect(d.pointId).toBeNull();
    expect(d.methodNote).toBe('Cách gửi hoặc điểm nhận lần trước nay tạm đóng, bạn chọn lại nhé');
  });

  it('điểm nhận ngưng, hết suất hoặc không nhận đủ loại: giữ cách gửi, bỏ điểm', () => {
    const note = 'Cách gửi hoặc điểm nhận lần trước nay tạm đóng, bạn chọn lại nhé';
    for (const points of [[], [point({ quotaFull: true })], [point({ acceptedItemIds: ['i1'] })], null]) {
      const d = buildRepeatDraft({ detail: detail(), items: ITEMS, enabledMethods: ['DROP_OFF'], points });
      expect(d.method).toBe('DROP_OFF');
      expect(d.pointId).toBeNull();
      expect(d.methodNote).toBe(note);
    }
  });

  it('Shipper lấy tận nhà: giữ cân nặng khai lần trước', () => {
    const d = buildRepeatDraft({
      detail: detail({ method: 'HOME_PICKUP', point: null, homePickup: { declaredWeightGrams: 2000 } as WasteRequestDetailDTO['homePickup'] }),
      items: ITEMS,
      enabledMethods: ['HOME_PICKUP'],
      points: null,
    });
    expect(d.method).toBe('HOME_PICKUP');
    expect(d.homePickupWeight).toBe(2000);
    expect(d.methodNote).toBeNull();
  });
});

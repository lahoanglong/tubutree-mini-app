import type {
  WasteDeskPointDTO,
  WasteDeskRequestDTO,
  WasteMeDTO,
  WasteMeItemDTO,
  WastePointContactDTO,
  WastePointDTO,
  WasteRequestDetailDTO,
  WasteRequestSummaryDTO,
} from '@tubutree/shared-types';

export function makeWasteItem(over: Partial<WasteMeItemDTO> = {}): WasteMeItemDTO {
  return {
    id: 'item-carton',
    code: 'CARTON',
    name: 'Thùng carton',
    unitLabel: 'thùng',
    unitsPerPoint: 1,
    pointsPerGroup: 1000,
    dropsPerUnit: 0,
    dailyCapQty: 10,
    monthlyCapQty: 20,
    status: 'ACTIVE',
    prepInstructions: 'Gấp phẳng, bỏ băng keo',
    imageUrl: null,
    gramsPerUnit: null,
    hazardous: false,
    sortOrder: 1,
    monthRemainingQty: 20,
    dayRemainingQty: 10,
    ...over,
  };
}

export const ITEM_CARTON = makeWasteItem();
export const ITEM_MILK = makeWasteItem({
  id: 'item-milk',
  code: 'MILK',
  name: 'Vỏ hộp sữa',
  unitLabel: 'vỏ',
  unitsPerPoint: 5,
  dailyCapQty: null,
  monthlyCapQty: 100,
  prepInstructions: 'Rửa sạch, để khô',
  sortOrder: 2,
  monthRemainingQty: 100,
  dayRemainingQty: null,
});
export const ITEM_BATTERY = makeWasteItem({
  id: 'item-battery',
  code: 'BATTERY',
  name: 'Pin đã dùng',
  unitLabel: 'viên',
  status: 'COMING_SOON',
  hazardous: true,
  dailyCapQty: null,
  monthlyCapQty: null,
  prepInstructions: 'Đợt này Tubu chưa nhận pin',
  sortOrder: 5,
  monthRemainingQty: null,
  dayRemainingQty: null,
});

export function makeWasteMe(over: Partial<WasteMeDTO> = {}): WasteMeDTO {
  return {
    programmeEnabled: true,
    eligibility: 'OK',
    blocked: false,
    shipLockedAt: null,
    laneFlags: { dropoff: true, mailin: true, pickup: false },
    parcelLimits: { maxWeightKg: 10, maxEdgeCm: 60 },
    balance: { pointsBalance: 30_000, pointsConvertedBalance: 5000, redeemablePoints: 30_000 },
    monthUsage: { capMonthKey: '2026-10', pointsUsed: 10_000, pointsCap: 200_000 },
    impactGrams: null,
    thresholds: { mailinMinPoints: 15_000, pickupMinPoints: 10_000, maxOpenRequests: 3 },
    items: [ITEM_CARTON, ITEM_MILK, ITEM_BATTERY],
    openRequests: [],
    deskPoints: [],
    ...over,
  };
}

export function makeWastePoint(over: Partial<WastePointDTO> = {}): WastePointDTO {
  return {
    id: 'pt-1',
    kind: 'PARTNER',
    name: 'Đại lý Cô Ba',
    addressLine: '12 Lê Lợi',
    provinceCode: '79',
    provinceName: 'TP.HCM',
    communeCode: '26734',
    communeName: 'Phường Bến Thành',
    lat: 10.77,
    lng: 106.7,
    phone: '0901234567',
    openingHours: { MON: [{ open: '08:00', close: '18:00' }] },
    acceptedItemIds: ['item-carton', 'item-milk'],
    perkText: null,
    quotaFull: false,
    distanceKm: null,
    ...over,
  };
}

export function makeWarehouseContact(over: Partial<WastePointContactDTO> = {}): WastePointContactDTO {
  return {
    id: 'wh-1',
    kind: 'WAREHOUSE',
    name: 'Kho Tubu TP.HCM',
    addressLine: '99 Nguyễn Văn Linh',
    communeName: 'Phường Tân Phong',
    provinceName: 'TP.HCM',
    phone: '0281234567',
    openingHours: { MON: [{ open: '08:00', close: '17:00' }] },
    ...over,
  };
}

export function makeRequestDetail(over: Partial<WasteRequestDetailDTO> = {}): WasteRequestDetailDTO {
  return {
    id: 'req-1',
    code: 'TR-8K2M9',
    method: 'DROP_OFF',
    status: 'OPEN',
    closeReason: null,
    createdAt: '2026-10-17T03:00:00.000Z',
    expiresAt: '2026-10-24T17:30:00.000Z', // VN 25/10 00:30
    estimatedPoints: 5000,
    pointsAwarded: null,
    pointName: 'Đại lý Cô Ba',
    orderCode: null,
    lines: [
      {
        itemId: 'item-carton',
        itemName: 'Thùng carton',
        unitLabel: 'thùng',
        unitsPerPoint: 1,
        pointsPerGroup: 1000,
        dropsPerUnit: 0,
        gramsPerUnit: null,
        declaredQty: 5,
        receivedQty: null,
        shortfallReason: null,
        pointsAwarded: null,
      },
    ],
    point: {
      ...makeWarehouseContact(),
      id: 'pt-1',
      kind: 'PARTNER',
      name: 'Đại lý Cô Ba',
      addressLine: '12 Lê Lợi',
      communeName: 'Phường Bến Thành',
      phone: '0901234567',
    },
    pointAvailable: true,
    carrier: null,
    trackingCode: null,
    inTransitAt: null,
    receivedAt: null,
    completedAt: null,
    closedAt: null,
    rejectionReason: null,
    rejectionNote: null,
    dropsAwarded: null,
    impactGrams: null,
    reversedPoints: null,
    reversalReason: null,
    editable: true,
    cancellable: true,
    orderId: null,
    ...over,
  };
}

export function makeRequestSummary(over: Partial<WasteRequestSummaryDTO> = {}): WasteRequestSummaryDTO {
  const d = makeRequestDetail();
  return {
    id: d.id,
    code: d.code,
    method: d.method,
    status: d.status,
    closeReason: d.closeReason,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt,
    estimatedPoints: d.estimatedPoints,
    pointsAwarded: d.pointsAwarded,
    pointName: d.pointName,
    orderCode: d.orderCode,
    lines: d.lines.map((l) => ({ itemName: l.itemName, unitLabel: l.unitLabel, declaredQty: l.declaredQty })),
    ...over,
  };
}

export function makeDeskPoint(over: Partial<WasteDeskPointDTO> = {}): WasteDeskPointDTO {
  return {
    id: 'pt-1',
    kind: 'PARTNER',
    name: 'Đại lý Cô Ba',
    giftHandoverEnabled: false,
    myRole: 'OWNER',
    quota: { limit: 500_000, used: 120_000, remaining: 380_000 },
    perkText: 'Giảm 10% hoá đơn đầu',
    perkPendingText: null,
    staffDailyCapRemaining: 150_000,
    ...over,
  };
}

export const WAREHOUSE_DESK = makeDeskPoint({
  id: 'wh-1',
  kind: 'WAREHOUSE',
  name: 'Kho Tubu TP.HCM',
  giftHandoverEnabled: true,
  myRole: 'STAFF',
  quota: null,
  perkText: null,
});

export function makeDeskRequest(over: Partial<WasteDeskRequestDTO> = {}): WasteDeskRequestDTO {
  return {
    id: 'req-1',
    code: 'TR-8K2M9',
    method: 'DROP_OFF',
    status: 'OPEN',
    pointId: 'pt-1',
    customerName: 'Ng*** A',
    customerPhone: '090****567',
    estimatedPoints: 6000,
    lines: [
      { itemId: 'item-carton', itemName: 'Thùng carton', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000, declaredQty: 5, receivedQty: null, hazardous: false },
      { itemId: 'item-milk', itemName: 'Vỏ hộp sữa', unitLabel: 'vỏ', unitsPerPoint: 5, pointsPerGroup: 1000, declaredQty: 5, receivedQty: null, hazardous: false },
    ],
    ...over,
  };
}

import { expect, type Page } from '@playwright/test';
import type {
  RewardCatalogDTO,
  WasteDeskLookupDTO,
  WasteDeskPointDTO,
  WasteMeDTO,
  WasteMeItemDTO,
  WastePointDTO,
  WastePreviewDTO,
  WastePreviewRequest,
  WasteRequestDetailDTO,
  WasteRequestSummaryDTO,
} from '@tubutree/shared-types';
import { publicConfig, wasteMe, type MockApi } from './mock-api';

export const WASTE_ITEMS: WasteMeItemDTO[] = [
  {
    id: 'wi-carton',
    code: 'CARTON',
    name: 'Thùng carton cũ',
    unitLabel: 'thùng',
    unitsPerPoint: 1,
    pointsPerGroup: 1000,
    dropsPerUnit: 0,
    dailyCapQty: 10,
    monthlyCapQty: 60,
    status: 'ACTIVE',
    prepInstructions: 'Gấp phẳng, giữ khô và sạch.',
    imageUrl: null,
    gramsPerUnit: null,
    hazardous: false,
    sortOrder: 10,
    monthRemainingQty: 60,
    dayRemainingQty: 10,
  },
  {
    id: 'wi-milk-carton',
    code: 'MILK_CARTON',
    name: 'Vỏ hộp sữa sạch',
    unitLabel: 'vỏ',
    unitsPerPoint: 5,
    pointsPerGroup: 1000,
    dropsPerUnit: 0,
    dailyCapQty: 50,
    monthlyCapQty: 300,
    status: 'ACTIVE',
    prepInstructions: 'Rửa sạch, để ráo, ép dẹt.',
    imageUrl: null,
    gramsPerUnit: null,
    hazardous: false,
    // Như seed thật: hộp sữa chỉ kho TP.HCM nhận.
    warehouseOnly: true,
    sortOrder: 30,
    monthRemainingQty: 300,
    dayRemainingQty: 50,
  },
];

export function wastePoint(over: Partial<WastePointDTO> & Pick<WastePointDTO, 'id'>): WastePointDTO {
  return {
    kind: 'PARTNER',
    name: 'Tạp hoá Cô Ba',
    addressLine: '12 Lê Lợi',
    provinceCode: '79',
    provinceName: 'TP. Hồ Chí Minh',
    communeCode: '26734',
    communeName: 'Phường Bến Thành',
    lat: 10.7731,
    lng: 106.7004,
    phone: '0901234567',
    openingHours: { MON: [{ open: '08:00', close: '20:00' }] },
    acceptedItemIds: ['wi-carton', 'wi-milk-carton'],
    perkText: null,
    quotaFull: false,
    distanceKm: null,
    ...over,
  };
}

export function wasteDetail(
  over: Partial<WasteRequestDetailDTO> & Pick<WasteRequestDetailDTO, 'id' | 'code' | 'method' | 'status'>,
): WasteRequestDetailDTO {
  const contact = wastePoint({ id: 'wp-q1' });
  return {
    closeReason: null,
    createdAt: '2026-10-17T03:00:00.000Z',
    expiresAt: '2026-10-24T03:00:00.000Z',
    estimatedPoints: 3000,
    pointsAwarded: null,
    pointName: 'Tạp hoá Cô Ba',
    orderCode: null,
    lines: [
      {
        itemId: 'wi-carton',
        itemName: 'Thùng carton cũ',
        unitLabel: 'thùng',
        unitsPerPoint: 1,
        pointsPerGroup: 1000,
        dropsPerUnit: 0,
        gramsPerUnit: null,
        declaredQty: 3,
        receivedQty: null,
        shortfallReason: null,
        pointsAwarded: null,
      },
    ],
    point: {
      id: contact.id,
      kind: contact.kind,
      name: contact.name,
      addressLine: contact.addressLine,
      communeName: contact.communeName,
      provinceName: contact.provinceName,
      phone: contact.phone,
      openingHours: contact.openingHours,
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

export function wasteSummary(d: WasteRequestDetailDTO): WasteRequestSummaryDTO {
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
    lines: d.lines.map(({ itemName, unitLabel, declaredQty }) => ({ itemName, unitLabel, declaredQty })),
  };
}

const EMPTY_REWARDS: RewardCatalogDTO = {
  pointsBalance: 0,
  pointsConvertedBalance: 0,
  lockedPoints: 0,
  redeemablePoints: 0,
  giftClaimDays: 30,
  claimPoint: null,
  rewards: [],
};

export function mockWasteCustomer(
  api: MockApi,
  opts: { me?: Partial<WasteMeDTO>; points?: WastePointDTO[]; requests?: WasteRequestDetailDTO[] },
): void {
  const requests = opts.requests ?? [];
  api.get('/config/public', publicConfig({ waste: { enabled: true, dropoff: true, mailin: true, pickup: false } }));
  api.get('/waste/me', () =>
    wasteMe({
      programmeEnabled: true,
      laneFlags: { dropoff: true, mailin: true, pickup: false },
      balance: { pointsBalance: 40_000, pointsConvertedBalance: 0, redeemablePoints: 40_000 },
      items: WASTE_ITEMS,
      ...opts.me,
    }),
  );
  api.get('/waste/items', WASTE_ITEMS.map(({ monthRemainingQty: _m, dayRemainingQty: _d, ...item }) => item));
  api.get('/waste/points', opts.points ?? []);
  api.post('/waste/preview', ({ call }): WastePreviewDTO => {
    const body = call.body as WastePreviewRequest;
    const estimatedPoints = body.lines.reduce((sum, l) => {
      const item = WASTE_ITEMS.find((i) => i.id === l.itemId);
      return item ? sum + Math.floor(l.declaredQty / item.unitsPerPoint) * item.pointsPerGroup : sum;
    }, 0);
    return {
      estimatedPoints,
      estimatedDrops: 0,
      estimatedGrams: null,
      pointsValueVnd: estimatedPoints,
      blocks: [],
      feeEstimate: null,
      itemCaps: [],
      pointsMonthRemaining: 60_000,
    };
  });
  api.get('/waste/requests', () => requests.map(wasteSummary));
  api.get('/waste/requests/:id', ({ params }) => requests.find((r) => r.id === params.id) ?? null);
  // Not /waste/* flow calls: the wizard, Home of the programme and the result page read these shared catalogues.
  api.get('/me/loyalty/rewards', EMPTY_REWARDS);
  api.get('/geo/provinces', [{ code: '79', name: 'TP. Hồ Chí Minh' }]);
}

export function mockDeskStaff(api: MockApi, opts: { points: WasteDeskPointDTO[]; lookup: WasteDeskLookupDTO }): void {
  api.get('/config/public', publicConfig({ waste: { enabled: true, dropoff: true, mailin: true, pickup: false } }));
  api.get('/waste/desk/points', opts.points);
  api.post('/waste/desk/lookup', opts.lookup);
  api.get('/waste/desk/points/:pointId/report', ({ params }) => ({
    pointId: params.pointId,
    month: '2026-10',
    confirmations: 0,
    pointsAwarded: 0,
    quotaUsed: 0,
    units: [],
  }));
}

export async function expectNoOverflow(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('page').or(page.getByRole('heading').first())).toBeVisible({ timeout: 15_000 });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(await fits()).toBe(true);
  await page.evaluate(() => document.documentElement.setAttribute('data-font-scale', 'large'));
  expect(await fits()).toBe(true);
}

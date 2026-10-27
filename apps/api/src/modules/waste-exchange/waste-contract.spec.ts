import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ST from '@tubutree/shared-types';
import {
  WasteActorRole, WasteCloseReason, WasteGiftKind, WasteGiftRedemptionStatus, WasteGiftStatus, WasteItemStatus, WasteMethod,
  WastePointKind, WastePointStaffRole, WastePointStatus, WasteRejectionReason, WasteRequestStatus, WasteShortfallReason, WasteUnmatchedStatus,
} from '@prisma/client';

const PRISMA_BACKED: [string, readonly string[], Record<string, string>][] = [
  ['WASTE_ITEM_STATUS_VALUES', ST.WASTE_ITEM_STATUS_VALUES, WasteItemStatus],
  ['WASTE_POINT_KIND_VALUES', ST.WASTE_POINT_KIND_VALUES, WastePointKind],
  ['WASTE_POINT_STATUS_VALUES', ST.WASTE_POINT_STATUS_VALUES, WastePointStatus],
  ['WASTE_POINT_STAFF_ROLE_VALUES', ST.WASTE_POINT_STAFF_ROLE_VALUES, WastePointStaffRole],
  ['WASTE_METHOD_VALUES', ST.WASTE_METHOD_VALUES, WasteMethod],
  ['WASTE_REQUEST_STATUS_VALUES', ST.WASTE_REQUEST_STATUS_VALUES, WasteRequestStatus],
  ['WASTE_CLOSE_REASON_VALUES', ST.WASTE_CLOSE_REASON_VALUES, WasteCloseReason],
  ['WASTE_REJECTION_REASON_VALUES', ST.WASTE_REJECTION_REASON_VALUES, WasteRejectionReason],
  ['WASTE_SHORTFALL_REASON_VALUES', ST.WASTE_SHORTFALL_REASON_VALUES, WasteShortfallReason],
  ['WASTE_ACTOR_ROLE_VALUES', ST.WASTE_ACTOR_ROLE_VALUES, WasteActorRole],
  ['WASTE_UNMATCHED_STATUS_VALUES', ST.WASTE_UNMATCHED_STATUS_VALUES, WasteUnmatchedStatus],
  ['WASTE_GIFT_KIND_VALUES', ST.WASTE_GIFT_KIND_VALUES, WasteGiftKind],
  ['WASTE_GIFT_STATUS_VALUES', ST.WASTE_GIFT_STATUS_VALUES, WasteGiftStatus],
  ['WASTE_GIFT_REDEMPTION_STATUS_VALUES', ST.WASTE_GIFT_REDEMPTION_STATUS_VALUES, WasteGiftRedemptionStatus],
];

const PURE: [string, readonly string[], string[]][] = [
  ['WASTE_MATCH_BASIS_VALUES', ST.WASTE_MATCH_BASIS_VALUES, ['TR_CODE', 'TRACKING_PHONE', 'MANUAL', 'ORDER']],
  ['WASTE_UNMATCHED_REASON_VALUES', ST.WASTE_UNMATCHED_REASON_VALUES, ['NO_MATCH', 'TRACKING_MULTI', 'TR_TRACKING_CONFLICT', 'EXPIRED_REQUEST', 'NOT_RECEIVABLE', 'MANUAL_ENTRY']],
  ['WASTE_ELIGIBILITY_VALUES', ST.WASTE_ELIGIBILITY_VALUES, ['OK', 'GUEST', 'NEED_PHONE']],
  ['WASTE_WEEKDAY_VALUES', ST.WASTE_WEEKDAY_VALUES, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']],
  ['WASTE_PREVIEW_BLOCK_VALUES', ST.WASTE_PREVIEW_BLOCK_VALUES, ['BELOW_MIN', 'MONTH_CAP_FOR_MIN', 'ITEM_MONTH_CAP', 'ITEM_DAY_CAP', 'POINTS_MONTH_CAP', 'POINT_QUOTA_FULL', 'POINT_UNAVAILABLE', 'ITEM_NOT_ACTIVE', 'ITEM_DROPOFF_ONLY', 'POINT_MISSING_ITEMS', 'LANE_DISABLED', 'SHIP_LOCKED', 'MAX_OPEN', 'PICKUP_PENDING', 'NEED_PROVINCE']],
  ['WASTE_ALERT_KIND_VALUES', ST.WASTE_ALERT_KIND_VALUES, ['QUOTA_PACE', 'FULL_MATCH', 'FULL_MATCH_CONFIRMER', 'AVG_UNITS', 'AVG_UNITS_CONFIRMER', 'REPEAT_CUSTOMER', 'LOOKUP_MISS', 'STAFF_ACCOUNT_CONFIRMED', 'STAFF_DIRECT']],
  ['WASTE_REQUEST_QUEUE_FILTER_VALUES', ST.WASTE_REQUEST_QUEUE_FILTER_VALUES, ['TO_COUNT', 'EXPIRED', 'CUSTOMER_BLOCKED', 'ORDER_NOT_DELIVERED', 'TRANSIT_OVERDUE', 'ORDER_MISMATCH']],
];

describe('shared-types waste unions', () => {
  it.each(PRISMA_BACKED)('%s equals the Prisma enum values in order', (_name, tuple, prismaEnum) => {
    expect([...tuple]).toEqual(Object.values(prismaEnum));
  });
  it.each(PURE)('%s has the contract literals in order', (_name, tuple, expected) => {
    expect([...tuple]).toEqual(expected);
  });
  it('no tuple has duplicates', () => {
    for (const [, tuple] of [...PRISMA_BACKED, ...PURE]) expect(new Set(tuple).size).toBe(tuple.length);
  });
});

const WASTE_TS = readFileSync(join(__dirname, '../../../../../packages/shared-types/src/waste.ts'), 'utf-8');
const EXPORTED_NAMES = [
  // unions (21)
  'WasteRequestStatus', 'WasteMethod', 'WasteItemStatus', 'WastePointKind', 'WastePointStatus', 'WastePointStaffRole', 'WasteShortfallReason',
  'WasteRejectionReason', 'WasteCloseReason', 'WasteActorRole', 'WasteMatchBasis', 'WasteUnmatchedStatus', 'WasteUnmatchedReason', 'WasteGiftKind',
  'WasteGiftStatus', 'WasteGiftRedemptionStatus', 'WasteEligibility', 'WasteWeekday', 'WastePreviewBlock', 'WasteAlertKind', 'WasteRequestQueueFilter',
  // config shapes (7)
  'WasteFeeTable', 'WasteFeeEstimate', 'WasteAlertThresholds', 'WastePublicFlags', 'WasteOpeningHours', 'WasteLaneFlags', 'WasteParcelLimits',
  // customer (18)
  'WasteLineInput', 'WasteItemDTO', 'WasteMeItemDTO', 'WastePointDTO', 'WastePointContactDTO', 'WasteDeskPointRefDTO', 'WasteMeDTO', 'WasteNearbyRequest',
  'WastePreviewRequest', 'WastePreviewBlockDTO', 'WastePreviewDTO', 'WasteCreateRequest', 'WasteEditRequest', 'WasteTrackingRequest', 'WasteRequestLineDTO',
  'WasteRequestSummaryDTO', 'WasteRequestDetailDTO', 'WasteRulesDTO',
  // rewards (5)
  'WasteVoucherSpec', 'RewardItemDTO', 'RewardCatalogDTO', 'GiftRedemptionDTO', 'RedeemRewardResultDTO',
  // desk (14)
  'WasteDeskPointDTO', 'WasteDeskLookupRequest', 'WasteDeskRequestDTO', 'WasteDeskGiftDTO', 'WasteDeskLookupDTO', 'WasteMatchInput', 'WasteConfirmLineInput',
  'WasteConfirmRequest', 'WasteRejectRequest', 'WasteConfirmResultDTO', 'WasteRejectResultDTO', 'WasteDeskGiftFulfilRequest', 'WastePerkSubmitRequest',
  'WastePointMonthlyReportDTO',
  // admin (32)
  'AdminWasteItemDTO', 'WasteItemUpsertRequest', 'AdminWastePointDTO', 'AdminWastePointQuery', 'WastePointUpsertRequest', 'WastePointStaffDTO',
  'WastePointStaffAddRequest', 'AdminWasteRequestQuery', 'AdminWasteRequestRowDTO', 'WasteRequestAdminDetailDTO', 'AdminWasteEventDTO', 'WasteReceiveRequest',
  'WasteReceiveResultDTO', 'WasteUnmatchedDTO', 'WasteUnmatchedCreateRequest', 'WasteUnmatchedResolveRequest', 'WasteReverseRequest', 'WasteReverseResultDTO',
  'WasteCostRequest', 'WasteCloseLostRequest', 'WasteReopenRequest', 'WasteUserFlagsDTO', 'WasteUserFlagsUpdateRequest', 'AdminWasteGiftDTO',
  'WasteGiftUpsertRequest', 'GiftRedemptionsQuery', 'AdminGiftRedemptionRowDTO', 'WasteGiftCancelRequest', 'WasteReorderRequest', 'WasteMonthMetrics',
  'WasteAlertDTO', 'WasteOverviewDTO',
];

describe('st/waste.ts exports the full registry 4.9 name set', () => {
  it('lists 97 distinct names', () => {
    expect(new Set(EXPORTED_NAMES).size).toBe(97);
  });
  it.each(EXPORTED_NAMES)('exports %s as an interface or type', (name) => {
    expect(WASTE_TS).toMatch(new RegExp(`^export (?:interface|type) ${name}\\b`, 'm'));
  });
  it('imports CouponType from ./enums and never redeclares it', () => {
    expect(WASTE_TS).toMatch(/^import (?:type )?\{[^}]*\bCouponType\b[^}]*\} from '\.\/enums';$/m);
    expect(WASTE_TS).not.toMatch(/^export (?:const|type|interface|enum) CouponType\b/m);
    expect(WASTE_TS).not.toMatch(/:\s*Date\b/);
  });
});

describe('DTO shapes compile as written in the contract (checked by pnpm --filter @tubutree/api typecheck)', () => {
  const summary: ST.WasteRequestSummaryDTO = {
    id: 'r1', code: 'TR-A2C4E', method: 'DROP_OFF', status: 'OPEN', closeReason: null, createdAt: '2026-10-18T03:00:00.000Z',
    expiresAt: '2026-10-25T03:00:00.000Z', estimatedPoints: 4000, pointsAwarded: null, pointName: 'Kho Tubu', orderCode: null,
    lines: [{ itemName: 'Thùng carton cũ', unitLabel: 'thùng', declaredQty: 4 }],
  };
  const detail: ST.WasteRequestDetailDTO = {
    ...summary,
    lines: [{ itemId: 'wi-carton', itemName: 'Thùng carton cũ', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000, dropsPerUnit: 0, gramsPerUnit: null, declaredQty: 4, receivedQty: null, shortfallReason: null, pointsAwarded: null }],
    point: null, pointAvailable: true, carrier: null, trackingCode: null, inTransitAt: null, receivedAt: null, completedAt: null, closedAt: null,
    rejectionReason: null, rejectionNote: null, dropsAwarded: null, impactGrams: null, reversedPoints: null, reversalReason: null, editable: true, cancellable: true, orderId: null,
  };
  const guest: ST.WasteMeDTO = {
    programmeEnabled: true, eligibility: 'GUEST', blocked: false, shipLockedAt: null,
    laneFlags: { dropoff: true, mailin: true, pickup: false }, parcelLimits: { maxWeightKg: 20, maxEdgeCm: 50 },
    balance: null, monthUsage: null, impactGrams: null, thresholds: { mailinMinPoints: 15_000, pickupMinPoints: 10_000, maxOpenRequests: 3 },
    items: [], openRequests: [summary], deskPoints: [],
  };
  const itemDto: ST.WasteItemDTO = {
    id: 'wi-carton', code: 'CARTON', name: 'Thùng carton cũ', unitLabel: 'thùng', unitsPerPoint: 1, pointsPerGroup: 1000, dropsPerUnit: 0,
    dailyCapQty: 10, monthlyCapQty: 60, status: 'ACTIVE', prepInstructions: 'Gấp phẳng, giữ khô và sạch.', imageUrl: null, gramsPerUnit: null, hazardous: false, sortOrder: 10,
  };
  const fee: ST.WasteFeeEstimate = { zoneName: 'Toàn quốc', provinceCode: '01', provinceName: 'Hà Nội', low: 30000, high: 85000 };
  const claimPoint = { name: 'Kho Tubu TP.HCM', addressLine: '12 Đường A', communeName: 'Phường B', provinceName: 'TP.HCM', openingHours: { MON: [{ open: '08:00', close: '17:00' }] } };
  const catalog: ST.RewardCatalogDTO = { pointsBalance: 120_000, pointsConvertedBalance: 0, lockedPoints: 0, redeemablePoints: 120_000, giftClaimDays: 60, claimPoint, rewards: [] };
  const staffQueueRow: ST.AdminGiftRedemptionRowDTO = {
    id: 'g1', giftId: 'gift-bag', giftKind: 'GIFT', giftName: 'Túi vải Tubu', pointsCost: 40_000, status: 'READY', codeLast2: '89',
    customerName: 'Nguyen V.', customerPhone: '090****567', claimExpiresAt: '2026-12-17T03:00:00.000Z', overdue: false, createdAt: '2026-10-18T03:00:00.000Z',
  };
  const treeGift: ST.AdminWasteGiftDTO = {
    id: 'gift-tree', kind: 'TREE', name: 'Góp quỹ trồng cây', description: null, label: null, pointsCost: 0, status: 'ACTIVE', sortOrder: 50,
    imageUrl: null, stock: null, claimInstructions: null, voucher: null, redemptionCount: 3, fundTreeTotal: 12, treePointsPrice: 50_000,
  };
  const pointQuery: ST.AdminWastePointQuery = { status: 'PENDING', perkPending: true };
  const creditLogQuery: ST.AdminWasteRequestQuery = { status: 'COMPLETED', pointId: 'p1', limit: 20 };
  const metrics: ST.WasteMonthMetrics = {
    requestsCreatedByMethod: { DROP_OFF: 0, MAIL_IN: 0, PICKUP: 0 },
    requestsByStatus: { OPEN: 0, IN_TRANSIT: 0, RECEIVED: 0, COMPLETED: 0, REJECTED: 0, CANCELLED: 0, EXPIRED: 0, REVERSED: 0 },
    completeHoursP50: null, completeHoursP90: null, unitsByItem: [], unitsByPoint: [], pointsIssued: 0, pointsReversed: 0,
    receivedDeclaredPctByMethod: { DROP_OFF: null, MAIL_IN: null, PICKUP: null }, receivedDeclaredPctByPoint: [],
    rejectionsByReason: { WET: 0, DIRTY: 0, FOREIGN_OBJECT: 0, WRONG_TYPE: 0, DAMAGED: 0, NOT_ACCEPTED: 0, OVERSIZE: 0, HAZARDOUS: 0, UNPAID_POSTAGE: 0, OTHER: 0 },
    expiredCount: 0, quotaByPoint: [], pickupCount: 0, carrierCostVnd: 0, receivedWeightGrams: null, estimatedWeightGrams: null,
    repeatCustomers60d: 0, ordersOfExchangers: 0, ordersOfNonExchangers: 0, costVndPer1000PointsIssued: null,
  };
  const flags: ST.WastePublicFlags = { enabled: true, dropoff: true, mailin: true, pickup: false };
  const deskPoint: ST.WasteDeskPointDTO = {
    id: 'p1', kind: 'PARTNER', name: 'Tạp hoá Cô Ba', giftHandoverEnabled: false, myRole: 'OWNER',
    quota: { limit: 100_000, used: 30_000, remaining: 70_000 }, perkText: null, perkPendingText: null, staffDailyCapRemaining: 990_000,
  };
  const confirmed: ST.WasteConfirmResultDTO = {
    requestId: 'r1', code: 'TR-A2C4E', status: 'COMPLETED', pointsAwarded: 10_000, dropsAwarded: 0, quota: null, staffDailyCapRemaining: 990_000,
  };
  const alerts: ST.WasteAlertDTO[] = [
    { kind: 'QUOTA_PACE', pointId: 'p1', pointName: 'Tạp hoá Cô Ba', value: 72, threshold: 60, detail: 'Đã dùng 72% hạn mức trong 10 ngày đầu tháng' },
    { kind: 'STAFF_ACCOUNT_CONFIRMED', confirmerName: 'Nguyen V.', value: 1, threshold: null, detail: 'Yêu cầu của tài khoản nhân viên do người khác xác nhận' },
  ];

  it('desk, public flag and alert shapes carry their pinned leaf types', () => {
    expect(Object.keys(flags)).toEqual(['enabled', 'dropoff', 'mailin', 'pickup']);
    expect([deskPoint.quota!.remaining, deskPoint.staffDailyCapRemaining, confirmed.quota, confirmed.staffDailyCapRemaining]).toEqual([70_000, 990_000, null, 990_000]);
    expect(alerts.map((a) => a.threshold)).toEqual([60, null]);
  });

  it('WasteMatchInput carries the optional parcelTracking (registry 4.9)', () => {
    const match: ST.WasteMatchInput = { parcelCode: 'TR-A2C4E', phoneMatchConfirmed: true, parcelTracking: 'GHN123456' };
    const confirm: ST.WasteConfirmRequest = { lines: [], match };
    const receive: ST.WasteReceiveRequest = { match };
    expect([confirm.match!.parcelTracking, receive.match!.parcelTracking]).toEqual(['GHN123456', 'GHN123456']);
    expect(WASTE_TS).toMatch(/interface WasteMatchInput \{[^}]*parcelTracking\?: string/);
  });

  it('review DTO expansions are present (coverage F1, F4, F5, F6, F7, F10, F18, F19)', () => {
    expect(guest.openRequests[0]!.lines[0]!.declaredQty).toBe(4);
    expect([guest.impactGrams, detail.impactGrams, detail.lines[0]!.gramsPerUnit, itemDto.gramsPerUnit]).toEqual([null, null, null, null]);
    expect(itemDto.hazardous).toBe(false);
    expect(fee.provinceName).toBe('Hà Nội');
    expect(catalog.claimPoint!.provinceName).toBe('TP.HCM');
    expect(catalog.giftClaimDays).toBe(60);
    expect(staffQueueRow.codeLast2).toBe('89');
    expect('code' in staffQueueRow).toBe(false);
    expect('userId' in staffQueueRow).toBe(false);
    expect(treeGift.fundTreeTotal).toBe(12);
    expect([pointQuery.perkPending, creditLogQuery.pointId]).toEqual([true, 'p1']);
    expect(Object.keys(metrics)).toHaveLength(21);
  });
  const describeReceive = (r: ST.WasteReceiveResultDTO): string => {
    switch (r.outcome) {
      case 'RECEIVED': return r.requestId;
      case 'ALREADY_RECEIVED': return r.receivedAt;
      case 'UNMATCHED': return `${r.unmatchedId}:${r.reason}`;
    }
  };
  const describeLookup = (l: ST.WasteDeskLookupDTO): string => (l.type === 'REQUEST' ? l.request.code : l.redemption.giftName);
  const describeResolve = (r: ST.WasteUnmatchedResolveRequest): string => (r.action === 'MATCH' ? r.requestId : r.note);

  it('builds the fixtures and narrows the discriminated unions', () => {
    expect(detail.lines[0]!.declaredQty).toBe(4);
    expect(guest.eligibility).toBe('GUEST');
    expect(describeReceive({ outcome: 'RECEIVED', requestId: 'r1', receivedAt: '2026-10-18T03:00:00.000Z' })).toBe('r1');
    expect(describeReceive({ outcome: 'ALREADY_RECEIVED', receivedAt: '2026-10-18T03:00:00.000Z' })).toBe('2026-10-18T03:00:00.000Z');
    expect(describeReceive({ outcome: 'UNMATCHED', unmatchedId: 'u1', reason: 'NO_MATCH' })).toBe('u1:NO_MATCH');
    expect(describeLookup({ type: 'REQUEST', request: { id: 'r1', code: 'TR-A2C4E', method: 'DROP_OFF', status: 'OPEN', pointId: 'p1', customerName: 'Nguyen V.', customerPhone: '090****567', estimatedPoints: 4000, lines: [] } })).toBe('TR-A2C4E');
    expect(describeResolve({ action: 'MATCH', requestId: 'r2', note: 'Khớp theo mô tả' })).toBe('r2');
    expect(describeResolve({ action: 'CLOSE', note: 'Không ghép được' })).toBe('Không ghép được');
  });
  it('reward and voucher shapes reuse CouponType', () => {
    const voucher: ST.WasteVoucherSpec = { type: ST.CouponType.FREESHIP, value: 0, minOrder: 99000, maxDiscount: null, validDays: 30 };
    const reward: ST.RewardItemDTO = {
      id: 'reward-freeship', kind: 'VOUCHER', name: 'Miễn phí vận chuyển', description: null, label: 'Phổ biến', pointsCost: 20_000, imageUrl: null,
      stockRemaining: null, soldOut: false, canRedeem: true, claimInstructions: null, voucher, sortOrder: 10,
    };
    expect(reward.voucher!.validDays).toBe(30);
  });
});

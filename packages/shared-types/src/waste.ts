import type { CouponType } from './enums';

// Closed lists; the first fourteen mirror the Prisma enums and are checked against @prisma/client by waste-contract.spec.ts.
export const WASTE_ITEM_STATUS_VALUES = ['ACTIVE', 'COMING_SOON', 'HIDDEN'] as const;
export type WasteItemStatus = (typeof WASTE_ITEM_STATUS_VALUES)[number];
export const WASTE_POINT_KIND_VALUES = ['WAREHOUSE', 'PARTNER'] as const;
export type WastePointKind = (typeof WASTE_POINT_KIND_VALUES)[number];
export const WASTE_POINT_STATUS_VALUES = ['ACTIVE', 'PAUSED', 'PENDING'] as const;
export type WastePointStatus = (typeof WASTE_POINT_STATUS_VALUES)[number];
export const WASTE_POINT_STAFF_ROLE_VALUES = ['OWNER', 'STAFF'] as const;
export type WastePointStaffRole = (typeof WASTE_POINT_STAFF_ROLE_VALUES)[number];
export const WASTE_METHOD_VALUES = ['DROP_OFF', 'MAIL_IN', 'PICKUP'] as const;
export type WasteMethod = (typeof WASTE_METHOD_VALUES)[number];
export const WASTE_REQUEST_STATUS_VALUES = ['OPEN', 'IN_TRANSIT', 'RECEIVED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REVERSED'] as const;
export type WasteRequestStatus = (typeof WASTE_REQUEST_STATUS_VALUES)[number];
export const WASTE_CLOSE_REASON_VALUES = ['HOLD_EXPIRED', 'PICKUP_NO_SHOW', 'PICKUP_NOT_DISPATCHED', 'LOST', 'LOST_AT_WAREHOUSE', 'SHIP_LOCKED', 'ORDER_CANCELLED'] as const;
export type WasteCloseReason = (typeof WASTE_CLOSE_REASON_VALUES)[number];
export const WASTE_REJECTION_REASON_VALUES = ['WET', 'DIRTY', 'FOREIGN_OBJECT', 'WRONG_TYPE', 'DAMAGED', 'NOT_ACCEPTED', 'OVERSIZE', 'HAZARDOUS', 'UNPAID_POSTAGE', 'OTHER'] as const;
export type WasteRejectionReason = (typeof WASTE_REJECTION_REASON_VALUES)[number];
export const WASTE_SHORTFALL_REASON_VALUES = ['WET', 'DIRTY', 'FOREIGN_OBJECT', 'WRONG_TYPE', 'DAMAGED', 'NOT_ACCEPTED', 'OTHER'] as const;
export type WasteShortfallReason = (typeof WASTE_SHORTFALL_REASON_VALUES)[number];
export const WASTE_ACTOR_ROLE_VALUES = ['CUSTOMER', 'POINT_STAFF', 'STAFF', 'ADMIN', 'SYSTEM'] as const;
export type WasteActorRole = (typeof WASTE_ACTOR_ROLE_VALUES)[number];
export const WASTE_UNMATCHED_STATUS_VALUES = ['OPEN', 'RESOLVED'] as const;
export type WasteUnmatchedStatus = (typeof WASTE_UNMATCHED_STATUS_VALUES)[number];
export const WASTE_GIFT_KIND_VALUES = ['VOUCHER', 'TREE', 'SEED_PACK', 'GIFT'] as const;
export type WasteGiftKind = (typeof WASTE_GIFT_KIND_VALUES)[number];
export const WASTE_GIFT_STATUS_VALUES = ['ACTIVE', 'HIDDEN'] as const;
export type WasteGiftStatus = (typeof WASTE_GIFT_STATUS_VALUES)[number];
export const WASTE_GIFT_REDEMPTION_STATUS_VALUES = ['READY', 'FULFILLED', 'CANCELLED'] as const;
export type WasteGiftRedemptionStatus = (typeof WASTE_GIFT_REDEMPTION_STATUS_VALUES)[number];
export const WASTE_MATCH_BASIS_VALUES = ['TR_CODE', 'TRACKING_PHONE', 'MANUAL', 'ORDER'] as const;
export type WasteMatchBasis = (typeof WASTE_MATCH_BASIS_VALUES)[number];
export const WASTE_UNMATCHED_REASON_VALUES = ['NO_MATCH', 'TRACKING_MULTI', 'TR_TRACKING_CONFLICT', 'EXPIRED_REQUEST', 'NOT_RECEIVABLE', 'MANUAL_ENTRY'] as const;
export type WasteUnmatchedReason = (typeof WASTE_UNMATCHED_REASON_VALUES)[number];
export const WASTE_ELIGIBILITY_VALUES = ['OK', 'GUEST', 'NEED_PHONE'] as const;
export type WasteEligibility = (typeof WASTE_ELIGIBILITY_VALUES)[number];
export const WASTE_WEEKDAY_VALUES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type WasteWeekday = (typeof WASTE_WEEKDAY_VALUES)[number];
export const WASTE_PREVIEW_BLOCK_VALUES = ['BELOW_MIN', 'MONTH_CAP_FOR_MIN', 'ITEM_MONTH_CAP', 'ITEM_DAY_CAP', 'POINTS_MONTH_CAP', 'POINT_QUOTA_FULL', 'POINT_UNAVAILABLE', 'ITEM_NOT_ACTIVE', 'POINT_MISSING_ITEMS', 'LANE_DISABLED', 'SHIP_LOCKED', 'MAX_OPEN', 'PICKUP_PENDING', 'NEED_PROVINCE'] as const;
export type WastePreviewBlock = (typeof WASTE_PREVIEW_BLOCK_VALUES)[number];
export const WASTE_ALERT_KIND_VALUES = ['QUOTA_PACE', 'FULL_MATCH', 'FULL_MATCH_CONFIRMER', 'AVG_UNITS', 'AVG_UNITS_CONFIRMER', 'REPEAT_CUSTOMER', 'LOOKUP_MISS', 'STAFF_ACCOUNT_CONFIRMED', 'STAFF_DIRECT'] as const;
export type WasteAlertKind = (typeof WASTE_ALERT_KIND_VALUES)[number];
export const WASTE_REQUEST_QUEUE_FILTER_VALUES = ['TO_COUNT', 'EXPIRED', 'CUSTOMER_BLOCKED', 'ORDER_NOT_DELIVERED', 'TRANSIT_OVERDUE', 'ORDER_MISMATCH'] as const;
export type WasteRequestQueueFilter = (typeof WASTE_REQUEST_QUEUE_FILTER_VALUES)[number];

export interface WasteFeeTable { zones: { name: string; provinceCodes: string[]; low: number; high: number }[]; defaultZone: { name: string; low: number; high: number } }
export interface WasteFeeEstimate { zoneName: string; provinceCode: string; provinceName: string; low: number; high: number }
export interface WasteAlertThresholds { quotaPacePct: number; quotaPaceDays: number; fullMatchPct: number; fullMatchMinSample: number; repeatCustomerCount: number; repeatCustomerDays: number; avgUnitsFactor: number; lookupMissCount: number; lookupMissDays: number; staffDirectCount: number; staffDirectDays: number }
export interface WastePublicFlags { enabled: boolean; dropoff: boolean; mailin: boolean; pickup: boolean }
export type WasteOpeningHours = Partial<Record<WasteWeekday, { open: string; close: string }[]>>;
export interface WasteLaneFlags { dropoff: boolean; mailin: boolean; pickup: boolean }
export interface WasteParcelLimits { maxWeightKg: number; maxEdgeCm: number }

// customer
export interface WasteLineInput { itemId: string; declaredQty: number }
export interface WasteItemDTO { id: string; code: string; name: string; unitLabel: string; unitsPerPoint: number; pointsPerGroup: number; dropsPerUnit: number; dailyCapQty: number | null; monthlyCapQty: number | null; status: WasteItemStatus; prepInstructions: string | null; imageUrl: string | null; gramsPerUnit: number | null; hazardous: boolean; sortOrder: number; /** Chỉ kho TP.HCM nhận (đại lý không nhận). Optional để bản app cũ vẫn biên dịch; API luôn gửi. */ warehouseOnly?: boolean }
export interface WasteMeItemDTO extends WasteItemDTO { monthRemainingQty: number | null; dayRemainingQty: number | null }
export interface WastePointDTO { id: string; kind: WastePointKind; name: string; addressLine: string; provinceCode: string; provinceName: string; communeCode: string; communeName: string; lat: number | null; lng: number | null; phone: string | null; openingHours: WasteOpeningHours; acceptedItemIds: string[]; perkText: string | null; quotaFull: boolean; distanceKm: number | null }
export interface WastePointContactDTO { id: string; kind: WastePointKind; name: string; addressLine: string; communeName: string; provinceName: string; phone: string | null; openingHours: WasteOpeningHours }
export interface WasteDeskPointRefDTO { id: string; name: string; kind: WastePointKind }
export interface WasteMeDTO { programmeEnabled: boolean; eligibility: WasteEligibility; blocked: boolean; shipLockedAt: string | null; laneFlags: WasteLaneFlags; parcelLimits: WasteParcelLimits; balance: { pointsBalance: number; pointsConvertedBalance: number; redeemablePoints: number } | null; monthUsage: { capMonthKey: string; pointsUsed: number; pointsCap: number } | null; impactGrams: number | null; thresholds: { mailinMinPoints: number; pickupMinPoints: number; maxOpenRequests: number }; items: WasteMeItemDTO[]; openRequests: WasteRequestSummaryDTO[]; deskPoints: WasteDeskPointRefDTO[] }
export interface WasteNearbyRequest { provinceCode?: string; locationToken: string; zaloAccessToken: string }
export interface WastePreviewRequest { lines: WasteLineInput[]; method?: WasteMethod; pointId?: string; provinceCode?: string }
export interface WastePreviewBlockDTO { code: WastePreviewBlock; itemId?: string; missingPoints?: number; openCount?: number; pickupRequestCode?: string; pointsRemaining?: number }
export interface WastePreviewDTO { estimatedPoints: number; estimatedDrops: number; estimatedGrams: number | null; pointsValueVnd: number; blocks: WastePreviewBlockDTO[]; feeEstimate: WasteFeeEstimate | null; itemCaps: { itemId: string; monthRemainingQty: number | null; dayRemainingQty: number | null }[]; pointsMonthRemaining: number }
export interface WasteCreateRequest { method: WasteMethod; lines: WasteLineInput[]; pointId?: string; consent: true; packagingConsent?: boolean; postagePaidConsent?: boolean }
export interface WasteEditRequest { lines: WasteLineInput[]; pointId?: string }
export interface WasteTrackingRequest { carrier: string; trackingCode: string }
export interface WasteRequestLineDTO { itemId: string; itemName: string; unitLabel: string; unitsPerPoint: number; pointsPerGroup: number; dropsPerUnit: number; gramsPerUnit: number | null; declaredQty: number; receivedQty: number | null; shortfallReason: WasteShortfallReason | null; pointsAwarded: number | null }
export interface WasteRequestSummaryDTO { id: string; code: string; method: WasteMethod; status: WasteRequestStatus; closeReason: WasteCloseReason | null; createdAt: string; expiresAt: string | null; estimatedPoints: number; pointsAwarded: number | null; pointName: string; orderCode: string | null; lines: { itemName: string; unitLabel: string; declaredQty: number }[] }
export interface WasteRequestDetailDTO extends WasteRequestSummaryDTO { lines: WasteRequestLineDTO[]; point: WastePointContactDTO | null; pointAvailable: boolean; carrier: string | null; trackingCode: string | null; inTransitAt: string | null; receivedAt: string | null; completedAt: string | null; closedAt: string | null; rejectionReason: WasteRejectionReason | null; rejectionNote: string | null; dropsAwarded: number | null; impactGrams: number | null; reversedPoints: number | null; reversalReason: string | null; editable: boolean; cancellable: boolean; orderId: string | null }
export interface WasteRulesDTO { text: string | null }

// rewards
export interface WasteVoucherSpec { type: CouponType; value: number; minOrder: number | null; maxDiscount: number | null; validDays: number }
export interface RewardItemDTO { id: string; kind: WasteGiftKind; name: string; description: string | null; label: string | null; pointsCost: number; imageUrl: string | null; stockRemaining: number | null; soldOut: boolean; canRedeem: boolean; claimInstructions: string | null; voucher: WasteVoucherSpec | null; sortOrder: number }
export interface RewardCatalogDTO { pointsBalance: number; pointsConvertedBalance: number; lockedPoints: number; redeemablePoints: number; giftClaimDays: number; claimPoint: { name: string; addressLine: string; communeName: string; provinceName: string; openingHours: WasteOpeningHours } | null; rewards: RewardItemDTO[];
  /** Hạng của khách và ngưỡng tiền hàng được miễn phí giao ở hạng đó (đã gồm ngưỡng chung); null khi khách chưa có hạng. Thiếu khi API cũ. */
  tierFreeShip?: { tierName: string; freeFrom: number } | null }
/** GET /loyalty/preview (công khai): danh mục quà và bảng hạng cho khách chưa đăng nhập; không có số dư hay trường riêng của khách. */
export interface LoyaltyPreviewDTO {
  rewards: RewardItemDTO[];
  giftClaimDays: number;
  claimPoint: RewardCatalogDTO['claimPoint'];
  tiers: { id: string; name: string; minPoints: number; minSpending: number | null; multiplier: number; perks: string[] }[];
  rates: { earnPct: number; vndPerPoint: number; vndPerPointRedeem: number; maxRedeemPct: number };
  pointExpireMonths: number;
}
export interface GiftRedemptionDTO { id: string; giftId: string; giftKind: WasteGiftKind; giftName: string; pointsCost: number; status: WasteGiftRedemptionStatus; code: string | null; claimExpiresAt: string | null; claimPoint: { name: string; addressLine: string; communeName: string; provinceName: string; openingHours: WasteOpeningHours } | null; fulfilledAt: string | null; cancelledAt: string | null; cancelReason: string | null; refundedPoints: number | null; couponCode: string | null; createdAt: string }
export interface RedeemRewardResultDTO { success: true; message: string; pointsSpent: number; remainingPoints: number; redemption: GiftRedemptionDTO; coupon: { code: string; type: CouponType; value: number; minOrder: number | null; maxDiscount: number | null; endAt: string } | null }

// desk
export interface WasteDeskPointDTO { id: string; kind: WastePointKind; name: string; giftHandoverEnabled: boolean; myRole: WastePointStaffRole; quota: { limit: number; used: number; remaining: number } | null; perkText: string | null; perkPendingText: string | null; staffDailyCapRemaining: number }
export interface WasteDeskLookupRequest { code: string }
export interface WasteDeskRequestDTO { id: string; code: string; method: WasteMethod; status: WasteRequestStatus; pointId: string; customerName: string; customerPhone: string | null; estimatedPoints: number; lines: { itemId: string; itemName: string; unitLabel: string; unitsPerPoint: number; pointsPerGroup: number; declaredQty: number; receivedQty: number | null; hazardous: boolean }[] }
export interface WasteDeskGiftDTO { id: string; giftName: string; customerName: string; status: WasteGiftRedemptionStatus; claimExpiresAt: string | null }
export type WasteDeskLookupDTO = { type: 'REQUEST'; request: WasteDeskRequestDTO } | { type: 'GIFT'; redemption: WasteDeskGiftDTO };
export interface WasteMatchInput { parcelCode?: string; phoneMatchConfirmed?: boolean; parcelTracking?: string }
export interface WasteConfirmLineInput { itemId: string; declaredQty: number; receivedQty: number; shortfallReason?: WasteShortfallReason }
export interface WasteConfirmRequest { lines: WasteConfirmLineInput[]; receivedWeightGrams?: number /* integer 1..100000, outside the replay comparison (spec 15.3) */; match?: WasteMatchInput }
export interface WasteRejectRequest { rejectionReason: WasteRejectionReason; rejectionNote?: string; match?: WasteMatchInput }
export interface WasteConfirmResultDTO { requestId: string; code: string; status: 'COMPLETED'; pointsAwarded: number; dropsAwarded: number; quota: { limit: number; used: number; remaining: number } | null; staffDailyCapRemaining: number }
export interface WasteRejectResultDTO { requestId: string; code: string; status: 'REJECTED' }
export interface WasteDeskGiftFulfilRequest { code: string; pointId: string }
export interface WastePerkSubmitRequest { perkText: string }
export interface WastePointMonthlyReportDTO { pointId: string; month: string; confirmations: number; pointsAwarded: number; quotaUsed: number; units: { itemId: string; itemName: string; unitLabel: string; qty: number }[] }

// admin
/** warehouseOnly is optional so a client built before the field existed still type-checks; the API always sends it. */
export interface AdminWasteItemDTO extends WasteItemDTO { warehouseOnly?: boolean; createdAt: string; updatedAt: string }
export interface WasteItemUpsertRequest { code: string; name: string; unitLabel: string; unitsPerPoint: number; pointsPerGroup: number; dropsPerUnit?: number; dailyCapQty?: number | null; monthlyCapQty?: number | null; status?: WasteItemStatus; prepInstructions?: string | null; imageUrl?: string | null; sortOrder?: number; gramsPerUnit?: number | null; hazardous?: boolean }
export interface WastePointStaffDTO { userId: string; role: WastePointStaffRole; isActive: boolean; fullName: string | null; phone: string | null }
export interface AdminWastePointDTO extends WastePointDTO { status: WastePointStatus; monthlyQuotaPoints: number | null; monthUsage: { monthKey: string; pointsUsed: number; confirmations: number }; quotaFull: boolean; perkPendingText: string | null; giftHandoverEnabled: boolean; note: string | null; sortOrder: number; activatedAt: string | null; lastConfirmedAt: string | null; hiddenInactive: boolean; staff: WastePointStaffDTO[] }
export interface AdminWastePointQuery { status?: WastePointStatus; perkPending?: boolean }
export interface WastePointUpsertRequest { kind?: WastePointKind; name: string; addressLine: string; provinceCode: string; provinceName: string; communeCode: string; communeName: string; lat?: number | null; lng?: number | null; phone?: string | null; openingHours?: WasteOpeningHours; status?: WastePointStatus; monthlyQuotaPoints?: number | null; giftHandoverEnabled?: boolean; note?: string | null; sortOrder?: number; itemIds?: string[] }
export interface WastePointStaffAddRequest { userId: string; role: WastePointStaffRole }
export interface WastePerkReviewRequest { expectedPendingText: string }
export interface AdminWasteRequestQuery { method?: WasteMethod; status?: WasteRequestStatus; filter?: WasteRequestQueueFilter; userId?: string; pointId?: string; cursor?: string; limit?: number }
export interface AdminWasteRequestRowDTO { id: string; code: string; method: WasteMethod; status: WasteRequestStatus; closeReason: WasteCloseReason | null; createdAt: string; expiresAt: string | null; inTransitAt: string | null; receivedAt: string | null; completedAt: string | null; estimatedPoints: number; pointsAwarded: number | null; pointId: string; pointName: string; customerName: string; customerPhone: string | null; userId?: string; carrier: string | null; trackingCode: string | null; trackingConflict: boolean; orderCode: string | null; waitingReason: 'CUSTOMER_BLOCKED' | 'ORDER_NOT_DELIVERED' | null }
export interface WasteRequestAdminDetailDTO extends WasteRequestDetailDTO { lines: (WasteRequestLineDTO & { hazardous: boolean })[]; customerName: string; customerPhone: string | null; userId?: string; trackingConflict: boolean; confirmedByUserId: string | null; receivedWeightGrams: number | null; carrierCostVnd: number | null; reversedAt: string | null; reversedByUserId: string | null; reversalShortfallPoints: number | null; capDayKey: string; capMonthKey: string; consentAt: string; consentVersion: string; events?: AdminWasteEventDTO[] }
export interface AdminWasteEventDTO { id: string; createdAt: string; kind: string; actorUserId: string | null; actorRole: WasteActorRole; requestId: string | null; pointId: string | null; giftRedemptionId: string | null; meta: Record<string, unknown> | null }
export interface WasteReceiveRequest { match?: WasteMatchInput; receivedWeightGrams?: number /* integer 1..100000, outside the replay comparison (spec 15.3) */ }
export type WasteReceiveResultDTO = { outcome: 'RECEIVED'; requestId: string; receivedAt: string } | { outcome: 'ALREADY_RECEIVED'; receivedAt: string } | { outcome: 'UNMATCHED'; unmatchedId: string; reason: WasteUnmatchedReason };
export interface WasteUnmatchedDTO { id: string; receivedAt: string; createdByUserId: string; carrier: string | null; trackingCode: string | null; description: string; reason: WasteUnmatchedReason; relatedRequestId: string | null; status: WasteUnmatchedStatus; matchedRequestId: string | null; resolvedByUserId: string | null; resolvedAt: string | null; resolveNote: string | null }
export interface WasteUnmatchedCreateRequest { carrier?: string; trackingCode?: string; description: string }
export type WasteUnmatchedResolveRequest = { action: 'MATCH'; requestId: string; note: string } | { action: 'CLOSE'; note: string };
export interface WasteReverseRequest { reason: string }
export interface WasteReverseResultDTO { requestId: string; status: 'REVERSED'; pointsTaken: number; shortfallPoints: number }
export interface WasteCostRequest { carrierCostVnd?: number; receivedWeightGrams?: number /* integer 1..100000, outside the replay comparison (spec 15.3) */ }
export interface WasteCloseLostRequest { reason: string }
export interface WasteReopenRequest { reason: string; unmatchedId?: string }
export interface WasteUserFlagsDTO { userId: string; shipLockedAt: string | null; shipUnlockedAt: string | null; blockedAt: string | null; reason: string | null; setByUserId: string | null; updatedAt: string | null }
export interface WasteUserFlagsUpdateRequest { shipLocked?: boolean; blocked?: boolean; reason: string }
export interface AdminWasteGiftDTO { id: string; kind: WasteGiftKind; name: string; description: string | null; label: string | null; pointsCost: number; status: WasteGiftStatus; sortOrder: number; imageUrl: string | null; stock: number | null; claimInstructions: string | null; voucher: WasteVoucherSpec | null; redemptionCount: number; fundTreeTotal?: number; treePointsPrice?: number }
export interface WasteGiftUpsertRequest { kind?: WasteGiftKind; name: string; description?: string | null; label?: string | null; pointsCost?: number; status?: WasteGiftStatus; sortOrder?: number; imageUrl?: string | null; stock?: number | null; claimInstructions?: string | null; voucher?: WasteVoucherSpec }
export interface GiftRedemptionsQuery { status?: WasteGiftRedemptionStatus; overdue?: boolean }
export interface AdminGiftRedemptionRowDTO { id: string; giftId: string; giftKind: WasteGiftKind; giftName: string; pointsCost: number; status: WasteGiftRedemptionStatus; codeLast2: string | null; code?: string | null; customerName: string; customerPhone: string | null; userId?: string; claimExpiresAt: string | null; overdue: boolean; createdAt: string }
export interface WasteGiftCancelRequest { reason: string; refundPoints?: boolean }
export interface WasteReorderRequest { ids: string[] }
export interface WasteMonthMetrics { requestsCreatedByMethod: Record<WasteMethod, number>; requestsByStatus: Record<WasteRequestStatus, number>; completeHoursP50: number | null; completeHoursP90: number | null; unitsByItem: { itemId: string; itemName: string; unitLabel: string; qty: number }[]; unitsByPoint: { pointId: string; pointName: string; qty: number }[]; pointsIssued: number; pointsReversed: number; receivedDeclaredPctByMethod: Record<WasteMethod, number | null>; receivedDeclaredPctByPoint: { pointId: string; pct: number | null }[]; rejectionsByReason: Record<WasteRejectionReason, number>; expiredCount: number; quotaByPoint: { pointId: string; pointName: string; quota: number | null; used: number; confirmations: number }[]; pickupCount: number; carrierCostVnd: number; receivedWeightGrams: number | null; estimatedWeightGrams: number | null; repeatCustomers60d: number; ordersOfExchangers: number; ordersOfNonExchangers: number; costVndPer1000PointsIssued: number | null }
// threshold is null for STAFF_ACCOUNT_CONFIRMED, which flags every case and has no threshold (spec 5.5).
export interface WasteAlertDTO { kind: WasteAlertKind; pointId?: string; pointName?: string; confirmerName?: string; value: number; threshold: number | null; detail: string }
export interface WasteOverviewDTO { month: string; previousMonth: string; current: WasteMonthMetrics; previous: WasteMonthMetrics; alerts: WasteAlertDTO[] }

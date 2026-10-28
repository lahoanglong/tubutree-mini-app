import type { GiftRedemptionDTO, LoyaltyPreviewDTO, RedeemRewardResultDTO, RewardCatalogDTO, RewardItemDTO } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

/** Quy tắc tích/đổi Điểm Xanh do API trả từ SystemConfig (loyalty.earn_pct, vnd_per_point_redeem, max_redeem_pct). */
export interface LoyaltyRates {
  /** Phần trăm tiền hàng tích thành điểm (2 = 2%); thiếu khi API cũ chưa trả. */
  earnPct?: number;
  /** 100 / earnPct, giữ cho bản app cũ. */
  vndPerPoint: number;
  vndPerPointRedeem: number;
  maxRedeemPct: number;
}

/** Loyalty overview (§6.6) — hạng hiện tại, tiến độ lên hạng kế. */
export interface LoyaltyOverview {
  /** Điểm Xanh lô thường (có hạn, trần % khi dùng ở thanh toán). Tổng khách thấy: xem `pointsSummary` (utils/points-lots). */
  pointsBalance: number;
  /**
   * Điểm Xanh lô quy đổi từ xu cũ: không hết hạn, dùng ở thanh toán tới 100% giá trị hàng, không đổi quà,
   * không rút ra tiền. Optional: API cũ chưa trả (coi như 0).
   */
  pointsConvertedBalance?: number;
  /** Điểm thường sắp hết hạn gần nhất (số điểm + ngày ISO); null khi không có. Optional: API cũ chưa trả. */
  expiringPoints?: { amount: number; expiresAt: string } | null;
  /** Số tháng điểm thường hết hạn kể từ ngày nhận (cấu hình). Optional: API cũ chưa trả. */
  pointExpireMonths?: number;
  /** Hệ số server nhân khi tích điểm (1 khi chưa có hạng, dù `tier` hiển thị hạng thấp nhất). Optional: API cũ chưa trả. */
  earnMultiplier?: number;
  /** pointsBalance + pointsConvertedBalance (BE tính sẵn; FE tự cộng bằng `pointsSummary` ở utils/points-lots). */
  pointsTotal?: number;
  /** redeemablePoints + pointsConvertedBalance: trần điểm đề nghị dùng ở thanh toán. */
  redeemableTotal?: number;
  /**
   * Điểm XÉT HẠNG 12 tháng — CHỈ điểm tích từ đơn online đã giao, trừ phần của đơn bị trả/huỷ
   * (không gồm điểm danh, tích tại quầy, hoàn điểm đã dùng, Vườn Xanh, đánh giá, season pass).
   * nextTier.pointsToGo tính theo số này. Optional: API cũ chưa trả.
   */
  tierPoints?: number;
  /** Tiền mua 12 tháng (đơn đã giao, trừ phần hoàn): thước đo thật của hạng. Optional: API cũ chưa trả. */
  spent12m?: number;
  /**
   * Điểm CHƯA đổi quà được vì đơn còn có thể bị trả hàng (đơn mới giao còn trong hạn đổi/trả, đơn
   * đang có yêu cầu đổi/trả). Optional: API cũ chưa trả.
   */
  lockedPoints?: number;
  /** Phần của lockedPoints thuộc đơn đang chờ xử lý đổi/trả (mở khi yêu cầu được xử lý, không theo ngày). */
  lockedReturnPoints?: number;
  /** ISO — mốc muộn nhất phần khoá theo hạn đổi/trả được mở; null nếu không có. */
  lockedUntil?: string | null;
  /** Điểm dùng được để đổi quà ngay = số dư − lockedPoints (≥ 0). */
  redeemablePoints?: number;
  tier: { id: string; name: string; multiplier: number; perks: unknown } | null;
  nextTier: {
    id: string;
    name: string;
    minPoints: number;
    minSpending?: number | null;
    pointsToGo: number;
    /** Số tiền mua còn thiếu để lên hạng này; null khi hạng không có mốc chi tiêu. Optional: API cũ chưa trả. */
    spendingToGo?: number | null;
  } | null;
  tiers: { id: string; name: string; minPoints: number; minSpending?: number | null; multiplier: number }[];
  /** Quy tắc tích/đổi điểm từ cấu hình để giải thích trên màn Điểm Xanh. Optional: API cũ chưa trả. */
  rates?: LoyaltyRates;
}

export interface PointsTxn {
  id: string;
  delta: number;
  reason: string;
  refType: string | null;
  expiresAt: string | null;
  /** Lô của dòng sổ; dòng cũ/API cũ không có → lô thường. */
  lot?: 'STANDARD' | 'CONVERTED';
  createdAt: string;
}

export interface CouponDTO {
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: string;
  /** Mã chỉ áp cho các sản phẩm này (mã mua chung); null/thiếu = mọi sản phẩm. */
  products?: { id: string; name: string }[] | null;
}

/** Khối "Quà khách mới": khách chưa có đơn (đúng định nghĩa đơn đầu của API) kèm voucher chào mừng còn dùng được. */
export interface NewCustomerOffer {
  isNewCustomer: boolean;
  welcomeVoucher: Pick<CouponDTO, 'code' | 'type' | 'value' | 'minOrder' | 'endAt'> | null;
}


export interface ReferralMilestone {
  count: number;
  bonusPoints: number;
}

/** GET /me/referral — thống kê giới thiệu bạn bè, thưởng bằng Điểm Xanh. */
export interface ReferralOverview {
  referralCode: string;
  successCount: number;
  earnedPoints: number;
  milestones: ReferralMilestone[];
  nextMilestone: ReferralMilestone | null;
  /** Optional: API cũ chưa trả. */
  windowDays?: number;
  minOrderAmount?: number;
}


export type RewardItem = RewardItemDTO;
export type RewardCatalogResponse = RewardCatalogDTO;
export type RedeemRewardResult = RedeemRewardResultDTO;
export type GiftRedemption = GiftRedemptionDTO;

export interface CheckInReward {
  day: number;
  points: number;
  claimed: boolean;
  isToday: boolean;
}

/** GET /me/daily-check-in: trạng thái điểm danh gộp (Điểm Xanh + giọt nước) và dải 7 ngày của Điểm Xanh. */
export interface CheckInStatusResponse {
  /** true khi cả hai phần (Điểm Xanh và giọt nước) đã xong hôm nay. */
  checkedInToday: boolean;
  /** Chuỗi ngày liên tiếp tới hôm qua (chưa điểm danh) hoặc tới hôm nay (đã điểm danh); đứt = 0. */
  streakDays: number;
  /** Ô 1..7 của hôm nay: ô SẼ được trả khi bấm (chưa điểm danh) hoặc ô vừa nhận (đã điểm danh). */
  currentCycleDay: number;
  /** Điểm của ô hôm nay; 0 khi phần Điểm Xanh đã xong hôm nay. Optional: API cũ chưa trả. */
  todayPoints?: number;
  rewards: CheckInReward[];
  /** Từng phần đã xong hôm nay chưa. Optional: API cũ (chỉ Điểm Xanh) chưa trả. */
  pointsDone?: boolean;
  waterDone?: boolean;
  /** Giọt nước của lần điểm danh kế tiếp (gồm quà lần đầu, chưa tính thưởng mốc chuỗi); 0 khi phần nước đã xong hôm nay. */
  todayWater?: number;
  /** Bình nước đã đầy (totalSeeds >= sức chứa): phần nước hôm nay sẽ không cộng thêm. Optional: API cũ chưa trả thì không hiện chữ bình đầy. */
  tankFull?: boolean;
}

/** Phần Điểm Xanh của lần điểm danh. */
export interface PointsCheckInPart {
  success: boolean;
  cycleDay: number;
  streakDays: number;
  pointsEarned: number;
  totalPoints: number;
  message: string;
}

/** Phần giọt nước của lần điểm danh. */
export interface WaterCheckInPart {
  seedsEarned: number;
  streakDays: number;
  totalSeeds: number;
  streakFrozeUsed: boolean;
  bonusNote: string;
  /** Các khoản thưởng ĐÃ NẰM TRONG `seedsEarned` (quà lần đầu, mốc chuỗi). Optional: API cũ chưa trả. */
  bonuses?: Array<{ seeds: number; label: string }>;
}

/**
 * POST /me/daily-check-in. `points`/`water` là kết quả của LẦN GỌI NÀY; null = phần đó đã xong từ trước (hoặc vừa lỗi: xem
 * `pending`). `alreadyDone` = cả hai đã xong từ trước. `pending` còn phần nào thì gọi lại để bù đúng phần đó.
 */
export interface CheckInResult {
  points: PointsCheckInPart | null;
  water: WaterCheckInPart | null;
  alreadyDone: boolean;
  pending: Array<'points' | 'water'>;
}

/**
 * GET /me/loyalty/member-card. memberCode ("TUBU" + mã giới thiệu duy nhất) là payload DUY NHẤT
 * của QR trên thẻ và là đúng chuỗi mà nhân viên nhập/quét ở /loyalty/staff/scan-member.
 */
export interface MemberCardResponse {
  memberCode: string;
  name: string;
  phone: string | null;
  tierName: string;
  tierMultiplier: number;
  pointsBalance: number;
  /** false → tích điểm hoá đơn tại cửa hàng đang TẮT ở backend: UI không được hứa tính năng này. */
  posCreditEnabled: boolean;
}

export const getReferral = (http: HttpClient) => http.get<ReferralOverview>('/me/referral');
export const getLoyalty = (http: HttpClient) => http.get<LoyaltyOverview>('/me/loyalty');
export const getPointsTransactions = (http: HttpClient) => http.get<PointsTxn[]>('/me/points/transactions');
export const getCoupons = (http: HttpClient) => http.get<CouponDTO[]>('/me/coupons');
export const getNewCustomerOffer = (http: HttpClient) => http.get<NewCustomerOffer>('/me/new-customer-offer');
export const getLoyaltyPreview = (http: HttpClient) => http.get<LoyaltyPreviewDTO>('/loyalty/preview');
export const getLoyaltyRewards = (http: HttpClient) => http.get<RewardCatalogDTO>('/me/loyalty/rewards');
export const redeemLoyaltyReward = (http: HttpClient, rewardId: string, idempotencyKey: string) =>
  http.post<RedeemRewardResultDTO>(`/me/loyalty/rewards/${encodeURIComponent(rewardId)}/redeem`, undefined, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
export const getMyRedemptions = (http: HttpClient) => http.get<GiftRedemptionDTO[]>('/me/loyalty/rewards/mine');
export const getDailyCheckInStatus = (http: HttpClient) => http.get<CheckInStatusResponse>('/me/daily-check-in');
export const postDailyCheckIn = (http: HttpClient) => http.post<CheckInResult>('/me/daily-check-in');
export const getMemberCard = (http: HttpClient) => http.get<MemberCardResponse>('/me/loyalty/member-card');

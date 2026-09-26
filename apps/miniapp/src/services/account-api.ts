import { api } from './api';
import type { AddressDTO } from './shop-api';

/** Loyalty overview (§6.6) — hạng hiện tại, tiến độ lên hạng kế. */
export interface LoyaltyOverview {
  pointsBalance: number;
  /**
   * Điểm XÉT HẠNG 12 tháng — CHỈ điểm tích từ đơn online đã giao, trừ phần của đơn bị trả/huỷ
   * (không gồm điểm danh, tích tại quầy, hoàn điểm đã dùng, Vườn Xanh, đánh giá, season pass).
   * nextTier.pointsToGo tính theo số này. Optional: API cũ chưa trả.
   */
  tierPoints?: number;
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
  nextTier: { id: string; name: string; minPoints: number; pointsToGo: number } | null;
  tiers: { id: string; name: string; minPoints: number; multiplier: number }[];
}

export interface PointsTxn {
  id: string;
  delta: number;
  reason: string;
  refType: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CouponDTO {
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: string;
}

export interface WalletSummary {
  walletBalance: number;
  coinsBalance: number;
  cashbackPending: number;
  commissionApproved: number;
  commissionPending: number;
  xuConvertMultiplier: number;
  withdrawMin: number;
  withdrawFee: number;
}

export interface CoinTxn {
  id: string;
  delta: number;
  reason: string;
  refType: string | null;
  createdAt: string;
}

export interface ReferralMilestone {
  count: number;
  bonus: number;
}

export interface CoinsOverview {
  coinsBalance: number;
  referralCode: string;
  referralEarned: number;
  referralSuccessCount: number;
  referralMilestones?: ReferralMilestone[];
  nextMilestone?: ReferralMilestone | null;
  transactions: CoinTxn[];
}

export interface BankInfo {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

// Me / onboarding
export interface MeProfile {
  id: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  dob: string | null;
  onboarded: boolean;
  segments: string[];
}
export const getMe = () => api.get<MeProfile>('/me').then((r) => r.data);
export const updateMe = (data: { fullName?: string; email?: string; avatarUrl?: string; dob?: string }) =>
  api.patch<MeProfile>('/me', data).then((r) => r.data);
export const completeOnboarding = (segments: string[]) =>
  api.post<MeProfile>('/me/onboarding', { segments }).then((r) => r.data);

// Loyalty
export interface RewardItem {
  id: string;
  title: string;
  description: string;
  pointsCost: number;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder?: number | null;
  maxDiscount?: number | null;
  badge?: string;
  canRedeem: boolean;
}

export interface RewardCatalogResponse {
  pointsBalance: number;
  /** Xem LoyaltyOverview.lockedPoints. Optional: API cũ chưa trả. */
  lockedPoints?: number;
  /** Điểm dùng được để đổi quà (canRedeem của từng quà tính theo số này). */
  redeemablePoints?: number;
  rewards: RewardItem[];
}

export interface RedeemRewardResult {
  success: boolean;
  message: string;
  pointsSpent: number;
  remainingPoints: number;
  coupon: CouponDTO;
}

export interface CheckInReward {
  day: number;
  points: number;
  claimed: boolean;
  isToday: boolean;
}

/** GET /me/loyalty/check-in — điểm danh Điểm Xanh (tách riêng với điểm danh hạt giống Vườn Xanh). */
export interface CheckInStatusResponse {
  checkedInToday: boolean;
  /** Chuỗi ngày liên tiếp tới hôm qua (chưa điểm danh) hoặc tới hôm nay (đã điểm danh); đứt = 0. */
  streakDays: number;
  /** Ô 1..7 của hôm nay: ô SẼ được trả khi bấm (chưa điểm danh) hoặc ô vừa nhận (đã điểm danh). */
  currentCycleDay: number;
  /** Điểm của ô hôm nay. Optional: API cũ chưa trả. */
  todayPoints?: number;
  rewards: CheckInReward[];
}

export interface CheckInResult {
  success: boolean;
  cycleDay: number;
  streakDays: number;
  pointsEarned: number;
  totalPoints: number;
  message: string;
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

export const getLoyalty = () => api.get<LoyaltyOverview>('/me/loyalty').then((r) => r.data);
export const getPointsTransactions = () =>
  api.get<PointsTxn[]>('/me/points/transactions').then((r) => r.data);
export const getCoupons = () => api.get<CouponDTO[]>('/me/coupons').then((r) => r.data);
export const getLoyaltyRewards = () => api.get<RewardCatalogResponse>('/me/loyalty/rewards').then((r) => r.data);
export const redeemLoyaltyReward = (rewardId: string) =>
  api
    .post<RedeemRewardResult>(`/me/loyalty/rewards/${encodeURIComponent(rewardId)}/redeem`)
    .then((r) => r.data);
export const getDailyCheckInStatus = () => api.get<CheckInStatusResponse>('/me/loyalty/check-in').then((r) => r.data);
export const postDailyCheckIn = () => api.post<CheckInResult>('/me/loyalty/check-in').then((r) => r.data);
export const getMemberCard = () => api.get<MemberCardResponse>('/me/loyalty/member-card').then((r) => r.data);

// ── View helper thuần cho trang Hạng thành viên (test: account-api.spec.ts) ──

/** Nhãn tiếng Việt cho `reason` của sổ Điểm Xanh — không bao giờ hiện mã kỹ thuật thô. */
export function pointsReasonLabel(reason: string): string {
  if (reason.startsWith('DAILY_CHECKIN')) return 'Điểm danh hằng ngày';
  if (reason.startsWith('POS_OFFLINE_ORDER')) return 'Tích điểm mua tại cửa hàng';
  if (reason.startsWith('LOYALTY_REDEEM_VOUCHER')) return 'Đổi điểm lấy voucher';
  if (reason.startsWith('ORDER_DELIVERED')) return 'Tích điểm từ đơn hàng';
  if (reason.startsWith('ORDER_REDEEM')) return 'Dùng điểm khi thanh toán';
  if (reason.startsWith('ORDER_REVERSED')) return 'Hoàn ngược điểm (hủy/trả)';
  if (reason.startsWith('ORDER_REFUND_POINTS')) return 'Hoàn lại điểm đã dùng';
  if (reason.startsWith('POINTS_EXPIRED')) return 'Điểm hết hạn';
  if (reason.startsWith('GAME') || reason.startsWith('SEASONPASS')) return 'Phần thưởng Vườn Xanh';
  if (reason.startsWith('REVIEW')) return 'Đánh giá sản phẩm';
  return 'Điều chỉnh Điểm Xanh';
}

/** dd/mm/yyyy theo giờ Việt Nam (UTC+7) — cùng quy ước với thông báo lỗi của backend. */
function vnDate(iso: string): string {
  const v = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
}

/**
 * Giải thích vì sao 1 phần Điểm Xanh chưa đổi quà được (backend redeemReward chặn điểm của đơn còn
 * có thể bị trả hàng). null = không có điểm khoá / API cũ.
 */
export function lockedPointsNote(
  ov: Pick<LoyaltyOverview, 'pointsBalance' | 'lockedPoints' | 'lockedReturnPoints' | 'lockedUntil' | 'redeemablePoints'>,
): string | null {
  const locked = ov.lockedPoints ?? 0;
  if (locked <= 0) return null;
  const ret = ov.lockedReturnPoints ?? 0;
  const inWindow = locked - ret;
  const parts: string[] = [];
  if (inWindow > 0 && ov.lockedUntil) {
    parts.push(`${inWindow} điểm từ đơn mới giao sẽ dùng được sau ngày ${vnDate(ov.lockedUntil)} (hết hạn đổi/trả hàng)`);
  }
  if (ret > 0) parts.push(`${ret} điểm từ đơn đang chờ xử lý đổi/trả sẽ dùng được khi yêu cầu được xử lý xong`);
  if (parts.length === 0) parts.push(`${locked} điểm từ đơn mới giao chưa dùng được`);
  const usable = ov.redeemablePoints ?? Math.max(0, ov.pointsBalance - locked);
  return `Đổi quà dùng được ${usable} điểm: ${parts.join('; ')}.`;
}

/** Nhãn nút đổi quà — không nói "Cần X điểm" khi số dư đủ mà chỉ đang chờ mở khoá điểm. */
export function rewardButtonLabel(
  r: Pick<RewardItem, 'pointsCost' | 'canRedeem'>,
  catalog: Pick<RewardCatalogResponse, 'pointsBalance' | 'redeemablePoints'>,
): string {
  if (r.canRedeem) return 'Đổi ngay';
  if (catalog.redeemablePoints !== undefined && catalog.pointsBalance >= r.pointsCost) return 'Chờ mở khoá điểm';
  return `Cần ${r.pointsCost} điểm`;
}

/** Nút điểm danh: ghi đúng số điểm của ô hôm nay (ô backend sẽ trả khi bấm). */
export function checkInView(s: CheckInStatusResponse): { canCheckIn: boolean; buttonLabel: string } {
  if (s.checkedInToday) return { canCheckIn: false, buttonLabel: 'Đã điểm danh' };
  const pts = s.todayPoints ?? s.rewards.find((r) => r.isToday)?.points ?? 0;
  return { canCheckIn: true, buttonLabel: pts > 0 ? `Điểm danh +${pts}` : 'Điểm danh' };
}

/**
 * % tiến độ từ SÀN điểm hạng hiện tại → ngưỡng hạng kế, theo điểm XÉT HẠNG (tierPoints) — cùng
 * con số backend dùng cho pointsToGo. Tính theo số dư (có điểm danh/POS) sẽ vẽ thanh gần đầy trong
 * khi backend không bao giờ cho lên hạng.
 */
export function tierProgressPercent(ov: LoyaltyOverview): number {
  const next = ov.nextTier;
  if (!next) return 100;
  const curMin = ov.tiers.find((t) => t.id === ov.tier?.id)?.minPoints ?? 0;
  if (next.minPoints <= curMin) return 100;
  const pts = ov.tierPoints ?? ov.pointsBalance;
  return Math.min(100, Math.max(0, Math.round(((pts - curMin) / (next.minPoints - curMin)) * 100)));
}

/** Lời nhắc dưới QR thẻ thành viên — chỉ hứa tích điểm tại quầy khi backend thật sự bật. */
export function memberCardHint(card: Pick<MemberCardResponse, 'posCreditEnabled'>): string {
  return card.posCreditEnabled
    ? 'Đưa mã QR này cho thu ngân khi thanh toán tại cửa hàng Tubu để được tích Điểm Xanh.'
    : 'Đây là mã thành viên của bạn. Tích Điểm Xanh khi mua tại cửa hàng chưa được áp dụng — hiện điểm được tích khi mua hàng online.';
}

// Wallet
export const getWallet = () => api.get<WalletSummary>('/me/wallet').then((r) => r.data);
export const withdraw = (amount: number, bankInfo: BankInfo, idempotencyKey: string) =>
  api
    .post<{ ok: boolean; payoutId: string; status: string; withdrawn: number; fee: number; net: number }>(
      '/wallet/withdraw',
      { amount, bankInfo },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    .then((r) => r.data);

// TubuXu
export const getCoins = () => api.get<CoinsOverview>('/me/coins').then((r) => r.data);
/** Doi Vi -> xu kem Idempotency-Key: doi 1 chieu (xu khong rut duoc) nen double-tap khong duoc doi 2 lan. */
export const convertToXu = (amount: number, idempotencyKey: string) =>
  api
    .post<{ spent: number; received: number; multiplier: number }>(
      '/wallet/convert-xu',
      { amount },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    .then((r) => r.data);

// Notifications
export interface NotificationDTO {
  id: string;
  templateCode: string;
  payload: { body?: string; data?: Record<string, string> };
  status: 'SENT' | 'FAILED' | 'READ';
  sentAt: string;
}
export const getNotifications = () =>
  api.get<NotificationDTO[]>('/me/notifications').then((r) => r.data);
export const markNotificationRead = (id: string) =>
  api.post<{ ok: boolean }>(`/me/notifications/${id}/read`).then((r) => r.data);

// Addresses (bổ sung update/delete cho address book)
export const updateAddress = (id: string, data: Partial<Omit<AddressDTO, 'id'>>) =>
  api.patch<AddressDTO>(`/me/addresses/${id}`, data).then((r) => r.data);
export const deleteAddress = (id: string) =>
  api.delete<{ ok: boolean }>(`/me/addresses/${id}`).then((r) => r.data);

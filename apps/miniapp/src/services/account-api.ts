import type { GiftRedemptionDTO, RedeemRewardResultDTO, RewardCatalogDTO, RewardItemDTO } from '@tubutree/shared-types';
import { api } from './api';
import { takeMeBlock } from './home-feed';
import type { AddressDTO } from './shop-api';
import { formatNumber } from '../utils/format';
import type { LoyaltyRates } from '../utils/loyalty-copy';

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

export interface WalletSummary {
  walletBalance: number;
  cashbackPending: number;
  commissionApproved: number;
  commissionPending: number;
  withdrawMin: number;
  withdrawFee: number;
}

/** Một dòng sao kê Ví Tubu (sổ cái wallet_transactions). delta có dấu: + vào ví, − ra khỏi ví. */
export interface WalletTxn {
  id: string;
  delta: number;
  balanceAfter: number;
  type: string;
  reason: string | null;
  orderId: string | null;
  createdAt: string;
}

export interface WalletTxnPage {
  data: WalletTxn[];
  meta: { page: number; limit: number; total: number };
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

/** A1-03: yêu cầu xoá tài khoản (KHÔNG phải xoá thật — CSKH xử lý thủ công, xem UsersService). */
export interface AccountDeletionRequestResult {
  alreadyRequested: boolean;
  createdAt: string;
  message: string;
}
export const requestAccountDeletion = (reason?: string) =>
  api.post<AccountDeletionRequestResult>('/me/deletion-request', { reason }).then((r) => r.data);

// Loyalty
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

/** GET /me/loyalty/check-in — điểm danh Điểm Xanh (tách riêng với điểm danh giọt nước Vườn Xanh). */
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

export const getReferral = () => api.get<ReferralOverview>('/me/referral').then((r) => r.data);
export const getLoyalty = () => api.get<LoyaltyOverview>('/me/loyalty').then((r) => r.data);
export const getPointsTransactions = () =>
  api.get<PointsTxn[]>('/me/points/transactions').then((r) => r.data);
export const getCoupons = () => api.get<CouponDTO[]>('/me/coupons').then((r) => r.data);
export const getNewCustomerOffer = async () =>
  (await takeMeBlock('newCustomerOffer')) ?? api.get<NewCustomerOffer>('/me/new-customer-offer').then((r) => r.data);
export const getLoyaltyRewards = () => api.get<RewardCatalogDTO>('/me/loyalty/rewards').then((r) => r.data);
export const redeemLoyaltyReward = (rewardId: string, idempotencyKey: string) =>
  api
    .post<RedeemRewardResultDTO>(`/me/loyalty/rewards/${encodeURIComponent(rewardId)}/redeem`, undefined, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    .then((r) => r.data);
export const getMyRedemptions = () => api.get<GiftRedemptionDTO[]>('/me/loyalty/rewards/mine').then((r) => r.data);
export const getDailyCheckInStatus = () => api.get<CheckInStatusResponse>('/me/loyalty/check-in').then((r) => r.data);
export const postDailyCheckIn = () => api.post<CheckInResult>('/me/loyalty/check-in').then((r) => r.data);
export const getMemberCard = () => api.get<MemberCardResponse>('/me/loyalty/member-card').then((r) => r.data);

// ── View helper thuần cho trang Hạng thành viên (test: account-api.spec.ts) ──

/**
 * Nhãn tiếng Việt cho `reason` của sổ Điểm Xanh — không bao giờ hiện mã kỹ thuật thô. Cùng bảng với màn quản trị
 * (apps/web ledger-labels.ts): sửa một bên thì sửa cả bên kia.
 */
export function pointsReasonLabel(rawReason: string): string {
  // Gộp phiên khách vãng lai đổi khoá một số dòng thành `MERGED:<id>:<reason cũ>` (auth.service).
  const reason = rawReason.replace(/^MERGED:[^:]+:/, '');
  if (reason.startsWith('DAILY_CHECKIN')) return 'Điểm danh hằng ngày';
  if (reason.startsWith('POS_OFFLINE_ORDER')) return 'Tích điểm mua tại cửa hàng';
  if (reason.startsWith('LOYALTY_REDEEM_VOUCHER')) return 'Đổi điểm lấy mã giảm giá';
  // RECYCLE_REVERSED phải đứng trước RECYCLE vì cùng khớp startsWith.
  if (reason.startsWith('RECYCLE_REVERSED:')) return 'Thu hồi điểm đổi rác';
  if (reason.startsWith('RECYCLE:')) return 'Đổi rác lấy quà';
  if (reason.startsWith('GIFT_REDEEM:')) return 'Đổi điểm lấy quà';
  if (reason.startsWith('GIFT_REFUND:')) return 'Hoàn điểm quà';
  // Hậu tố _REVERSED phải đứng trước mã ngắn hơn vì cùng khớp startsWith.
  if (reason.startsWith('PANCAKE_CHAT_ORDER_REVERSED:')) return 'Thu hồi điểm đơn đặt qua tư vấn viên';
  if (reason.startsWith('PANCAKE_CHAT_ORDER:')) return 'Tích điểm đơn đặt qua tư vấn viên';
  if (reason.startsWith('MARKETPLACE_ORDER_REVERSED:')) return 'Thu hồi điểm đơn mua trên sàn';
  if (reason.startsWith('MARKETPLACE_ORDER:')) return 'Tích điểm đơn mua trên sàn';
  if (reason.startsWith('ORDER_DELIVERED')) return 'Tích điểm từ đơn hàng';
  if (reason.startsWith('ORDER_REDEEM')) return 'Dùng điểm khi thanh toán';
  if (reason.startsWith('ORDER_REVERSED')) return 'Thu hồi điểm của đơn trả hàng';
  if (reason.startsWith('ORDER_REFUND_POINTS')) return 'Hoàn lại điểm đã dùng';
  if (reason.startsWith('ORDER_REFUND_CONVERTED') || reason.startsWith('ORDER_REFUND_XU')) return 'Hoàn điểm đơn huỷ/trả';
  if (reason.startsWith('RETURN_REVERSED')) return 'Thu hồi điểm của đơn trả hàng';
  if (reason.startsWith('RETURN_REFUND')) return 'Hoàn lại điểm đã dùng (trả hàng)';
  if (reason.startsWith('POINTS_EXPIRED')) return 'Điểm hết hạn';
  if (reason.startsWith('XU_TO_POINTS')) return 'Chuyển từ xu cũ sang Điểm Xanh';
  if (reason.startsWith('REFERRAL')) {
    if (reason.includes('DEBT')) return 'Ghi nợ thu hồi thưởng giới thiệu';
    return reason.includes('REVOKE') ? 'Thu hồi thưởng giới thiệu' : 'Thưởng giới thiệu bạn bè';
  }
  if (reason.startsWith('COMMUNITY')) return 'Thưởng cộng đồng';
  if (reason.startsWith('STOREFRONT_QUEST')) return 'Thưởng nhiệm vụ gian hàng';
  if (reason.startsWith('CTV_MILESTONE')) return 'Thưởng mốc doanh số CTV';
  if (reason.startsWith('GAME_BUY_TREE')) return 'Góp quỹ trồng cây';
  if (reason.startsWith('GAME_SPIN_COST')) return 'Quay vòng quay may mắn';
  if (reason.startsWith('GAME') || reason.startsWith('SEASONPASS')) return 'Phần thưởng Vườn Xanh';
  if (reason.startsWith('MISSION')) return 'Thưởng nhiệm vụ Vườn Xanh';
  if (reason.startsWith('REVIEW_DELETE')) return 'Thu hồi điểm đánh giá đã xoá';
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
    parts.push(`${formatNumber(inWindow)} điểm từ đơn mới giao sẽ dùng được sau ngày ${vnDate(ov.lockedUntil)} (hết hạn đổi/trả hàng)`);
  }
  if (ret > 0) parts.push(`${formatNumber(ret)} điểm từ đơn đang chờ xử lý đổi/trả sẽ dùng được khi yêu cầu được xử lý xong`);
  if (parts.length === 0) parts.push(`${formatNumber(locked)} điểm từ đơn mới giao chưa dùng được`);
  const usable = ov.redeemablePoints ?? Math.max(0, ov.pointsBalance - locked);
  return `Đổi quà dùng được ${formatNumber(usable)} điểm: ${parts.join('; ')}.`;
}

export type RewardCardState =
  | { kind: 'redeem' }
  | { kind: 'soldOut' }
  | { kind: 'locked' }
  | { kind: 'need'; missing: number };

/**
 * Trạng thái thẻ quà theo số máy chủ trả. Quà TREE đi qua `buyTree` nên tiêu cả hai lô; "Cần thêm" của nó phải tính
 * cùng tổng với `canRedeem`. Hết hàng đứng trước nên thẻ hết không bao giờ hiện "Cần thêm".
 */
export function rewardCardState(
  r: Pick<RewardItemDTO, 'kind' | 'pointsCost' | 'canRedeem' | 'soldOut'>,
  c: Pick<RewardCatalogDTO, 'redeemablePoints' | 'pointsConvertedBalance'>,
): RewardCardState {
  if (r.soldOut) return { kind: 'soldOut' };
  if (r.canRedeem) return { kind: 'redeem' };
  const spendable = r.kind === 'TREE' ? c.redeemablePoints + c.pointsConvertedBalance : c.redeemablePoints;
  const missing = r.pointsCost - spendable;
  return missing > 0 ? { kind: 'need', missing } : { kind: 'locked' };
}

/** Nút điểm danh: ghi đúng số điểm của ô hôm nay (ô backend sẽ trả khi bấm). */
export function checkInView(s: CheckInStatusResponse): { canCheckIn: boolean; buttonLabel: string } {
  if (s.checkedInToday) return { canCheckIn: false, buttonLabel: 'Đã điểm danh' };
  const pts = s.todayPoints ?? s.rewards.find((r) => r.isToday)?.points ?? 0;
  return { canCheckIn: true, buttonLabel: pts > 0 ? `Điểm danh +${pts}` : 'Điểm danh' };
}

/**
 * % tiến độ lên hạng kế. Hạng có mốc chi tiêu thì đo theo TIỀN MUA 12 tháng (spent12m, cùng số backend dùng để xét hạng
 * và tính spendingToGo); hạng không có mốc chi tiêu hoặc API cũ chưa trả spent12m thì đo theo điểm XÉT HẠNG (tierPoints).
 * Đo theo số dư (có điểm danh/POS) sẽ vẽ thanh gần đầy trong khi backend không bao giờ cho lên hạng.
 */
export function tierProgressPercent(ov: LoyaltyOverview): number {
  const next = ov.nextTier;
  if (!next) return 100;
  const curTier = ov.tiers.find((t) => t.id === ov.tier?.id);
  if (next.minSpending != null && ov.spent12m !== undefined) {
    const curSpend = curTier?.minSpending ?? 0;
    if (next.minSpending <= curSpend) return 100;
    return Math.min(100, Math.max(0, Math.round(((ov.spent12m - curSpend) / (next.minSpending - curSpend)) * 100)));
  }
  const curMin = curTier?.minPoints ?? 0;
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
export const getWalletTransactions = (page: number, limit = 20) =>
  api.get<WalletTxnPage>('/me/wallet/transactions', { params: { page, limit } }).then((r) => r.data);
export const withdraw = (amount: number, bankInfo: BankInfo, idempotencyKey: string) =>
  api
    .post<{ ok: boolean; payoutId: string; status: string; withdrawn: number; fee: number; net: number }>(
      '/wallet/withdraw',
      { amount, bankInfo },
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
export const getNotifications = async () =>
  (await takeMeBlock('notifications')) ?? api.get<NotificationDTO[]>('/me/notifications').then((r) => r.data);
export const markNotificationRead = (id: string) =>
  api.post<{ ok: boolean }>(`/me/notifications/${id}/read`).then((r) => r.data);
export const markAllNotificationsRead = () =>
  api.post<{ ok: boolean; count: number }>('/me/notifications/read-all').then((r) => r.data);

// Addresses (bổ sung update/delete cho address book)
export const updateAddress = (id: string, data: Partial<Omit<AddressDTO, 'id'>>) =>
  api.patch<AddressDTO>(`/me/addresses/${id}`, data).then((r) => r.data);
export const deleteAddress = (id: string) =>
  api.delete<{ ok: boolean }>(`/me/addresses/${id}`).then((r) => r.data);

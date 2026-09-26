import { api } from './api';
import type { OrderDTO } from '@tubutree/shared-types';
import { formatVnd } from '../utils/format';

export type DealerStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface DealerMe {
  isDealer: boolean;
  status: DealerStatus;
  tier: { id: string; name: string; creditLimit: number } | null;
  currentDebt: number;
}

export interface DealerApplyInput {
  businessName: string;
  taxCode?: string;
  ownerName: string;
  phone: string;
  address: string;
  cccdFrontUrl: string;
  cccdBackUrl: string;
  storeFrontUrl?: string;
  monthlyVolumeEstimate?: number;
  notes?: string;
}

export interface PricelistRow {
  variationId: string;
  sku: string;
  product: string;
  brand: string;
  variation: string;
  retailPrice: number;
  dealerPrice: number;
  discountPct: number;
  stock: number;
}

export interface CreditEntry {
  id: string;
  delta: number;
  refType: string;
  note: string | null;
  createdAt: string;
}

export const getDealerMe = () => api.get<DealerMe>('/dealer/me').then((r) => r.data);
export const applyDealer = (data: DealerApplyInput) =>
  api.post('/dealer/apply', data).then((r) => r.data);
export const getPricelist = () => api.get<PricelistRow[]>('/dealer/pricelist').then((r) => r.data);
/** Đặt đơn đại lý kèm Idempotency-Key (mirror checkout.placeOrder/wallet.withdraw) — double-tap/retry mạng không tạo đơn công nợ đôi. */
export const placeDealerOrder = (
  items: { variationId: string; quantity: number }[],
  paymentMethod: 'CREDIT' | 'PREPAID',
  note?: string,
  idempotencyKey?: string,
) =>
  api
    .post<OrderDTO>(
      '/dealer/orders',
      { items, paymentMethod, note },
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    )
    .then((r) => r.data);
export const getDealerOrders = () => api.get<OrderDTO[]>('/dealer/orders').then((r) => r.data);
export const getCreditLedger = () =>
  api.get<{ balance: number; entries: CreditEntry[] }>('/dealer/credit-ledger').then((r) => r.data);
/** Báo đã chuyển khoản trả nợ, kèm Idempotency-Key BẮT BUỘC (mirror placeDealerOrder/wallet.withdraw)
 * — double-tap/retry mạng của 1 lần báo không được trừ nợ 2 lần. */
export const payCredit = (amount: number, idempotencyKey: string, note?: string) =>
  api
    .post<{ ok: boolean }>(
      '/dealer/credit-payment',
      { amount, note },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    .then((r) => r.data);

// ── Báo cáo quý (#71) ──
export interface QuarterlyReport {
  quarter: string;
  periodStart: string;
  periodEnd: string;
  /** Doanh số ĐÃ CHỐT (đã thanh toán/ghi công nợ + đã đóng gói trở đi) — nền tính thưởng. */
  revenue: number;
  orderCount: number;
  /** Đơn trong quý chưa thanh toán / chưa đóng gói — chưa tính thưởng. */
  pendingRevenue: number;
  pendingOrderCount: number;
  bonusPct: number;
  bonusAmount: number;
  nextTier: { min: number; pct: number; toNext: number } | null;
  tiers: { min: number; pct: number }[];
}
export const getQuarterlyReport = () =>
  api.get<QuarterlyReport>('/dealer/quarterly-report').then((r) => r.data);

/** Vòng đời yêu cầu nhận thưởng: PENDING → APPROVED | REJECTED; APPROVED → PAID. */
export type DealerRewardClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface DealerRewardProgress {
  id: string;
  type: 'TOUR' | 'GIFT' | 'OTHER';
  title: string;
  description: string | null;
  threshold: number;
  period: string;
  /** 'Q3/2026' | '2026' — gửi kèm khi yêu cầu nhận thưởng. */
  periodKey: string;
  periodLabel: string;
  /** false = dòng của kỳ trước (còn trong thời gian gia hạn / đã có yêu cầu). */
  isCurrentPeriod: boolean;
  /** Doanh số ĐÃ CHỐT của kỳ. */
  volume: number;
  /** Đơn trong kỳ chưa thanh toán / chưa đóng gói — chưa tính. */
  pendingVolume: number;
  achieved: boolean;
  toGo: number;
  claimStatus: DealerRewardClaimStatus | null;
  claimId: string | null;
  rejectionReason: string | null;
  /** Mốc (loại trừ) hết hạn gửi yêu cầu cho kỳ này. */
  claimDeadline: string;
  canClaim: boolean;
}
export interface DealerRewardsView {
  quarter: string;
  year: number;
  quarterVolume: number;
  yearVolume: number;
  quarterPendingVolume: number;
  yearPendingVolume: number;
  claimGraceDays: number;
  rewards: DealerRewardProgress[];
}
export const getDealerRewards = () =>
  api.get<DealerRewardsView>('/dealer/rewards').then((r) => r.data);

export interface DealerRewardClaimResult {
  success: boolean;
  /** true = đã gửi trước đó (bấm lại/2 request) — backend trả yêu cầu cũ, không tạo thêm. */
  alreadyClaimed: boolean;
  claimStatus: DealerRewardClaimStatus;
  message: string;
  claim: { id: string; status: DealerRewardClaimStatus; periodKey: string; volumeAtClaim: number; createdAt: string };
  reward: { id: string | null; title: string; type: string; threshold: number };
  periodKey: string;
  periodLabel: string;
  currentVolume: number;
}
/** Gửi yêu cầu nhận thưởng mốc cho 1 kỳ — idempotent phía backend (đại lý + kỳ + phần thưởng). */
export const claimDealerReward = (rewardId: string, periodKey?: string, note?: string) =>
  api
    .post<DealerRewardClaimResult>(`/dealer/rewards/${encodeURIComponent(rewardId)}/claim`, { periodKey, note })
    .then((r) => r.data);

/** Ngày cuối (giờ VN) còn hạn của mốc loại trừ `iso` (00:00 VN ngày kế) — dd/mm/yyyy. */
export function vnLastDayLabel(iso: string): string {
  const d = new Date(Date.parse(iso) - 1 + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export type RewardClaimTone = 'info' | 'success' | 'danger' | 'muted';
export interface RewardClaimView {
  showClaimButton: boolean;
  badge: { label: string; tone: RewardClaimTone } | null;
  hint: string;
}

/**
 * Trạng thái hiển thị 1 dòng phần thưởng. claimStatus (backend) LUÔN thắng: đã có yêu cầu thì
 * không bao giờ hiện lại nút — kể cả REJECTED (trạng thái cuối, cần hỗ trợ thì nhắn Zalo OA).
 */
export function rewardClaimView(
  r: Pick<
    DealerRewardProgress,
    'achieved' | 'canClaim' | 'claimStatus' | 'rejectionReason' | 'toGo' | 'pendingVolume' | 'isCurrentPeriod' | 'claimDeadline'
  >,
): RewardClaimView {
  switch (r.claimStatus) {
    case 'PENDING':
      return {
        showClaimButton: false,
        badge: { label: 'Đã gửi yêu cầu · chờ duyệt', tone: 'info' },
        hint: 'Tubu Tree sẽ báo kết quả trong mục Thông báo.',
      };
    case 'APPROVED':
      return {
        showClaimButton: false,
        badge: { label: 'Đã duyệt · chờ trao thưởng', tone: 'success' },
        hint: 'Tubu Tree sẽ liên hệ để trao thưởng cho bạn.',
      };
    case 'PAID':
      return { showClaimButton: false, badge: { label: 'Đã trao thưởng ✓', tone: 'success' }, hint: 'Cảm ơn bạn đã đồng hành 🌿' };
    case 'REJECTED':
      return {
        showClaimButton: false,
        badge: { label: 'Yêu cầu bị từ chối', tone: 'danger' },
        hint: r.rejectionReason
          ? `Lý do: ${r.rejectionReason}`
          : 'Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.',
      };
    default:
      break;
  }
  if (!r.achieved) {
    const pending = r.pendingVolume > 0 ? ` · ${formatVnd(r.pendingVolume)} đang chờ thanh toán/đóng gói` : '';
    return { showClaimButton: false, badge: null, hint: `Còn ${formatVnd(r.toGo)} để đạt${pending}` };
  }
  if (!r.canClaim) {
    return { showClaimButton: false, badge: { label: 'Đã hết hạn gửi yêu cầu', tone: 'muted' }, hint: 'Đã đạt chỉ tiêu doanh số' };
  }
  return {
    showClaimButton: true,
    badge: null,
    hint: r.isCurrentPeriod
      ? 'Đã đạt chỉ tiêu doanh số 🎉'
      : `Đã đạt 🎉 · hạn gửi yêu cầu: hết ngày ${vnLastDayLabel(r.claimDeadline)}`,
  };
}

// ── Mẫu đơn lưu sẵn (#64) ──
export interface DealerTemplate {
  id: string;
  name: string;
  items: { variationId: string; quantity: number }[];
  createdAt: string;
}
export const getTemplates = () => api.get<DealerTemplate[]>('/dealer/templates').then((r) => r.data);
export const saveTemplate = (name: string, items: { variationId: string; quantity: number }[]) =>
  api.post<DealerTemplate>('/dealer/templates', { name, items }).then((r) => r.data);
export const deleteTemplate = (id: string) =>
  api.delete<{ ok: boolean }>(`/dealer/templates/${id}`).then((r) => r.data);

import { dealerApplyPitch } from '@tubutree/app-core/dealer-apply-copy';
import type { DealerRewardClaimStatus, DealerRewardProgress } from '@tubutree/app-core/api/dealer';
import { formatVnd } from './format-vnd';

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

type ClaimInput = Pick<
  DealerRewardProgress,
  'achieved' | 'canClaim' | 'rejectionReason' | 'toGo' | 'pendingVolume' | 'isCurrentPeriod' | 'claimDeadline'
> & { claimStatus: DealerRewardClaimStatus | null };

/**
 * Trạng thái hiển thị một dòng phần thưởng, cùng luật với Mini App. claimStatus của máy chủ LUÔN thắng: đã có yêu cầu thì
 * không bao giờ hiện lại nút, kể cả REJECTED (trạng thái cuối, cần hỗ trợ thì nhắn Zalo OA). Không dùng emoji/ký hiệu
 * trong chữ vì trang nội bộ đi qua icon của lucide-react.
 */
export function rewardClaimView(r: ClaimInput): RewardClaimView {
  switch (r.claimStatus) {
    case 'PENDING':
      return { showClaimButton: false, badge: { label: 'Đã gửi yêu cầu · chờ duyệt', tone: 'info' }, hint: 'Tubu Tree sẽ báo kết quả trong mục Thông báo.' };
    case 'APPROVED':
      return { showClaimButton: false, badge: { label: 'Đã duyệt · chờ trao thưởng', tone: 'success' }, hint: 'Tubu Tree sẽ liên hệ để trao thưởng cho bạn.' };
    case 'PAID':
      return { showClaimButton: false, badge: { label: 'Đã trao thưởng', tone: 'success' }, hint: 'Cảm ơn bạn đã đồng hành cùng Tubu Tree.' };
    case 'REJECTED':
      return {
        showClaimButton: false,
        badge: { label: 'Yêu cầu bị từ chối', tone: 'danger' },
        hint: r.rejectionReason ? `Lý do: ${r.rejectionReason}` : 'Cần hỗ trợ, bạn nhắn Zalo OA Tubu Tree nhé.',
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
    hint: r.isCurrentPeriod ? 'Đã đạt chỉ tiêu doanh số' : `Đã đạt · hạn gửi yêu cầu: hết ngày ${vnLastDayLabel(r.claimDeadline)}`,
  };
}

/** Tỉ lệ 0..1 → "45%", "3,5%" (dấu phẩy Việt, bỏ ",0" thừa). */
export function formatRatePct(rate: number | string | null | undefined): string {
  const v = Number(rate ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '0%';
  return `${(v * 100).toFixed(1).replace(/\.0$/, '').replace('.', ',')}%`;
}

/** % bậc thưởng quý (đơn vị phần trăm, không phải tỉ lệ) ghi kiểu Việt, cùng đường với Mini App. */
export const bonusPctText = (pct: number): string => formatRatePct(pct / 100);

/** Chữ mời đăng ký: chỉ nêu con số khi cấu hình thật đã về, không hứa con số mặc định. */
export const applyPitch = (maxDiscountPct: number | null | undefined): string => dealerApplyPitch(maxDiscountPct ? formatRatePct(maxDiscountPct) : null);

export const pendingBody = (reviewHours: number | null | undefined): string =>
  reviewHours
    ? `Đội ngũ Tubu sẽ xét duyệt trong vòng ${reviewHours} giờ và liên hệ lại với bạn qua Zalo.`
    : 'Đội ngũ Tubu sẽ xét duyệt và liên hệ lại với bạn qua Zalo.';

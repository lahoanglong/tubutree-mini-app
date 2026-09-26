import type { DealerRewardClaimStatus } from './admin-client';

/** Nhãn trạng thái — trùng CLAIM_STATUS_LABEL của BE (dealer.service.ts) và màn Đại lý trong miniapp. */
export const CLAIM_STATUS_LABEL: Record<DealerRewardClaimStatus, string> = {
  PENDING: 'Đang chờ duyệt',
  APPROVED: 'Đã duyệt, chờ trao thưởng',
  REJECTED: 'Bị từ chối',
  PAID: 'Đã trao thưởng',
};

export const CLAIM_STATUS_ORDER: DealerRewardClaimStatus[] = ['PENDING', 'APPROVED', 'PAID', 'REJECTED'];

export const CLAIM_REWARD_TYPE_LABEL: Record<string, string> = { TOUR: 'Tour', GIFT: 'Quà', OTHER: 'Khác' };

/** Thao tác hợp lệ theo luồng PENDING → APPROVED | REJECTED; APPROVED → PAID (khớp DealerService). */
export function claimActions(status: DealerRewardClaimStatus): { approve: boolean; reject: boolean; markPaid: boolean } {
  return { approve: status === 'PENDING', reject: status === 'PENDING', markPaid: status === 'APPROVED' };
}

/** Lý do từ chối bắt buộc (BE @IsNotEmpty @MaxLength(500)); null = hợp lệ. */
export function rejectReasonError(reason: string): string | null {
  const r = reason.trim();
  if (!r) return 'Nhập lý do từ chối — đại lý sẽ nhận được lý do này.';
  if (r.length > 500) return 'Lý do tối đa 500 ký tự.';
  return null;
}

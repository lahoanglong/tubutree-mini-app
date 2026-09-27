import type { AdminPayoutStatus } from './admin-client';

/** Nhãn trạng thái Payout cho admin — mirror CLAIM_STATUS_LABEL (dealer-claims.ts). */
export const PAYOUT_STATUS_LABEL: Record<AdminPayoutStatus, string> = {
  REQUESTED: 'Đang chờ duyệt',
  APPROVED: 'Đã duyệt, chờ chuyển khoản',
  PAID: 'Đã chuyển khoản',
  REJECTED: 'Bị từ chối (đã hoàn)',
};

export const PAYOUT_STATUS_ORDER: AdminPayoutStatus[] = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'];

/** Thao tác hợp lệ theo luồng REQUESTED → APPROVED | REJECTED; APPROVED → PAID (khớp AffiliateService). */
export function payoutActions(status: AdminPayoutStatus): { approve: boolean; reject: boolean; markPaid: boolean } {
  return { approve: status === 'REQUESTED', reject: status === 'REQUESTED', markPaid: status === 'APPROVED' };
}

/** Lý do từ chối bắt buộc (BE @IsNotEmpty @MaxLength(500)); null = hợp lệ. */
export function rejectPayoutReasonError(reason: string): string | null {
  const r = reason.trim();
  if (!r) return 'Nhập lý do từ chối — tiền/hoa hồng sẽ được hoàn lại cho CTV kèm lý do này.';
  if (r.length > 500) return 'Lý do tối đa 500 ký tự.';
  return null;
}

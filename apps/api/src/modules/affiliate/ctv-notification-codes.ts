/**
 * Mã mẫu thông báo gửi CTV (mẫu nằm trong prisma/seed.ts). Phải bắt đầu bằng "COMMISSION" để
 * màn Thông báo của miniapp gom vào nhóm "Hoa hồng CTV" (notificationMeta).
 */
export const CTV_NOTIFICATION = {
  NEW: 'COMMISSION_NEW',
  APPROVED: 'COMMISSION_APPROVED',
  PAYOUT_PAID: 'COMMISSION_PAYOUT_PAID',
  PAYOUT_APPROVED: 'COMMISSION_PAYOUT_APPROVED',
  PAYOUT_REJECTED: 'COMMISSION_PAYOUT_REJECTED',
  REVERSED: 'COMMISSION_REVERSED',
} as const;

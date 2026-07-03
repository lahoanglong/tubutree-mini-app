export interface CancelInput {
  now: Date;
  workStart: Date; // giờ bắt đầu ca (hiệu lực)
  isEmergency: boolean;
  hasEvidence: boolean;
  emergencyCountThisMonth: number; // số ca đột xuất đã miễn phạt trong tháng (chưa tính ca này)
  noticeDays: number; // cfg attendance.cancel_notice_days
  emergencyCap: number; // cfg attendance.emergency_cap_month
}

/**
 * Quyết định huỷ ca đã duyệt:
 * - Báo trước ≥ noticeDays → miễn phạt.
 * - Báo trễ: miễn nếu đột xuất + có chứng cứ + chưa vượt cap; ngược lại phạt (1h công — Phase D quy tiền).
 */
export function decideCancel(i: CancelInput): { allowed: true; penalty: boolean } {
  const daysNotice = (i.workStart.getTime() - i.now.getTime()) / 86400000;
  if (daysNotice >= i.noticeDays) return { allowed: true, penalty: false };
  if (i.isEmergency && i.hasEvidence && i.emergencyCountThisMonth < i.emergencyCap) {
    return { allowed: true, penalty: false };
  }
  return { allowed: true, penalty: true };
}

import type { OpsCronJob, OpsHealth } from '@/lib/admin-client';

/** Việc nền đang lỗi: lượt gần nhất lỗi (consecutiveFailures > 0). Banner xanh chỉ hiện khi không còn việc nào như vậy. */
export const failingCronJobs = (h: Pick<OpsHealth, 'cronJobs'>): OpsCronJob[] =>
  (h.cronJobs ?? []).filter((j) => j.consecutiveFailures > 0).sort((a, b) => b.consecutiveFailures - a.consecutiveFailures || a.job.localeCompare(b.job));

/**
 * Câu báo sau khi bấm tay "Tính lại số đã bán": không có gì đổi vẫn phải đọc ra là đã đúng, không giống job hỏng.
 * API cũ chưa trả `zeroed` thì coi là 0; chưa trả `scanned` thì bỏ phần trong ngoặc thay vì nói "xét 0 sản phẩm".
 */
export const recomputeSoldMessage = (r: { updated: number; zeroed?: number; scanned?: number }): string => {
  const updated = r.updated ?? 0;
  const zeroed = r.zeroed ?? 0;
  const scope = r.scanned === undefined ? '' : ` (xét ${r.scanned} sản phẩm có đơn đã giao)`;
  return updated === 0 && zeroed === 0
    ? `Số đã bán đã đúng, không sản phẩm nào cần đổi${scope}.`
    : `Đã tính lại số đã bán: ${updated} sản phẩm đổi số, ${zeroed} sản phẩm về 0${scope}.`;
};

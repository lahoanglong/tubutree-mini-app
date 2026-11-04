import type { OpsCronJob, OpsHealth } from '@/lib/admin-client';

/** Việc nền đang lỗi: lượt gần nhất lỗi (consecutiveFailures > 0). Banner xanh chỉ hiện khi không còn việc nào như vậy. */
export const failingCronJobs = (h: Pick<OpsHealth, 'cronJobs'>): OpsCronJob[] =>
  (h.cronJobs ?? []).filter((j) => j.consecutiveFailures > 0).sort((a, b) => b.consecutiveFailures - a.consecutiveFailures || a.job.localeCompare(b.job));

/** Câu báo sau khi bấm tay "Tính lại số đã bán": không có gì đổi vẫn phải đọc ra là đã đúng, không giống job hỏng. */
export const recomputeSoldMessage = (r: { updated: number; zeroed: number; scanned: number }): string =>
  r.updated === 0 && r.zeroed === 0
    ? `Số đã bán đã đúng, không sản phẩm nào cần đổi (đã xét ${r.scanned} sản phẩm).`
    : `Đã tính lại số đã bán: ${r.updated} sản phẩm đổi số, ${r.zeroed} sản phẩm về 0 (đã xét ${r.scanned} sản phẩm).`;

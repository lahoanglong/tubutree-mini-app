import type { OpsCronJob, OpsHealth } from '@/lib/admin-client';

/** Việc nền đang lỗi: lượt gần nhất lỗi (consecutiveFailures > 0). Banner xanh chỉ hiện khi không còn việc nào như vậy. */
export const failingCronJobs = (h: Pick<OpsHealth, 'cronJobs'>): OpsCronJob[] =>
  (h.cronJobs ?? []).filter((j) => j.consecutiveFailures > 0).sort((a, b) => b.consecutiveFailures - a.consecutiveFailures || a.job.localeCompare(b.job));

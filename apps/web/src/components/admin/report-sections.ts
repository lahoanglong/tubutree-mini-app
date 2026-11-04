export type ReportSection = 'revenue' | 'sources' | 'finance';
export const ALL_SECTIONS: readonly ReportSection[] = ['revenue', 'sources', 'finance'];

/**
 * Phần báo cáo mở cho người đang xem — khớp @AllowStaff của AdminReportsController: doanh thu và file tài chính cho KE_TOAN,
 * bảng nguồn khách cho MARKETING. Phần không có quyền thì không render, nên cũng không gọi API (khỏi 403).
 */
export function reportSectionsFor(isAdmin: boolean, perms: readonly string[]): ReportSection[] {
  if (isAdmin) return [...ALL_SECTIONS];
  return ALL_SECTIONS.filter((s) => (s === 'sources' ? perms.includes('MARKETING') : perms.includes('KE_TOAN')));
}

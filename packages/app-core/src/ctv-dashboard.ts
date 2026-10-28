/** Ba tab của trang CTV: mỗi tab chỉ tải dữ liệu của tab đó. */
export const CTV_TABS = [
  { key: 'overview', label: 'Tổng quan' },
  { key: 'commission', label: 'Hoa hồng' },
  { key: 'share', label: 'Chia sẻ' },
] as const;
export type CtvTabKey = (typeof CTV_TABS)[number]['key'];
export const CTV_TAB_KEYS: readonly CtvTabKey[] = CTV_TABS.map((t) => t.key);

/** Một câu chung cho khoản hoa hồng đang chờ, dùng ở trang CTV và ở Ví Tubu để CTV không thấy hai tên cho cùng một số. */
export const COMMISSION_PENDING_LABEL = 'Hoa hồng đang chờ';
export const COMMISSION_PENDING_NOTE = 'đơn chưa giao hoặc trong thời gian đổi/trả';

interface DashboardMoney {
  monthCommission: number;
  pendingCommission: number;
  withdrawableCommission: number;
  totalConversions: number;
}

/**
 * Số to đầu trang là tiền dùng được ngay (có thể chuyển vào Ví). Hoa hồng đang chờ và số tạm tính tháng là dòng phụ, vì
 * số tạm tính gồm cả hoa hồng chưa chốt nên dễ bị hiểu là tiền đã có.
 */
export function ctvHeadline(d: DashboardMoney | undefined): { big: number; pending: number; monthEstimate: number } {
  return { big: d?.withdrawableCommission ?? 0, pending: d?.pendingCommission ?? 0, monthEstimate: d?.monthCommission ?? 0 };
}

/** Lời cho ô "Chuyển vào Ví" khi chưa có số dư: nói vì sao và khi nào có. `pendingText` đã định dạng tiền. */
export function transferBlockedText(pendingText: string): string {
  return `Hoa hồng vào Ví khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: ${pendingText}.`;
}

/** Thẻ "Việc đầu tiên" chỉ hiện cho CTV chưa có đơn nào: có chuyển đổi hoặc bất kỳ khoản hoa hồng nào là đã có đơn đầu. */
export function hasFirstOrder(d: DashboardMoney | undefined): boolean {
  if (!d) return false;
  return d.totalConversions > 0 || d.monthCommission > 0 || d.pendingCommission > 0 || d.withdrawableCommission > 0;
}

/** Mốc thưởng hiện mặc định: các mốc nhận được và mốc kế tiếp; đã đạt hết thì mốc cuối. Giữ thứ tự gốc. */
export function nextMilestoneRows<T extends { achieved: boolean; canClaim: boolean }>(ms: readonly T[]): T[] {
  if (ms.length === 0) return [];
  const next = ms.find((m) => !m.achieved);
  const keep = ms.filter((m) => m.canClaim || m === next);
  return keep.length > 0 ? keep : [ms[ms.length - 1]!];
}

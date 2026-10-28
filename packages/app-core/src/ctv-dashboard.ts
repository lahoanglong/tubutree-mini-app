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

/**
 * Cờ `autoWalletTransfer` của dashboard: chỉ đúng `true` mới là bật. API cũ (rollback) chưa trả trường này thì coi như tắt,
 * để màn không hứa "tự vào Ví" khi máy chủ không làm.
 */
export function isAutoWalletTransfer(flag: boolean | undefined): boolean {
  return flag === true;
}

/**
 * Số to của hero. Tự chuyển bật thì hoa hồng đã duyệt vào Ví ngay nên "có thể chuyển" gần như luôn 0đ: lúc đó số to là số dư Ví
 * (tiền dùng được ngay). Dashboard về trước Ví thì chưa biết số nào sẽ là số to: `waiting` = true, màn giữ khung chờ để số to
 * không đổi nhãn và số khi Ví về. Ví lỗi (không còn tải, không có số dư) thì giữ số chuyển được.
 */
export function ctvHeroAmount(
  transferable: number,
  auto: boolean,
  walletBalance: number | undefined,
  walletLoading = false,
): { label: string; amount: number; waiting: boolean } {
  if (auto && transferable <= 0) {
    if (walletBalance !== undefined) return { label: 'Số dư Ví Tubu', amount: walletBalance, waiting: false };
    if (walletLoading) return { label: 'Số dư Ví Tubu', amount: 0, waiting: true };
  }
  return { label: 'Có thể chuyển vào Ví', amount: transferable, waiting: false };
}

/** Hero đang hiện số dư Ví thì dòng "Số dư Ví" bên dưới trùng số: màn bỏ số ở dòng đó. */
export function heroShowsWalletBalance(hero: { label: string; waiting: boolean }): boolean {
  return !hero.waiting && hero.label === 'Số dư Ví Tubu';
}

/** Lời cho ô "Chuyển vào Ví" khi chưa có số dư: nói vì sao và khi nào có. `pendingText` đã định dạng tiền. */
export function transferBlockedText(pendingText: string, auto = true): string {
  return auto
    ? `Hoa hồng tự vào Ví Tubu khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: ${pendingText}.`
    : `Hoa hồng chuyển được vào Ví Tubu khi đơn đã giao và hết thời gian đổi/trả. Đang chờ: ${pendingText}.`;
}

/** Dòng dưới số to khi còn hoa hồng "có thể chuyển": với tự chuyển bật thì đây là phần chưa tự vào Ví được, CTV bấm tay. */
export function transferHeroNote(auto = true): string {
  return auto
    ? 'Phần này chưa tự vào Ví được (thường do cần mã số thuế). Bấm Chuyển vào Ví để nhận ngay.'
    : 'Bấm Chuyển vào Ví để chuyển phần này vào Ví Tubu.';
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

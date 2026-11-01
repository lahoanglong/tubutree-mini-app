export type CommunityView = 'pending' | 'reports' | 'published' | 'unanswered' | 'events';

export interface CommunityViewDef {
  k: CommunityView;
  label: string;
  /** Nhãn gọn cho Mini App (thanh tab hẹp). */
  shortLabel: string;
  /** Mini App chỉ mang ba mục xử lý nhanh; "Đã đăng" và "Chưa trả lời" làm ở web admin. */
  mini: boolean;
  /** Chỉ ADMIN (nhân viên CSKH/MARKETING không có quyền ở API). */
  adminOnly: boolean;
}

export const COMMUNITY_VIEWS: readonly CommunityViewDef[] = [
  { k: 'pending', label: 'Chờ duyệt', shortLabel: 'Chờ duyệt', mini: true, adminOnly: false },
  { k: 'reports', label: 'Báo cáo vi phạm', shortLabel: 'Báo cáo', mini: true, adminOnly: false },
  { k: 'published', label: 'Đã đăng', shortLabel: 'Đã đăng', mini: false, adminOnly: false },
  { k: 'unanswered', label: 'Chưa trả lời', shortLabel: 'Chưa trả lời', mini: false, adminOnly: false },
  { k: 'events', label: 'Sự kiện', shortLabel: 'Sự kiện', mini: true, adminOnly: true },
];

export function communityViewsFor({ platform, isAdmin }: { platform: 'web' | 'mini'; isAdmin: boolean }): CommunityViewDef[] {
  return COMMUNITY_VIEWS.filter((v) => (platform === 'web' || v.mini) && (isAdmin || !v.adminOnly));
}

export const communityViewLabel = (v: CommunityViewDef, platform: 'web' | 'mini') => (platform === 'mini' ? v.shortLabel : v.label);

/** API danh sách báo cáo chỉ trả tối đa 50 dòng. */
const REPORTS_LIST_CAP = 50;

/**
 * Số hiện cạnh tab Báo cáo: số thật từ hộp việc (khoá communityReports) nếu có; chưa có thì lấy độ dài danh sách đã tải,
 * đủ trần thì ghi "50+". Không có gì để báo (0 hoặc chưa biết) thì trả undefined để ẩn số.
 */
export function reportsTabCount(inboxCount: number | undefined, listLength: number | undefined): number | string | undefined {
  const n = inboxCount ?? (listLength === undefined ? undefined : listLength >= REPORTS_LIST_CAP ? `${REPORTS_LIST_CAP}+` : listLength);
  return n === undefined || n === 0 ? undefined : n;
}

import { canSeeAcademy } from './account-copy';
import { BRAND_OWNER_TITLE } from './client-copy';
import { homeCopy } from './home-copy';
import { ORDER_STATUS_ROW, RECYCLE_REQUESTS_LABEL } from './home-layout';
import { DESK_ENTRY_LABEL } from './profile-sections';
import { ctvMenuEntry, type CtvAccessHint } from './storefront-signup';

/**
 * Danh sách dòng của trang Cá nhân, một nguồn cho Mini App (`pages/profile.tsx`) và web (`/tai-khoan`): cùng dòng, cùng thứ tự, cùng chữ,
 * mỗi đích ghi cả route Mini lẫn route web. Chữ đặt ở đây (không ở `home-copy.ts`) vì chỉ trang Cá nhân dùng: `home-copy` nằm trong gói đầu Mini App.
 */
export const PROFILE_MENU_COPY = {
  notifications: 'Thông báo',
  notificationsCount: (n: number) => `${n} thông báo chưa đọc`,
  offers: 'Ưu đãi & quà',
  offersHint: 'Mã giảm giá và đổi quà',
  offersCount: (n: number) => `${n} mã giảm giá đang có`,
  invite: 'Mời bạn nhận quà',
  inviteHint: 'Chia sẻ mã mời qua Zalo',
  addresses: 'Sổ địa chỉ',
  wishlist: 'Sản phẩm yêu thích',
  recycle: 'Đổi rác lấy quà',
  support: 'Hỗ trợ',
  /** Tên đọc của dòng có chấm tin chưa đọc (Hỗ trợ đang đóng, Chat): bắt đầu bằng chữ nhìn thấy (WCAG 2.5.3). */
  unreadName: (label: string) => `${label}, có tin mới`,
  chat: 'Chat với Tubu Tree',
  chatUnread: 'Có tin nhắn mới',
  ai: 'Trợ lý AI 24/7',
  aiHint: 'Tư vấn sản phẩm',
  about: 'Về Tubu Tree & Hỗ trợ',
  brandStory: 'Câu chuyện thương hiệu',
  settings: 'Cài đặt',
  partner: 'Dành cho đối tác',
  dealerApproved: 'Kênh đại lý',
  dealerPending: 'Hồ sơ đại lý',
  dealerPendingHint: 'Đang chờ duyệt',
  staff: 'Ca làm & chấm công',
  staffHint: 'Đăng ký ca, chấm công',
  payroll: 'Lương của tôi',
  payrollHint: 'Xem lương & thông tin nhận',
  admin: 'Quản trị nhân sự',
  adminHint: 'Cấp quyền, duyệt ca, lương',
} as const;

/** Hàng trạng thái đơn của Cá nhân: bốn ô, không có Định kỳ (gói định kỳ mở từ tab Định kỳ của trang đơn và từ Trang chủ). */
export const PROFILE_ORDER_ROW = ORDER_STATUS_ROW.filter((r) => r.key !== 'subscriptions');

export type ProfileRowKey = 'notifications' | 'offers' | 'invite' | 'addresses' | 'wishlist' | 'recycle' | 'support' | 'settings' | 'partner';
export type ProfileLinkKey = 'chat' | 'ai' | 'about' | 'brandStory' | 'ctv' | 'academy' | 'dealer' | 'brandOwner' | 'staff' | 'payroll' | 'desk' | 'admin';

export interface ProfileMenuLink {
  key: ProfileLinkKey;
  label: string;
  hint?: string;
  /** Route Mini App. */
  mini: string;
  /** Route web. */
  web: string;
}

export type ProfileMenuRow =
  | { kind: 'link'; key: ProfileRowKey; label: string; hint?: string; mini: string; web: string }
  /** Dòng mở tại chỗ. `invite` không có mục con: app vẽ nội dung thẻ mời bạn trong phần mở. */
  | { kind: 'accordion'; key: ProfileRowKey; label: string; hint?: string; children: ProfileMenuLink[] };

export interface ProfileMenuDealer {
  isDealer?: boolean;
  status?: string | null;
  tier?: { name?: string } | null;
}

export interface ProfileMenuContext {
  role: string | null | undefined;
  chatEnabled: boolean;
  aiEnabled: boolean;
  /** Chương trình đổi rác đang chạy (cờ `waste.enabled` của cấu hình công khai). */
  wasteEnabled: boolean;
  /** Chương trình đã tạm dừng mà khách còn yêu cầu đổi rác đang mở. */
  recycleOpenRequests: boolean;
  /** Hàng huy hiệu đang hiện: nhường chỗ bằng mục Câu chuyện thương hiệu (vẫn mở được từ trang sản phẩm và trang thương hiệu). */
  badgesEnabled: boolean;
  /** Có mã giới thiệu: không có thì không có dòng Mời bạn. */
  hasReferralCode: boolean;
  /** Số mã giảm giá khả dụng; chưa tải hoặc lỗi thì null/undefined. */
  couponCount: number | null | undefined;
  /** Số thông báo chưa đọc (/me/summary). Có thì thêm dòng Thông báo đầu danh sách: chấm nhắc ở tab Cá nhân trỏ tới đây; không có thì lối vào là chuông ở Trang chủ. */
  unreadNotifications?: number | null;
  dealer: ProfileMenuDealer | null | undefined;
  ownedBrandName: string | null | undefined;
  /** GET /affiliate/me (chỉ cần với đại lý, nhân viên, admin): quyết định mục Cộng tác viên. */
  ctvAccess?: CtvAccessHint | null;
  /** Tên các điểm nhận hàng khách này vận hành (GET /waste/desk/points); rỗng hoặc chưa có thì không có mục quầy. */
  deskPointNames?: readonly string[];
}

const PARTNER_ROLES = new Set(['AFFILIATE', 'DEALER', 'STAFF', 'ADMIN']);

/** Tài khoản có việc đối tác/công việc: vai trò, hồ sơ đại lý (chờ duyệt hoặc đã duyệt), nhãn hàng sở hữu, hoặc điểm nhận hàng. Khách thường không có. */
export function hasPartnerRole(c: Pick<ProfileMenuContext, 'role' | 'dealer' | 'ownedBrandName' | 'deskPointNames'>): boolean {
  return (
    (!!c.role && PARTNER_ROLES.has(c.role)) ||
    c.dealer?.isDealer === true ||
    c.dealer?.status === 'APPROVED' ||
    c.dealer?.status === 'PENDING' ||
    !!c.ownedBrandName ||
    (c.deskPointNames?.length ?? 0) > 0
  );
}

/** Mục của dòng "Dành cho đối tác": cùng mục, nhãn, gợi ý và đích với hai nhóm cũ Kiếm tiền cùng Tubu và Công việc. */
export function partnerLinks(c: ProfileMenuContext): ProfileMenuLink[] {
  const t = PROFILE_MENU_COPY;
  const earn = homeCopy.earn;
  const links: ProfileMenuLink[] = [];
  const ctv = ctvMenuEntry(c.role, c.ctvAccess);
  if (ctv) links.push({ key: 'ctv', ...ctv, mini: '/affiliate', web: '/ctv' });
  if (canSeeAcademy(c.role)) links.push({ key: 'academy', label: earn.academy.label, hint: earn.academy.hint, mini: '/academy', web: '/hoc-vien' });
  const dealer =
    c.dealer?.isDealer || c.dealer?.status === 'APPROVED'
      ? { label: t.dealerApproved, hint: c.dealer.tier?.name ?? earn.dealer.hint }
      : c.dealer?.status === 'PENDING'
        ? { label: t.dealerPending, hint: t.dealerPendingHint }
        : { label: earn.dealer.label, hint: earn.dealer.hint };
  links.push({ key: 'dealer', ...dealer, mini: '/dealer', web: '/dai-ly' });
  if (c.ownedBrandName) links.push({ key: 'brandOwner', label: BRAND_OWNER_TITLE, hint: c.ownedBrandName, mini: '/brand-owner', web: '/chu-thuong-hieu' });
  const staffOrAdmin = c.role === 'STAFF' || c.role === 'ADMIN';
  if (staffOrAdmin) {
    links.push({ key: 'staff', label: t.staff, hint: t.staffHint, mini: '/staff', web: '/nhan-vien' });
    links.push({ key: 'payroll', label: t.payroll, hint: t.payrollHint, mini: '/my-payroll', web: '/nhan-vien/bang-luong' });
  }
  if (c.deskPointNames && c.deskPointNames.length > 0) {
    links.push({ key: 'desk', label: DESK_ENTRY_LABEL, hint: c.deskPointNames.join(', '), mini: '/recycle/desk', web: '/doi-rac/quay' });
  }
  if (c.role === 'ADMIN') links.push({ key: 'admin', label: t.admin, hint: t.adminHint, mini: '/admin', web: '/admin?tab=staffRoster' });
  return links;
}

export function supportLinks(c: Pick<ProfileMenuContext, 'chatEnabled' | 'aiEnabled' | 'badgesEnabled'>): ProfileMenuLink[] {
  const t = PROFILE_MENU_COPY;
  return [
    ...(c.chatEnabled ? [{ key: 'chat' as const, label: t.chat, mini: '/chat', web: '/ho-tro/chat' }] : []),
    ...(c.aiEnabled ? [{ key: 'ai' as const, label: t.ai, hint: t.aiHint, mini: '/ai-advisor', web: '/tu-van' }] : []),
    { key: 'about', label: t.about, mini: '/about', web: '/gioi-thieu' },
    ...(c.badgesEnabled ? [] : [{ key: 'brandStory' as const, label: t.brandStory, mini: '/brand-story', web: '/cau-chuyen' }]),
  ];
}

/**
 * Các dòng của thẻ danh sách Cá nhân, đúng thứ tự: Thông báo (chỉ khi có tin chưa đọc), Ưu đãi & quà, Mời bạn nhận quà, Sổ địa chỉ,
 * Sản phẩm yêu thích, Đổi rác, Hỗ trợ, Cài đặt, Dành cho đối tác. Khách thường (đổi rác bật, đã đọc hết thông báo) có bảy dòng; tài khoản đối tác thêm một.
 */
export function buildProfileMenu(c: ProfileMenuContext): ProfileMenuRow[] {
  const t = PROFILE_MENU_COPY;
  const rows: ProfileMenuRow[] = [];
  const unread = c.unreadNotifications ?? 0;
  if (unread > 0) rows.push({ kind: 'link', key: 'notifications', label: t.notifications, hint: t.notificationsCount(unread), mini: '/notifications', web: '/tai-khoan/thong-bao' });
  rows.push({ kind: 'link', key: 'offers', label: t.offers, hint: c.couponCount ? t.offersCount(c.couponCount) : t.offersHint, mini: '/offers', web: '/uu-dai' });
  if (c.hasReferralCode) rows.push({ kind: 'accordion', key: 'invite', label: t.invite, hint: t.inviteHint, children: [] });
  rows.push(
    { kind: 'link', key: 'addresses', label: t.addresses, mini: '/addresses', web: '/tai-khoan/dia-chi' },
    { kind: 'link', key: 'wishlist', label: t.wishlist, mini: '/wishlist', web: '/tai-khoan/yeu-thich' },
  );
  if (c.wasteEnabled) {
    rows.push({ kind: 'link', key: 'recycle', label: t.recycle, hint: homeCopy.offers.recycleHint, mini: '/recycle', web: '/doi-rac' });
  } else if (c.recycleOpenRequests) {
    rows.push({ kind: 'link', key: 'recycle', label: RECYCLE_REQUESTS_LABEL, hint: homeCopy.offers.recyclePausedHint, mini: '/recycle', web: '/doi-rac' });
  }
  rows.push(
    { kind: 'accordion', key: 'support', label: t.support, children: supportLinks(c) },
    { kind: 'link', key: 'settings', label: t.settings, mini: '/settings', web: '/tai-khoan/cai-dat' },
  );
  if (hasPartnerRole(c)) {
    const children = partnerLinks(c);
    if (children.length > 0) rows.push({ kind: 'accordion', key: 'partner', label: t.partner, children });
  }
  return rows;
}

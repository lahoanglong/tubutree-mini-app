import { ctvMenuEntry, type CtvAccessHint } from '@tubutree/app-core/storefront-signup';
import { BadgeDollarSign, BookOpen, Bell, CalendarClock, GraduationCap, Heart, Info, MapPin, MessageCircle, Settings, ShieldCheck, Sparkles, Store, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { DealerMe } from '@tubutree/app-core/api/dealer';
import { homeCopy } from '@tubutree/app-core/home-copy';

export interface AccountMenuItem {
  icon: LucideIcon;
  label: string;
  /** Route web. */
  to: string;
  hint?: string;
}
export interface AccountMenuGroup {
  group: string;
  items: AccountMenuItem[];
}
export interface AccountMenuContext {
  role: string | undefined;
  aiEnabled: boolean;
  chatEnabled: boolean;
  /** Cờ CASHBACK_ENABLED: bật thì có lối vào Hoàn tiền sàn ngoài ở nhóm Tài khoản. */
  cashbackEnabled?: boolean;
  dealer: Pick<DealerMe, 'status' | 'isDealer'> & { tier?: { name?: string } | null } | null | undefined;
  ownedBrandName: string | null | undefined;
  /** GET /affiliate/me (chỉ cần với đại lý, nhân viên, admin): quyết định mục Cộng tác viên. */
  ctvAccess?: CtvAccessHint | null;
  /** Route web đã xong chưa (route map): mục trỏ route còn `pending` bị ẩn để khách không rơi vào 404. */
  isReady: (webPath: string) => boolean;
}

// Mục theo cùng thứ tự, nhãn và mô tả với MENU trong apps/miniapp/src/pages/profile.tsx; chỉ đổi đích sang route web.
export function buildAccountMenu(c: AccountMenuContext): AccountMenuGroup[] {
  const earnDealer = homeCopy.earn.dealer;
  const ctvEntry = ctvMenuEntry(c.role, c.ctvAccess);
  const dealerItem: AccountMenuItem =
    c.dealer?.isDealer || c.dealer?.status === 'APPROVED'
      ? { icon: Store, label: 'Kênh đại lý', to: '/dai-ly', hint: c.dealer.tier?.name ?? earnDealer.hint }
      : c.dealer?.status === 'PENDING'
        ? { icon: Store, label: 'Hồ sơ đại lý', to: '/dai-ly', hint: 'Đang chờ duyệt' }
        : { icon: Store, label: earnDealer.label, to: '/dai-ly', hint: earnDealer.hint };

  const groups: AccountMenuGroup[] = [
    {
      group: homeCopy.profile.groupEarn,
      items: [
        ...(ctvEntry ? [{ icon: Users, ...ctvEntry, to: '/ctv' }] : []),
        { icon: GraduationCap, label: homeCopy.earn.academy.label, to: '/hoc-vien', hint: homeCopy.earn.academy.hint },
        dealerItem,
        ...(c.ownedBrandName ? [{ icon: Store, label: 'Quản lý nhãn hàng', to: '/chu-thuong-hieu', hint: c.ownedBrandName }] : []),
      ],
    },
    {
      group: homeCopy.profile.groupAccount,
      items: [
        { icon: Heart, label: 'Sản phẩm yêu thích', to: '/tai-khoan/yeu-thich' },
        { icon: MapPin, label: 'Sổ địa chỉ', to: '/tai-khoan/dia-chi' },
        { icon: Bell, label: 'Thông báo', to: '/tai-khoan/thong-bao' },
        ...(c.cashbackEnabled ? [{ icon: BadgeDollarSign, label: 'Hoàn tiền sàn ngoài', to: '/hoan-tien' }] : []),
        { icon: Settings, label: 'Cài đặt', to: '/tai-khoan/cai-dat' },
      ],
    },
    {
      group: homeCopy.profile.groupSupport,
      items: [
        ...(c.chatEnabled ? [{ icon: MessageCircle, label: 'Chat với Tubu Tree', to: '/ho-tro/chat' }] : []),
        ...(c.aiEnabled ? [{ icon: Sparkles, label: 'Trợ lý AI 24/7', to: '/tu-van', hint: 'Tư vấn sản phẩm' }] : []),
        { icon: BookOpen, label: 'Câu chuyện thương hiệu', to: '/cau-chuyen' },
        { icon: Info, label: 'Về Tubu Tree & Hỗ trợ', to: '/gioi-thieu' },
      ],
    },
  ];

  const isStaffOrAdmin = c.role === 'STAFF' || c.role === 'ADMIN';
  const work: AccountMenuItem[] = [
    ...(isStaffOrAdmin
      ? [
          { icon: CalendarClock, label: 'Ca làm & chấm công', to: '/nhan-vien', hint: 'Đăng ký ca, chấm công' },
          { icon: Wallet, label: 'Lương của tôi', to: '/nhan-vien/bang-luong', hint: 'Xem lương & thông tin nhận' },
        ]
      : []),
    ...(c.role === 'ADMIN' ? [{ icon: ShieldCheck, label: 'Quản trị nhân sự', to: '/admin', hint: 'Cấp quyền, duyệt ca, lương' }] : []),
  ];
  if (work.length > 0) groups.push({ group: homeCopy.profile.groupWork, items: work });

  return groups.map((g) => ({ ...g, items: g.items.filter((i) => c.isReady(i.to)) })).filter((g) => g.items.length > 0);
}

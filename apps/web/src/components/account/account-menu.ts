import { ctvMenuEntry, type CtvAccessHint } from '@tubutree/app-core/storefront-signup';
import {
  BadgePercent, BookOpen, Bell, CalendarClock, Heart, Info, Leaf, MapPin, MessageCircle, MessagesSquare, Recycle, ScanLine, Settings, ShieldCheck, Sparkles, Store, Users, Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { DealerMe } from '@tubutree/app-core/api/dealer';

export interface AccountMenuItem {
  icon: LucideIcon;
  label: string;
  /** Route web; mục `miniAppOnly` không có route web nên `to` chỉ là khoá. */
  to: string;
  hint?: string;
  miniAppOnly?: boolean;
}
export interface AccountMenuGroup {
  group: string;
  items: AccountMenuItem[];
}
export interface AccountMenuContext {
  role: string | undefined;
  aiEnabled: boolean;
  claimEnabled: boolean;
  chatEnabled: boolean;
  cashbackEnabled: boolean;
  dealer: Pick<DealerMe, 'status' | 'isDealer'> & { tier?: { name?: string } | null } | null | undefined;
  ownedBrandName: string | null | undefined;
  /** GET /affiliate/me (chỉ cần với đại lý, nhân viên, admin): quyết định mục Cộng tác viên. */
  ctvAccess?: CtvAccessHint | null;
  /** Route web đã xong chưa (route map): mục trỏ route còn `pending` bị ẩn để khách không rơi vào 404. */
  isReady: (webPath: string) => boolean;
}

// Mục theo cùng thứ tự, nhãn và mô tả với MENU trong apps/miniapp/src/pages/profile.tsx; chỉ đổi đích sang route web.
const GROUP_BUY_MENU_HINT = 'Rủ bạn mua chung, đủ nhóm nhận mã giảm';

export function buildAccountMenu(c: AccountMenuContext): AccountMenuGroup[] {
  const ctvEntry = ctvMenuEntry(c.role, c.ctvAccess);
  const dealerItem: AccountMenuItem =
    c.dealer?.isDealer || c.dealer?.status === 'APPROVED'
      ? { icon: Store, label: 'Kênh đại lý', to: '/dai-ly', hint: c.dealer.tier?.name ?? 'Bảng giá sỉ — công nợ' }
      : c.dealer?.status === 'PENDING'
        ? { icon: Store, label: 'Hồ sơ đại lý', to: '/dai-ly', hint: 'Đang chờ duyệt' }
        : { icon: Store, label: 'Đăng ký đại lý', to: '/dai-ly' };

  const groups: AccountMenuGroup[] = [
    {
      group: 'Mua sắm',
      items: [
        { icon: Users, label: 'Mua chung nhóm', to: '/mua-chung', hint: GROUP_BUY_MENU_HINT },
        { icon: Recycle, label: 'Đổi rác lấy quà', to: '/doi-rac', hint: 'Đổi bao bì lấy Điểm Xanh' },
        ...(c.aiEnabled ? [{ icon: Sparkles, label: 'Trợ lý AI 24/7', to: '/tu-van', hint: 'Tư vấn sản phẩm' }] : []),
        { icon: Heart, label: 'Sản phẩm yêu thích', to: '/tai-khoan/yeu-thich' },
        { icon: MapPin, label: 'Sổ địa chỉ', to: '/tai-khoan/dia-chi' },
        { icon: MessagesSquare, label: 'Cộng đồng hỏi đáp', to: '/cong-dong', hint: 'Hỏi cách dùng · chia sẻ trải nghiệm' },
      ],
    },
    {
      group: 'Tài sản',
      items: [
        { icon: Leaf, label: 'Hạng thành viên & Điểm Xanh', to: '/tai-khoan/diem-xanh' },
        { icon: Wallet, label: 'Ví Tubu', to: '/tai-khoan/vi-tubu' },
        ...(c.claimEnabled
          ? [{ icon: ScanLine, label: 'Tích điểm đơn sàn', to: '/points/scan', hint: 'Quét mã trên phiếu giao hàng', miniAppOnly: true }]
          : []),
      ],
    },
    {
      group: 'Hợp tác',
      items: [
        ...(ctvEntry ? [{ icon: Users, ...ctvEntry, to: '/ctv' }] : []),
        ...(c.cashbackEnabled ? [{ icon: BadgePercent, label: 'Hoàn tiền sàn ngoài', to: '/hoan-tien' }] : []),
        dealerItem,
        ...(c.ownedBrandName ? [{ icon: Store, label: 'Quản lý nhãn hàng', to: '/chu-thuong-hieu', hint: c.ownedBrandName }] : []),
      ],
    },
    {
      group: 'Khác',
      items: [
        { icon: Bell, label: 'Thông báo', to: '/tai-khoan/thong-bao' },
        { icon: BookOpen, label: 'Câu chuyện thương hiệu', to: '/cau-chuyen' },
        ...(c.chatEnabled ? [{ icon: MessageCircle, label: 'Chat với Tubu Tree', to: '/ho-tro/chat' }] : []),
        { icon: Settings, label: 'Cài đặt', to: '/tai-khoan/cai-dat' },
        { icon: Info, label: 'Về Tubu Tree & Hỗ trợ', to: '/gioi-thieu' },
      ],
    },
  ];

  const isStaffOrAdmin = c.role === 'STAFF' || c.role === 'ADMIN';
  const work: AccountMenuItem[] = [
    ...(isStaffOrAdmin
      ? [
          { icon: CalendarClock, label: 'Ca làm & chấm công', to: '/nhan-vien', hint: 'Đăng ký ca — chấm công' },
          { icon: Wallet, label: 'Lương của tôi', to: '/nhan-vien/bang-luong', hint: 'Xem lương & thông tin nhận' },
        ]
      : []),
    ...(c.role === 'ADMIN' ? [{ icon: ShieldCheck, label: 'Quản trị nhân sự', to: '/admin', hint: 'Cấp quyền — duyệt ca — lương' }] : []),
  ];
  if (work.length > 0) groups.push({ group: 'Công việc', items: work });

  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.miniAppOnly || c.isReady(i.to)) }))
    .filter((g) => g.items.length > 0);
}

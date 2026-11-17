import { Bell, BookOpen, CalendarClock, CircleHelp, Gift, GraduationCap, Heart, Info, MapPin, MessageCircle, Recycle, Settings, ShieldCheck, Sparkles, Store, Ticket, Users, Wallet, type LucideIcon } from 'lucide-react';
import { buildProfileMenu, type ProfileLinkKey, type ProfileMenuContext, type ProfileRowKey } from '@tubutree/app-core/profile-menu';

const ROW_ICON: Record<ProfileRowKey, LucideIcon> = {
  notifications: Bell,
  offers: Ticket,
  invite: Gift,
  addresses: MapPin,
  wishlist: Heart,
  recycle: Recycle,
  support: CircleHelp,
  settings: Settings,
  partner: Store,
};

const LINK_ICON: Record<ProfileLinkKey, LucideIcon> = {
  chat: MessageCircle,
  ai: Sparkles,
  about: Info,
  brandStory: BookOpen,
  ctv: Users,
  academy: GraduationCap,
  dealer: Store,
  brandOwner: Store,
  staff: CalendarClock,
  payroll: Wallet,
  desk: Recycle,
  admin: ShieldCheck,
};

export interface AccountMenuLink {
  key: ProfileLinkKey;
  icon: LucideIcon;
  label: string;
  hint?: string;
  /** Route web. */
  to: string;
}

export type AccountMenuRow =
  | { kind: 'link'; key: ProfileRowKey; icon: LucideIcon; label: string; hint?: string; to: string }
  | { kind: 'accordion'; key: ProfileRowKey; icon: LucideIcon; label: string; hint?: string; children: AccountMenuLink[] };

export interface AccountMenuContext extends ProfileMenuContext {
  /** Route web đã xong chưa (route map): mục trỏ route còn `pending` bị ẩn để khách không rơi vào 404. */
  isReady: (webPath: string) => boolean;
}

/** Dòng đã có ở cột trái `AccountShell` (từ md): trang Cá nhân ẩn chúng từ md để hai bên không lặp. */
export const IN_ACCOUNT_SHELL: ReadonlySet<ProfileRowKey> = new Set<ProfileRowKey>(['notifications', 'addresses', 'wishlist', 'settings']);

/** Dòng trang Cá nhân web: cùng dòng, thứ tự, chữ với Mini App (`buildProfileMenu` của app-core), đích là route web. */
export function buildAccountMenu(c: AccountMenuContext): AccountMenuRow[] {
  return buildProfileMenu(c).flatMap((row): AccountMenuRow[] => {
    const icon = ROW_ICON[row.key];
    if (row.kind === 'link') return c.isReady(row.web) ? [{ kind: 'link', key: row.key, icon, label: row.label, hint: row.hint, to: row.web }] : [];
    const children = row.children
      .filter((ch) => c.isReady(ch.web))
      .map((ch): AccountMenuLink => ({ key: ch.key, icon: LINK_ICON[ch.key], label: ch.label, hint: ch.hint, to: ch.web }));
    // Mời bạn không có mục con (nội dung là thẻ mời); dòng khác hết mục con thì bỏ cả dòng.
    if (row.key !== 'invite' && children.length === 0) return [];
    return [{ kind: 'accordion', key: row.key, icon, label: row.label, hint: row.hint, children }];
  });
}

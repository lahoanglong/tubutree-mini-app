import {
  CheckCircle2, Truck, PackageCheck, Receipt, FileText, Coins, ShoppingBag, Gift, Leaf, Zap, Bell, Store, TriangleAlert, Repeat, Undo2, PackageOpen, XCircle, UserPlus, Recycle, MessageCircle, Star, Tag, Users,
  type LucideIcon,
} from 'lucide-react';
import routeMapJson from '@tubutree/app-core/route-map.json';
import { notificationAction as coreAction, notificationOrderLink, notificationTitle } from '@tubutree/app-core/notification-route';
import { formatDate } from '@/lib/format-date';
import { reviewHref } from '@/lib/reviews-client';
import { isWebRouteReady } from '@/lib/route-map';

// Tiêu đề và nút đi tiếp theo luật chung ở app-core (`notification-route`), cùng nguồn với Mini App; ở đây chỉ có icon và việc đổi đích sang route web.

/** Icon theo templateCode. */
function notificationIcon(code: string): LucideIcon {
  if (code.startsWith('ORDER_CONFIRMED')) return CheckCircle2;
  if (code.startsWith('ORDER_SHIPPING')) return Truck;
  if (code.startsWith('ORDER_DELIVERED')) return PackageCheck;
  if (code === 'RETURN_REQUESTED') return Undo2;
  if (code.startsWith('RETURN_APPROVED')) return CheckCircle2;
  if (code === 'RETURN_RECEIVED') return PackageOpen;
  if (code === 'RETURN_REJECTED') return XCircle;
  if (code.startsWith('ORDER') || code === 'MERCHANT_ORDER_CANCELLED_BY_SELLER') return Receipt;
  if (code.startsWith('MERCHANT_')) return Store;
  if (code.startsWith('INVOICE')) return FileText;
  if (code.startsWith('REFUND_')) return Undo2;
  if (code.startsWith('COMMISSION')) return Coins;
  if (code.startsWith('CASHBACK')) return ShoppingBag;
  if (code.startsWith('BIRTHDAY') || code.startsWith('VOUCHER') || code.endsWith('_VOUCHER')) return Gift;
  if (code.startsWith('REFERRAL_')) return UserPlus;
  if (code.startsWith('POINTS') || code === 'XU_CONVERTED' || code === 'TIER_DROP_NOTICE' || code.startsWith('EXTERNAL_POINTS_') || code.startsWith('CHAT_ORDER_POINTS_')) return Leaf;
  if (code.startsWith('STOREFRONT')) return Store;
  if (code.startsWith('REORDER_REMINDER')) return Repeat;
  if (code === 'REVIEW_REQUEST') return Star;
  if (code.startsWith('FLASH')) return Zap;
  if (code === 'PRICE_DROP_ALERT') return Tag;
  if (code === 'CART_ABANDONED') return ShoppingBag;
  if (code.startsWith('GAME_')) return Leaf;
  if (code.startsWith('GROUP_BUY_')) return Users;
  if (code.startsWith('SUBSCRIPTION_')) return Repeat;
  if (code.startsWith('COMMUNITY_')) return MessageCircle;
  if (code.startsWith('DEALER')) return Store;
  if (code.startsWith('WASTE') || code.startsWith('REFILL')) return Recycle;
  if (code === 'SUPPORT_CHAT_REPLY') return MessageCircle;
  if (code.startsWith('OPS_')) return TriangleAlert;
  return Bell;
}

/** Icon + nhãn nhóm theo templateCode. */
export function notificationMeta(code: string): { Icon: LucideIcon; title: string } {
  return { Icon: notificationIcon(code), title: notificationTitle(code) };
}

export { notificationOrderLink };

/** Đổi đường dẫn Mini App sang route web; null khi không có trang web (hoặc chưa xong) để nút bị ẩn. */
export type RouteResolver = (miniappPath: string) => string | null;

interface RouteRow {
  miniapp: string;
  web?: string;
}
const routeRows: RouteRow[] = (routeMapJson.routes as { items: RouteRow[] }[]).flatMap((g) => g.items);

const segmentsOf = (path: string) => path.split(/[?#]/, 1)[0]!.split('/').filter(Boolean);

/** Tra xuôi route map: dòng Mini App khớp thắng, tham số `:x` thay vào đích web (giữ nguyên mã hoá); route pending hoặc không có web thì null. */
export const resolveWebRoute: RouteResolver = (miniappPath) => {
  const input = segmentsOf(miniappPath);
  for (const row of routeRows) {
    if (!row.web) continue;
    const pattern = segmentsOf(row.miniapp);
    if (pattern.length !== input.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((seg, i) => {
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = input[i]!;
        return true;
      }
      return seg === input[i];
    });
    if (!ok) continue;
    const web = row.web.replace(/:(\w+)/g, (whole, name: string) => params[name] ?? whole);
    if (!isWebRouteReady(web)) return null;
    // Query của đường dẫn Mini App (vd ?tab=commission) chọn tab/lọc trên trang đích, nên đi theo sang web.
    const extra = miniappPath.includes('?') ? miniappPath.slice(miniappPath.indexOf('?') + 1).split('#', 1)[0]! : '';
    return extra ? `${web}${web.includes('?') ? '&' : '?'}${extra}` : web;
  }
  return null;
};

export type NotificationAction = { kind: 'reorder'; label: string; to: string } | { kind: 'link'; label: string; to: string };

const REORDER_CTA = 'Mua lại ngay';

/**
 * Nút đi tiếp trong chi tiết thông báo (luật chung với Mini App ở app-core). Đích Mini App được đổi sang route web; chưa có trang web
 * thì không có nút. Đích của trang Đối tác / quản trị và form đánh giá là đường dẫn web đi thẳng. `reorder` mang đích dự phòng của mẫu
 * nhắc mua lại (trang sản phẩm, không thì danh sách đơn).
 */
export function notificationAction(
  templateCode: string,
  data: Record<string, string> | undefined,
  resolve: RouteResolver = resolveWebRoute,
): NotificationAction | null {
  const a = coreAction(templateCode, data, { platform: 'web' });
  if (!a) return null;
  if (a.kind === 'direct') return { kind: 'link', label: a.label, to: a.to };
  if (a.kind === 'review') return { kind: 'link', label: a.label, to: reviewHref(a.productSlug, a.orderId) };
  const to = resolve(a.to);
  if (!to) return null;
  return a.kind === 'reorder' ? { kind: 'reorder', label: REORDER_CTA, to } : { kind: 'link', label: a.label, to };
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Vừa xong';
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} ngày trước`;
  return formatDate(iso);
}

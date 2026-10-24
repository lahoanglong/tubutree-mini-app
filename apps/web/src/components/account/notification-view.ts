import {
  CheckCircle2, Truck, PackageCheck, Receipt, FileText, Coins, ShoppingBag, Gift, Leaf, Zap, Bell, Store, TriangleAlert, Repeat, Undo2, PackageOpen, XCircle, UserPlus, Recycle, MessageCircle,
  type LucideIcon,
} from 'lucide-react';
import routeMapJson from '@tubutree/app-core/route-map.json';
import { formatDate } from '@/lib/format-date';
import { isWebRouteReady } from '@/lib/route-map';

// Nhãn, nút và quy tắc chọn đích chép từ apps/miniapp/src/pages/notifications.tsx; chỉ đổi đích sang route web.

/** Icon + nhãn nhóm theo templateCode. */
export function notificationMeta(code: string): { Icon: LucideIcon; title: string } {
  if (code.startsWith('ORDER_CONFIRMED')) return { Icon: CheckCircle2, title: 'Đơn đã xác nhận' };
  if (code.startsWith('ORDER_SHIPPING')) return { Icon: Truck, title: 'Đang giao hàng' };
  if (code.startsWith('ORDER_DELIVERED')) return { Icon: PackageCheck, title: 'Đã giao thành công' };
  if (code === 'RETURN_REQUESTED') return { Icon: Undo2, title: 'Đã nhận yêu cầu đổi/trả' };
  if (code.startsWith('RETURN_APPROVED')) return { Icon: CheckCircle2, title: 'Yêu cầu đổi/trả đã duyệt' };
  if (code === 'RETURN_RECEIVED') return { Icon: PackageOpen, title: 'Tubu đã nhận lại hàng' };
  if (code === 'RETURN_REJECTED') return { Icon: XCircle, title: 'Yêu cầu đổi/trả bị từ chối' };
  if (code.startsWith('ORDER')) return { Icon: Receipt, title: 'Cập nhật đơn hàng' };
  if (code.startsWith('INVOICE')) return { Icon: FileText, title: 'Hoá đơn điện tử' };
  if (code.startsWith('COMMISSION')) return { Icon: Coins, title: 'Hoa hồng CTV' };
  if (code.startsWith('CASHBACK')) return { Icon: ShoppingBag, title: 'Hoàn tiền' };
  if (code.startsWith('BIRTHDAY') || code.startsWith('VOUCHER')) return { Icon: Gift, title: 'Ưu đãi cho bạn' };
  if (code === 'REFERRAL_REWARD_PAID') return { Icon: UserPlus, title: 'Thưởng giới thiệu bạn bè' };
  if (code === 'REFERRAL_MILESTONE_PAID') return { Icon: UserPlus, title: 'Thưởng mốc giới thiệu' };
  if (code === 'REFERRAL_REWARD_REVOKED') return { Icon: UserPlus, title: 'Thu lại thưởng giới thiệu' };
  if (code.startsWith('POINTS') || code === 'XU_CONVERTED') return { Icon: Leaf, title: 'Điểm Xanh' };
  if (code.startsWith('STOREFRONT')) return { Icon: Store, title: 'Gian hàng của bạn' };
  if (code.startsWith('REORDER_REMINDER')) return { Icon: Repeat, title: 'Nhắc mua lại' };
  // Trong app mục này tên là "Ưu đãi giờ vàng"; gọi "Flash Sale" khiến khách tìm mục không tồn tại.
  if (code.startsWith('FLASH')) return { Icon: Zap, title: 'Ưu đãi giờ vàng' };
  if (code.startsWith('DEALER')) return { Icon: Store, title: 'Đại lý' };
  if (code.startsWith('WASTE')) return { Icon: Recycle, title: 'Đổi rác lấy quà' };
  if (code === 'SUPPORT_CHAT_REPLY') return { Icon: MessageCircle, title: 'Tubu Tree trả lời bạn' };
  // OPS_* gửi tài khoản ADMIN; admin đăng nhập vẫn thấy trong danh sách (không lọc theo mã) nên cần nhãn riêng.
  if (code.startsWith('OPS_')) return { Icon: TriangleAlert, title: 'Cảnh báo vận hành' };
  return { Icon: Bell, title: 'Thông báo' };
}

/**
 * Có hiện nút "Xem chi tiết đơn hàng" không. Báo động OPS_* mang order_code của đơn KHÁCH KHÁC:
 * GET /orders/:code chỉ trả đơn của chính người xem, nên nút đó chỉ dẫn tới màn lỗi.
 */
export function notificationOrderLink(templateCode: string, orderCode: unknown): boolean {
  if (templateCode.startsWith('OPS_')) return false;
  return templateCode.startsWith('ORDER') || !!orderCode;
}

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
    return isWebRouteReady(web) ? web : null;
  }
  return null;
};

export type NotificationAction = { kind: 'reorder'; label: string; to: string } | { kind: 'link'; label: string; to: string };

const REORDER_CTA = 'Mua lại ngay';
const enc = (v: string) => encodeURIComponent(v);

/** Đường dẫn nội bộ an toàn: bắt đầu bằng "/" một lần (chặn "//host" và URL ngoài). */
function internalRoute(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : null;
}

/** Tin chỉ gửi cho admin; việc xử lý nằm ở trang quản trị web, trang khách không có màn tương ứng. */
const ADMIN_ONLY_CODES = new Set(['DEALER_CREDIT_PAYMENT_REPORTED', 'DEALER_REWARD_CLAIM_NEW']);

function miniappAction(templateCode: string, data: Record<string, string> | undefined): { kind: 'reorder' | 'link'; label: string; to: string } | null {
  const d = data ?? {};
  if (templateCode.startsWith('OPS_') || ADMIN_ONLY_CODES.has(templateCode)) return null;
  const orderCode = d.order_code ?? d.orderCode;
  const productSlug = d.product_slug ?? d.productSlug;
  const route = internalRoute(d.route);

  if (templateCode.startsWith('REORDER_REMINDER')) {
    return { kind: 'reorder', label: REORDER_CTA, to: productSlug ? `/product/${enc(String(productSlug))}` : '/orders' };
  }
  if (templateCode.startsWith('WASTE') || templateCode.startsWith('REFILL')) {
    const requestId = d.request_id ?? d.requestId;
    if (templateCode === 'WASTE_GIFT_CANCELLED') return { kind: 'link', label: 'Xem quà của tôi', to: '/rewards/mine' };
    if (templateCode === 'WASTE_PERK_REVIEWED') return { kind: 'link', label: 'Mở màn nhận hàng', to: '/recycle/desk' };
    if (templateCode === 'WASTE_POINTS_CREDITED' && requestId) return { kind: 'link', label: 'Xem kết quả', to: `/recycle/done/${enc(requestId)}` };
    if (templateCode.startsWith('WASTE') && requestId) return { kind: 'link', label: 'Xem yêu cầu', to: `/recycle/r/${enc(requestId)}` };
    return { kind: 'link', label: 'Mở Đổi rác lấy quà', to: '/recycle' };
  }
  if (notificationOrderLink(templateCode, orderCode)) {
    return { kind: 'link', label: 'Xem chi tiết đơn hàng', to: orderCode ? `/order/${enc(orderCode)}` : '/orders' };
  }
  if (templateCode === 'SUPPORT_CHAT_REPLY') return { kind: 'link', label: 'Mở chat với Tubu Tree', to: '/chat' };
  if (route) return { kind: 'link', label: 'Xem chi tiết', to: route };
  if (templateCode.startsWith('FLASH')) {
    // Không có slug thì về Trang chủ, nơi dải "Ưu đãi giờ vàng" đang hiển thị.
    return { kind: 'link', label: 'Xem ưu đãi giờ vàng', to: productSlug ? `/product/${enc(productSlug)}` : '/' };
  }
  if (templateCode === 'PRICE_DROP_ALERT') {
    return { kind: 'link', label: 'Xem sản phẩm', to: productSlug ? `/product/${enc(productSlug)}` : '/wishlist' };
  }
  if (templateCode.startsWith('COMMUNITY_')) {
    const postId = d.post_id ?? d.postId;
    return { kind: 'link', label: 'Xem trong Cộng đồng', to: postId ? `/feed/${enc(postId)}` : '/feed' };
  }
  if (templateCode.startsWith('GAME_')) return { kind: 'link', label: 'Đến Vườn Xanh', to: '/game' };
  if (templateCode === 'CART_ABANDONED') return { kind: 'link', label: 'Xem giỏ hàng', to: '/cart' };
  if (templateCode.endsWith('_VOUCHER') || templateCode.startsWith('VOUCHER')) return { kind: 'link', label: 'Xem mã giảm giá', to: '/loyalty' };
  if (templateCode.startsWith('POINTS') || templateCode === 'XU_CONVERTED' || templateCode.startsWith('REFERRAL_')) {
    return { kind: 'link', label: 'Xem Điểm Xanh', to: '/loyalty' };
  }
  if (templateCode.startsWith('CASHBACK')) return { kind: 'link', label: 'Xem Ví Tubu', to: '/wallet' };
  if (templateCode.startsWith('SUBSCRIPTION')) return { kind: 'link', label: 'Xem gói định kỳ', to: '/subscriptions' };
  if (templateCode.startsWith('STOREFRONT')) return { kind: 'link', label: 'Thêm vào gian hàng', to: '/storefront' };
  if (templateCode.startsWith('DEALER')) return { kind: 'link', label: 'Mở trang Đại lý', to: '/dealer' };
  // Nhóm hết hạn không đủ người: về trang sản phẩm, nơi vừa mua được với giá thường vừa mở được nhóm mới.
  if (templateCode === 'GROUP_BUY_FAILED' && productSlug) return { kind: 'link', label: 'Xem sản phẩm', to: `/product/${enc(productSlug)}` };
  if (templateCode.startsWith('GROUP_BUY')) return { kind: 'link', label: 'Xem mua chung', to: '/group-buy' };
  return null;
}

/**
 * Nút đi tiếp trong chi tiết thông báo, quyết định theo LOẠI tin (templateCode) và dữ liệu có cấu trúc trong payload,
 * không dò từ khoá trong nội dung. Đích Mini App được đổi sang route web; chưa có trang web thì không có nút.
 * `reorder` mang đích dự phòng của mẫu nhắc mua lại (trang sản phẩm, không thì danh sách đơn).
 */
export function notificationAction(
  templateCode: string,
  data: Record<string, string> | undefined,
  resolve: RouteResolver = resolveWebRoute,
): NotificationAction | null {
  const a = miniappAction(templateCode, data);
  if (!a) return null;
  const to = resolve(a.to);
  return to ? { ...a, to } : null;
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

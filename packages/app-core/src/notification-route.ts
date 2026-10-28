/**
 * Luật tiêu đề và nút đi tiếp của thông báo, dùng chung cho Mini App và web: quyết định theo LOẠI tin (templateCode) và dữ liệu có
 * cấu trúc trong payload, không dò từ khoá trong nội dung. Icon nằm ở từng nền tảng. Đường dẫn trả về là đường dẫn Mini App (web
 * đổi qua route map), trừ hành động `direct`: đường dẫn web đi thẳng, chỉ có ở nền web.
 */

export type NotificationPlatform = 'miniapp' | 'web';

export interface NotificationRouteOptions {
  platform: NotificationPlatform;
  /** Mini App: khách đang có gói định kỳ đang chạy hoặc tạm dừng (tab Định kỳ của Đơn hàng có hiện). */
  hasSubscription?: boolean;
}

export type NotificationAction =
  /** Mở luồng mua lại; `to` là đích dự phòng khi không mở được sheet. */
  | { kind: 'reorder'; to: string }
  | { kind: 'link'; label: string; to: string }
  /** Mở thẳng form đánh giá của một lần mua: Mini App qua `state`, web qua tham số của trang sản phẩm. */
  | { kind: 'review'; label: string; productSlug: string; orderId: string }
  | { kind: 'direct'; label: string; to: string };

const enc = (v: string) => encodeURIComponent(v);

/** Đường dẫn nội bộ an toàn: bắt đầu bằng "/" một lần (chặn "//host" và URL ngoài). */
function internalRoute(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : null;
}

/** Tin chỉ gửi cho admin; việc xử lý nằm ở trang quản trị web, trang khách không có màn tương ứng. */
const ADMIN_ONLY_CODES = new Set(['DEALER_CREDIT_PAYMENT_REPORTED', 'DEALER_REWARD_CLAIM_NEW']);

/** Tin của gian hàng đối tác gửi cho CHÍNH khách mua (không phải tin cho chủ gian hàng): vẫn mở đơn của khách. */
const MERCHANT_TO_BUYER = 'MERCHANT_ORDER_CANCELLED_BY_SELLER';

const isMerchantNotice = (code: string) => code.startsWith('MERCHANT_') && code !== MERCHANT_TO_BUYER;

/** Tiêu đề nhóm của tin theo templateCode. Mã lạ mới là "Thông báo". */
export function notificationTitle(code: string): string {
  if (code.startsWith('ORDER_CONFIRMED')) return 'Đơn đã xác nhận';
  if (code.startsWith('ORDER_SHIPPING')) return 'Đang giao hàng';
  if (code.startsWith('ORDER_DELIVERED')) return 'Đã giao thành công';
  if (code === 'RETURN_REQUESTED') return 'Đã nhận yêu cầu đổi/trả';
  if (code.startsWith('RETURN_APPROVED')) return 'Yêu cầu đổi/trả đã duyệt';
  if (code === 'RETURN_RECEIVED') return 'Tubu đã nhận lại hàng';
  if (code === 'RETURN_REJECTED') return 'Yêu cầu đổi/trả bị từ chối';
  if (code.startsWith('ORDER')) return 'Cập nhật đơn hàng';
  if (code === MERCHANT_TO_BUYER) return 'Cập nhật đơn hàng';
  if (code.startsWith('MERCHANT_')) return 'Gian hàng đối tác';
  if (code.startsWith('INVOICE')) return 'Hoá đơn điện tử';
  if (code.startsWith('REFUND_')) return 'Hoàn tiền đơn hàng';
  if (code.startsWith('COMMISSION')) return 'Hoa hồng CTV';
  if (code.startsWith('CASHBACK')) return 'Hoàn tiền';
  if (code.startsWith('BIRTHDAY') || code.startsWith('VOUCHER') || code.endsWith('_VOUCHER')) return 'Ưu đãi cho bạn';
  if (code === 'REFERRAL_REWARD_PAID') return 'Thưởng giới thiệu bạn bè';
  if (code === 'REFERRAL_MILESTONE_PAID') return 'Thưởng mốc giới thiệu';
  if (code === 'REFERRAL_REWARD_REVOKED') return 'Thu lại thưởng giới thiệu';
  if (code.startsWith('POINTS') || code === 'XU_CONVERTED' || code.startsWith('EXTERNAL_POINTS_') || code.startsWith('CHAT_ORDER_POINTS_')) return 'Điểm Xanh';
  if (code === 'TIER_DROP_NOTICE') return 'Hạng thành viên';
  if (code.startsWith('STOREFRONT')) return 'Gian hàng của bạn';
  if (code.startsWith('REORDER_REMINDER')) return 'Nhắc mua lại';
  if (code === 'REVIEW_REQUEST') return 'Mời đánh giá';
  // Trong app mục này tên là "Ưu đãi giờ vàng"; gọi "Flash Sale" khiến khách tìm mục không tồn tại.
  if (code.startsWith('FLASH')) return 'Ưu đãi giờ vàng';
  if (code === 'PRICE_DROP_ALERT') return 'Giảm giá';
  if (code === 'CART_ABANDONED') return 'Giỏ hàng của bạn';
  if (code.startsWith('GAME_')) return 'Vườn Xanh';
  if (code.startsWith('GROUP_BUY_')) return 'Mua chung';
  if (code.startsWith('SUBSCRIPTION_')) return 'Đơn định kỳ';
  if (code.startsWith('COMMUNITY_')) return 'Cộng đồng';
  if (code.startsWith('DEALER')) return 'Đại lý';
  if (code.startsWith('WASTE') || code.startsWith('REFILL')) return 'Đổi rác lấy quà';
  if (code === 'SUPPORT_CHAT_REPLY') return 'Tubu Tree trả lời bạn';
  // OPS_* gửi tài khoản ADMIN (và nhân viên CSKH với cảnh báo cầu nối Zalo); họ đăng nhập app vẫn thấy trong danh sách.
  if (code.startsWith('OPS_')) return 'Cảnh báo vận hành';
  return 'Thông báo';
}

/**
 * Có hiện nút "Xem chi tiết đơn hàng" không. Báo động OPS_* và tin cho chủ gian hàng mang order_code của đơn KHÁCH KHÁC:
 * GET /orders/:code chỉ trả đơn của chính người xem, nên nút đó chỉ dẫn tới màn lỗi.
 */
export function notificationOrderLink(templateCode: string, orderCode: unknown): boolean {
  if (templateCode.startsWith('OPS_') || isMerchantNotice(templateCode)) return false;
  return templateCode.startsWith('ORDER') || !!orderCode;
}

/** Câu thêm dưới nội dung tin ở Mini App, nơi không có Cổng người bán: chỉ dẫn sang web thay vì một nút không đi đâu. */
export function notificationNote(templateCode: string, platform: NotificationPlatform): string | null {
  if (platform !== 'miniapp' || !isMerchantNotice(templateCode)) return null;
  if (templateCode.startsWith('MERCHANT_PAYOUT_')) return 'Mở trang Đối tác trên web Tubu Tree để xem phiếu đối soát.';
  if (templateCode.startsWith('MERCHANT_PRODUCT_')) return 'Mở trang Đối tác trên web Tubu Tree để xem sản phẩm.';
  return 'Mở trang Đối tác trên web Tubu Tree để xử lý đơn.';
}

function merchantAction(templateCode: string): NotificationAction {
  if (templateCode.startsWith('MERCHANT_PAYOUT_')) return { kind: 'direct', label: 'Xem đối soát', to: '/merchant?tab=settlement' };
  if (templateCode.startsWith('MERCHANT_PRODUCT_')) return { kind: 'direct', label: 'Xem sản phẩm gian hàng', to: '/merchant?tab=products' };
  return { kind: 'direct', label: 'Mở đơn cần xử lý', to: '/merchant?tab=fulfil' };
}

function reviewAction(d: Record<string, string>, orderCode: string | undefined): NotificationAction {
  const slug = d.product_slug ?? d.productSlug;
  const orderId = d.order_id ?? d.orderId;
  if (slug && orderId) return { kind: 'review', label: 'Viết đánh giá', productSlug: slug, orderId };
  // Tin cũ chưa mang order_id: về chi tiết đơn, nơi có nút "Viết đánh giá" cho từng sản phẩm.
  return { kind: 'link', label: 'Viết đánh giá', to: orderCode ? `/order/${enc(orderCode)}` : '/orders' };
}

/** Nút đi tiếp trong chi tiết thông báo; null khi tin không có đích phù hợp trên nền tảng này. */
export function notificationAction(
  templateCode: string,
  data: Record<string, string> | undefined,
  opts: NotificationRouteOptions,
): NotificationAction | null {
  const d = data ?? {};
  const web = opts.platform === 'web';
  if (templateCode.startsWith('OPS_ZALO_BRIDGE_')) return web ? { kind: 'direct', label: 'Mở Chat CSKH', to: '/admin?tab=supportChat' } : null;
  if (templateCode.startsWith('OPS_') || ADMIN_ONLY_CODES.has(templateCode)) return null;
  if (isMerchantNotice(templateCode)) return web ? merchantAction(templateCode) : null;

  const orderCode = d.order_code ?? d.orderCode;
  const productSlug = d.product_slug ?? d.productSlug;
  const route = internalRoute(d.route);

  if (templateCode === 'REVIEW_REQUEST') return reviewAction(d, orderCode);
  if (templateCode.startsWith('REORDER_REMINDER')) {
    return { kind: 'reorder', to: productSlug ? `/product/${enc(String(productSlug))}` : '/orders' };
  }
  if (templateCode.startsWith('WASTE') || templateCode.startsWith('REFILL')) {
    const requestId = d.request_id ?? d.requestId;
    if (templateCode === 'WASTE_GIFT_CANCELLED') return { kind: 'link', label: 'Xem quà của tôi', to: '/rewards/mine' };
    if (templateCode === 'WASTE_PERK_REVIEWED') return { kind: 'link', label: 'Mở màn nhận hàng', to: '/recycle/desk' };
    if (templateCode === 'WASTE_POINTS_CREDITED' && requestId) return { kind: 'link', label: 'Xem kết quả', to: `/recycle/done/${enc(requestId)}` };
    if (templateCode.startsWith('WASTE') && requestId) return { kind: 'link', label: 'Xem yêu cầu', to: `/recycle/r/${enc(requestId)}` };
    return { kind: 'link', label: 'Mở Đổi rác lấy quà', to: '/recycle' };
  }
  // Các nhóm dưới đây có đích riêng và người nhận không phải chủ đơn nếu tin có kèm order_code: đứng trước nhánh xem đơn để
  // không bị dẫn sang chi tiết đơn của người khác.
  if (templateCode.startsWith('COMMISSION')) {
    const toWallet = templateCode === 'COMMISSION_WALLET_CREDITED' || templateCode === 'COMMISSION_WALLET_TAX_ONLY' || templateCode.startsWith('COMMISSION_PAYOUT_');
    return toWallet
      ? { kind: 'link', label: 'Xem Ví Tubu', to: '/wallet' }
      : { kind: 'link', label: 'Xem hoa hồng', to: '/affiliate?tab=commission' };
  }
  if (templateCode === 'TIER_DROP_NOTICE') return { kind: 'link', label: 'Xem cách giữ hạng', to: '/loyalty' };
  if (templateCode.startsWith('EXTERNAL_POINTS_') || templateCode.startsWith('CHAT_ORDER_POINTS_')) {
    return { kind: 'link', label: 'Xem Điểm Xanh', to: '/loyalty' };
  }
  if (templateCode.startsWith('STOREFRONT')) {
    if (templateCode === 'STOREFRONT_TRENDING_PRODUCTS') return { kind: 'link', label: 'Thêm vào gian hàng', to: '/storefront' };
    if (templateCode === 'STOREFRONT_TAKEN_DOWN') return { kind: 'link', label: 'Xem gian hàng', to: '/storefront' };
    return { kind: 'link', label: 'Chia sẻ gian hàng', to: '/storefront' };
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
  if (templateCode.endsWith('_VOUCHER') || templateCode.startsWith('VOUCHER')) {
    return { kind: 'link', label: 'Xem mã giảm giá', to: '/loyalty' };
  }
  if (templateCode.startsWith('POINTS') || templateCode === 'XU_CONVERTED' || templateCode.startsWith('REFERRAL_')) {
    return { kind: 'link', label: 'Xem Điểm Xanh', to: '/loyalty' };
  }
  if (templateCode.startsWith('CASHBACK')) return { kind: 'link', label: 'Xem Ví Tubu', to: '/wallet' };
  if (templateCode.startsWith('SUBSCRIPTION')) {
    // Mini App không có lối tạo gói: chỉ khách đã có gói mới có tab Định kỳ để mở tới.
    return web || opts.hasSubscription ? { kind: 'link', label: 'Xem gói', to: '/orders?tab=subscriptions' } : null;
  }
  if (templateCode.startsWith('DEALER')) return { kind: 'link', label: 'Mở trang Đại lý', to: '/dealer' };
  // Nhóm hết hạn không đủ người: về trang sản phẩm, nơi vừa mua được với giá thường vừa mở được nhóm mới.
  if (templateCode === 'GROUP_BUY_FAILED' && productSlug) {
    return { kind: 'link', label: 'Xem sản phẩm', to: `/product/${enc(productSlug)}` };
  }
  // Nhóm đủ người: mã giảm đã vào ví mã, mở thẳng sản phẩm để dùng.
  if (templateCode === 'GROUP_BUY_SUCCESS' && productSlug) {
    return { kind: 'link', label: 'Dùng mã, mua ngay', to: `/product/${enc(productSlug)}` };
  }
  if (templateCode.startsWith('GROUP_BUY')) return { kind: 'link', label: 'Xem mua chung', to: '/group-buy' };
  return null;
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { notificationAction, notificationNote, notificationOrderLink, notificationTitle, type NotificationAction } from './notification-route';

const mini = { platform: 'miniapp' as const };
const web = { platform: 'web' as const };

/** Mã mẫu tin trong seed (đọc thẳng file, để thêm mẫu mới mà quên tiêu đề thì spec đỏ). */
function seededCodes(): string[] {
  const seed = readFileSync(fileURLToPath(new URL('../../../apps/api/prisma/seed.ts', import.meta.url)), 'utf8');
  return [...seed.matchAll(/\{\s*id:\s*'nt-[^']*',\s*code:\s*'([A-Z0-9_]+)'/g)].map((m) => m[1]!);
}

// Tin chỉ gửi cho admin/vận hành: không phải "tin của khách", tiêu đề riêng được kiểm ở ca khác.
const NOT_FOR_CUSTOMERS = (code: string) => code.startsWith('OPS_') || ['ACCOUNT_DELETION_REQUESTED', 'DEALER_CREDIT_PAYMENT_REPORTED', 'DEALER_REWARD_CLAIM_NEW'].includes(code);

describe('notificationTitle', () => {
  it('đọc được danh sách mã mẫu tin từ seed (spec không chạy trên danh sách rỗng)', () => {
    expect(seededCodes().length).toBeGreaterThan(80);
    expect(seededCodes()).toContain('REVIEW_REQUEST');
  });

  it('mọi mã gửi cho khách trong seed có tiêu đề riêng, không rơi về "Thông báo"', () => {
    const generic = seededCodes().filter((c) => !NOT_FOR_CUSTOMERS(c) && notificationTitle(c) === 'Thông báo');
    expect(generic).toEqual([]);
  });

  it('chỉ mã lạ mới là "Thông báo"', () => {
    expect(notificationTitle('SOMETHING_NEW')).toBe('Thông báo');
  });

  it.each([
    ['REFUND_WALLET_CREDITED', 'Hoàn tiền đơn hàng'],
    ['REFUND_BANK_COMPLETED', 'Hoàn tiền đơn hàng'],
    ['WINBACK_VOUCHER', 'Ưu đãi cho bạn'],
    ['SECOND_ORDER_VOUCHER', 'Ưu đãi cho bạn'],
    ['VOUCHER_EXPIRING', 'Ưu đãi cho bạn'],
    ['GAME_TREE_THIRSTY', 'Vườn Xanh'],
    ['CART_ABANDONED', 'Giỏ hàng của bạn'],
    ['PRICE_DROP_ALERT', 'Giảm giá'],
    ['GROUP_BUY_SUCCESS', 'Mua chung'],
    ['GROUP_BUY_FAILED', 'Mua chung'],
    ['REVIEW_REQUEST', 'Mời đánh giá'],
    ['SUBSCRIPTION_PAUSED', 'Đơn định kỳ'],
    ['SUBSCRIPTION_ORDER', 'Đơn định kỳ'],
    ['COMMUNITY_POST_APPROVED', 'Cộng đồng'],
    ['COMMUNITY_BEST_ANSWER', 'Cộng đồng'],
  ])('%s → %s', (code, title) => {
    expect(notificationTitle(code)).toBe(title);
  });

  it.each([
    ['COMMISSION_NEW', 'Hoa hồng CTV'],
    ['COMMISSION_PAYOUT_PAID', 'Hoa hồng CTV'],
    ['TIER_DROP_NOTICE', 'Hạng thành viên'],
    ['TIER_UPGRADED', 'Hạng thành viên'],
    ['EXTERNAL_POINTS_CREDITED', 'Điểm Xanh'],
    ['EXTERNAL_POINTS_CLAIM_NOT_FOUND', 'Điểm Xanh'],
    ['CHAT_ORDER_POINTS_CREDITED', 'Điểm Xanh'],
    ['CHAT_ORDER_POINTS_LINKED', 'Điểm Xanh'],
    ['STOREFRONT_APPROVED', 'Gian hàng của bạn'],
    ['MERCHANT_ORDER_NEW', 'Gian hàng đối tác'],
    ['MERCHANT_PAYOUT_PAID', 'Gian hàng đối tác'],
    ['MERCHANT_ORDER_CANCELLED_BY_SELLER', 'Cập nhật đơn hàng'],
    ['OPS_ZALO_BRIDGE_DOWN', 'Cảnh báo vận hành'],
    ['REFILL_RETURN_CREDITED', 'Đổi rác lấy quà'],
  ])('%s → %s', (code, title) => {
    expect(notificationTitle(code)).toBe(title);
  });
});

describe('notificationOrderLink', () => {
  it('tin đơn của chính khách có nút xem đơn; OPS_* và tin cho chủ gian hàng (MERCHANT_*) mang mã đơn người khác thì không', () => {
    expect(notificationOrderLink('ORDER_SHIPPING', 'TUBU1')).toBe(true);
    expect(notificationOrderLink('ORDER_SHIPPING', undefined)).toBe(true);
    expect(notificationOrderLink('INVOICE_ISSUED', 'TUBU1')).toBe(true);
    expect(notificationOrderLink('OPS_GOMDON_ALERT', 'TUBU1')).toBe(false);
    for (const code of ['MERCHANT_ORDER_NEW', 'MERCHANT_ORDER_OVERDUE', 'MERCHANT_ORDER_CANCELLED', 'MERCHANT_RETURN_REQUESTED', 'MERCHANT_RETURN_APPROVED']) {
      expect(notificationOrderLink(code, 'TB1')).toBe(false);
    }
  });

  it('MERCHANT_ORDER_CANCELLED_BY_SELLER gửi cho khách mua: vẫn mở đơn của khách', () => {
    expect(notificationOrderLink('MERCHANT_ORDER_CANCELLED_BY_SELLER', 'TB1')).toBe(true);
  });
});

const link = (a: NotificationAction | null) => (a && 'to' in a ? a.to : null);
const label = (a: NotificationAction | null) => (a && 'label' in a ? a.label : null);

describe('E-4: tin cho chủ gian hàng', () => {
  it.each(['MERCHANT_ORDER_NEW', 'MERCHANT_ORDER_OVERDUE', 'MERCHANT_ORDER_CANCELLED', 'MERCHANT_RETURN_REQUESTED', 'MERCHANT_RETURN_APPROVED'])(
    '%s (có order_code): Mini không có nút; web mở "Đơn cần giao" của trang Đối tác',
    (code) => {
      expect(notificationAction(code, { order_code: 'TB1' }, mini)).toBeNull();
      expect(notificationAction(code, { order_code: 'TB1' }, web)).toEqual({ kind: 'direct', label: 'Mở đơn cần xử lý', to: '/merchant?tab=fulfil' });
    },
  );

  it('phiếu đối soát và sản phẩm đi đúng tab trên web', () => {
    expect(link(notificationAction('MERCHANT_PAYOUT_CREATED', {}, web))).toBe('/merchant?tab=settlement');
    expect(link(notificationAction('MERCHANT_PAYOUT_PAID', {}, web))).toBe('/merchant?tab=settlement');
    expect(link(notificationAction('MERCHANT_PRODUCT_APPROVED', {}, web))).toBe('/merchant?tab=products');
    expect(link(notificationAction('MERCHANT_PRODUCT_EDIT_REJECTED', {}, web))).toBe('/merchant?tab=products');
    expect(notificationAction('MERCHANT_PAYOUT_PAID', {}, mini)).toBeNull();
    expect(notificationAction('MERCHANT_PRODUCT_APPROVED', {}, mini)).toBeNull();
  });

  it('tin huỷ đơn của người bán gửi cho khách vẫn là link /order/<mã> trên cả hai nền', () => {
    expect(notificationAction('MERCHANT_ORDER_CANCELLED_BY_SELLER', { order_code: 'TB1' }, mini)).toEqual({ kind: 'link', label: 'Xem chi tiết đơn hàng', to: '/order/TB1' });
    expect(link(notificationAction('MERCHANT_ORDER_CANCELLED_BY_SELLER', { order_code: 'TB1' }, web))).toBe('/order/TB1');
  });

  it('Mini ghi chú chỉ dẫn sang web (không link); web không cần ghi chú; tin của khách không có ghi chú', () => {
    expect(notificationNote('MERCHANT_ORDER_NEW', 'miniapp')).toBe('Mở trang Đối tác trên web Tubu Tree để xử lý đơn.');
    expect(notificationNote('MERCHANT_RETURN_APPROVED', 'miniapp')).toBe('Mở trang Đối tác trên web Tubu Tree để xử lý đơn.');
    expect(notificationNote('MERCHANT_PAYOUT_PAID', 'miniapp')).toContain('Mở trang Đối tác trên web Tubu Tree');
    expect(notificationNote('MERCHANT_ORDER_NEW', 'web')).toBeNull();
    expect(notificationNote('MERCHANT_ORDER_CANCELLED_BY_SELLER', 'miniapp')).toBeNull();
    expect(notificationNote('ORDER_CONFIRMED', 'miniapp')).toBeNull();
  });
});

describe('E-5: hoa hồng, hạng, điểm sàn, gian hàng', () => {
  it.each([
    ['COMMISSION_WALLET_CREDITED', 'Xem Ví Tubu', '/wallet'],
    ['COMMISSION_WALLET_TAX_ONLY', 'Xem Ví Tubu', '/wallet'],
    ['COMMISSION_PAYOUT_PAID', 'Xem Ví Tubu', '/wallet'],
    ['COMMISSION_PAYOUT_APPROVED', 'Xem Ví Tubu', '/wallet'],
    ['COMMISSION_PAYOUT_REJECTED', 'Xem Ví Tubu', '/wallet'],
    ['COMMISSION_NEW', 'Xem hoa hồng', '/affiliate?tab=commission'],
    ['COMMISSION_APPROVED', 'Xem hoa hồng', '/affiliate?tab=commission'],
    ['COMMISSION_REVERSED', 'Xem hoa hồng', '/affiliate?tab=commission'],
    ['TIER_DROP_NOTICE', 'Xem cách giữ hạng', '/loyalty'],
    ['TIER_UPGRADED', 'Xem hạng của tôi', '/loyalty'],
    ['EXTERNAL_POINTS_PENDING', 'Xem Điểm Xanh', '/loyalty'],
    ['EXTERNAL_POINTS_CREDITED', 'Xem Điểm Xanh', '/loyalty'],
    ['EXTERNAL_POINTS_VOIDED', 'Xem Điểm Xanh', '/loyalty'],
    ['EXTERNAL_POINTS_CLAIM_NOT_FOUND', 'Xem Điểm Xanh', '/loyalty'],
    ['CHAT_ORDER_POINTS_CREDITED', 'Xem Điểm Xanh', '/loyalty'],
    ['CHAT_ORDER_POINTS_LINKED', 'Xem Điểm Xanh', '/loyalty'],
    ['STOREFRONT_APPROVED', 'Chia sẻ gian hàng', '/storefront'],
    ['STOREFRONT_REINSTATED', 'Chia sẻ gian hàng', '/storefront'],
    ['STOREFRONT_TAKEN_DOWN', 'Xem gian hàng', '/storefront'],
    ['STOREFRONT_TRENDING_PRODUCTS', 'Thêm vào gian hàng', '/storefront'],
  ])('%s → "%s" %s (cả hai nền)', (code, text, to) => {
    for (const opts of [mini, web]) expect(notificationAction(code, {}, opts)).toEqual({ kind: 'link', label: text, to });
  });

  it('tin hoa hồng lỡ mang order_code không dẫn sang chi tiết đơn', () => {
    expect(link(notificationAction('COMMISSION_NEW', { order_code: 'TB9' }, mini))).toBe('/affiliate?tab=commission');
  });
});

describe('E-32: tin mời đánh giá', () => {
  it('có product_slug và order_id: nút "Viết đánh giá" mở thẳng form của đơn đó', () => {
    for (const opts of [mini, web]) {
      expect(notificationAction('REVIEW_REQUEST', { order_code: 'TB1', order_id: 'o1', product_slug: 'sua-tam', product: 'Sữa tắm' }, opts)).toEqual({
        kind: 'review',
        label: 'Viết đánh giá',
        productSlug: 'sua-tam',
        orderId: 'o1',
      });
    }
  });

  it('tin cũ thiếu order_id (hoặc slug): "Viết đánh giá" về chi tiết đơn; không có cả mã đơn thì về danh sách đơn', () => {
    expect(notificationAction('REVIEW_REQUEST', { order_code: 'TB1', product_slug: 'sua-tam' }, mini)).toEqual({ kind: 'link', label: 'Viết đánh giá', to: '/order/TB1' });
    expect(notificationAction('REVIEW_REQUEST', { order_code: 'TB1', order_id: 'o1' }, web)).toEqual({ kind: 'link', label: 'Viết đánh giá', to: '/order/TB1' });
    expect(link(notificationAction('REVIEW_REQUEST', {}, mini))).toBe('/orders');
  });

  it('không còn nút "Xem chi tiết đơn hàng" cho tin mời đánh giá', () => {
    expect(label(notificationAction('REVIEW_REQUEST', { order_code: 'TB1' }, mini))).toBe('Viết đánh giá');
  });
});

describe('E-71: tin gói định kỳ', () => {
  it('Mini: chỉ có nút khi khách đã có gói; web luôn có', () => {
    expect(notificationAction('SUBSCRIPTION_PAUSED', {}, mini)).toBeNull();
    expect(notificationAction('SUBSCRIPTION_PAUSED', {}, { platform: 'miniapp', hasSubscription: false })).toBeNull();
    expect(notificationAction('SUBSCRIPTION_PAUSED', {}, { platform: 'miniapp', hasSubscription: true })).toEqual({ kind: 'link', label: 'Xem gói', to: '/orders?tab=subscriptions' });
    expect(notificationAction('SUBSCRIPTION_ORDER_FAILED', {}, web)).toEqual({ kind: 'link', label: 'Xem gói', to: '/orders?tab=subscriptions' });
  });
});

describe('E-81: giờ vàng và mua chung', () => {
  it('FLASH_STARTING có slug mở sản phẩm; thiếu thì về Trang chủ', () => {
    expect(link(notificationAction('FLASH_STARTING', { product: 'X', product_slug: 'dau-goi' }, mini))).toBe('/product/dau-goi');
    expect(link(notificationAction('FLASH_STARTING', { product: 'X' }, mini))).toBe('/');
  });

  it('GROUP_BUY_SUCCESS có product_slug: "Dùng mã, mua ngay" mở sản phẩm; không có thì giữ nút về Mua chung', () => {
    expect(notificationAction('GROUP_BUY_SUCCESS', { discount: '15.000', product_slug: 'nuoc-rua-chen' }, mini)).toEqual({ kind: 'link', label: 'Dùng mã, mua ngay', to: '/product/nuoc-rua-chen' });
    expect(notificationAction('GROUP_BUY_SUCCESS', { discount: '15.000' }, mini)).toEqual({ kind: 'link', label: 'Xem mua chung', to: '/group-buy' });
  });
});

describe('E-90: cảnh báo cầu nối Zalo', () => {
  it.each(['OPS_ZALO_BRIDGE_DOWN', 'OPS_ZALO_BRIDGE_ALERT'])('%s: web mở tab Chat CSKH; Mini không có nút', (code) => {
    expect(notificationAction(code, {}, web)).toEqual({ kind: 'direct', label: 'Mở Chat CSKH', to: '/admin?tab=supportChat' });
    expect(notificationAction(code, {}, mini)).toBeNull();
  });

  it('OPS_* khác vẫn không có nút, kể cả khi mang order_code hoặc route', () => {
    expect(notificationAction('OPS_GOMDON_ALERT', { order_code: 'T1', route: '/admin' }, web)).toBeNull();
    expect(notificationAction('OPS_HEALTH_ALERT', {}, mini)).toBeNull();
  });
});

describe('giữ nguyên các nút cũ', () => {
  it('REORDER_REMINDER: luồng mua lại với đích dự phòng là sản phẩm, không thì danh sách đơn', () => {
    expect(notificationAction('REORDER_REMINDER', { product_slug: 'dau-goi' }, mini)).toEqual({ kind: 'reorder', to: '/product/dau-goi' });
    expect(notificationAction('REORDER_REMINDER', { product: 'X' }, web)).toEqual({ kind: 'reorder', to: '/orders' });
  });

  it('data.route nội bộ được dùng; URL ngoài hoặc "//" bị bỏ qua', () => {
    expect(link(notificationAction('SOMETHING_NEW', { route: '/academy' }, mini))).toBe('/academy');
    expect(notificationAction('SOMETHING_NEW', { route: '//evil.com' }, mini)).toBeNull();
    expect(notificationAction('SOMETHING_NEW', { route: 'https://evil.com' }, web)).toBeNull();
  });

  it('tin chỉ gửi cho admin không có nút', () => {
    expect(notificationAction('DEALER_CREDIT_PAYMENT_REPORTED', { dealer: 'A' }, mini)).toBeNull();
    expect(link(notificationAction('DEALER_REWARD_CLAIM_APPROVED', {}, mini))).toBe('/dealer');
  });
});

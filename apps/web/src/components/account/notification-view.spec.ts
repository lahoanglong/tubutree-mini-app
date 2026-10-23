import { describe, expect, it } from 'vitest';
import { notificationAction, notificationMeta, notificationOrderLink, relativeTime, resolveWebRoute, type RouteResolver } from './notification-view';

// Chép ý notifications.spec.ts (Mini App): nhãn nhóm theo templateCode, nút theo loại tin (không dò nội dung), chặn route ngoài.
// Đích kiểm bằng đường dẫn Mini App qua resolver giả `/w` + path để không phụ thuộc cờ pending của route map.
const prefix: RouteResolver = (p) => `/w${p}`;

describe('notificationMeta', () => {
  it('XU_CONVERTED (báo xu đã thành Điểm Xanh) → nhóm Điểm Xanh', () => {
    expect(notificationMeta('XU_CONVERTED').title).toBe('Điểm Xanh');
  });

  it.each([
    ['REFERRAL_REWARD_PAID', 'Thưởng giới thiệu bạn bè'],
    ['REFERRAL_MILESTONE_PAID', 'Thưởng mốc giới thiệu'],
    ['REFERRAL_REWARD_REVOKED', 'Thu lại thưởng giới thiệu'],
  ])('%s → %s, không rơi về nhãn chung', (code, title) => {
    expect(notificationMeta(code).title).toBe(title);
  });

  it.each(['DEALER_BONUS_PAID', 'DEALER_REWARD_CLAIM_NEW', 'DEALER_REWARD_CLAIM_APPROVED', 'DEALER_REWARD_CLAIM_REJECTED', 'DEALER_REWARD_CLAIM_PAID'])(
    '%s → nhóm Đại lý',
    (code) => {
      expect(notificationMeta(code).title).toBe('Đại lý');
    },
  );

  it.each([
    ['RETURN_REQUESTED', 'Đã nhận yêu cầu đổi/trả'],
    ['RETURN_APPROVED_DETAIL', 'Yêu cầu đổi/trả đã duyệt'],
    ['RETURN_RECEIVED', 'Tubu đã nhận lại hàng'],
    ['RETURN_REJECTED', 'Yêu cầu đổi/trả bị từ chối'],
  ])('%s → tiêu đề đọc được', (code, title) => {
    expect(notificationMeta(code).title).toBe(title);
  });

  it('OPS_* → Cảnh báo vận hành; mọi mã WASTE → Đổi rác lấy quà', () => {
    expect(notificationMeta('OPS_GOMDON_ALERT').title).toBe('Cảnh báo vận hành');
    expect(notificationMeta('WASTE_POINTS_CREDITED').title).toBe('Đổi rác lấy quà');
    expect(notificationMeta('WASTE_GIFT_CANCELLED').title).toBe('Đổi rác lấy quà');
  });

  it('giữ nguyên các nhóm cũ, REORDER_REMINDER là Nhắc mua lại, mã lạ là Thông báo', () => {
    expect(notificationMeta('ORDER_CONFIRMED').title).toBe('Đơn đã xác nhận');
    expect(notificationMeta('ORDER_CANCELLED').title).toBe('Cập nhật đơn hàng');
    expect(notificationMeta('FLASH_REMINDER').title).toBe('Ưu đãi giờ vàng');
    expect(notificationMeta('REORDER_REMINDER').title).toBe('Nhắc mua lại');
    expect(notificationMeta('SOMETHING_NEW').title).toBe('Thông báo');
  });
});

describe('notificationOrderLink', () => {
  it('tin đơn của chính khách có nút xem đơn; OPS_* mang mã đơn của khách khác thì không', () => {
    expect(notificationOrderLink('ORDER_SHIPPING', 'TUBU1')).toBe(true);
    expect(notificationOrderLink('ORDER_SHIPPING', undefined)).toBe(true);
    expect(notificationOrderLink('INVOICE_ISSUED', 'TUBU1')).toBe(true);
    expect(notificationOrderLink('OPS_GOMDON_ALERT', 'TUBU1')).toBe(false);
  });
});

describe('SUPPORT_CHAT_REPLY (Tubu Tree trả lời trong chat)', () => {
  it('có nhãn riêng; nút mở /ho-tro/chat bất kể route map', () => {
    expect(notificationMeta('SUPPORT_CHAT_REPLY').title).toBe('Tubu Tree trả lời bạn');
    expect(notificationAction('SUPPORT_CHAT_REPLY', { preview: 'Dạ vâng', route: '/chat' }, () => null)).toMatchObject({ kind: 'link', to: '/ho-tro/chat' });
  });
});

describe('notificationAction: nút theo loại tin, không dò nội dung', () => {
  const to = (code: string, data?: Record<string, string>) => {
    const a = notificationAction(code, data, prefix);
    return a ? a.to : null;
  };

  it('tin giảm giá mở đúng sản phẩm, thiếu slug thì về Yêu thích', () => {
    expect(to('PRICE_DROP_ALERT', { product: 'Cây lau nhà', product_slug: 'cay-lau-nha' })).toBe('/w/product/cay-lau-nha');
    expect(to('PRICE_DROP_ALERT', { product: 'X' })).toBe('/w/wishlist');
  });

  it('tin cộng đồng về Cộng đồng, có post_id thì mở thẳng bài', () => {
    expect(to('COMMUNITY_NEW_ANSWER', { author: 'Lan' })).toBe('/w/feed');
    expect(to('COMMUNITY_BEST_ANSWER', { post_id: 'p1' })).toBe('/w/feed/p1');
    expect(to('COMMUNITY_EVENT_WINNER', { title: 'Thi khoe vườn' })).toBe('/w/feed');
  });

  it('chữ "cây"/"giỏ" trong dữ liệu không đổi hướng nút: chỉ templateCode quyết định', () => {
    expect(to('ORDER_SHIPPING', { order_code: 'TUBU1', product: 'Chậu cây, giỏ tre' })).toBe('/w/order/TUBU1');
    expect(to('WINBACK_VOUCHER', { product: 'vườn cây' })).toBe('/w/loyalty');
  });

  it('tin đơn không có mã đơn thì về danh sách đơn; mã đơn được mã hoá', () => {
    expect(to('ORDER_SHIPPING', {})).toBe('/w/orders');
    expect(to('ORDER_SHIPPING', { order_code: 'A/B' })).toBe('/w/order/A%2FB');
  });

  it.each([
    ['GAME_TREE_THIRSTY', '/w/game'],
    ['CART_ABANDONED', '/w/cart'],
    ['VOUCHER_EXPIRING', '/w/loyalty'],
    ['BIRTHDAY_VOUCHER', '/w/loyalty'],
    ['POINTS_EXPIRING', '/w/loyalty'],
    ['XU_CONVERTED', '/w/loyalty'],
    ['REFERRAL_REWARD_PAID', '/w/loyalty'],
    ['CASHBACK_PAID', '/w/wallet'],
    ['SUBSCRIPTION_PAUSED', '/w/subscriptions'],
    ['STOREFRONT_TRENDING_PRODUCTS', '/w/storefront'],
    ['DEALER_BONUS_PAID', '/w/dealer'],
    ['FLASH_STARTING', '/w/'],
  ])('%s → %s', (code, path) => {
    expect(to(code)).toBe(path);
  });

  it('nhóm mua chung hết hạn về sản phẩm; thành công hoặc thiếu slug về Mua chung', () => {
    expect(to('GROUP_BUY_FAILED', { product_slug: 'nuoc-rua-chen' })).toBe('/w/product/nuoc-rua-chen');
    expect(to('GROUP_BUY_FAILED', { product: 'X' })).toBe('/w/group-buy');
    expect(to('GROUP_BUY_SUCCESS', { discount: '15.000' })).toBe('/w/group-buy');
  });

  it('FLASH có slug mở sản phẩm (mã hoá)', () => {
    expect(to('FLASH_STARTING', { product_slug: 'a b' })).toBe('/w/product/a%20b');
  });

  it('data.route nội bộ được dùng; URL ngoài hoặc "//" bị bỏ qua; OPS_* không có nút', () => {
    expect(to('SOMETHING_NEW', { route: '/academy' })).toBe('/w/academy');
    expect(to('SOMETHING_NEW', { route: '//evil.com' })).toBeNull();
    expect(to('SOMETHING_NEW', { route: 'https://evil.com' })).toBeNull();
    expect(to('OPS_GOMDON_ALERT', { order_code: 'T1', route: '/admin' })).toBeNull();
  });

  it('tin chỉ gửi cho admin không dẫn sang trang Đại lý của khách', () => {
    expect(to('DEALER_CREDIT_PAYMENT_REPORTED', { dealer: 'A' })).toBeNull();
    expect(to('DEALER_REWARD_CLAIM_NEW', { dealer: 'A' })).toBeNull();
    expect(to('DEALER_REWARD_CLAIM_APPROVED', {})).toBe('/w/dealer');
  });

  it('đổi rác theo tiền tố, id lấy từ nội dung', () => {
    expect(to('WASTE_POINTS_CREDITED', { request_id: 'req-1' })).toBe('/w/recycle/done/req-1');
    expect(to('WASTE_GIFT_CANCELLED', { redemption_id: 'red-1' })).toBe('/w/rewards/mine');
    expect(to('WASTE_PERK_REVIEWED', { point_id: 'pt-1' })).toBe('/w/recycle/desk');
    for (const code of ['WASTE_PARCEL_RECEIVED', 'WASTE_REQUEST_REJECTED', 'WASTE_REQUEST_EXPIRED', 'WASTE_PICKUP_STARTED', 'WASTE_PICKUP_CANCELLED', 'WASTE_POINTS_REVERSED']) {
      expect(to(code, { request_id: 'r/2' })).toBe('/w/recycle/r/r%2F2');
    }
    expect(to('WASTE_SHIP_LOCKED', {})).toBe('/w/recycle');
    expect(to('WASTE_POINTS_CREDITED', {})).toBe('/w/recycle');
    expect(to('REFILL_RETURN_CREDITED', {})).toBe('/w/recycle');
    expect(to('WASTE_PICKUP_STARTED', { request_id: 'req-3', order_code: 'TUBU1' })).toBe('/w/recycle/r/req-3');
  });

  it('REORDER_REMINDER: nhãn Mua lại ngay; đích dự phòng là sản phẩm nếu có slug, không thì danh sách đơn', () => {
    expect(notificationAction('REORDER_REMINDER', { product_slug: 'dau-goi' }, prefix)).toEqual({ kind: 'reorder', label: 'Mua lại ngay', to: '/w/product/dau-goi' });
    expect(notificationAction('REORDER_REMINDER', { product_slug: 'sữa/đặc' }, prefix)?.to).toBe(`/w/product/${encodeURIComponent('sữa/đặc')}`);
    expect(notificationAction('REORDER_REMINDER', { product: 'X' }, prefix)?.to).toBe('/w/orders');
  });

  it('đích chưa có trang web (resolver trả null) thì không có nút', () => {
    const none: RouteResolver = () => null;
    expect(notificationAction('GAME_TREE_THIRSTY', {}, none)).toBeNull();
    expect(notificationAction('REORDER_REMINDER', {}, none)).toBeNull();
  });
});

describe('resolveWebRoute: đổi đường dẫn Mini App sang route web bằng route map', () => {
  it('route đã xong: thay tham số, giữ nguyên mã hoá', () => {
    expect(resolveWebRoute('/order/TUBU1')).toBe('/tai-khoan/don-hang/TUBU1');
    expect(resolveWebRoute('/product/a%20b')).toBe('/san-pham/a%20b');
    expect(resolveWebRoute('/')).toBe('/');
    expect(resolveWebRoute('/profile')).toBe('/tai-khoan');
  });

  it('không có trong bản đồ hoặc chỉ có ở Mini App thì null', () => {
    expect(resolveWebRoute('/points/scan')).toBeNull();
    expect(resolveWebRoute('/khong-co-trang-nay')).toBeNull();
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-19T10:00:00Z');
  it.each([
    ['2026-10-19T09:59:40Z', 'Vừa xong'],
    ['2026-10-19T09:55:00Z', '5 phút trước'],
    ['2026-10-19T07:00:00Z', '3 giờ trước'],
    ['2026-10-17T10:00:00Z', '2 ngày trước'],
    ['2026-10-01T10:00:00Z', '01/10/2026'],
  ])('%s → %s', (iso, text) => {
    expect(relativeTime(iso, now)).toBe(text);
  });
});

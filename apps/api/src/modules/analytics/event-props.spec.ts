import { CLIENT_EVENT_NAMES } from '@tubutree/shared-types';
import { CLIENT_EVENT_RULES, checkEventProps, looksLikePii } from './event-props';

describe('looksLikePii', () => {
  it.each([
    '0912345678',
    '091 234 5678',
    '091.234.5678',
    '+84912345678',
    '84912345678',
    'gọi 0912-345-678 nhé',
    '028 3822 1234',
    'a@b.vn',
    'khach.hang+1@gmail.com',
  ])('bắt %s', (s) => expect(looksLikePii(s)).toBe(true));

  it.each([
    'nuoc-rua-chen-fuwa3e-3-8l-ef3979',
    '3f2b0a91-0123-4567-8901-a23456789012',
    '01234567-89ab-4cde-8f01-234567890123',
    'clx0912345678abcdef',
    '/san-pham/:slug',
    '/tai-khoan/don-hang/:code',
    'TT2511160912345678X',
    '123456789',
    '1763300000000',
    'nước rửa chén 3.8L',
    '@tubutree',
  ])('không bắt %s', (s) => expect(looksLikePii(s)).toBe(false));
});

describe('checkEventProps', () => {
  it('mọi tên trong CLIENT_EVENT_NAMES đều có luật', () => {
    for (const name of CLIENT_EVENT_NAMES) expect(CLIENT_EVENT_RULES[name]).toBeDefined();
  });

  it('nhận đúng props của từng sự kiện phễu mua', () => {
    const ok: Array<[string, Record<string, unknown>]> = [
      ['screen_viewed', { route: '/san-pham/:slug', referrerRoute: null }],
      ['screen_viewed', { route: '/', referrerRoute: '/gio-hang' }],
      ['home_block_viewed', { block: 'bestSellers' }],
      ['product_card_click', { shelf: 'flash', position: 3, productSlug: 'nuoc-rua-chen-fuwa3e-3-8l-ef3979' }],
      ['product_viewed', { productSlug: 'xit-tram', hasVideo: false, imageCount: 10, inStock: true }],
      ['pdp_action', { action: 'buy_now', productSlug: 'xit-tram' }],
      ['cart_viewed', { itemCount: 2, subtotalBucket: '100-199k' }],
      ['checkout_started', { entry: 'cart_subset', itemCount: 1 }],
      ['checkout_step', { step: 'payment_method_selected', paymentMethod: 'BANK_TRANSFER' }],
      ['checkout_step', { step: 'place_order_click' }],
      ['checkout_abandoned', { lastStep: 'started' }],
      ['login_wall_shown', { from: '/thanh-toan' }],
      ['login_completed', { from: '/tai-khoan/don-hang/:code' }],
      ['review_submitted', { orderAgeDays: 0 }],
      ['return_requested', { orderAgeDays: 12 }],
    ];
    for (const [name, props] of ok) expect([name, checkEventProps(name, props)]).toEqual([name, 'ok']);
  });

  it('vẫn nhận props Mini App bản cũ đang gửi', () => {
    expect(checkEventProps('screen_viewed', { route: '/product/abc-1', prevRoute: null, msToContent: 120 })).toBe('ok');
    expect(
      checkEventProps('product_viewed', { productId: 'clx1', variationId: 'clv2', price: 195000, isFlash: false, inStock: true, listSource: 'browse' }),
    ).toBe('ok');
    expect(checkEventProps('checkout_started', { itemCount: 2, subtotal: 195000, entry: 'buy_now', isSubset: true })).toBe('ok');
    expect(checkEventProps('client_error', { kind: 'render', route: '/order/TT1', messageHash: '-1x2abc' })).toBe('ok');
    expect(checkEventProps('app_opened', {})).toBe('ok');
    expect(checkEventProps('reorder_clicked', { source: 'order_card', orderCode: 'TT-2511-AB', variationId: 'v1' })).toBe('ok');
  });

  it('từ chối khoá ngoài danh sách trắng', () => {
    expect(checkEventProps('pdp_action', { action: 'share', productSlug: 'a', phone: '1' })).toBe('unknown_key');
    expect(checkEventProps('cart_viewed', { itemCount: 1, subtotalBucket: '0-99k', subtotal: 50000 })).toBe('unknown_key');
    expect(checkEventProps('home_block_viewed', { block: 'flash', name: 'An' })).toBe('unknown_key');
  });

  it('từ chối thiếu khoá bắt buộc và giá trị sai khuôn', () => {
    expect(checkEventProps('pdp_action', { action: 'add_to_cart' })).toBe('missing_key');
    expect(checkEventProps('pdp_action', { action: 'delete_all', productSlug: 'a' })).toBe('bad_value');
    expect(checkEventProps('product_card_click', { shelf: 'flash', position: 0, productSlug: 'a' })).toBe('bad_value');
    expect(checkEventProps('product_card_click', { shelf: 'flash', position: 1.5, productSlug: 'a' })).toBe('bad_value');
    expect(checkEventProps('cart_viewed', { itemCount: 1, subtotalBucket: '195000' })).toBe('bad_value');
    expect(checkEventProps('screen_viewed', { route: 'san-pham' })).toBe('bad_value');
    expect(checkEventProps('screen_viewed', { route: '/san-pham?q=x' })).toBe('bad_value');
    expect(checkEventProps('product_viewed', { productSlug: 'a', hasVideo: 'yes' })).toBe('bad_value');
  });

  it('từ chối chuỗi giống SĐT hoặc email kể cả khi đúng khuôn', () => {
    expect(checkEventProps('product_card_click', { shelf: 'search', position: 1, productSlug: '0912345678' })).toBe('pii');
    expect(checkEventProps('search_performed', { q: 'sdt 0912 345 678', resultsCount: 0 })).toBe('pii');
    expect(checkEventProps('search_performed', { q: 'an@gmail.com', resultsCount: 0 })).toBe('pii');
    expect(checkEventProps('screen_viewed', { route: '/0912345678' })).toBe('pii');
  });

  it('green_card_shared: thẻ nhựa đã giảm của đơn gửi kèm nơi gửi; nơi lạ hay mã đơn thì bỏ', () => {
    expect(checkEventProps('green_card_shared', { method: 'share' })).toBe('ok');
    expect(checkEventProps('green_card_shared', { method: 'copy', surface: 'order' })).toBe('ok');
    expect(checkEventProps('green_card_shared', { method: 'copy', surface: 'home' })).toBe('bad_value');
    expect(checkEventProps('green_card_shared', { method: 'copy', surface: 'order', orderCode: 'TUBU1' })).toBe('unknown_key');
  });

  it('tên không có luật → bỏ', () => {
    expect(checkEventProps('order_paid', {})).toBe('unknown_key');
  });
});

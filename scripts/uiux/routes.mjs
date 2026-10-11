// Bảng route + persona + trạng thái cho bộ chụp màn hình A4. Nguồn route: apps/miniapp/src/components/app.tsx
// (react-router) và apps/web/src/app/**/page.tsx (Next App Router).
const ALL = ['normal', 'empty', 'loading', 'error', 'long'];

export const ADMIN_TABS = [
  'dashboard', 'dealers', 'dealerClaims', 'payouts', 'orders', 'returns', 'cashback', 'posCredits', 'users',
  'config', 'coupons', 'brands', 'merchantProducts', 'flashSales', 'faqs', 'contentKit', 'academy', 'quickReplies', 'analytics',
];
export const MERCHANT_TABS = ['Gian hàng & Subdomain', 'Tài khoản VietQR', 'Kho Hàng & Giao Nhận', 'Quản Lý Sản Phẩm', 'Đơn Hàng Thuộc Kho'];

/** @param {{product:string, brand:string}} ctx slug thật lấy từ API local */
export function miniappRoutes({ product, brand }) {
  const r = (id, path, persona = 'customer', states = ALL, extra = {}) => ({ app: 'miniapp', id, path, persona, states, ...extra });
  return [
    r('home', '/'),
    r('home-new-customer', '/', 'customer-new', ['normal', 'empty']),
    r('browse', '/browse'),
    r('browse-search', '/browse?q=nuoc', 'customer', ['normal', 'empty']),
    r('product-detail', `/product/${product}`),
    r('cart', '/cart'),
    r('checkout', '/checkout'),
    r('bank-payment', '/bank-payment/TUBU26100901'),
    r('orders', '/orders'),
    r('orders-subscriptions', '/orders?tab=subscriptions'),
    r('order-detail', '/order/TUBU26100901'),
    r('game', '/game'),
    r('feed', '/feed'),
    r('feed-leaderboard', '/feed/leaderboard'),
    r('feed-events', '/feed/events'),
    r('post-detail', '/feed/post-1'),
    r('ai-advisor', '/ai-advisor'),
    r('group-buy', '/group-buy'),
    r('refill', '/refill'),
    r('profile', '/profile'),
    r('loyalty', '/loyalty'),
    r('wallet', '/wallet'),
    r('addresses', '/addresses'),
    r('notifications', '/notifications'),
    r('affiliate', '/affiliate', 'ctv'),
    r('academy', '/academy', 'ctv'),
    r('academy-course', '/academy/course-1', 'ctv'),
    r('cashback', '/cashback'),
    r('dealer', '/dealer', 'dealer'),
    r('about', '/about', 'customer', ['normal']),
    r('wishlist', '/wishlist'),
    r('edit-profile', '/edit-profile', 'customer', ['normal', 'error']),
    r('settings', '/settings', 'customer', ['normal']),
    r('brand-story', '/brand-story', 'customer', ALL),
    r('storefront-builder', '/storefront', 'ctv'),
    r('storefront-view', '/s/tubu-demo'),
    r('brand-view', `/brand/${brand}`),
    r('brand-owner', '/brand-owner', 'dealer'),
    r('admin', '/admin', 'admin'),
    r('admin-community', '/admin/community', 'admin'),
    r('staff', '/staff', 'staff'),
    r('my-payroll', '/my-payroll', 'staff'),
    r('not-found', '/khong-ton-tai', 'customer', ['normal']),
  ];
}

export function webRoutes({ product, brand }) {
  const r = (id, path, persona, states, extra = {}) => ({ app: 'web', id, path, persona, states, ...extra });
  const out = [
    r('home', '/', 'customer', ['normal']),
    r('san-pham', `/san-pham/${product}`, 'customer', ['normal']),
    r('gio-hang', '/gio-hang', 'customer', ALL),
    r('thanh-toan', '/thanh-toan', 'customer', ALL),
    r('tai-khoan', '/tai-khoan', 'customer', ALL),
    r('dang-nhap', '/dang-nhap', 'guest', ['normal']),
    r('dang-nhap-callback', '/dang-nhap/callback?code=x&state=y', 'guest', ['normal']),
    r('storefront', '/s/tubu-demo', 'customer', ['normal']),
    r('brand', `/brand/${brand}`, 'customer', ['normal']),
    r('admin-pos', '/admin/pos', 'admin', ['normal', 'empty', 'error']),
    r('merchant-denied', '/merchant', 'customer', ['normal']),
  ];
  for (const t of ADMIN_TABS) out.push(r(`admin-${t}`, `/admin?tab=${t}`, 'admin', ALL, { mobileStates: ['normal'] }));
  MERCHANT_TABS.forEach((label, i) => out.push(r(`merchant-${i + 1}`, '/merchant', 'dealer', ['normal', 'empty', 'error'], { clickTab: label, mobileStates: ['normal'] })));
  out.push(r('merchant-ctv', '/merchant', 'ctv', ['normal']));
  return out;
}

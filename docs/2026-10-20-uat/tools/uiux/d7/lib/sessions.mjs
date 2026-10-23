// Người dùng giả theo vai trò + fixture tay cho vài endpoint cần dữ liệu nhất quán (giỏ hàng, báo giá).
import { artUri } from './art.mjs';

const REF = 'TUBU2410';

const BASE_USERS = {
  'customer-new': { id: 'u-new', role: 'CUSTOMER', fullName: 'Lê Thu Trang', phone: '0901234567', pointsBalance: 0, walletBalance: 0, coinsBalance: 0 },
  customer: { id: 'u-cus', role: 'CUSTOMER', fullName: 'Nguyễn Thị Hoa', phone: '0901234567', pointsBalance: 1280, walletBalance: 350000, coinsBalance: 80000, tierId: 'tier-2' },
  ctv: { id: 'u-ctv', role: 'AFFILIATE', fullName: 'Trần Văn Minh', phone: '0912345678', pointsBalance: 420, walletBalance: 1250000, coinsBalance: 20000 },
  dealer: { id: 'u-dealer', role: 'DEALER', fullName: 'Cửa hàng Xanh Tươi', phone: '0987654321', pointsBalance: 0, walletBalance: 0, coinsBalance: 0 },
  staff: { id: 'u-staff', role: 'STAFF', fullName: 'Phạm Quốc Anh', phone: '0933000111', pointsBalance: 0, walletBalance: 0, coinsBalance: 0 },
  admin: { id: 'u-admin', role: 'ADMIN', fullName: 'Admin Tubu', phone: '0931813126', pointsBalance: 0, walletBalance: 0, coinsBalance: 0 },
  'staff-cskh': { id: 'u-st-cskh', role: 'STAFF', fullName: 'Võ Ngọc Lan', phone: '0933000112', pointsBalance: 0, walletBalance: 0, coinsBalance: 0 },
  'staff-ketoan': { id: 'u-st-kt', role: 'STAFF', fullName: 'Đặng Hữu Phước', phone: '0933000113', pointsBalance: 0, walletBalance: 0, coinsBalance: 0 },
  'staff-marketing': { id: 'u-st-mkt', role: 'STAFF', fullName: 'Lê Thu Trang', phone: '0933000114', pointsBalance: 0, walletBalance: 0, coinsBalance: 0 },
  'staff-kho': { id: 'u-st-kho', role: 'STAFF', fullName: 'Phạm Quốc Anh', phone: '0933000115', pointsBalance: 0, walletBalance: 0, coinsBalance: 0 },
  'staff-none': { id: 'u-st-none', role: 'STAFF', fullName: 'Nhân viên mới', phone: '0933000116', pointsBalance: 0, walletBalance: 0, coinsBalance: 0 },
};

/** Nhóm quyền nhân viên theo persona (GET /admin/ops/access); khớp StaffPermission ở apps/web/src/lib/admin-client.ts. */
export const STAFF_PERMS = {
  staff: ['CSKH'],
  'staff-cskh': ['CSKH'],
  'staff-ketoan': ['KE_TOAN'],
  'staff-marketing': ['MARKETING'],
  'staff-kho': ['KHO'],
  'staff-none': [],
};

export const PERSONAS = Object.keys(BASE_USERS);

export function makeSession(persona) {
  const base = BASE_USERS[persona] ?? BASE_USERS.customer;
  const user = { zaloId: null, email: null, avatarUrl: artUri(base.fullName, 'avatar'), tierId: null, referralCode: REF, ...base };
  // GET /me thật trả cả số dư (users.service.ts getMe → serialize(user)); thiếu walletBalance thì /tai-khoan web sập vì mock.
  const me = { ...user, pointsConvertedBalance: 0, email: null, dob: null, onboarded: true, segments: ['skincare'] };
  return { persona, user, me };
}

function cartFrom(products, n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const p = products[i % products.length];
    const unit = p.salePrice ?? p.basePrice;
    const qty = 1 + (i % 3);
    items.push({
      id: `cart-${i}`,
      variationId: `var-${p.id}`,
      productName: p.name,
      variationName: ['Hương chanh gừng', 'Chai 500ml', 'Túi refill 1L'][i % 3],
      slug: p.slug,
      thumbnail: p.thumbnail ?? artUri(p.name),
      unitPrice: unit,
      quantity: qty,
      stock: 20,
      weight: 500,
      total: unit * qty,
    });
  }
  const subtotal = items.reduce((a, b) => a + b.total, 0);
  return {
    items,
    couponCode: null,
    subtotal,
    discount: 0,
    freeship: subtotal >= 200000,
    freeshipThreshold: 200000,
    itemCount: items.reduce((a, b) => a + b.quantity, 0),
  };
}

/** products: thẻ sản phẩm thật lấy từ API local (đã patch ảnh). */
export function makeCurated({ persona, products }) {
  const returning = persona !== 'customer-new';
  let lastCart = cartFrom(products, 3);
  return (ctx) => {
    const { method, path, state } = ctx;
    if (method === 'GET') {
      if (path === '/admin/ops/access') {
        const u = BASE_USERS[persona] ?? BASE_USERS.customer;
        if (u.role !== 'ADMIN' && u.role !== 'STAFF') return { __status: 403, body: { statusCode: 403, message: 'Forbidden' } };
        return { role: u.role, staffPermissions: STAFF_PERMS[persona] ?? [] };
      }
      if (path === '/orders/active-count') return { count: returning && state !== 'empty' ? 2 : 0 };
      if (path === '/me/purchased-items' && (!returning || state === 'empty')) return { items: [], nextCursor: null };
      if (path === '/cart') {
        lastCart = state === 'empty' ? cartFrom(products, 0) : cartFrom(products, state === 'long' ? 12 : 3);
        return lastCart;
      }
      if (path === '/me/addresses') {
        if (state === 'empty') return [];
        const mk = (i) => ({
          id: `addr-${i}`,
          recipient: ['Nguyễn Thị Hoa', 'Trần Văn Minh', 'Lê Thu Trang'][i % 3],
          phone: '0901234567',
          province: 'TP. Hồ Chí Minh',
          district: 'Quận 1',
          ward: 'Phường Bến Nghé',
          street: `${12 + i} Lê Lợi`,
          provinceCode: '79',
          districtCode: '760',
          wardCode: '26734',
          isDefault: i === 0,
        });
        return Array.from({ length: state === 'long' ? 7 : 2 }, (_, i) => mk(i));
      }
    } else if (method === 'POST' && path === '/checkout/quote') {
      const ship = lastCart.freeship ? 0 : 19000;
      return {
        subtotal: lastCart.subtotal,
        discount: 0,
        comboDiscount: 0,
        pointsUsed: 0,
        pointsDiscount: 0,
        shippingFee: ship,
        total: lastCart.subtotal + ship,
        pointsEarned: Math.round(lastCart.subtotal / 10000),
        pointsBalance: 1280,
      };
    }
    return undefined;
  };
}

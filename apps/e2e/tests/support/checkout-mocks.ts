import type { OrderDTO } from '@tubutree/shared-types';
import type {
  AddressDTO,
  CartSummary,
  CheckoutQuote,
  PublicConfig,
} from '../../../miniapp/src/services/shop-api';
import type { LoyaltyOverview, WalletSummary } from '../../../miniapp/src/services/account-api';
import type { BankQr } from '../../../miniapp/src/services/payment-api';
import { makeOrder, makeUser, mockSession, type MockApi } from './mock-api';
import { PILOT_PRODUCT } from './pilot-mocks';

/**
 * Mock đủ cho màn /checkout (apps/miniapp/src/pages/checkout.tsx) — mọi path khớp route NestJS:
 *   GET  /cart                    cart.controller.ts
 *   GET  /me/addresses            users.controller.ts
 *   GET  /me/wallet               wallet.controller.ts
 *   GET  /me/loyalty              loyalty.controller.ts
 *   GET  /config/public           system-config.controller.ts (recyclingEnabled)
 *   POST /checkout/quote          checkout.controller.ts
 *   POST /checkout/place-order    checkout.controller.ts (Idempotency-Key)
 *   GET  /payments/bank-qr/:code  payment.controller.ts
 */

export const CHECKOUT_ADDRESS: AddressDTO = {
  id: 'addr-default-1',
  recipient: 'Nguyễn Văn A',
  phone: '0901234567',
  province: 'TP. Hồ Chí Minh',
  district: 'Quận 1',
  ward: 'Phường Bến Nghé',
  street: '123 Lê Lợi',
  provinceCode: '79',
  districtCode: '760',
  wardCode: '26734',
  isDefault: true,
};

export const CHECKOUT_CART: CartSummary = {
  items: [
    {
      id: 'cart-item-1',
      variationId: 'var-1',
      slug: 'nuoc-rua-chen-tubu',
      productName: 'Nước Rửa Chén Sinh Học Tubu 500ml',
      variationName: 'Hương Chanh Gừng',
      thumbnail: null,
      unitPrice: 65000,
      quantity: 2,
      stock: 50,
      // 2 × 600g = 1,2kg → "Thu gom tối đa ~1.2 kg" (recyclingMaxKg, utils/format.ts).
      weight: 600,
      total: 130000,
    },
  ],
  couponCode: null,
  subtotal: 130000,
  discount: 0,
  freeship: false,
  freeshipThreshold: 200000,
  itemCount: 2,
};

export const CHECKOUT_QUOTE: CheckoutQuote = {
  subtotal: 130000,
  discount: 0,
  comboDiscount: 0,
  pointsUsed: 0,
  pointsDiscount: 0,
  shippingFee: 19000,
  total: 149000,
  pointsEarned: 14,
  pointsBalance: 50,
};

/**
 * Số dư CỐ Ý khác số trong user đăng nhập (200.000đ / 50.000 xu): checkout đọc số dư từ
 * GET /me/wallet, nên nhãn "Ví Tubu (350.000đ)" chứng minh mock đúng route đang được dùng.
 */
export const CHECKOUT_WALLET: WalletSummary = {
  walletBalance: 350000,
  coinsBalance: 80000,
  cashbackPending: 0,
  commissionApproved: 0,
  commissionPending: 0,
  xuConvertMultiplier: 1.2,
  withdrawMin: 100000,
  withdrawFee: 3000,
};

export const CHECKOUT_LOYALTY: LoyaltyOverview = {
  pointsBalance: 50,
  tierPoints: 50,
  tier: { id: 'tier-1', name: 'Mầm Xanh', multiplier: 1, perks: [] },
  nextTier: { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, pointsToGo: 450 },
  tiers: [
    { id: 'tier-1', name: 'Mầm Xanh', minPoints: 0, multiplier: 1 },
    { id: 'tier-2', name: 'Lộc Biếc', minPoints: 500, multiplier: 1.2 },
  ],
};

export function publicConfig(over: Partial<PublicConfig> = {}): PublicConfig {
  return {
    freeshipThreshold: 200000,
    subscribeDiscountPct: 0.12,
    affiliateWalletMultiplier: 1.5,
    affiliateMinWithdrawBank: 50000,
    cashbackHoldDays: 30,
    recyclingEnabled: false,
    ...over,
  };
}

export const ORDER_CODE_COD = 'TUBU-COD-12345';
export const ORDER_CODE_BANK = 'TUBU-BANK-67890';

/** Đơn trả về từ place-order — phản chiếu body (paymentMethod, recycling) như BE lưu vào Order. */
export function placedOrderFor(body: Record<string, unknown>): OrderDTO {
  const bank = body.paymentMethod === 'BANK_TRANSFER';
  return makeOrder({
    code: bank ? ORDER_CODE_BANK : ORDER_CODE_COD,
    status: bank ? 'PENDING_PAYMENT' : 'CONFIRMED',
    paymentMethod: bank ? 'BANK_TRANSFER' : 'COD',
    paymentStatus: 'UNPAID',
    hasRecyclingPickup: body.hasRecyclingPickup === true,
    recyclingNote: typeof body.recyclingNote === 'string' ? body.recyclingNote : null,
  });
}

export const BANK_QR: BankQr = {
  orderCode: ORDER_CODE_BANK,
  amount: 149000,
  paymentStatus: 'UNPAID',
  bank: { bin: '970436', name: 'Vietcombank', accountNo: '123456789', accountName: 'CONG TY TUBU TREE' },
  memo: ORDER_CODE_BANK,
  qrString: '000201010212',
  // data: URI — không tải ảnh ngoài (host ngoài bị chặn trong mock-api.ts).
  qrImageUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
};

export function mockCheckout(api: MockApi, opts: { recyclingEnabled?: boolean } = {}): void {
  mockSession(
    api,
    makeUser({ id: 'user-checkout', fullName: 'Nguyễn Văn A', pointsBalance: 50, walletBalance: 200000, coinsBalance: 50000 }),
  );
  api.get('/cart', CHECKOUT_CART);
  api.get('/me/addresses', [CHECKOUT_ADDRESS]);
  api.get('/me/wallet', CHECKOUT_WALLET);
  api.get('/me/loyalty', CHECKOUT_LOYALTY);
  api.get('/config/public', publicConfig({ recyclingEnabled: opts.recyclingEnabled ?? false }));
  api.post('/checkout/quote', CHECKOUT_QUOTE);
  api.post('/checkout/place-order', ({ call }) => placedOrderFor((call.body ?? {}) as Record<string, unknown>));
  api.get('/payments/bank-qr/:code', BANK_QR);
  // Màn đặt hàng thành công (dự án 4a) đọc sản phẩm của đơn để quyết định gợi ý "Đặt định kỳ"
  // (cùng điều kiện PDP). makeOrder dùng slug 'nuoc-rua-chen-tubu' + variation 'var-1' = PILOT_PRODUCT.
  api.get('/products/:slug', PILOT_PRODUCT);
}

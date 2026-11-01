import type { CollectableCouponDTO } from '../../../../packages/app-core/src/api/coupon-collect';
import type { CouponDTO, CouponHistoryDTO } from '../../../../packages/app-core/src/api/loyalty';
import type { MockApi } from './mock-api';

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();
const ago = (n: number) => new Date(Date.now() - n * DAY).toISOString();

/** Ba mã trong kho: một còn dài, một miễn phí giao hàng sắp hết hạn (2 ngày, trong khoảng "Sắp hết hạn"), một giảm phần trăm không giới hạn lượt. */
export const COLLECTABLE: CollectableCouponDTO[] = [
  { code: 'KM30K', title: 'Giảm 30K cho đơn từ 150K', type: 'AMOUNT', value: 30_000, minOrder: 150_000, maxDiscount: null, startAt: ago(1), endAt: inDays(12), newCustomerOnly: false, claimedCount: 12, usageLimit: 100 },
  { code: 'FS99', title: 'Miễn phí giao hàng', type: 'FREESHIP', value: 0, minOrder: 99_000, maxDiscount: null, startAt: ago(1), endAt: inDays(2), newCustomerOnly: false, claimedCount: 4, usageLimit: null },
  { code: 'GIAM10', title: 'Giảm 10% tối đa 40K', type: 'PERCENT', value: 10, minOrder: 200_000, maxDiscount: 40_000, startAt: ago(1), endAt: inDays(20), newCustomerOnly: false, claimedCount: 0, usageLimit: null },
];

/** Mã trong ví của khách: trùng một mã của kho (KM30K) nên ở tab Nhận mã nó hiện "Đã lưu". */
export const WALLET: CouponDTO[] = [
  { code: 'KM30K', title: 'Giảm 30K cho đơn từ 150K', type: 'AMOUNT', value: 30_000, minOrder: 150_000, maxDiscount: null, endAt: inDays(12) },
  { code: 'QUA-FS', title: 'Miễn phí giao hàng (đổi quà)', type: 'FREESHIP', value: 0, minOrder: 99_000, maxDiscount: null, endAt: inDays(2) },
];

export const HISTORY: CouponHistoryDTO[] = [
  { code: 'DA-DUNG', title: 'Giảm 20K', type: 'AMOUNT', value: 20_000, minOrder: 100_000, maxDiscount: null, endAt: inDays(5), state: 'used', usedAt: ago(3) },
  { code: 'HET-HAN', title: 'Giảm 5%', type: 'PERCENT', value: 5, minOrder: 0, maxDiscount: 20_000, endAt: ago(2), state: 'expired', usedAt: null },
];

/** `GET /coupons/collectable`: công khai, khách chưa đăng nhập cũng gọi. */
export function mockCollectable(api: MockApi, items: CollectableCouponDTO[] = COLLECTABLE): void {
  api.get('/coupons/collectable', items);
}

/** `GET /me/coupons` (ví) và `GET /me/coupons/history` (tab Đã dùng–hết hạn). */
export function mockWallet(api: MockApi, wallet: CouponDTO[] = WALLET): void {
  api.get('/me/coupons', wallet);
}

export function mockCouponHistory(api: MockApi, items: CouponHistoryDTO[] = HISTORY): void {
  api.get('/me/coupons/history', items);
}

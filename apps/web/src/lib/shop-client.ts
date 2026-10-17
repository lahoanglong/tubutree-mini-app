'use client';

import { apiFetch } from './client-api';
import type { MyRefund, RefundBankInput, ReturnReasonCode } from './refund-rules';
import type { FlashItem } from './flash-price';
import { cartStorefrontSlug } from './cart-key';

export interface CartLine {
  id: string;
  variationId: string;
  productName: string;
  variationName: string;
  slug: string;
  thumbnail: string | null;
  unitPrice: number;
  quantity: number;
  stock: number;
  total: number;
  /** Nơi giao dòng này (D4): kho Tubu, gian hàng đối tác tự giao, hoặc không giao được. API cũ chưa trả. */
  fulfiller?: LineFulfiller;
  /** Dòng đang tính giá Giờ vàng (`unitPrice` đã là giá Giờ vàng). API cũ chưa trả. */
  isFlash?: boolean;
  /** Số lượng vượt giới hạn mua Giờ vàng nên dòng tính giá thường: câu giải thích từ server. */
  flashLimitNotice?: string | null;
}
export interface LineFulfiller {
  kind: 'TUBU' | 'MERCHANT' | 'UNAVAILABLE';
  storefrontId: string | null;
  name: string;
  /** Chỉ có ở UNAVAILABLE: gian hàng tạm nghỉ nhận đơn, hoặc gian hàng đã ngừng bán (chủ bị khoá/hết quyền đối tác). */
  reason?: 'STORE_PAUSED' | 'STORE_CLOSED';
}
/** Một kiện của lần đặt: mỗi nơi giao thành một đơn riêng với phí giao và tổng riêng. */
export interface QuoteShipment {
  key: string;
  fulfiller: LineFulfiller;
  itemIds: string[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
}
export interface CartSummary {
  items: CartLine[];
  couponCode: string | null;
  /** Mã đang giữ nhưng chưa áp cho giỏ hiện tại — câu giải thích từ server. */
  couponNotice?: string | null;
  subtotal: number;
  /** Giảm giá combo của gian hàng đang ghi công (đã trừ trước khi tính mã); API cũ chưa trả → coi như 0. */
  comboDiscount?: number;
  /** Mức giảm của mã, tính trên phần hàng sau combo (cùng số báo giá checkout trừ). */
  discount: number;
  /** Ưu đãi hạng thành viên, tính sau combo và mã (cùng số báo giá checkout trừ); API cũ chưa trả → coi như 0. */
  tierDiscount?: number;
  freeship: boolean;
  freeshipThreshold: number;
  itemCount: number;
  /** Dòng có SP đã ngừng bán/chưa duyệt — server không tính tiền, không đặt được. */
  unavailableItems?: { id: string; productName: string; variationName: string; quantity: number }[];
}
export interface AddressDTO {
  id: string;
  recipient: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  street: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
  isDefault: boolean;
}
export interface CheckoutQuote {
  subtotal: number;
  discount: number;
  /** Mã trong giỏ chưa áp cho đơn này (không giảm, không tiêu lượt). */
  couponNotice?: string | null;
  /** Ưu đãi combo và ưu đãi hạng thành viên: hai khoản riêng ngoài `discount` (mã) và `pointsDiscount`. API cũ chưa trả. */
  comboDiscount?: number;
  tierDiscount?: number;
  pointsUsed: number;
  pointsDiscount: number;
  shippingFee: number;
  total: number;
  pointsEarned: number;
  pointsBalance: number;
  /** Điểm DÙNG ĐƯỢC ở checkout = số dư − điểm đơn còn có thể bị trả (backend kẹp theo số này). API cũ chưa trả. */
  redeemablePoints?: number;
  lockedPoints?: number;
  /** Lô quy đổi từ xu cũ (không hết hạn): phần của `pointsUsed` trừ vào lô này, số dư, và số được đề nghị dùng. */
  pointsUsedConverted?: number;
  pointsConvertedBalance?: number;
  redeemableConvertedPoints?: number;
  /** Số Điểm Xanh tối đa dùng được cho lần đặt này (chỉ trên hàng Tubu). API cũ chưa trả. */
  pointsMax?: number;
  /** Câu giải thích khi giỏ có hàng của gian hàng đối tác (Điểm Xanh không trả cho hàng đó); null = không có. */
  pointsPartnerNote?: string | null;
  /** Số điểm khách chọn bị kẹp vì hàng của gian hàng đối tác. */
  pointsNotice?: string | null;
  shipments?: QuoteShipment[];
  /** Phương thức không dùng được cho giỏ này → câu giải thích (ví dụ có hàng đối tác tự giao). */
  blockedPaymentMethods?: Record<string, string>;
}
/** Đơn cùng lần đặt bị tách theo nơi giao (kể cả chính đơn này). */
export interface SplitOrderDTO {
  id: string;
  code: string;
  total: number;
  status: string;
  fulfiller: 'TUBU' | 'MERCHANT';
  fulfillerName: string;
}
export interface OrderDTO {
  code: string;
  status: string;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  paymentMethod: string;
  paymentStatus?: string;
  createdAt: string;
  items: {
    productName: string;
    variationName: string;
    unitPrice: number;
    quantity: number;
    total: number;
    /** Ảnh nhỏ của dòng (API ghép theo biến thể); thiếu → hiện biểu tượng lá. */
    thumbnail?: string | null;
  }[];
  /**
   * Đơn chờ thanh toán mà hàng đã bàn giao vận chuyển (hệ thống thôi tự huỷ): Tubu xử lý với khách — không ghi hạn, không QR,
   * không nút hủy, chỉ câu "Tubu đang xử lý đơn này". API cũ chưa trả.
   */
  manualHandling?: boolean;
  /** Thu gom vật liệu tái chế (vận đơn đổi hàng Gomdon/BestExpress) — xem lib/recycling.ts. */
  hasRecyclingPickup?: boolean;
  recyclingNote?: string | null;
  gomdonStatus?: string | null;
  gomdonPartnerCode?: string | null;
  gomdonCancelStatus?: string | null;
  /** Có khi đặt hàng bị tách theo nơi giao (response của place-order). */
  splitOrders?: SplitOrderDTO[];
  /** Ai giao đơn này (chi tiết đơn). */
  fulfilment?: { kind: 'TUBU' | 'MERCHANT'; name: string; phone: string | null };
  /** Các đơn khác cùng lần đặt (chi tiết đơn). */
  siblings?: { code: string; status: string; total: number; fulfillerName: string }[];
}

/** GET /config/public — chỉ những giá trị vốn đã hiển thị công khai (xem system-config.controller.ts). */
export interface PublicConfig {
  freeshipThreshold?: number;
  /** true khi Gomdon đã cấu hình VÀ admin bật công tắc — chỉ khi đó mới hiện lựa chọn thu gom. */
  recyclingEnabled?: boolean;
}
export const getPublicConfig = () => apiFetch<PublicConfig>('/config/public', { auth: false });

/**
 * Tồn kho HIỆN TẠI của từng phân loại. Trang chi tiết sản phẩm là bản ISR 5 phút nên tồn kho in sẵn trong HTML có thể
 * cũ; trình duyệt hỏi lại cái này khi mở trang để nút "Thêm vào giỏ" và giới hạn số lượng theo hàng thật.
 */
export async function getProductStock(slug: string): Promise<Record<string, number>> {
  const p = await apiFetch<{ variations?: { id: string; stock: number }[] }>(
    `/products/${encodeURIComponent(slug)}`,
    { auth: false, cache: 'no-store' },
  );
  return Object.fromEntries((p.variations ?? []).map((v) => [v.id, v.stock]));
}

/**
 * Đợt Giờ vàng đang chạy (công khai, không cache): trang chủ/chi tiết là bản ISR 5 phút nên giá Giờ vàng không thể nằm trong
 * HTML; trình duyệt hỏi lại cái này để giá hiển thị khớp giá giỏ và đơn.
 */
export async function getActiveFlashSales(): Promise<FlashItem[]> {
  return apiFetch<FlashItem[]>('/flash-sales/active', { auth: false, cache: 'no-store' });
}

// Cart
/**
 * Gian hàng CTV đang ghi công (cùng slug màn thanh toán gửi cho báo giá): máy chủ trừ combo của gian hàng đó trong giỏ, để số giảm
 * và tổng ở trang giỏ đúng số thanh toán sẽ trừ. Mọi đường trả giỏ đều gửi để giỏ trong cache không đổi số giữa các thao tác.
 */
function cartPath(path: string): string {
  const slug = cartStorefrontSlug();
  return slug ? `${path}?storefrontSlug=${encodeURIComponent(slug)}` : path;
}
export const getCart = () => apiFetch<CartSummary>(cartPath('/cart'));
/** Giá của MỘT PHẦN giỏ (các dòng đang chọn): combo, mã và hạng tính trên đúng phần đó, cùng số báo giá thanh toán trừ. Chỉ đọc. */
export const getCartSelection = (itemIds: string[]) => {
  const base = cartPath('/cart');
  return apiFetch<CartSummary>(`${base}${base.includes('?') ? '&' : '?'}itemIds=${encodeURIComponent(itemIds.join(','))}`);
};
export const addToCart = (variationId: string, quantity: number) =>
  apiFetch<CartSummary>(cartPath('/cart/items'), { method: 'POST', body: { variationId, quantity } });
export const updateCartItem = (id: string, quantity: number) =>
  apiFetch<CartSummary>(cartPath(`/cart/items/${id}`), { method: 'PATCH', body: { quantity } });
export const removeCartItem = (id: string) =>
  apiFetch<CartSummary>(cartPath(`/cart/items/${id}`), { method: 'DELETE' });

// Voucher — web trước đây chỉ HIỂN THỊ cart.discount, không có ô nhập/chọn mã, nên cùng một giỏ
// mà mua trên web thì đắt hơn mua trong Mini App.
export interface CouponDTO {
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: string;
  /** Mã chỉ áp cho các sản phẩm này (mã mua chung); null/thiếu = mọi sản phẩm. */
  products?: { id: string; name: string }[] | null;
}
export const getMyCoupons = () => apiFetch<CouponDTO[]>('/me/coupons');
/** Mức giảm một mã cho lần đặt đang xem, máy chủ tính đúng như báo giá (khớp CouponPreviewDTO của shared-types). */
export interface CouponPreview {
  code: string;
  eligible: boolean;
  reason?: string;
  discount: number;
  /** Chỉ có khi gửi kèm addressId (thanh toán). */
  freeshipSaving?: number;
}
export interface CouponPreviewParams {
  addressId?: string;
  storefrontSlug?: string;
  itemIds?: string[];
}
export const getCouponPreviews = (params: CouponPreviewParams) =>
  apiFetch<{ coupons: CouponPreview[] }>('/checkout/coupon-previews', { method: 'POST', body: params }).then((r) => r.coupons);
export const applyCoupon = (code: string) =>
  apiFetch<CartSummary>(cartPath('/cart/coupon'), { method: 'POST', body: { code } });
export const removeCoupon = () => apiFetch<CartSummary>(cartPath('/cart/coupon'), { method: 'DELETE' });

/** GET /me — chỉ khai các số dư web hiển thị; hồ sơ trong phiên đăng nhập là ảnh chụp lúc đăng nhập nên sẽ cũ. */
export interface MyBalances {
  pointsBalance: number;
  /** Lô Điểm Xanh quy đổi từ xu cũ (không hết hạn). API cũ chưa trả → coi là 0. */
  pointsConvertedBalance?: number;
  walletBalance: number;
}
export const getMe = () => apiFetch<MyBalances>('/me');

/** GET /me/loyalty (cùng endpoint Mini App) — web chỉ đọc phần Điểm Xanh đang khoá. API cũ chưa trả → vắng. */
export interface MyPointsLock {
  lockedPoints?: number;
  /** Phần của lockedPoints thuộc đơn đang chờ xử lý đổi/trả (mở khi yêu cầu xử lý xong, không theo ngày). */
  lockedReturnPoints?: number;
  /** ISO — mốc muộn nhất phần khoá theo hạn đổi/trả được mở; null nếu không có. */
  lockedUntil?: string | null;
}
export const getMyPointsLock = () => apiFetch<MyPointsLock>('/me/loyalty');

// Ví Tubu và Điểm Xanh — số dư thật + sổ cái, cùng contract với Mini App (services/account-api.ts).
export interface WalletSummary {
  walletBalance: number;
  cashbackPending: number;
  commissionApproved: number;
  commissionPending: number;
  withdrawMin: number;
  withdrawFee: number;
}
export const getWallet = () => apiFetch<WalletSummary>('/me/wallet');

/** Một dòng sao kê Ví Tubu; `delta` có dấu: + vào ví, − ra khỏi ví. */
export interface WalletTxn {
  id: string;
  delta: number;
  balanceAfter: number;
  type: string;
  reason: string | null;
  orderId: string | null;
  createdAt: string;
}
export interface WalletTxnPage {
  data: WalletTxn[];
  meta: { page: number; limit: number; total: number };
}
export const WALLET_PAGE_SIZE = 20;
export const getWalletTransactions = (page: number) =>
  apiFetch<WalletTxnPage>(`/me/wallet/transactions?page=${page}&limit=${WALLET_PAGE_SIZE}`);

export interface PointsTxn {
  id: string;
  delta: number;
  reason: string;
  expiresAt: string | null;
  /** Dòng cũ/API cũ không có → lô thường. */
  lot?: 'STANDARD' | 'CONVERTED';
  createdAt: string;
}
/** API trả tối đa 100 dòng mới nhất. */
export const getPointsTransactions = () => apiFetch<PointsTxn[]>('/me/points/transactions');

// Addresses
export const getAddresses = () => apiFetch<AddressDTO[]>('/me/addresses');
export const createAddress = (data: Omit<AddressDTO, 'id' | 'isDefault'>) =>
  apiFetch<AddressDTO>('/me/addresses', { method: 'POST', body: data });
export const updateAddress = (id: string, data: Partial<Omit<AddressDTO, 'id'>>) =>
  apiFetch<AddressDTO>(`/me/addresses/${encodeURIComponent(id)}`, { method: 'PATCH', body: data });
export const deleteAddress = (id: string) =>
  apiFetch<{ ok: boolean }>(`/me/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Ghi "chạm" giới thiệu để attribution sống qua cả lúc mất phiên (BE giữ 3 ngày). */
export const recordReferralTouch = (dto: { referralCode: string; storefrontSlug?: string; kind?: 'ctv' | 'brand' }) =>
  apiFetch<{ ok: boolean }>('/affiliate/touch', { method: 'POST', body: dto });

// Checkout
export const checkoutQuote = (addressId: string, pointsToUse?: number, storefrontSlug?: string, itemIds?: string[]) =>
  apiFetch<CheckoutQuote>('/checkout/quote', {
    method: 'POST',
    body: { addressId, pointsToUse, storefrontSlug, ...(itemIds ? { itemIds } : {}) },
  });
export interface InvoiceRequestBody {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}
export const placeOrder = (
  body: {
    addressId: string;
    paymentMethod: string;
    pointsToUse?: number;
    /** Chỉ thanh toán các dòng này của giỏ; không gửi = toàn giỏ. */
    itemIds?: string[];
    invoiceRequest?: InvoiceRequestBody;
    /** Khách đã thấy đơn 0đ (FE ẩn chọn phương thức): BE từ chối nếu lúc đặt tổng > 0. */
    quotedZeroTotal?: boolean;
    /** Tổng khách đang thấy (từ báo giá): lúc đặt mà tổng cao hơn thì BE trả TOTAL_CHANGED. */
    expectedTotal?: number;
    note?: string;
    storefrontSlug?: string;
    referralCode?: string;
    /** Chỉ có mặt khi tính năng bật VÀ khách chọn — xem recyclingCheckoutFields. */
    hasRecyclingPickup?: true;
    recyclingNote?: string;
  },
  idempotencyKey: string,
) =>
  apiFetch<OrderDTO>('/checkout/place-order', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

// Orders
export interface OrderListFilter {
  status?: string;
  /** Nhóm trạng thái gộp của API (GET /orders?group=): processing = Đã xác nhận + Đang đóng gói, closed = Đã hủy + Đã hoàn. */
  group?: 'processing' | 'closed';
  /** Tìm theo mã đơn hoặc tên sản phẩm (API bỏ dấu, không phân biệt hoa thường). */
  q?: string;
}
export interface OrdersPage {
  data: OrderDTO[];
  meta: { page: number; limit: number; total: number };
}
export const ORDERS_PAGE_SIZE = 20;
/** Một trang đơn (mới nhất trước) kèm tổng số — API mặc định chỉ trả 20 đơn đầu nên danh sách phải tự tải thêm. */
export const fetchOrdersPage = (page: number, filter: OrderListFilter = {}) => {
  const qs = new URLSearchParams({ page: String(page), limit: String(ORDERS_PAGE_SIZE) });
  if (filter.status) qs.set('status', filter.status);
  if (filter.group) qs.set('group', filter.group);
  if (filter.q) qs.set('q', filter.q);
  return apiFetch<OrdersPage>(`/orders?${qs.toString()}`);
};

/** GET /orders/:code — API trả nguyên cột của Order kèm ảnh từng dòng; chỉ khai các trường web đang dùng. */
export interface ShippingEvent {
  at?: string | null;
  status?: string | null;
  carrier?: string | null;
  code?: string | null;
}
export interface OrderDetailDTO extends OrderDTO {
  id?: string;
  /** Hai trường dưới quyết định khách có tự hủy được không (xem canCancelOrder). */
  placedForCustomer?: boolean | null;
  referrerUserId?: string | null;
  deliveredAt?: string | null;
  /** Mốc hành trình do hãng vận chuyển ghi (Pancake/Gomdon webhook), cũ → mới. */
  shippingHistory?: ShippingEvent[] | null;
  shippingStatus?: string | null;
  couponCode?: string | null;
  /** Mã của lần đặt khi đơn tách này không giữ lượt dùng mã (đơn đầu của nhóm giữ) — để ghi đúng tên mã ở dòng giảm giá. */
  groupCouponCode?: string | null;
  /** Các phần của `discount` (đơn tạo trước khi API lưu từng khoản thì không có, các trường này bằng 0). */
  couponDiscount?: number;
  comboDiscount?: number;
  tierDiscount?: number;
  pointsDiscount?: number;
  /** Số Điểm Xanh đã dùng (đã nằm trong `discount`, không trừ thêm lần nữa). */
  pointsUsed?: number;
  note?: string | null;
  /** Ảnh chụp địa chỉ lúc đặt; đơn đại lý không có địa chỉ khách lẻ, chỉ có `note`. */
  shippingAddress?: {
    recipient?: string;
    phone?: string;
    province?: string;
    district?: string;
    ward?: string;
    street?: string;
    note?: string | null;
  } | null;
  shippingPartner?: string | null;
  shippingCode?: string | null;
  trackingLink?: string | null;
  /** Hạn chuyển khoản của đơn trả trước đang chờ tiền (ISO); quá hạn đơn tự huỷ. */
  paymentDeadline?: string | null;
  items: (OrderDTO['items'][number] & {
    id?: string;
    thumbnail?: string | null;
    /** Slug sản phẩm lúc mua (đơn cũ không có) — để mở trang sản phẩm từ đơn. */
    productSlug?: string | null;
    /** Đánh giá khách đã viết cho sản phẩm của dòng này ở chính đơn này (mỗi lần mua một đánh giá). */
    reviewId?: string | null;
    /** Dòng này còn viết đánh giá mới được (đơn đã nhận, mua lẻ cho chính mình, chưa đánh giá). */
    reviewable?: boolean;
  })[];
}
export const fetchOrder = (code: string) => apiFetch<OrderDetailDTO>(`/orders/${encodeURIComponent(code)}`);

export type RefundDestinationBody =
  | { refundMethod: 'WALLET' }
  | { refundMethod: 'BANK'; bankName: string; accountNumber: string; accountName: string };

/** Đơn đã trả tiền: gửi kèm nơi nhận tiền hoàn (Ví Tubu hoặc tài khoản ngân hàng). */
export const cancelOrder = (code: string, destination?: RefundDestinationBody) =>
  apiFetch<OrderDTO>(`/orders/${encodeURIComponent(code)}/cancel`, { method: 'POST', body: destination ?? {} });

export interface RepurchaseResult {
  results: { orderItemId: string; status: 'added' | 'partial' | 'skipped'; reason?: string; addedQuantity: number }[];
  /** Giỏ sau khi thêm — cùng dạng GET /cart. */
  cart: CartSummary;
}
/** Thêm lại các dòng của đơn vào giỏ; dòng hết hàng/ngừng bán bị bỏ qua riêng, không làm hỏng cả lượt. */
export const repurchaseOrder = (code: string) =>
  apiFetch<RepurchaseResult>(`/orders/${encodeURIComponent(code)}/repurchase`, { method: 'POST', body: {} });

export interface ReturnRequestDTO {
  id: string;
  orderId: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  reason: string;
  reasonCode?: string | null;
  adminNote?: string | null;
  refundMethod?: 'WALLET' | 'BANK';
  bankName?: string | null;
  bankAccountNo?: string | null;
  /** Tiền hàng hoàn khi duyệt (null khi chưa duyệt); phí ship hoàn nằm riêng ở `shippingRefund`. */
  refundAmount?: number | null;
  shippingRefund?: number;
  pointsRefunded?: number;
  fullReturn?: boolean;
  receivedAt?: string | null;
  items?: { orderItemId: string; quantity: number; refundAmount: number }[];
  createdAt: string;
}
export interface ReturnRequestBody {
  reasonCode: ReturnReasonCode;
  reason?: string;
  /** Ảnh minh chứng (https Cloudinary hoặc data URL JPEG/PNG/WebP), tối đa 6 theo API; web gửi tối đa 3 như Mini App. */
  images?: string[];
  items: { orderItemId: string; quantity: number }[];
}
export const requestReturn = (code: string, body: ReturnRequestBody & Partial<RefundDestinationBody>) =>
  apiFetch<ReturnRequestDTO>(`/orders/${encodeURIComponent(code)}/return-request`, { method: 'POST', body });
export const fetchMyReturns = () => apiFetch<ReturnRequestDTO[]>('/orders/me/returns');

/** Số tiền dự kiến hoàn cho các dòng khách đang chọn (cùng cách tính lúc Tubu duyệt, D3) — không ghi gì. */
export interface ReturnEstimateDTO {
  isFull: boolean;
  goods: number;
  shipping: number;
  refund: number;
  moneyRefundable: boolean;
  pointsUsedBack: number;
  lines: { orderItemId: string; quantity: number; refundAmount: number }[];
}
export const estimateReturn = (code: string, body: { reasonCode?: ReturnReasonCode; items: { orderItemId: string; quantity: number }[] }) =>
  apiFetch<ReturnEstimateDTO>(`/orders/${encodeURIComponent(code)}/return-estimate`, { method: 'POST', body });

/** Các khoản hoàn tiền của khách cho một đơn (chuyển khoản chờ xử lý, tiền về muộn). */
export const fetchMyRefunds = (orderId: string) =>
  apiFetch<MyRefund[]>(`/orders/me/refunds?orderId=${encodeURIComponent(orderId)}`);
/** Tài khoản ngân hàng khách dùng gần nhất — điền sẵn khi chọn hoàn về ngân hàng. */
export const fetchRefundBank = () =>
  apiFetch<{ bank: RefundBankInput | null }>('/orders/me/refund-bank').then((r) => r.bank);
export const chooseRefundDestination = (refundId: string, body: RefundDestinationBody) =>
  apiFetch<MyRefund>(`/orders/me/refunds/${encodeURIComponent(refundId)}/destination`, { method: 'POST', body });

// Thanh toán chuyển khoản (VietQR) — A2-02 = A6-01 (docs/audit-2026-09): web chọn được
// BANK_TRANSFER nhưng trước đây không có cách nào gọi endpoint này nên khách không bao giờ thấy
// QR/STK để trả tiền. Cùng contract BE với apps/miniapp/src/services/payment-api.ts
// (GET /payments/bank-qr/:code — xem bank-transfer.service.ts).
export interface BankQrDTO {
  orderCode: string;
  amount: number;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED';
  bank: { bin: string; name: string; accountNo: string; accountName: string };
  memo: string;
  qrString: string;
  qrImageUrl: string;
  /** Hạn chuyển khoản (ISO) khi đơn còn chờ tiền; null khi đã trả hoặc không có hạn. */
  paymentDeadline?: string | null;
}
export const getBankQr = (code: string) => apiFetch<BankQrDTO>(`/payments/bank-qr/${code}`);

export function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}

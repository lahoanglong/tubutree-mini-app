'use client';

import { apiFetch } from './client-api';
import type { AdminOrderItem, Page } from './admin-client';

export interface MerchantStore {
  id: string;
  type: string;
  slug: string;
  subdomain?: string | null;
  customDomain?: string | null;
  title: string;
  headerNote?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  theme: string;
  themeColor?: string | null;
  bankName?: string | null;
  bankBin?: string | null;
  bankAccountNo?: string | null;
  bankAccountName?: string | null;
  warehouseAddress?: string | null;
  warehouseCity?: string | null;
  warehouseDistrict?: string | null;
  warehouseWard?: string | null;
  warehousePhone?: string | null;
  /** Phí giao một kiện khi đối tác tự giao; null = phí mặc định của Tubu. */
  shippingFee?: number | null;
  /** Đơn từ mức này được miễn phí giao (đối tác chịu); null = không miễn. */
  freeShipFrom?: number | null;
  /** Phí sàn riêng (phân số); null = mức mặc định `merchant.commission_pct`. */
  commissionPct?: string | number | null;
  isPublished: boolean;
  collections?: {
    id: string;
    title: string;
    items?: {
      id: string;
      productId: string;
      product: {
        id: string;
        name: string;
        basePrice: number;
        salePrice?: number | null;
        thumbnail?: string | null;
      };
    }[];
  }[];
}

export interface MerchantProductVariation {
  id: string;
  sku: string;
  name: string;
  retailPrice: number;
  salePrice?: number | null;
  stock: number;
}

export interface MerchantProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  shortDesc?: string | null;
  basePrice: number;
  salePrice?: number | null;
  images: string[];
  thumbnail?: string | null;
  approvalStatus: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED';
  rejectReason?: string | null;
  storefrontId?: string | null;
  isActive?: boolean;
  /** TUBU: kho Tubu giao qua Pancake ("Tubu giao hộ" đã duyệt); MERCHANT: gian hàng tự giao. */
  fulfilment?: 'TUBU' | 'MERCHANT';
  /** Mã biến thể Pancake xin "Tubu giao hộ" (chờ admin duyệt). */
  pancakeLinkCode?: string | null;
  variations?: MerchantProductVariation[];
  createdAt: string;
}

export interface UpdateMerchantStoreInput {
  title?: string;
  headerNote?: string;
  subdomain?: string;
  customDomain?: string;
  themeColor?: string;
  bankName?: string;
  bankBin?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  warehouseAddress?: string;
  warehouseCity?: string;
  warehouseDistrict?: string;
  warehouseWard?: string;
  warehousePhone?: string;
  avatarUrl?: string;
  coverUrl?: string;
  isPublished?: boolean;
  shippingFee?: number | null;
  freeShipFrom?: number | null;
}

export interface CreateMerchantProductInput {
  name: string;
  description: string;
  shortDesc?: string;
  basePrice: number;
  salePrice?: number;
  images: string[];
  thumbnail?: string;
  categoryIds?: string[];
  tags?: string[];
  forSegment?: string[];
  ingredients?: unknown;
  certifications?: string[];
  stock?: number;
  /** Mã biến thể Pancake khi chọn "Tubu giao hộ". */
  pancakeCode?: string;
  tubuFulfils?: boolean;
}

export interface UpdateMerchantProductInput {
  name?: string;
  description?: string;
  shortDesc?: string;
  basePrice?: number;
  salePrice?: number | null;
  images?: string[];
  stock?: number;
  isActive?: boolean;
}

/** Biến thể Pancake hợp lệ cho "Tubu giao hộ" (GET /merchant/pancake-variations/:code). */
export interface LinkablePancakeVariation {
  variationId: string;
  pancakeId: string;
  productId: string;
  productName: string;
  variationName: string;
  retailPrice: number;
  salePrice: number | null;
  stock: number;
}

export const getMerchantStore = () =>
  apiFetch<MerchantStore>('/merchant/store');

export const updateMerchantStore = (body: UpdateMerchantStoreInput) =>
  apiFetch<MerchantStore>('/merchant/store', { method: 'PUT', body });

/**
 * Cỡ trang cổng đối tác = mặc định PaginationQuery của BE (limit 20, tối đa 100 —
 * apps/api/src/common/pagination.ts). Không gửi limit thì BE vẫn cắt ở 20.
 */
export const MERCHANT_PAGE_SIZE = 20;

/**
 * BE merchant.service.listMyProducts phân trang CẢ 2 danh sách bằng cùng page/limit và trả kèm tổng riêng
 * từng danh sách. Client cũ bỏ qua meta → số "Sản phẩm riêng/bán lại" đếm trên trang đầu, không bao giờ vượt 20.
 */
export interface MerchantProductsPage {
  ownProducts: MerchantProduct[];
  resellProducts: MerchantProduct[];
  meta: { page: number; limit: number; ownTotal: number; resellTotal: number };
}

export const getMerchantProducts = (page = 1, limit = MERCHANT_PAGE_SIZE) =>
  apiFetch<MerchantProductsPage>(`/merchant/products?page=${page}&limit=${limit}`);

export const createMerchantProduct = (body: CreateMerchantProductInput) =>
  apiFetch<MerchantProduct>('/merchant/products', { method: 'POST', body });

export const updateMerchantProduct = (id: string, body: UpdateMerchantProductInput) =>
  apiFetch<MerchantProduct>(`/merchant/products/${encodeURIComponent(id)}`, { method: 'PATCH', body });

/** Ngừng bán (không xoá: đơn cũ và đối soát vẫn trỏ tới sản phẩm). */
export const stopSellingMerchantProduct = (id: string) =>
  apiFetch<MerchantProduct>(`/merchant/products/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const checkPancakeVariation = (code: string) =>
  apiFetch<LinkablePancakeVariation>(`/merchant/pancake-variations/${encodeURIComponent(code.trim())}`);

export const addResellProduct = (productId: string, collectionId?: string) =>
  apiFetch('/merchant/resell-products', { method: 'POST', body: { productId, collectionId } });

export const removeResellProduct = (productId: string) =>
  apiFetch(`/merchant/resell-products/${productId}`, { method: 'DELETE' });

/**
 * Một dòng trong `data` của GET /merchant/orders: tập field whitelist (MERCHANT_ORDER_SELECT trong
 * merchant.service.ts — không có note/invoiceRequest/userId/referrerUserId) — cùng entity Order mà admin-client.ts (AdminOrder) mô tả, chỉ
 * khác là đơn ở đây còn cần `shippingAddress` để đối tác đóng gói/ghi vận đơn. Tái dùng AdminOrderItem
 * cho `items` — tránh khai trùng một interface item thứ hai cho cùng một shape.
 */
export interface MerchantOrder {
  id: string;
  code: string;
  status: string;
  total: number;
  paymentMethod?: string;
  paymentStatus?: string;
  createdAt: string;
  shippingAddress?: {
    recipient?: string;
    phone?: string;
    street?: string;
    ward?: string;
    district?: string;
    province?: string;
  } | null;
  user?: {
    phone: string | null;
    fullName: string | null;
  } | null;
  items?: AdminOrderItem[];
}

/**
 * BE trả `paginated()` = `{ data, meta: { page, limit, total } }`, KHÔNG phải mảng. Client cũ khai
 * `MerchantOrder[]` → trang /merchant gọi `.filter`/`.map`/`.length` trên object → TypeError, trắng trang
 * với MỌI tài khoản DEALER/AFFILIATE.
 */
export const listMerchantOrders = (status?: string, page = 1, limit = MERCHANT_PAGE_SIZE) =>
  apiFetch<Page<MerchantOrder>>(
    `/merchant/orders?page=${page}&limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
  );

/** Số đơn theo trạng thái (đọc meta.total, không tải danh sách) — cho thẻ "Chờ đóng gói". */
export const countMerchantOrders = (status: string) =>
  listMerchantOrders(status, 1, 1).then((r) => r.meta.total);

export const updateMerchantOrderStatus = (orderId: string, status: string) =>
  apiFetch(`/merchant/orders/${orderId}/status`, { method: 'PUT', body: { status } });

export const publishMerchantStore = (isPublished: boolean) =>
  apiFetch<MerchantStore>('/merchant/store/publish', { method: 'POST', body: { isPublished } });


// ── Đơn đối tác tự giao (D4) ──

export type FulfilStatus = 'CONFIRMED' | 'PACKED' | 'SHIPPING' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
export type SlaState = 'CONFIRM_OVERDUE' | 'SHIP_OVERDUE' | 'DELIVER_OVERDUE' | null;

export interface FulfilOrder {
  id: string;
  code: string;
  status: FulfilStatus;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  shippingAddress: {
    recipient?: string;
    phone?: string;
    street?: string;
    ward?: string;
    district?: string;
    province?: string;
  } | null;
  note?: string | null;
  shippingPartner?: string | null;
  shippingCode?: string | null;
  trackingLink?: string | null;
  merchantAcceptedAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  items: { id: string; productName: string; variationName: string; unitPrice: number; quantity: number; total: number }[];
  user?: { fullName: string | null; phone: string | null } | null;
  sla: { state: SlaState; dueAt: string | null };
}

export interface SlaConfig {
  confirmHours: number;
  shipHours: number;
  deliverDays: number;
}

export interface FulfilOrdersPage extends Page<FulfilOrder> {
  /** Số đơn đang chờ đối tác theo trạng thái (CONFIRMED/PACKED/SHIPPING). */
  counts: Partial<Record<FulfilStatus, number>>;
  slaConfig: SlaConfig;
}

export const listFulfilOrders = (status?: FulfilStatus, page = 1, limit = MERCHANT_PAGE_SIZE) =>
  apiFetch<FulfilOrdersPage>(
    `/merchant/fulfil-orders?page=${page}&limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ''}`,
  );

const fulfilAction = (id: string, action: string, body?: unknown) =>
  apiFetch<FulfilOrder>(`/merchant/fulfil-orders/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: body ?? {} });

export const acceptFulfilOrder = (id: string) => fulfilAction(id, 'accept');
export const packFulfilOrder = (id: string) => fulfilAction(id, 'pack');
export const shipFulfilOrder = (id: string, body: { carrier: string; trackingCode: string; trackingUrl?: string }) =>
  fulfilAction(id, 'ship', body);
export const deliverFulfilOrder = (id: string) => fulfilAction(id, 'deliver');
export const failFulfilOrder = (id: string, reason: string) => fulfilAction(id, 'fail', { reason });
export const cancelFulfilOrder = (id: string, reason: string) => fulfilAction(id, 'cancel', { reason });

// ── Đối soát ──

export interface SettlementLine {
  orderId: string;
  orderCode: string;
  kind: 'SALE' | 'REVERSAL';
  goodsAmount: number;
  shippingFee: number;
  commissionAmount: number;
  codCollected: number;
  netAmount: number;
  deliveredAt: string | null;
}

export interface MerchantPayout {
  id: string;
  storefrontId: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  bankInfo?: { bankName?: string | null; accountNo?: string | null; accountName?: string | null } | null;
  createdAt: string;
  paidAt?: string | null;
  bankRef?: string | null;
  note?: string | null;
  lines: (SettlementLine & { id: string })[];
  storefront?: { id: string; title: string };
}

export interface MerchantStatement {
  holdDays: number;
  lines: SettlementLine[];
  total: number;
  upcoming: (SettlementLine & { availableAt: string | null })[];
}

export const getMerchantSettlement = () =>
  apiFetch<MerchantStatement & { payouts: MerchantPayout[] }>('/merchant/settlement');

// ── Admin: giám sát đơn đối tác tự giao + đối soát ──

export interface MerchantFulfilmentOverview {
  slaConfig: SlaConfig;
  stores: {
    storefrontId: string;
    title: string;
    owner: { fullName: string | null; phone: string | null } | null;
    activeOrders: number;
    overdueOrders: number;
    settleableLines: number;
    settleableAmount: number;
  }[];
  overdue: {
    id: string;
    code: string;
    status: string;
    total: number;
    createdAt: string;
    fulfillerStorefront: { title: string; owner: { phone: string | null } | null } | null;
    sla: { state: SlaState; dueAt: string | null };
  }[];
}

export const getMerchantFulfilmentOverview = () =>
  apiFetch<MerchantFulfilmentOverview>('/admin/merchant-fulfilment/overview');

export const getAdminMerchantStatement = (storefrontId: string) =>
  apiFetch<MerchantStatement>(`/admin/merchant-fulfilment/statements/${encodeURIComponent(storefrontId)}`);

export const listAdminMerchantPayouts = (page = 1, limit = MERCHANT_PAGE_SIZE) =>
  apiFetch<Page<MerchantPayout>>(`/admin/merchant-fulfilment/payouts?page=${page}&limit=${limit}`);

export const createAdminMerchantPayout = (storefrontId: string, note?: string) =>
  apiFetch<MerchantPayout>('/admin/merchant-fulfilment/payouts', { method: 'POST', body: { storefrontId, note } });

export const markAdminMerchantPayoutPaid = (id: string, bankRef: string) =>
  apiFetch<MerchantPayout>(`/admin/merchant-fulfilment/payouts/${encodeURIComponent(id)}/paid`, {
    method: 'POST',
    body: { bankRef },
  });

export const cancelAdminMerchantPayout = (id: string) =>
  apiFetch<MerchantPayout>(`/admin/merchant-fulfilment/payouts/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });

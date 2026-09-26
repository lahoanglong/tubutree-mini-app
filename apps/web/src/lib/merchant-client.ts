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

export const addResellProduct = (productId: string, collectionId?: string) =>
  apiFetch('/merchant/resell-products', { method: 'POST', body: { productId, collectionId } });

export const removeResellProduct = (productId: string) =>
  apiFetch(`/merchant/resell-products/${productId}`, { method: 'DELETE' });

/**
 * Một dòng trong `data` của GET /merchant/orders: nguyên Prisma `Order` kèm include `items` + `user`
 * (merchant.service.listMerchantOrders) — cùng entity Order mà admin-client.ts (AdminOrder) mô tả, chỉ
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
  note?: string | null;
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
    id: string;
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

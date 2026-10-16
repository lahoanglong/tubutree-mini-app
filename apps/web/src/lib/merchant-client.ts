'use client';

import { apiFetch } from './client-api';
import type { AdminOrderItem, Page } from './admin-client';

export interface MerchantStore {
  id: string;
  type: string;
  /** API quyết định gian hàng dùng cổng đối tác (MERCHANT, hoặc CTV của đại lý đã duyệt); thiếu = xét theo type. */
  isPartner?: boolean;
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
  /** Gian hàng "Tạm nghỉ" từ mốc này: hàng tự giao không đặt được. null = đang nhận đơn. */
  ordersPausedAt?: string | null;
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

export interface MerchantProductPendingEdit {
  name: string;
  description: string;
  shortDesc: string | null;
  images: string[];
  thumbnail: string | null;
  submittedAt: string;
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
  /** Sản phẩm APPROVED mà có lý do: lần sửa nội dung gần nhất bị từ chối, sản phẩm vẫn bán nội dung cũ. */
  rejectReason?: string | null;
  /** Bản sửa tên/mô tả/ảnh của sản phẩm đang bán, chờ admin duyệt; các trường thường ở trên vẫn là nội dung đang bán. */
  pendingEdit?: MerchantProductPendingEdit | null;
  storefrontId?: string | null;
  isActive?: boolean;
  /** TUBU: kho Tubu giao qua Pancake ("Tubu giao hộ" đã duyệt); MERCHANT: gian hàng tự giao. */
  fulfilment?: 'TUBU' | 'MERCHANT';
  /** Mã biến thể Pancake xin "Tubu giao hộ" (chờ admin duyệt). */
  pancakeLinkCode?: string | null;
  variations?: MerchantProductVariation[];
  /** Số đơn vị khách đã đặt (đơn tự giao) mà chưa gửi — đã trừ khỏi tồn kho. API cũ chưa trả. */
  heldQty?: number;
  /** LINKED: đang giữ biến thể Pancake; AWAITING: xin "Tubu giao hộ", chờ admin duyệt/liên kết lại. */
  linkState?: 'LINKED' | 'AWAITING' | null;
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
  /** Chỉ cho sản phẩm chưa liên kết: chuỗi = đổi sang mã Pancake khác (gửi duyệt lại), null = bỏ mã để tự giao. */
  pancakeCode?: string | null;
}

/** Biến thể Pancake hợp lệ cho "Tubu giao hộ" (GET /merchant/pancake-variations/:code). */
export interface LinkablePancakeVariation {
  pancakeId: string;
  productName: string;
  variationName: string;
  retailPrice: number;
  salePrice: number | null;
  /** null khi mã đang thuộc sản phẩm đang bán của Tubu (gian hàng không xem tồn kho của bên khác). */
  stock: number | null;
  /** Mã của sản phẩm Tubu đang bán: chỉ gửi xin được, admin xác nhận chuyển thì mới liên kết. */
  requiresAdminConfirm?: boolean;
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
  /** null: đơn Tubu giao có hàng của nơi khác — gian hàng chỉ thấy tiền các dòng của mình (`ownTotal`). */
  total: number | null;
  ownTotal?: number;
  /** Đơn chính gian hàng tự giao (xử lý ở tab Đơn cần giao). */
  selfFulfilled?: boolean;
  /** Đơn còn dòng hàng của nơi khác, đã ẩn. */
  partial?: boolean;
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
  /** Khách đã che (CTV/đại lý). Gian hàng đối tác không nhận trường này: người nhận ở `shippingAddress` của tab Đơn cần giao. */
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

/** "Tạm nghỉ": hàng tự giao của gian hàng tạm không đặt được (khác ẩn trang gian hàng). */
export const pauseMerchantOrders = (paused: boolean) =>
  apiFetch<MerchantStore>('/merchant/store/pause', { method: 'POST', body: { paused } });


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
  /**
   * '' = cả đơn; 'RETURN:<id>' = dòng đảo của một lần khách trả một phần (mỗi đơn có thể có nhiều). Hàng "Tubu giao hộ":
   * 'ITEM:<dòng hàng>' và 'RETURN:<id>:ITEM:<dòng hàng>'.
   */
  refKey?: string;
  goodsAmount: number;
  shippingFee: number;
  commissionAmount: number;
  /** Phí Tubu giao hộ của dòng hàng giao hộ (0 với đơn tự giao). API cũ chưa trả. */
  opsFeeAmount?: number;
  codCollected: number;
  netAmount: number;
  deliveredAt: string | null;
  /** Dòng hàng "Tubu giao hộ"; null/thiếu = đơn gian hàng tự giao. */
  orderItemId?: string | null;
  /** `quantity` là số lượng của cả dòng hàng; dòng đảo dùng `units` cho số đơn vị trả. */
  item?: { productName: string; variationName: string | null; quantity: number } | null;
  /** Dòng đảo của hàng giao hộ: số đơn vị trả lại. null/thiếu ở dòng khác và dòng đảo lập trước khi có cột này. */
  units?: number | null;
}

/** Mức phí áp cho hàng "Tubu giao hộ": phần trăm là phân số (0.1 = 10%), phí cố định tính mỗi đơn. */
export interface ConsignmentTerms {
  commissionPct: number;
  feePct: number;
  feeFixed: number;
}

export interface MerchantPayout {
  id: string;
  storefrontId: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  /** TO_TUBU: phiếu âm, đối tác nộp lại Tubu. API cũ chưa trả: suy từ dấu của amount. */
  direction?: 'TO_MERCHANT' | 'TO_TUBU';
  /** Nội dung chuyển khoản khi nộp phiếu âm. */
  transferMemo?: string;
  /** Hạn nộp phiếu âm chưa thu. */
  dueAt?: string | null;
  bankInfo?: { bankName?: string | null; accountNo?: string | null; accountName?: string | null } | null;
  createdAt: string;
  paidAt?: string | null;
  bankRef?: string | null;
  note?: string | null;
  /** Phiếu đã huỷ: lúc huỷ, lý do gửi cho gian hàng, số khoản và số đơn lúc huỷ (`lines` là ảnh chụp các khoản đó). */
  cancelledAt?: string | null;
  cancelReason?: string | null;
  cancelledLineCount?: number | null;
  cancelledOrderCount?: number | null;
  /** Chỉ admin thấy. */
  cancelledBy?: string | null;
  lines: (SettlementLine & { id: string; createdAt?: string })[];
  storefront?: { id: string; title: string };
}

/** Món "Tubu giao hộ" đã bán nhưng không tự vào bảng kê — chỉ để đối chiếu. */
export interface ConsignmentExcludedLine {
  orderId: string;
  orderCode: string;
  orderItemId: string;
  productName: string;
  variationName: string | null;
  quantity: number;
  /** Tiền khách thực trả cho món. */
  goodsAmount: number;
  createdAt: string;
  deliveredAt: string | null;
  /**
   * BEFORE_SETTLE_FROM: đặt trước mốc đối soát tự động; TAKEOVER_UNCONFIRMED: biến thể nhận lại chưa xác nhận hàng ký gửi lúc đặt;
   * TAKEOVER_BEFORE_CONFIRM: đã xác nhận nhưng đơn đặt trước lúc xác nhận (`confirmedAt`) nên không bao giờ tự vào phiếu.
   * API cũ chỉ trả hai lý do đầu.
   */
  reason: 'BEFORE_SETTLE_FROM' | 'TAKEOVER_UNCONFIRMED' | 'TAKEOVER_BEFORE_CONFIRM';
  /** Lúc admin xác nhận hàng ký gửi của liên kết (chỉ có với TAKEOVER_BEFORE_CONFIRM). */
  confirmedAt?: string | null;
  /** Liên kết của món lúc đặt vẫn đang chờ admin xác nhận hàng ký gửi (còn việc để xác nhận); false = đã xác nhận sau lúc đặt hoặc đã gỡ. Thiếu ở API cũ. */
  linkPending?: boolean;
}

export interface ConsignmentExcluded {
  /** Mốc bắt đầu đối soát tự động; null = không giới hạn. */
  settleFrom: string | null;
  /** Tổng số món (danh sách chỉ trả tối đa 200 món mới nhất). */
  total: number;
  lines: ConsignmentExcludedLine[];
}

export interface MerchantStatement {
  holdDays: number;
  lines: SettlementLine[];
  total: number;
  upcoming: (SettlementLine & { availableAt: string | null })[];
  /** null/thiếu = gian hàng chưa có hàng "Tubu giao hộ". */
  consignmentTerms?: ConsignmentTerms | null;
  /** Thiếu ở API cũ. */
  consignmentExcluded?: ConsignmentExcluded | null;
}

export interface MerchantSettlement extends MerchantStatement {
  payouts: MerchantPayout[];
  /** Tài khoản Tubu nhận tiền nộp lại của phiếu âm. */
  tubuAccount?: { bankName: string; accountNo: string; accountName: string } | null;
  negativeDueDays?: number;
}

// ── Hàng khách trả về gian hàng (đơn tự giao) ──

export interface MerchantReturn {
  id: string;
  status: 'REQUESTED' | 'APPROVED';
  createdAt: string;
  reviewedAt: string | null;
  receivedAt: string | null;
  reasonLabel: string | null;
  reason: string;
  fullReturn: boolean;
  shopFault: boolean | null;
  orderCode: string;
  lines: { productName: string; variationName: string | null; quantity: number }[];
  /** Ảnh khách gửi kèm yêu cầu. API cũ chưa trả. */
  images?: string[];
}

export const listMerchantReturns = () => apiFetch<MerchantReturn[]>('/merchant/returns');
/** Gian hàng đã nhận hàng khách trả: BE cộng lại tồn kho sản phẩm của gian hàng (một lần mỗi yêu cầu). */
export const markMerchantReturnReceived = (id: string) =>
  apiFetch<unknown>(`/merchant/returns/${encodeURIComponent(id)}/received`, { method: 'POST', body: {} });

export const getMerchantSettlement = () => apiFetch<MerchantSettlement>('/merchant/settlement');

// ── Admin: giám sát đơn đối tác tự giao + đối soát ──

export interface MerchantFulfilmentOverview {
  slaConfig: SlaConfig;
  /** merchant.commission_pct — phí sàn của gian hàng không đặt mức riêng. */
  defaultCommissionPct?: number;
  stores: {
    storefrontId: string;
    title: string;
    /** Loại gian hàng: chỉ CTV mới bật/tắt được cờ đối tác. */
    type?: 'CTV' | 'MERCHANT' | 'BRAND';
    isPartner?: boolean;
    owner: { fullName: string | null; phone: string | null } | null;
    activeOrders: number;
    overdueOrders: number;
    settleableLines: number;
    settleableAmount: number;
    /** Trong số khoản chờ đối soát, số khoản là hàng "Tubu giao hộ". */
    consignmentLines?: number;
    /** Phí sàn riêng (phân số); null = mức mặc định. */
    commissionPct?: number | null;
    consignmentFeePct?: number;
    consignmentFeeFixed?: number;
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

/** Admin sửa phí sàn riêng (null = mặc định) và phí "Tubu giao hộ" của gian hàng; phần trăm gửi dạng phân số. */
export const updateAdminMerchantStoreTerms = (
  storefrontId: string,
  body: { commissionPct?: number | null; consignmentFeePct?: number; consignmentFeeFixed?: number },
) =>
  apiFetch<unknown>(`/admin/merchant-fulfilment/stores/${encodeURIComponent(storefrontId)}/terms`, { method: 'PATCH', body });

/** `status: 'PENDING'`: chỉ phiếu chờ chuyển cho đối tác hoặc chờ đối tác nộp lại. */
export const listAdminMerchantPayouts = (page = 1, limit = MERCHANT_PAGE_SIZE, status?: 'PENDING') =>
  apiFetch<Page<MerchantPayout>>(`/admin/merchant-fulfilment/payouts?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`);

/** `expectedTotal`: tổng bảng kê admin đang xem — server tính lại khác số này thì từ chối (409) để admin xem lại. */
export const createAdminMerchantPayout = (storefrontId: string, expectedTotal: number, note?: string) =>
  apiFetch<MerchantPayout>('/admin/merchant-fulfilment/payouts', { method: 'POST', body: { storefrontId, note, expectedTotal } });

export const markAdminMerchantPayoutPaid = (id: string, bankRef: string) =>
  apiFetch<MerchantPayout>(`/admin/merchant-fulfilment/payouts/${encodeURIComponent(id)}/paid`, {
    method: 'POST',
    body: { bankRef },
  });

/** `reason`: gửi nguyên văn cho gian hàng (bắt buộc); các khoản của phiếu quay lại bảng kê để lập phiếu mới. */
export const cancelAdminMerchantPayout = (id: string, reason: string) =>
  apiFetch<MerchantPayout>(`/admin/merchant-fulfilment/payouts/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason } });

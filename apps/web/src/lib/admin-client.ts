'use client';

import { apiDownload, apiFetch } from './client-api';
import type { GomdonAlertView } from './recycling';

export interface DealerApp {
  id: string;
  businessName: string;
  ownerName: string;
  phone: string;
  address: string;
  taxCode: string | null;
  cccdFrontUrl: string;
  cccdBackUrl: string;
  status: string;
  createdAt: string;
}
export interface AdminUser {
  id: string;
  fullName: string | null;
  phone: string | null;
  role: string;
  /** Điểm Xanh lô thường (có hạn). Tổng khách thấy = pointsBalance + pointsConvertedBalance. */
  pointsBalance: number;
  /** Lô quy đổi từ xu cũ (không hết hạn). API cũ chưa trả → coi như 0. */
  pointsConvertedBalance?: number;
  createdAt: string;
  isBlocked?: boolean;
  blockedAt?: string | null;
  blockedReason?: string | null;
}
/** Khớp model OrderItem của API (snapshot tên SP/biến thể + đơn giá lúc mua). */
export interface AdminOrderItem {
  id: string;
  // Tên field khớp đúng OrderItem thật (Prisma) — trước đây field đặt tên sai
  // (productTitle/variationTitle/sku/price không tồn tại trên OrderItem) khiến panel chi tiết
  // đơn ở admin luôn hiện "undefined" cho tên SP/biến thể/giá, chỉ số lượng+tổng còn đúng vì
  // trùng tên field tình cờ.
  productName: string;
  variationName?: string | null;
  unitPrice: number;
  quantity: number;
  total: number;
  /** Số lượng đang đặt trước (đơn đại lý vượt tồn) — 0 với đơn khác. */
  backorderedQty?: number;
}
/** Ảnh chụp địa chỉ giao lúc đặt (Order.shippingAddress). Mọi trường có thể thiếu với đơn cũ / đơn tạo tay. */
export interface AdminShippingAddress {
  recipient?: string;
  phone?: string;
  street?: string;
  ward?: string;
  district?: string;
  province?: string;
}
/** Yêu cầu xuất hoá đơn VAT khách gửi lúc thanh toán (Order.invoiceRequest). */
export interface AdminInvoiceRequest {
  taxCode?: string;
  companyName?: string;
  address?: string;
  email?: string;
}
export type AdminInvoiceStatus = 'NOT_REQUESTED' | 'REQUESTED' | 'ISSUED' | 'FAILED';
export interface AdminOrder {
  id: string;
  code: string;
  status: string;
  /** RETAIL | DEALER (cột Order.type — listOrders trả nguyên dòng). */
  type?: string;
  /**
   * Chỉ có trên đơn DEALER: true = "Ghi công nợ" (có dòng ghi nợ trong sổ công nợ đại lý), false = trả
   * trước (chờ chuyển khoản). Xem AdminService.listOrders.
   */
  dealerOnCredit?: boolean;
  total: number;
  paymentMethod: string;
  paymentStatus?: string;
  shippingFee?: number;
  discountTotal?: number;
  /** Điểm Xanh khách đã dùng cho đơn — trả lại khi huỷ. */
  pointsUsed?: number;
  /** true = CTV lên đơn hộ khách cuối: tiền huỷ/trả hoàn cho khách cuối, không hoàn cho CTV (OrderReversalService.refundEndCustomer). */
  placedForCustomer?: boolean;
  /** CTV được ghi công / gian hàng giới thiệu — có thì chi tiết đơn tải khối "Giới thiệu & hoa hồng". */
  referrerUserId?: string | null;
  storefrontId?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt?: string;
  shippingAddress?: AdminShippingAddress | null;
  invoiceRequest?: AdminInvoiceRequest | null;
  invoiceStatus?: AdminInvoiceStatus | null;
  invoiceUrl?: string | null;
  shippingPartner?: string | null;
  shippingCode?: string | null;
  shippingStatus?: string | null;
  /** Thu gom vật liệu tái chế (vận đơn đổi hàng Gomdon/BestExpress) — xem lib/recycling.ts. */
  hasRecyclingPickup?: boolean;
  recyclingNote?: string | null;
  gomdonOrderId?: string | null;
  /** Mã vận đơn BestExpress. */
  gomdonPartnerCode?: string | null;
  /** Mã Gomdon "1".."12" hoặc trạng thái nội bộ (AWAITING_PAYMENT/CREATING/NEEDS_MANUAL_CHECK/FAILED/NOT_CONFIGURED). */
  gomdonStatus?: string | null;
  gomdonStatusAt?: string | null;
  /** CANCELLED | FAILED | TOO_LATE | NOT_NEEDED | MANUAL_HANDLED — kết quả huỷ vận đơn khi đơn bị huỷ. */
  gomdonCancelStatus?: string | null;
  /** Lý do đơn nằm trong hàng đợi "Cần xử lý Pancake" (webhook mâu thuẫn / bị chặn); null = không cần xử lý. */
  pancakeAttention?: string | null;
  pancakeAttentionAt?: string | null;
  /** Mã đơn bên kho Pancake; null = chưa lên kho. */
  pancakeOrderId?: string | null;
  /** WAITING_PAYMENT | WAITING_STOCK | PENDING | PUSHING | SYNCED | FAILED | NOT_CONFIGURED | SKIPPED | STALE (PancakeOrderService). */
  pancakePushStatus?: string | null;
  /** Lỗi gần nhất khi đẩy / cập nhật / huỷ đơn bên Pancake. */
  pancakeSyncError?: string | null;
  pancakePushAttempts?: number;
  pancakeLastAttemptAt?: string | null;
  /** PENDING | CANCELLED | NOT_FOUND | TOO_LATE | FAILED — kết quả huỷ bên Pancake khi đơn bị huỷ. */
  pancakeCancelStatus?: string | null;
  /** Báo động Gomdon chưa xử lý (mới nhất trước, tối đa 10). */
  gomdonAlerts?: GomdonAlertView[];
  deliveredAt?: string | null;
  /** Mốc việc sau giao (cộng Điểm Xanh, khoá hoa hồng CTV, thưởng giới thiệu) đã xong; null trên đơn DELIVERED = chưa xong. */
  deliveredEffectsAt?: string | null;
  user?: {
    id: string;
    phone: string | null;
    fullName: string | null;
  } | null;
  items?: AdminOrderItem[];
  /** Trạng thái API sẽ nhận ngay lúc này (AdminService.listOrders, cùng luật OrderStatusService.setStatus). */
  allowedTransitions?: string[];
  /** true = đơn lẻ chuyển khoản còn UNPAID, chưa huỷ/trả → nút "Đã nhận tiền". */
  canConfirmPayment?: boolean;
  /** true = đơn lẻ chuyển khoản đã huỷ/trả, chưa ghi nhận tiền → nút "Ghi nhận tiền về muộn" (khoản hoàn vào hàng đợi, D2). */
  canRecordLatePayment?: boolean;
  /** TUBU = kho Tubu (qua Pancake); MERCHANT = gian hàng đối tác tự giao, không bao giờ lên Pancake. */
  fulfiller?: 'TUBU' | 'MERCHANT' | string;
  fulfillerStorefront?: { title: string } | null;
  /** Khoản hoàn của đơn, cũ nhất trước (trừ khoản đã bỏ qua) — "Đang hoàn tiền" khi khoản chuyển khoản còn Chờ/Đang chuyển. */
  customerRefunds?: AdminOrderRefund[];
}

/** Khoản hoàn ở danh sách đơn admin (AdminService ORDER_LIST_REFUNDS): không kèm tài khoản ngân hàng của khách. */
export interface AdminOrderRefund {
  id: string;
  kind: AdminCustomerRefundKind;
  method: AdminCustomerRefundMethod;
  status: AdminCustomerRefundStatus;
  amount: number;
  createdAt: string;
  completedAt: string | null;
}
export interface DashboardStats {
  /** Tiền đã thu: đơn đã thanh toán hoặc COD đã giao (không gồm đơn đại lý ghi công nợ), trừ đơn huỷ/trả và phần đã hoàn khi trả một phần. */
  totalRevenue: number;
  /** Giá trị đơn còn hiệu lực (gồm COD chưa thu) — API cũ chưa trả thì vắng. */
  gmv?: number;
  /** COD đang giao/chờ giao chưa thu tiền. */
  codPendingValue?: number;
  returnedOrders?: number;
  pendingReturns?: number;
  /** Tổng tiền đã hoàn cho các yêu cầu trả hàng đã duyệt. */
  returnRefundTotal?: number;
  /** Tổng dư nợ đại lý (đơn ghi công nợ chưa trả qua sổ công nợ) — không nằm trong doanh thu đã thu. */
  dealerDebtOutstanding?: number;
  totalOrders: number;
  pendingOrders: number;
  shippingOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  totalUsers: number;
  totalAffiliates: number;
  totalProducts: number;
  plantedTreesCount: number;
  recentOrders: {
    id: string;
    code: string;
    total: number;
    status: string;
    paymentMethod: string;
    createdAt: string;
    user?: { fullName: string | null; phone: string | null } | null;
  }[];
}
export interface ConfigRow {
  key: string;
  value: unknown;
  description: string | null;
  category: string;
  /** true = khoá không code nào đọc (GET /admin/config gắn): sửa vô tác dụng, API từ chối ghi. */
  deprecated?: boolean;
}
export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

/**
 * Chuẩn hoá về `Page<T>`: API trả `{ data, meta }` (paginated()), BE cũ từng trả mảng trần. Trước đây
 * helper `unwrapList` chỉ lấy `data` và VỨT meta → tab Đổi/Trả (limit 20) và Đại lý (limit 100) cắt cụt
 * im lặng, không ai biết còn hồ sơ cũ hơn — mà với hàng chờ, hồ sơ cũ nhất lại là hồ sơ quá hạn nhất.
 */
export function asPage<T>(res: T[] | Page<T> | null | undefined, page: number, limit: number): Page<T> {
  if (Array.isArray(res)) return { data: res, meta: { page, limit, total: res.length } };
  if (res && Array.isArray(res.data)) return { data: res.data, meta: res.meta ?? { page, limit, total: res.data.length } };
  return { data: [], meta: { page, limit, total: 0 } };
}

/** getNextPageParam cho useInfiniteQuery: còn dòng chưa tải → trang kế, hết → undefined. */
export function nextPageParam(meta: Page<unknown>['meta']): number | undefined {
  return meta.page * meta.limit < meta.total ? meta.page + 1 : undefined;
}

/**
 * Gộp các trang "Tải thêm" của một hàng đợi. Bỏ trùng theo id: sau khi duyệt 1 hồ sơ, refetch các trang
 * đã tải với offset lệch 1 dòng nên 1 hồ sơ có thể nằm ở 2 trang.
 *
 * `oldestFirst` (hàng CHỜ duyệt): xếp cũ nhất lên đầu — hồ sơ chờ lâu nhất cần xử lý trước. HẠN CHẾ: API
 * (admin.service listDealerApplications/listReturnRequests) chỉ xếp `createdAt desc` và không nhận tham số
 * thứ tự (DTO có forbidNonWhitelisted → gửi `order=` là 400), nên đây chỉ là sắp xếp TRONG phần đã tải; khi
 * `hasMore` thì hồ sơ cũ nhất thật sự vẫn còn ở các trang chưa tải — UI phải nói rõ điều đó.
 */
export function mergeQueuePages<T extends { id: string; createdAt: string }>(
  pages: Page<T>[] | undefined,
  oldestFirst: boolean,
): { items: T[]; total: number; hasMore: boolean; label: string } {
  if (!pages || pages.length === 0) return { items: [], total: 0, hasMore: false, label: 'Hiển thị 0/0' };
  const seen = new Set<string>();
  const items: T[] = [];
  for (const p of pages) {
    for (const row of p.data) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      items.push(row);
    }
  }
  if (oldestFirst) items.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const last = pages[pages.length - 1]!;
  const total = Math.max(last.meta.total, items.length);
  return { items, total, hasMore: nextPageParam(last.meta) !== undefined, label: `Hiển thị ${items.length}/${total}` };
}

/** Phân trang kiểu Trang trước / Trang sau (cổng đối tác): nhãn "Hiển thị 21–40/45" + trạng thái nút. */
export function pageRange(
  meta: { page: number; limit: number },
  total: number,
  shown: number,
): { label: string; totalPages: number; hasPrev: boolean; hasNext: boolean } {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, meta.limit)));
  const from = (meta.page - 1) * meta.limit + 1;
  const label = shown > 0 ? `Hiển thị ${from}–${from + shown - 1}/${total}` : `Hiển thị 0/${total}`;
  return { label, totalPages, hasPrev: meta.page > 1, hasNext: meta.page < totalPages };
}

/** Cỡ trang hàng đợi admin = @Max(100) của PaginationQuery (apps/api/src/common/pagination.ts). */
export const ADMIN_QUEUE_PAGE_SIZE = 100;

/** `order`: 'asc' cho hàng CHỜ duyệt (chờ lâu nhất lên đầu, đúng trên MỌI trang); bỏ trống = mới nhất trước. */
export type QueueOrder = 'asc' | 'desc';
const queueQuery = (page: number, limit: number, status?: string, order?: QueueOrder) =>
  `page=${page}&limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ''}${order ? `&order=${order}` : ''}`;

export const listDealerApps = (status?: string, page = 1, limit = ADMIN_QUEUE_PAGE_SIZE, order?: QueueOrder) =>
  apiFetch<DealerApp[] | Page<DealerApp>>(`/admin/dealer-applications?${queueQuery(page, limit, status, order)}`).then((res) =>
    asPage(res, page, limit),
  );
export const reviewDealerApp = (id: string, approve: boolean, tierId?: string, reason?: string) =>
  apiFetch(`/admin/dealer-applications/${id}/review`, { method: 'POST', body: { approve, tierId, reason } });

// ── Đổi / Trả (§6.4) ──
export interface AdminReturnLine {
  orderItemId: string;
  quantity: number;
  /** Tiền hàng hoàn của dòng (chốt khi duyệt; 0 khi chưa duyệt). */
  refundAmount: number;
  productName: string | null;
  variationName: string | null;
  orderedQuantity: number | null;
}
export interface AdminReturnRequest {
  id: string;
  orderId: string;
  userId: string;
  reason: string;
  /** Mã lý do khách chọn (DEFECTIVE/WRONG_ITEM/...) và nhãn tiếng Việt; null ở yêu cầu cũ. */
  reasonCode?: string | null;
  reasonLabel?: string | null;
  images: string[];
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  refundMethod: string;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountName?: string | null;
  shopFault?: boolean | null;
  fullReturn?: boolean;
  refundAmount?: number | null;
  shippingRefund?: number;
  pointsRefunded?: number;
  receivedAt?: string | null;
  items?: AdminReturnLine[];
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  order?: {
    id: string;
    code: string;
    total: number;
    status: string;
    paymentMethod: string;
    pancakeOrderId?: string | null;
    placedForCustomer?: boolean;
    /** MERCHANT = gian hàng đối tác tự giao: hàng trả về gian hàng, gian hàng xác nhận nhận hàng (không về kho Tubu). */
    fulfiller?: string;
    fulfillerStorefront?: { title: string } | null;
  } | null;
  user?: {
    id: string;
    fullName: string | null;
    phone: string | null;
  } | null;  /** Khoản hoàn thật của yêu cầu (khoản RETURN): khách có thể đã đổi ngân hàng → Ví, Tubu có thể chưa chuyển. */
  refund?: {
    method: 'WALLET' | 'MANUAL_TRANSFER';
    status: AdminCustomerRefundStatus;
    amount: number;
    bankName: string | null;
    bankAccountNo: string | null;
  } | null;
}
export const listReturnRequests = (status?: string, page = 1, limit = ADMIN_QUEUE_PAGE_SIZE, order?: QueueOrder) =>
  apiFetch<AdminReturnRequest[] | Page<AdminReturnRequest>>(`/admin/return-requests?${queueQuery(page, limit, status, order)}`).then(
    (res) => asPage(res, page, limit),
  );
/** Số tiền/điểm sẽ hoàn nếu duyệt ngay (BE tính, không ghi gì) — bước xác nhận của admin (D3). */
export interface AdminReturnPreview {
  requestId: string;
  shopFault: boolean;
  defaultShopFault: boolean;
  isFull: boolean;
  goods: number;
  shipping: number;
  refund: number;
  moneyRefundable: boolean;
  destination: {
    method: 'WALLET' | 'BANK' | 'END_CUSTOMER';
    bankName?: string | null;
    accountNumber?: string | null;
    accountName?: string | null;
  };
  pointsUsedBack: number;
  pointsEarnedBack: number;
  lines: { orderItemId: string; productName: string; variationName: string; quantity: number; orderedQuantity: number; refundAmount: number }[];
  pancakeTask: boolean;
  /** Hàng trả về kho Tubu hay về gian hàng đối tác tự giao. */
  returnTo?: { kind: 'TUBU' | 'MERCHANT'; name: string };
}
export const previewReturnRequest = (id: string, shopFault?: boolean) =>
  apiFetch<AdminReturnPreview>(
    `/admin/return-requests/${encodeURIComponent(id)}/preview${shopFault === undefined ? '' : `?shopFault=${shopFault}`}`,
  );
/** Duyệt gửi kèm số tiền admin đã thấy: BE tính lại khác số này (yêu cầu khác vừa duyệt) thì từ chối 409 để xem lại. */
export const reviewReturnRequest = (
  id: string,
  approve: boolean,
  note?: string,
  opts: { shopFault?: boolean; expectedRefund?: number } = {},
) =>
  apiFetch<AdminReturnRequest>(`/admin/return-requests/${encodeURIComponent(id)}/review`, {
    method: 'POST',
    body: { approve, note, ...opts },
  });
/** Hàng trả đã về kho: lúc này BE mới cộng lại tồn kho các dòng trả. */
export const markReturnReceived = (id: string) =>
  apiFetch<AdminReturnRequest>(`/admin/return-requests/${encodeURIComponent(id)}/received`, { method: 'POST', body: {} });

// ── Nhập giá đại lý B2B & số lượng bán ngoài ──
export type DealerPriceImportStatus = 'OK' | 'UNCHANGED' | 'NOT_FOUND' | 'INVALID' | 'OUT_OF_RANGE' | 'DUPLICATE';
export interface DealerPricePreview {
  tierId: string;
  rows: {
    line: number;
    sku: string;
    input: string;
    status: DealerPriceImportStatus;
    price: number | null;
    currentPrice: number | null;
    retailPrice: number | null;
    productName: string | null;
    variationName: string | null;
    message: string | null;
  }[];
  counts: Record<DealerPriceImportStatus, number>;
  blocking: number;
  canApply: boolean;
}
/** Xem trước bảng giá sỉ: BE đọc số tiền kiểu Việt Nam (185.000, 240,000) và kiểm khoảng 10–100% giá lẻ, không ghi gì. */
export const previewDealerPrices = (tierId: string, csv: string) =>
  apiFetch<DealerPricePreview>('/admin/dealer-prices/import/preview', { method: 'POST', body: { tierId, csv } });
/** Còn dòng lỗi thì BE trả 400 và không ghi dòng nào; `skipped` = dòng không đổi + SKU không khớp. */
export const importDealerPrices = (tierId: string, csv: string) =>
  apiFetch<{ updated: number; unchanged: number; skipped: number; notFound: string[] }>('/admin/dealer-prices/import', {
    method: 'POST',
    body: { tierId, csv },
  });
export const importSoldExternal = (csv: string) =>
  apiFetch<{ ok: boolean; updatedCount: number }>('/admin/products/sold-external', {
    method: 'POST',
    body: { csv },
  });

/** search: SĐT (chứa), tên (không phân biệt hoa thường) hoặc đúng id. */
export const listUsers = (page = 1, search?: string) => {
  const q = new URLSearchParams({ page: String(page), limit: '20' });
  if (search?.trim()) q.set('search', search.trim());
  return apiFetch<Page<AdminUser>>(`/admin/users?${q.toString()}`);
};
type BlockState = { id: string; isBlocked: boolean; blockedAt: string | null; blockedReason: string | null };
/** Khoá ngay: thu hồi mọi phiên đăng nhập, access token đang có bị từ chối trong vài giây. */
export const blockUser = (id: string, reason: string) =>
  apiFetch<BlockState & { revokedSessions: number }>(`/admin/users/${encodeURIComponent(id)}/block`, {
    method: 'POST',
    body: { reason },
  });
export const unblockUser = (id: string) =>
  apiFetch<BlockState>(`/admin/users/${encodeURIComponent(id)}/unblock`, { method: 'POST', body: {} });
export type UserRole = 'CUSTOMER' | 'AFFILIATE' | 'DEALER' | 'STAFF' | 'ADMIN';
/** tierId bắt buộc khi role = DEALER (BE từ chối nếu thiếu/không tồn tại — C-008); role khác không gửi. */
export const setUserRole = (phone: string, role: UserRole, tierId?: string) => {
  const tier = role === 'DEALER' ? tierId?.trim() : undefined;
  return apiFetch<{ ok: boolean; id: string; phone: string | null; fullName: string | null; role: string; previousRole: string }>(
    '/admin/users/role',
    { method: 'POST', body: { phone, role, ...(tier ? { tierId: tier } : {}) } },
  );
};
export const getDashboardStats = () =>
  apiFetch<DashboardStats>('/admin/dashboard/stats');
/** attention = hàng đợi "Cần xử lý thu gom"; all = mọi đơn có chọn thu gom tái chế. */
export type RecyclingFilter = 'attention' | 'all';
/** pending = đơn VAT chưa xuất xong (REQUESTED/FAILED); issued = đã phát hành; all = mọi đơn có yêu cầu VAT. */
export type InvoiceFilter = 'pending' | 'issued' | 'all';
/** attention = hàng đợi "Cần xử lý Pancake"; unsynced = đơn còn trong kho mà chưa lên Pancake. */
export type PancakeFilter = 'attention' | 'unsynced';
export const listOrders = (
  page = 1,
  status?: string,
  search?: string,
  recycling?: RecyclingFilter,
  limit = 20,
  invoice?: InvoiceFilter,
  pancake?: PancakeFilter,
  from?: string,
  to?: string,
) =>
  apiFetch<Page<AdminOrder>>(
    `/admin/orders?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}${
      recycling ? `&recycling=${recycling}` : ''
    }${invoice ? `&invoice=${invoice}` : ''}${pancake ? `&pancake=${pancake}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`,
  );
/** Số đơn VAT chưa xuất xong (đọc meta.total, không tải danh sách). */
export const countInvoicePending = () =>
  listOrders(1, undefined, undefined, undefined, 1, 'pending').then((r) => r.meta.total);

// ── Hoá đơn VAT: ghi nhận đã xuất ──
/** Trùng @MaxLength(500) của IssueInvoiceDto. */
export const INVOICE_URL_MAX = 500;
export interface IssueInvoiceResult {
  ok: boolean;
  message: string;
  order: { id: string; code: string; invoiceStatus: AdminInvoiceStatus; invoiceUrl: string | null };
}
/** POST /admin/orders/:id/issue-invoice — link tuỳ chọn (chỉ gửi khi có), BE chỉ nhận https. Lỗi 400 hiện NGUYÊN VĂN. */
export const issueOrderInvoice = (orderId: string, invoiceUrl?: string) =>
  apiFetch<IssueInvoiceResult>(`/admin/orders/${encodeURIComponent(orderId)}/issue-invoice`, {
    method: 'POST',
    body: invoiceUrl?.trim() ? { invoiceUrl: invoiceUrl.trim() } : {},
  });

// ── Lịch sử đổi trạng thái đơn ──
export interface AdminOrderStatusHistoryRow {
  id: string;
  fromStatus: string;
  toStatus: string;
  /** ADMIN | CUSTOMER | MERCHANT | PANCAKE | SYSTEM */
  actorType: string;
  actorId: string | null;
  note: string | null;
  createdAt: string;
  actor: { id: string; fullName: string | null; phone: string | null } | null;
}
export const getOrderStatusHistory = (orderId: string) =>
  apiFetch<{ orderCode: string; history: AdminOrderStatusHistoryRow[] }>(
    `/admin/orders/${encodeURIComponent(orderId)}/status-history`,
  );
/** Số đơn trong hàng đợi "Cần xử lý thu gom" (đọc meta.total, không tải danh sách). */
export const countRecyclingAttention = () =>
  listOrders(1, undefined, undefined, 'attention', 1).then((r) => r.meta.total);

/** Số đơn trong hàng đợi "Cần xử lý Pancake" (đọc meta.total, không tải danh sách). */
export const countPancakeAttention = () =>
  listOrders(1, undefined, undefined, undefined, 1, undefined, 'attention').then((r) => r.meta.total);
/** Trùng @MaxLength(500) của ResolvePancakeAttentionDto. */
export const PANCAKE_RESOLVE_NOTE_MAX = 500;
/** POST /admin/orders/:id/pancake-attention/resolve — đơn rời hàng đợi "Cần xử lý Pancake". Ghi chú rỗng → body {}. */
export const resolvePancakeAttention = (orderId: string, note: string) => {
  const trimmed = note.trim().slice(0, PANCAKE_RESOLVE_NOTE_MAX);
  return apiFetch<{ ok: boolean; message: string }>(
    `/admin/orders/${encodeURIComponent(orderId)}/pancake-attention/resolve`,
    { method: 'POST', body: trimmed ? { note: trimmed } : {} },
  );
};

/** POST /admin/pancake/orders/:id/push — "Đẩy lại Pancake" cho đơn chưa lên kho (API tự chặn đơn huỷ/đã rời kho). */
export const retryPancakePush = (orderId: string) =>
  apiFetch<{ ok: boolean; message: string }>(`/admin/pancake/orders/${encodeURIComponent(orderId)}/push`, { method: 'POST' });

// ── Vận đơn thu gom Gomdon (thao tác admin) ──
export interface GomdonActionResult {
  message: string;
  queued?: boolean;
  result?: 'QUEUED' | 'CANCELLED';
}
export const retryGomdon = (orderId: string, confirmedNoWaybill: boolean) =>
  apiFetch<GomdonActionResult>(`/admin/orders/${encodeURIComponent(orderId)}/gomdon/retry`, {
    method: 'POST',
    // Chỉ gửi khi đã tick xác nhận — body rỗng cho FAILED/NOT_CONFIGURED.
    body: confirmedNoWaybill ? { confirmedNoWaybill: true } : {},
  });
export const cancelGomdonWaybill = (orderId: string) =>
  apiFetch<GomdonActionResult>(`/admin/orders/${encodeURIComponent(orderId)}/gomdon/cancel-waybill`, { method: 'POST' });
/** Giới hạn ghi chú "Đã xử lý tay" — trùng @MaxLength(500) của GomdonMarkHandledDto. */
export const GOMDON_HANDLED_NOTE_MAX = 500;
/** POST /admin/orders/:id/gomdon/mark-handled — "Đã xử lý tay" (gomdonStatus → MANUAL_HANDLED). Ghi chú rỗng → body {}. */
export const markGomdonHandled = (orderId: string, note: string) => {
  const trimmed = note.trim().slice(0, GOMDON_HANDLED_NOTE_MAX);
  return apiFetch<{ result: 'MANUAL_HANDLED'; message: string }>(
    `/admin/orders/${encodeURIComponent(orderId)}/gomdon/mark-handled`,
    { method: 'POST', body: trimmed ? { note: trimmed } : {} },
  );
};

// ── Đơn đại lý trả trước: xác nhận đã nhận chuyển khoản ──
/** Trùng @MaxLength của ConfirmDealerPaymentDto (bankRef 100, note 500). */
export const DEALER_BANK_REF_MAX = 100;
export const DEALER_PAYMENT_NOTE_MAX = 500;
export interface ConfirmDealerPaymentResult {
  ok: boolean;
  /** true = đơn đã PAID từ trước (webhook/admin khác) — không ghi gì thêm. */
  alreadyPaid: boolean;
  /** true = đơn lẻ đã huỷ/trả: tiền về muộn đã được ghi thành khoản hoàn trong hàng đợi Hoàn tiền khách. */
  latePayment?: boolean;
  message: string;
  order: { id: string; code: string; status: string; paymentStatus: string };
}
/**
 * POST /admin/dealer-orders/:id/confirm-payment — UNPAID → PAID (PENDING_PAYMENT → CONFIRMED). Chỉ gửi
 * trường có nội dung (DTO forbidNonWhitelisted, MaxLength). Luật (chỉ DEALER trả trước, không công nợ,
 * không huỷ/trả) nằm ở DealerService.confirmDealerOrderPayment — lỗi 400 hiện NGUYÊN VĂN.
 */
export const confirmDealerOrderPayment = (orderId: string, input: { bankRef?: string; note?: string } = {}) => {
  const bankRef = input.bankRef?.trim().slice(0, DEALER_BANK_REF_MAX);
  const note = input.note?.trim().slice(0, DEALER_PAYMENT_NOTE_MAX);
  return apiFetch<ConfirmDealerPaymentResult>(`/admin/dealer-orders/${encodeURIComponent(orderId)}/confirm-payment`, {
    method: 'POST',
    body: { ...(bankRef ? { bankRef } : {}), ...(note ? { note } : {}) },
  });
};

/**
 * POST /admin/orders/:id/confirm-payment — "Đã nhận tiền" cho đơn lẻ chuyển khoản (C-024): UNPAID → PAID
 * (PENDING_PAYMENT → CONFIRMED), idempotent; luật nằm ở AdminService.confirmOrderPayment, lỗi 400 hiện nguyên văn.
 */
export const confirmOrderPayment = (orderId: string, input: { bankRef?: string; note?: string; amount?: number } = {}) => {
  const bankRef = input.bankRef?.trim().slice(0, DEALER_BANK_REF_MAX);
  const note = input.note?.trim().slice(0, DEALER_PAYMENT_NOTE_MAX);
  return apiFetch<ConfirmDealerPaymentResult>(`/admin/orders/${encodeURIComponent(orderId)}/confirm-payment`, {
    method: 'POST',
    body: { ...(bankRef ? { bankRef } : {}), ...(note ? { note } : {}), ...(input.amount !== undefined ? { amount: input.amount } : {}) },
  });
};

export type ResyncDeliveredEffectsOutcome = 'DONE' | 'ALREADY_DONE' | 'INCOMPLETE';
export interface ResyncDeliveredEffectsResult {
  orderId: string;
  code: string;
  outcome: ResyncDeliveredEffectsOutcome;
  pointsCredited?: boolean;
  commissionsLocked?: number;
}
/** Chạy lại việc sau giao của đơn DELIVERED chưa có mốc deliveredEffectsAt (chỉ ADMIN, chạy lại an toàn). */
export const resyncDeliveredEffects = (orderId: string) =>
  apiFetch<ResyncDeliveredEffectsResult>(`/admin/orders/${encodeURIComponent(orderId)}/resync-delivered-effects`, { method: 'POST' });

/** Bật/tắt cờ đối tác của gian hàng CTV (chỉ ADMIN). Tắt bị 409 kèm câu liệt kê việc đang vướng. */
export const setStorefrontPartner = (storefrontId: string, isPartner: boolean) =>
  apiFetch<{ id: string; isPartner: boolean }>(`/admin/storefronts/${encodeURIComponent(storefrontId)}/partner`, {
    method: 'POST',
    body: { isPartner },
  });

// ── Công nợ đại lý (A5-09): "Báo đã CK" của đại lý giờ chỉ là thông báo, sổ công nợ CHỈ giảm khi
// ADMIN tự đối chiếu sao kê rồi xác nhận ở đây — xem DealerService.adminRecordCreditPayment. ──
export interface DealerCreditLedgerEntry {
  id: string;
  delta: number;
  refType: string;
  refId: string | null;
  note: string | null;
  createdAt: string;
}
export interface DealerCreditLedger {
  /** Dư nợ hiện tại = tổng delta (âm = đang nợ). */
  balance: number;
  entries: DealerCreditLedgerEntry[];
}
export const getDealerCreditLedger = (userId: string) =>
  apiFetch<DealerCreditLedger>(`/admin/dealers/${encodeURIComponent(userId)}/credit-ledger`);

export interface RecordDealerCreditPaymentResult {
  balance: number;
}
/**
 * POST /admin/dealers/:userId/credit-payment — GHI GIẢM sổ công nợ, trần theo dư nợ TẠI LÚC DUYỆT
 * (Serializable). `idempotencyKey` nên là mã giao dịch ngân hàng nếu có, tránh ghi trùng khi bấm lặp.
 */
export const recordDealerCreditPayment = (
  userId: string,
  input: { amount: number; bankRef?: string; note?: string },
  idempotencyKey?: string,
) => {
  const bankRef = input.bankRef?.trim().slice(0, DEALER_BANK_REF_MAX) || undefined;
  const note = input.note?.trim().slice(0, DEALER_PAYMENT_NOTE_MAX) || undefined;
  return apiFetch<RecordDealerCreditPaymentResult>(`/admin/dealers/${encodeURIComponent(userId)}/credit-payment`, {
    method: 'POST',
    body: { amount: input.amount, ...(bankRef ? { bankRef } : {}), ...(note ? { note } : {}) },
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  });
};
export interface GomdonIntegrationStatus {
  baseUrlSet: boolean;
  credentialsSet: boolean;
  configured: boolean;
  webhookSecretSet: boolean;
  recyclingToggle: boolean;
  recyclingEnabled: boolean;
  /** Lần gọi Gomdon gần nhất của API (từ lúc khởi động). Bản API cũ không có. */
  connection?: GomdonConnectionHealth;
}
export interface GomdonConnectionHealth {
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  /** Gomdon từ chối tài khoản → API tự ẩn lựa chọn thu gom ở checkout. */
  credentialsRejected: boolean;
  credentialsRejectedAt: string | null;
}
export const getGomdonStatus = () => apiFetch<GomdonIntegrationStatus>('/admin/gomdon/status');
export interface GomdonConnectionCheck {
  ok: boolean;
  message: string;
  checkedAt: string;
}
/** Đăng nhập Gomdon thật để kiểm tra tài khoản (không tạo đơn). */
export const checkGomdonConnection = () =>
  apiFetch<GomdonConnectionCheck>('/admin/gomdon/check-connection', { method: 'POST' });
/** Đánh dấu một báo động Gomdon đã xử lý. */
export const resolveGomdonAlert = (alertId: string) =>
  apiFetch<{ ok: true }>(`/admin/gomdon/alerts/${encodeURIComponent(alertId)}/resolve`, { method: 'POST' });
export const updateOrderStatus = (id: string, status: string, note?: string) =>
  apiFetch<AdminOrder>(`/admin/orders/${id}/status`, {
    method: 'PUT',
    body: { status, note },
  });
export const getConfig = (category?: string) =>
  apiFetch<ConfigRow[]>(`/admin/config${category ? `?category=${category}` : ''}`);
export const setConfig = (key: string, value: unknown) =>
  apiFetch<{ ok: boolean }>('/admin/config', { method: 'PUT', body: { key, value } });
export interface CreateCouponInput {
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder?: number;
  maxDiscount?: number;
  startAt: string;
  endAt: string;
  usageLimit?: number;
  perUserLimit?: number;
  scope: 'PUBLIC' | 'TIER' | 'USER_GROUP' | 'BIRTHDAY' | 'INVITE';
}
export const createCoupon = (input: CreateCouponInput) =>
  apiFetch('/admin/coupons', { method: 'POST', body: input });

export interface AdminCoupon {
  id: string;
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  startAt: string;
  endAt: string;
  usageLimit: number | null;
  perUserLimit: number;
  scope: string;
  isActive: boolean;
  /** Số lượt đã dùng (đếm theo đơn đã đặt bằng mã, đã trừ đơn huỷ/trả được hoàn mã). */
  redeemedCount: number;
}
export type CouponStatusFilter = '' | 'active' | 'inactive' | 'expired';
export async function listCoupons(params: { page: number; limit: number; q?: string; status?: CouponStatusFilter }) {
  const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.status) qs.set('status', params.status);
  return asPage(await apiFetch<AdminCoupon[] | Page<AdminCoupon>>(`/admin/coupons?${qs}`), params.page, params.limit);
}
export const updateCoupon = (id: string, patch: { isActive?: boolean; endAt?: string; usageLimit?: number | null }) =>
  apiFetch<AdminCoupon>(`/admin/coupons/${id}`, { method: 'PATCH', body: patch });

// ── Nhãn hàng (storefront Lớp 3) ──
export interface BrandCert {
  code: string;
  label: string;
  verified?: boolean;
  proofUrl?: string;
}
export interface AdminBrand {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  story: string | null;
  origin: string | null;
  certifications: BrandCert[] | null;
  isVerified: boolean;
  isPublished: boolean;
  followerCount: number;
}
export interface AdminBrandProduct {
  id: string;
  name: string;
  slug: string;
  thumbnail: string | null;
  brand: string;
  isActive: boolean;
}
export interface AdminPromotion {
  id: string;
  title: string;
  subtitle: string | null;
  startAt: string;
  endAt: string;
  isActive: boolean;
}
export interface AdminDealerReward {
  id: string;
  brandId: string | null;
  type: 'TOUR' | 'GIFT' | 'OTHER';
  title: string;
  description: string | null;
  threshold: number;
  period: string;
  isActive: boolean;
}

export const listBrands = () => apiFetch<AdminBrand[]>('/admin/brands');
export const createBrand = (body: { name: string; tagline?: string; isPublished?: boolean }) =>
  apiFetch<AdminBrand>('/admin/brands', { method: 'POST', body });
export const updateBrand = (
  id: string,
  body: Partial<{
    name: string;
    tagline: string;
    logoUrl: string;
    coverUrl: string;
    story: string;
    origin: string;
    certifications: BrandCert[];
    isPublished: boolean;
    ownerUserId: string;
  }>,
) => apiFetch<AdminBrand>(`/admin/brands/${id}`, { method: 'PATCH', body });
export const verifyBrand = (id: string, isVerified: boolean) =>
  apiFetch<AdminBrand>(`/admin/brands/${id}/verify`, { method: 'PATCH', body: { isVerified } });
export const listBrandProducts = (id: string) =>
  apiFetch<AdminBrandProduct[]>(`/admin/brands/${id}/products`);
export const linkBrandByName = (id: string) =>
  apiFetch<{ linked: number }>(`/admin/brands/${id}/link-by-name`, { method: 'POST' });
export const detachBrandProducts = (id: string, productIds: string[]) =>
  apiFetch<{ detached: number }>(`/admin/brands/${id}/products`, { method: 'DELETE', body: { productIds } });
export const listPromotions = (id: string) =>
  apiFetch<AdminPromotion[]>(`/admin/brands/${id}/promotions`);
export const createPromotion = (id: string, body: { title: string; subtitle?: string; startAt: string; endAt: string }) =>
  apiFetch<AdminPromotion>(`/admin/brands/${id}/promotions`, { method: 'POST', body });
export const deletePromotion = (id: string) =>
  apiFetch(`/admin/promotions/${id}`, { method: 'DELETE' });
export const listDealerRewards = () => apiFetch<AdminDealerReward[]>('/admin/dealer-rewards');
export const createDealerReward = (body: { brandId?: string; type: 'TOUR' | 'GIFT' | 'OTHER'; title: string; description?: string; threshold: number; period?: string }) =>
  apiFetch<AdminDealerReward>('/admin/dealer-rewards', { method: 'POST', body });
export const deleteDealerReward = (id: string) =>
  apiFetch(`/admin/dealer-rewards/${id}`, { method: 'DELETE' });

// ── Flash Sale ──
export interface AdminFlashSaleItem {
  id: string;
  variationId: string;
  flashPrice: number;
  quota: number;
  soldCount: number;
  perUserLimit: number;
}
export interface AdminFlashSale {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  isActive: boolean;
  items: AdminFlashSaleItem[];
}
export const listFlashSales = () => apiFetch<AdminFlashSale[]>('/admin/flash-sales');
export const createFlashSale = (body: { title: string; startAt: string; endAt: string }) =>
  apiFetch<AdminFlashSale>('/admin/flash-sales', { method: 'POST', body });
export const updateFlashSale = (id: string, body: Partial<{ title: string; startAt: string; endAt: string; isActive: boolean }>) =>
  apiFetch(`/admin/flash-sales/${id}`, { method: 'PATCH', body });
export const deleteFlashSale = (id: string) => apiFetch(`/admin/flash-sales/${id}`, { method: 'DELETE' });
export const addFlashSaleItem = (saleId: string, body: { variationId: string; flashPrice: number; quota: number; perUserLimit?: number }) =>
  apiFetch(`/admin/flash-sales/${saleId}/items`, { method: 'POST', body });
export const deleteFlashSaleItem = (itemId: string) =>
  apiFetch(`/admin/flash-sales/items/${itemId}`, { method: 'DELETE' });

// ── FAQ / câu trả lời nhanh (CSKH + nạp vào ngữ cảnh AI tư vấn) ──
export interface AdminFaq {
  id: string;
  category: string | null;
  question: string;
  answer: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
// ── Content Kit (bộ nội dung bán hàng cho CTV) ──
export interface ContentKitFaq {
  q: string;
  a: string;
}
export interface AdminContentKit {
  id: string;
  productId: string;
  captions: string[];
  usps: string[];
  faqs: ContentKitFaq[] | null;
  videoUrls: string[];
  updatedAt: string;
}
export const getContentKit = (productId: string) =>
  apiFetch<AdminContentKit | null>(`/admin/content-kits/${productId}`);
export const saveContentKit = (
  productId: string,
  body: { captions?: string[]; usps?: string[]; faqs?: ContentKitFaq[]; videoUrls?: string[] },
) => apiFetch<AdminContentKit>(`/admin/content-kits/${productId}`, { method: 'PUT', body });

export const listFaqs = () => apiFetch<AdminFaq[]>('/admin/faqs');
export const createFaq = (body: { category?: string; question: string; answer: string; sortOrder?: number; isActive?: boolean }) =>
  apiFetch<AdminFaq>('/admin/faqs', { method: 'POST', body });
export const updateFaq = (
  id: string,
  body: Partial<{ category: string; question: string; answer: string; sortOrder: number; isActive: boolean }>,
) => apiFetch<AdminFaq>(`/admin/faqs/${id}`, { method: 'PATCH', body });
export const deleteFaq = (id: string) => apiFetch<{ ok: boolean }>(`/admin/faqs/${id}`, { method: 'DELETE' });

// ── CTV Academy (khoá học/bài học đào tạo CTV) ──
export type AcademyLessonContentType = 'VIDEO' | 'ARTICLE';
export interface AdminLesson {
  id: string;
  courseId: string;
  title: string;
  contentType: AcademyLessonContentType;
  videoUrl: string | null;
  body: string | null;
  sortOrder: number;
}
export interface AdminCourse {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  sortOrder: number;
  isPublished: boolean;
  lessons: AdminLesson[];
}

export const listAcademyCourses = () => apiFetch<AdminCourse[]>('/admin/academy/courses');
export const createAcademyCourse = (body: {
  title: string;
  description?: string;
  coverUrl?: string;
  sortOrder?: number;
  isPublished?: boolean;
}) => apiFetch<AdminCourse>('/admin/academy/courses', { method: 'POST', body });
export const updateAcademyCourse = (
  id: string,
  body: Partial<{ title: string; description: string; coverUrl: string; sortOrder: number; isPublished: boolean }>,
) => apiFetch<AdminCourse>(`/admin/academy/courses/${id}`, { method: 'PATCH', body });
export const deleteAcademyCourse = (id: string) =>
  apiFetch<{ ok: boolean }>(`/admin/academy/courses/${id}`, { method: 'DELETE' });
export const addAcademyLesson = (
  courseId: string,
  input: { title: string; contentType: AcademyLessonContentType; videoUrl?: string; body?: string; sortOrder?: number },
) => apiFetch<AdminLesson>(`/admin/academy/courses/${courseId}/lessons`, { method: 'POST', body: input });
export const updateAcademyLesson = (
  id: string,
  input: Partial<{ title: string; contentType: AcademyLessonContentType; videoUrl: string; body: string; sortOrder: number }>,
) => apiFetch<AdminLesson>(`/admin/academy/lessons/${id}`, { method: 'PATCH', body: input });
export const deleteAcademyLesson = (id: string) =>
  apiFetch<{ ok: boolean }>(`/admin/academy/lessons/${id}`, { method: 'DELETE' });

// ── CSKH Quick-reply (mẫu tin nhanh + auto-reply Zalo OA) ──
export interface AdminQuickReply {
  id: string;
  category: string | null;
  keywords: string[];
  title: string;
  content: string;
  isGreeting: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const listQuickReplies = () => apiFetch<AdminQuickReply[]>('/admin/quick-replies');
export const createQuickReply = (body: {
  category?: string;
  keywords: string[];
  title: string;
  content: string;
  isGreeting?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}) => apiFetch<AdminQuickReply>('/admin/quick-replies', { method: 'POST', body });
export const updateQuickReply = (
  id: string,
  body: Partial<{
    category: string;
    keywords: string[];
    title: string;
    content: string;
    isGreeting: boolean;
    sortOrder: number;
    isActive: boolean;
  }>,
) => apiFetch<AdminQuickReply>(`/admin/quick-replies/${id}`, { method: 'PATCH', body });
export const deleteQuickReply = (id: string) =>
  apiFetch<{ ok: boolean }>(`/admin/quick-replies/${id}`, { method: 'DELETE' });

// ── Mẫu thông báo (kênh ZNS / trong app, mã mẫu ZNS Zalo đã duyệt) ──
/** Kênh gửi thật: ZNS chỉ gửi khi template là ZNS và có mã mẫu; còn lại khách chỉ thấy trong app. */
export type NotificationDelivery = 'ZNS' | 'ZNS_MISSING_TEMPLATE_ID' | 'INAPP';
export interface AdminNotificationTemplate {
  id: string;
  code: string;
  channel: string;
  zaloTemplateId: string | null;
  bodyTemplate: string;
  delivery: NotificationDelivery;
  sent30d: { INAPP: number; ZNS: number };
  /** Lượt ZNS bị Zalo từ chối/lỗi hẳn trong 30 ngày + lý do (mã + lời Zalo) của lần gần nhất. */
  znsFailed30d?: number;
  znsLastError?: { text: string; at: string } | null;
}
export const listNotificationTemplates = () => apiFetch<AdminNotificationTemplate[]>('/admin/notification-templates');
export const updateNotificationTemplate = (
  code: string,
  body: Partial<{ channel: 'INAPP' | 'ZNS'; zaloTemplateId: string | null; bodyTemplate: string }>,
) =>
  apiFetch<{ code: string }>(`/admin/notification-templates/${encodeURIComponent(code)}`, {
    method: 'PATCH',
    body,
  });

// ── Duyệt sản phẩm đăng bởi đối tác (Multi-tenancy Storefront) ──
export interface AdminPendingProduct {
  id: string;
  name: string;
  slug: string;
  basePrice: number;
  salePrice: number | null;
  thumbnail: string | null;
  brand: string;
  category: string;
  description: string | null;
  shortDesc?: string | null;
  ingredients: string | null;
  certifications: string[];
  ecoBadges: string[];
  approvalStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  rejectReason?: string | null;
  /** true: sản phẩm đang bán, dòng này mang nội dung bản sửa chờ duyệt (name/description/thumbnail là bản MỚI). */
  isEdit?: boolean;
  /** Lần sửa gần nhất của bản chờ mà dòng này đang hiện; gửi lại khi duyệt/từ chối để chỉ xử lý đúng bản admin đã xem. */
  editVersion?: string | null;
  /** Lần sửa gần nhất của sản phẩm chờ duyệt lần đầu; gửi lại khi duyệt/từ chối để API chặn nếu đối tác sửa tiếp. API cũ chưa trả. */
  updatedAt?: string;
  /** Nội dung đang bán để đối chiếu với bản sửa (null/thiếu: sản phẩm chờ duyệt lần đầu). */
  live?: { name: string; description: string; shortDesc: string | null; thumbnail: string | null } | null;
  /** Mã biến thể Pancake xin "Tubu giao hộ"; duyệt thì biến thể đó chuyển sang sản phẩm này. */
  pancakeLinkCode?: string | null;
  createdAt: string;
  storefront?: {
    id: string;
    title: string;
    subdomain: string | null;
    ownerUserId: string;
  } | null;
  variations?: {
    id: string;
    name: string;
    sku: string;
    price: number;
    stock: number;
  }[];
  /** Biến thể Pancake và sản phẩm sẽ bị chuyển khi bấm Duyệt (null: gian hàng tự giao). API cũ chưa trả. */
  pancakeLink?: PancakeLinkPreview | null;
}

/** LINKED: đã ở sản phẩm này; AVAILABLE: sản phẩm gốc không bán; TAKEOVER: lấy từ sản phẩm đang bán; UNAVAILABLE: không liên kết được. */
export type PancakeLinkState = 'LINKED' | 'AVAILABLE' | 'TAKEOVER' | 'UNAVAILABLE';

export interface PancakeLinkPreview {
  code: string;
  state: PancakeLinkState;
  reason: string | null;
  variation: { name: string; stock: number; retailPrice: number; salePrice: number | null } | null;
  origin: {
    id: string;
    name: string;
    slug: string;
    brand: string;
    brandName: string | null;
    isActive: boolean;
    onSale: boolean;
    sold: number;
    reviewCount: number;
    otherVariations: number;
    storefrontTitle: string | null;
  } | null;
  brandMatchesStore: boolean;
}

export interface AdminLinkedMerchantProduct {
  id: string;
  linkedAt: string;
  takeover: boolean;
  /** Tồn kho Tubu của biến thể lúc liên kết (null: liên kết trước khi có ghi nhận). */
  stockAtLink: number | null;
  /** Liên kết takeover chỉ đối soát tự động từ mốc admin xác nhận hàng ký gửi; null = chưa xác nhận. */
  consignmentConfirmedAt: string | null;
  originProductId: string | null;
  product: {
    id: string;
    name: string;
    slug: string;
    thumbnail: string | null;
    isActive: boolean;
    approvalStatus: string;
    storefront: { id: string; title: string; subdomain: string | null } | null;
  };
  variation: { pancakeId: string | null; name: string; stock: number };
  originProduct: { id: string; name: string; slug: string; brand: string; isActive: boolean } | null;
}

// P0 A6-07 (docs/audit-2026-09/06-web.md): API trả {data, meta} (paginated(), xem
// admin.service.ts listPendingMerchantProducts) nhưng bản cũ khai kiểu mảng trần rồi gọi `.map`
// thẳng lên response — TypeError, cả trang admin rơi vào app/error.tsx. Sửa ĐÚNG theo pattern đã
// dùng cho tab Đại lý/Đổi-Trả (asPage() + Page<T>), không tự nghĩ ra cách khác.
export const listPendingMerchantProducts = (page = 1, limit = ADMIN_QUEUE_PAGE_SIZE) =>
  apiFetch<AdminPendingProduct[] | Page<AdminPendingProduct>>(
    `/admin/merchant-products/pending?page=${page}&limit=${limit}`,
  ).then((res) => asPage(res, page, limit));

/**
 * Những gì dòng chờ duyệt đang hiện lúc admin bấm: API chỉ duyệt khi sản phẩm vẫn đúng như vậy (đối tác đổi mã → 409). Màn admin
 * luôn gửi: API coi null hoặc bỏ trống là "chưa xem mã/phiên bản nào" nên duyệt theo nội dung đang có (kèm cảnh báo trong nhật ký).
 */
export interface MerchantReviewSeen {
  /** Mã đang hiện trên dòng; chuỗi rỗng khi dòng không có mã (không dùng null). */
  pancakeCode: string;
  /** Sản phẩm đang bán admin đã tích xác nhận chuyển (`pancakeLink.origin.id`). */
  takeoverProductId?: string | null;
  /** `updatedAt` của dòng chờ duyệt lần đầu: đối tác sửa sau đó (hoặc admin khác đã xử lý) thì API trả 409 thay vì duyệt nội dung chưa xem. */
  updatedAt?: string | null;
}

export const reviewMerchantProduct = (
  productId: string,
  approve: boolean,
  rejectReason?: string,
  confirmTakeover?: boolean,
  editVersion?: string | null,
  seen?: MerchantReviewSeen,
) =>
  apiFetch<{ id: string; approvalStatus: string }>(
    `/admin/merchant-products/${productId}/review`,
    {
      method: 'POST',
      body: {
        approve,
        rejectReason,
        ...(confirmTakeover ? { confirmTakeover: true } : {}),
        ...(editVersion ? { editVersion } : {}),
        ...(seen ? { expectedPancakeCode: seen.pancakeCode } : {}),
        ...(seen?.takeoverProductId ? { expectedTakeoverProductId: seen.takeoverProductId } : {}),
        ...(seen?.updatedAt ? { expectedUpdatedAt: seen.updatedAt } : {}),
      },
    },
  );

/** `consignment: 'PENDING'`: chỉ liên kết nhận lại hàng Tubu đang bán còn chờ admin xác nhận hàng ký gửi. */
export const listLinkedMerchantProducts = (page = 1, limit = ADMIN_QUEUE_PAGE_SIZE, consignment?: 'PENDING') =>
  apiFetch<Page<AdminLinkedMerchantProduct>>(
    `/admin/merchant-products/linked?page=${page}&limit=${limit}${consignment ? `&consignment=${consignment}` : ''}`,
  );

/** Gỡ liên kết "Tubu giao hộ": biến thể Pancake về sản phẩm gốc, sản phẩm đối tác tắt bán. */
export const unlinkMerchantProduct = (productId: string, reason: string) =>
  apiFetch<{ ok: true; originProductId: string }>(`/admin/merchant-products/${productId}/unlink`, {
    method: 'POST',
    body: { reason },
  });

/** Xác nhận hàng đang bán của biến thể nhận lại là hàng ký gửi của gian hàng: đơn đặt từ giờ vào đối soát tự động. */
export const confirmMerchantConsignment = (linkId: string) =>
  apiFetch<{ id: string; consignmentConfirmedAt: string | null }>(
    `/admin/merchant-fulfilment/links/${encodeURIComponent(linkId)}/confirm-consignment`,
    { method: 'POST' },
  );

// ── Hoàn tiền sàn ngoài (cashback) ──
export interface AdminCashbackTxn {
  id: string;
  userId: string;
  provider: string;
  merchantOrderId: string;
  orderAmount: number;
  commission: number;
  userReward: number;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'PAID';
  confirmedAt: string | null;
  paidAt: string | null;
  user: { id: string; fullName: string | null; phone: string | null } | null;
  merchant: { name: string; slug: string } | null;
}
export const listCashbackTxns = (status?: string) =>
  apiFetch<AdminCashbackTxn[]>(`/admin/cashback/transactions${status ? `?status=${status}` : ''}`);
export const reviewCashbackTxn = (id: string, status: 'CONFIRMED' | 'REJECTED', note?: string) =>
  apiFetch<AdminCashbackTxn>(`/admin/cashback/transactions/${id}/review`, {
    method: 'POST',
    body: { status, note },
  });

// ── Yêu cầu nhận thưởng mốc đại lý (tour/quà) ──
export type DealerRewardClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
export interface AdminDealerRewardClaim {
  id: string;
  userId: string;
  rewardId: string | null;
  periodKey: string;
  rewardTitle: string;
  rewardType: 'TOUR' | 'GIFT' | 'OTHER';
  rewardPeriod: string;
  threshold: number;
  volumeAtClaim: number;
  note: string | null;
  status: DealerRewardClaimStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  paidBy: string | null;
  paidAt: string | null;
  adminNote: string | null;
  createdAt: string;
  dealer?: { id: string; fullName: string | null; phone: string | null; businessName: string | null };
}
export const listDealerRewardClaims = (status?: DealerRewardClaimStatus, page = 1, limit = 20) =>
  apiFetch<Page<AdminDealerRewardClaim>>(
    `/admin/dealer-reward-claims?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`,
  );
export const approveDealerRewardClaim = (id: string, note?: string) =>
  apiFetch<AdminDealerRewardClaim>(`/admin/dealer-reward-claims/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: note?.trim() ? { note: note.trim() } : {},
  });
export const rejectDealerRewardClaim = (id: string, reason: string) =>
  apiFetch<AdminDealerRewardClaim>(`/admin/dealer-reward-claims/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: { reason: reason.trim() },
  });
export const markDealerRewardClaimPaid = (id: string, note?: string) =>
  apiFetch<AdminDealerRewardClaim>(`/admin/dealer-reward-claims/${encodeURIComponent(id)}/mark-paid`, {
    method: 'POST',
    body: note?.trim() ? { note: note.trim() } : {},
  });
/** REJECTED → PENDING khi từ chối nhầm (Q-09); lý do từ chối cũ được BE giữ lại trong ghi chú admin. */
export const reopenDealerRewardClaim = (id: string, note?: string) =>
  apiFetch<AdminDealerRewardClaim>(`/admin/dealer-reward-claims/${encodeURIComponent(id)}/reopen`, {
    method: 'POST',
    body: note?.trim() ? { note: note.trim() } : {},
  });

// ── Duyệt yêu cầu rút tiền (P0 A5-08 = A6-05): hoa hồng CTV / Ví Tubu → ngân hàng ──
export type AdminPayoutStatus = 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED';
export interface AdminPayout {
  id: string;
  userId: string;
  /** Số thực nhận (đã trừ phí) — xem wallet.service.ts:withdraw / affiliate.service.ts:requestPayout. */
  amount: number;
  fee: number;
  /** Hoa hồng trước khấu trừ thuế TNCN (null: rút Ví hoặc lệnh cũ). */
  grossAmount?: number | null;
  taxWithheld?: number;
  /** MST/CCCD người nhận chụp lúc khấu trừ. */
  taxId?: string | null;
  method: string;
  bankInfo: { bankName?: string; accountNumber?: string; accountName?: string } | null;
  status: AdminPayoutStatus;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  paidBy: string | null;
  paidAt: string | null;
  bankRef: string | null;
  adminNote: string | null;
  user: { id: string; fullName: string | null; phone: string | null; referralCode: string | null } | null;
}
export interface PitReportRow {
  userId: string;
  fullName: string | null;
  phone: string | null;
  taxId: string | null;
  payoutCount: number;
  grossAmount: number;
  taxWithheld: number;
  netAmount: number;
}
export interface PitReport {
  month: string;
  rows: PitReportRow[];
  totals: { recipients: number; withheldRecipients: number; grossAmount: number; taxWithheld: number; netAmount: number };
}
/** Báo cáo khấu trừ thuế TNCN theo tháng (YYYY-MM, giờ VN): mọi lần chi hoa hồng cho cá nhân, gộp theo người nhận. */
export const getPitReport = (month: string) =>
  apiFetch<PitReport>(`/admin/payouts/pit-report?month=${encodeURIComponent(month)}`);
export const listPayouts = (status?: AdminPayoutStatus, page = 1, limit = 20) =>
  apiFetch<Page<AdminPayout>>(`/admin/payouts?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}`);
export const approvePayout = (id: string, note?: string) =>
  apiFetch<AdminPayout>(`/admin/payouts/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: note?.trim() ? { note: note.trim() } : {},
  });
export const rejectPayout = (id: string, reason: string) =>
  apiFetch<AdminPayout>(`/admin/payouts/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: { reason: reason.trim() },
  });
export const markPayoutPaid = (id: string, bankRef?: string, note?: string) =>
  apiFetch<AdminPayout>(`/admin/payouts/${encodeURIComponent(id)}/mark-paid`, {
    method: 'POST',
    body: {
      ...(bankRef?.trim() ? { bankRef: bankRef.trim() } : {}),
      ...(note?.trim() ? { note: note.trim() } : {}),
    },
  });

// ── Hoàn tiền khách: hàng đợi chuyển khoản tay (khách cuối đơn CTV lên hộ, khách chọn ngân hàng khi huỷ/trả, tiền về muộn) ──
/**
 * PROCESSING: admin đã bấm "Bắt đầu chuyển khoản" — nơi nhận bị khoá, khách không đổi sang Ví được nữa.
 * UNVERIFIED: khoản dư Pancake báo, chờ admin đối chiếu sao kê (khách chưa thấy); DISMISSED: admin xác định không phải tiền dư.
 */
export type AdminCustomerRefundStatus = 'UNVERIFIED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'DISMISSED';
export type AdminCustomerRefundMethod = 'WALLET' | 'MANUAL_TRANSFER';
export type AdminCustomerRefundKind = 'END_CUSTOMER' | 'CANCEL' | 'RETURN' | 'LATE_PAYMENT' | 'OVERPAYMENT';
/** Khớp model OrderCustomerRefund (BE trả nguyên dòng, không che SĐT). `reason` là trạng thái đơn gây ra lần hoàn. */
export interface AdminCustomerRefund {
  id: string;
  orderId: string;
  orderCode: string;
  amount: number;
  phone: string | null;
  recipientName: string | null;
  customerUserId: string | null;
  method: AdminCustomerRefundMethod;
  status: AdminCustomerRefundStatus;
  reason: string;
  completedAt: string | null;
  /** adminId xác nhận đã chuyển khoản. */
  completedBy: string | null;
  /** Tên admin xác nhận (BE tra từ completedBy); API cũ chưa trả. */
  completedByName?: string | null;
  bankRef: string | null;
  adminNote: string | null;
  createdAt: string;
  kind: AdminCustomerRefundKind;
  /** Chủ đơn (khách có tài khoản); null với khoản khách cuối đơn CTV lên hộ. */
  userId: string | null;
  /** Tài khoản nhận khách đã chọn; trống = khách chưa chọn nơi nhận, admin nhập tài khoản khách cung cấp khi xác nhận. */
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  /** adminId đang chuyển khoản (PROCESSING) và lúc bấm; API cũ chưa trả. */
  claimedBy?: string | null;
  claimedAt?: string | null;
  /** Tên admin đang chuyển khoản — chỉ người này được xác nhận/trả về hàng chờ, admin khác phải tiếp quản kèm lý do. */
  claimedByName?: string | null;
}
/** Admin khác người đang chuyển khoản: tiếp quản tường minh, lý do lưu vào lịch sử đơn (R3-MONEY-4). */
export interface RefundTakeOver {
  takeOverReason: string;
}
const takeOverBody = (t?: RefundTakeOver) => (t ? { takeOver: true, takeOverReason: t.takeOverReason.trim() } : {});
/** Bộ lọc hàng đợi: một trạng thái, hoặc OPEN = mọi khoản còn việc (chờ đối soát + chờ chuyển khoản + đang chuyển khoản). */
export type AdminCustomerRefundFilter = AdminCustomerRefundStatus | 'OPEN';
export const listCustomerRefunds = (status?: AdminCustomerRefundFilter, page = 1, limit = 20, kind?: AdminCustomerRefundKind) =>
  apiFetch<Page<AdminCustomerRefund>>(
    `/admin/customer-refunds?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}${kind ? `&kind=${kind}` : ''}`,
  );
const bankBody = (input: { bankName?: string; accountNumber?: string; accountName?: string }) =>
  input.accountNumber?.trim()
    ? { bankName: input.bankName?.trim() ?? '', accountNumber: input.accountNumber.trim(), accountName: input.accountName?.trim() ?? '' }
    : {};
/** "Bắt đầu chuyển khoản": PENDING -> PROCESSING, khoá nơi nhận trước khi admin chuyển tiền (khách vừa chọn Ví thì 400). */
export const claimCustomerRefund = (id: string, input: { bankName?: string; accountNumber?: string; accountName?: string } = {}) =>
  apiFetch<AdminCustomerRefund>(`/admin/customer-refunds/${encodeURIComponent(id)}/claim`, { method: 'POST', body: bankBody(input) });
/** Chưa chuyển được: PROCESSING -> PENDING, khách lại đổi được nơi nhận. */
export const releaseCustomerRefund = (id: string, takeOver?: RefundTakeOver) =>
  apiFetch<AdminCustomerRefund>(`/admin/customer-refunds/${encodeURIComponent(id)}/release`, { method: 'POST', body: takeOverBody(takeOver) });
/** "Xác nhận tiền dư" sau khi đối chiếu sao kê: UNVERIFIED -> PENDING với số dư thực nhận; khách được báo để chọn nơi nhận. */
export const verifyCustomerRefund = (id: string, input: { amount: number; note?: string }) =>
  apiFetch<AdminCustomerRefund>(`/admin/customer-refunds/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
    body: { amount: input.amount, ...(input.note?.trim() ? { note: input.note.trim() } : {}) },
  });
/** "Không phải tiền dư": UNVERIFIED -> DISMISSED kèm lý do; khách không được báo. */
export const dismissCustomerRefund = (id: string, reason: string) =>
  apiFetch<AdminCustomerRefund>(`/admin/customer-refunds/${encodeURIComponent(id)}/dismiss`, { method: 'POST', body: { reason: reason.trim() } });
/** Chỉ ghi sổ việc admin ĐÃ chuyển khoản tay (BE: PENDING -> COMPLETED một lần, thua race trả 400); không chuyển tiền. */
export const markCustomerRefundPaid = (
  id: string,
  input: { bankRef?: string; note?: string; bankName?: string; accountNumber?: string; accountName?: string } = {},
  takeOver?: RefundTakeOver,
) =>
  apiFetch<AdminCustomerRefund>(`/admin/customer-refunds/${encodeURIComponent(id)}/mark-paid`, {
    method: 'POST',
    body: {
      ...(input.bankRef?.trim() ? { bankRef: input.bankRef.trim() } : {}),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      ...(input.accountNumber?.trim()
        ? { bankName: input.bankName?.trim() ?? '', accountNumber: input.accountNumber.trim(), accountName: input.accountName?.trim() ?? '' }
        : {}),
      ...takeOverBody(takeOver),
    },
  });

// ── Tích điểm tại quầy (POS) ──
export interface PosMember {
  id: string;
  memberCode: string;
  name: string;
  /** SĐT đã che (090****123). */
  phone: string | null;
  tier: string;
  pointsBalance: number;
  /** Lô quy đổi từ xu cũ (không hết hạn). API cũ chưa trả → coi như 0. */
  pointsConvertedBalance?: number;
}
export interface PosCreditResult {
  /** true = hoá đơn này đã được tích trước đó — trả lại kết quả cũ, KHÔNG cộng thêm. */
  replayed: boolean;
  member: PosMember;
  posTransaction: { receiptId: string; orderTotal: number; pointsEarned: number; creditedAt: string };
}
export interface AdminPosCredit {
  id: string;
  receiptId: string;
  orderTotal: number;
  points: number;
  multiplier: number;
  note: string | null;
  dayKey: string;
  createdAt: string;
  staff: { id: string; name: string | null; phone: string | null };
  member: { id: string; name: string | null; phone: string | null; memberCode: string };
}
export const scanMember = (memberCode: string) =>
  apiFetch<{ member: PosMember }>('/loyalty/staff/scan-member', { method: 'POST', body: { memberCode } });
export const posCredit = (body: { memberCode: string; orderTotal: number; receiptId: string; note?: string }) =>
  apiFetch<PosCreditResult>('/loyalty/staff/pos-credit', { method: 'POST', body });
/**
 * Công tắc loyalty.pos_credit_enabled nhìn từ phía nhân viên: STAFF không đọc được /admin/config, nhưng
 * thẻ thành viên của CHÍNH MÌNH (/me/loyalty/member-card) có cờ posCreditEnabled — đủ để màn thu ngân
 * báo "đang tắt" trước khi nhân viên nhập hoá đơn.
 */
export const getPosCreditEnabled = () =>
  apiFetch<{ posCreditEnabled?: boolean }>('/me/loyalty/member-card').then((r) => r.posCreditEnabled === true);
export const listPosCredits = (q: { day?: string; staffUserId?: string; memberId?: string } = {}) => {
  const params = new URLSearchParams();
  if (q.day) params.set('day', q.day);
  if (q.staffUserId?.trim()) params.set('staffUserId', q.staffUserId.trim());
  if (q.memberId?.trim()) params.set('memberId', q.memberId.trim());
  const qs = params.toString();
  return apiFetch<AdminPosCredit[]>(`/admin/loyalty/pos-credits${qs ? `?${qs}` : ''}`);
};

// ── Retention & North-star (Task 14 cron + Task 20 dashboard) ──
export interface RetentionDailyRow {
  date: string;
  newBuyers: number;
  activeBuyers: number;
  ordersCount: number;
  ordersPerBuyerMtd: number;
  dauProxyRefreshToken: number;
  dauEventBased: number | null;
  /** NS-1 của cohort "đơn đầu tiên rơi vào ngày date − 30": số khách và số khách có đơn thứ 2 trong 30 ngày. null = chưa tính. */
  ns1CohortSize: number | null;
  ns1RepeatCount: number | null;
}
export const getRetentionDaily = (days = 30) =>
  apiFetch<RetentionDailyRow[]>(`/admin/analytics/retention-daily?days=${days}`);

// ── Ô chọn (khách / sản phẩm / bậc đại lý), duyệt đánh giá, gói định kỳ (C-092) ──
export interface AdminVariationHit {
  id: string;
  name: string;
  sku: string;
  /** Giá đang bán (giá khuyến mãi nếu có, không thì giá lẻ). */
  price: number;
  stock: number;
  isActive: boolean;
}
export interface AdminProductHit {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  thumbnail: string | null;
  isActive: boolean;
  variations: AdminVariationHit[];
}
export interface AdminVariationLabel {
  id: string;
  name: string;
  sku: string;
  productId: string;
  productName: string;
}
/** Ô chọn chỉ tìm khi đủ ký tự này — khớp ngưỡng của BE (ngắn hơn trả mảng rỗng). */
export const PICKER_MIN_CHARS = 2;
export const searchAdminProducts = (q: string) =>
  apiFetch<AdminProductHit[]>(`/admin/products/search?q=${encodeURIComponent(q.trim())}`);
export const lookupVariations = (ids: string[]) =>
  ids.length === 0
    ? Promise.resolve<AdminVariationLabel[]>([])
    : apiFetch<AdminVariationLabel[]>(`/admin/variations/lookup?ids=${encodeURIComponent(ids.join(','))}`);
export const searchAdminUsers = (search: string, limit = 8) =>
  apiFetch<Page<AdminUser>>(`/admin/users?page=1&limit=${limit}&search=${encodeURIComponent(search.trim())}`);

export interface AdminDealerTier {
  id: string;
  name: string;
  minOrderVolume: number;
  creditLimit: number;
  paymentTerms: string | null;
}
export const listDealerTiers = () => apiFetch<AdminDealerTier[]>('/admin/dealer-tiers');

export type ReviewVisibilityFilter = 'visible' | 'hidden';
export interface AdminReview {
  id: string;
  rating: number;
  comment: string | null;
  images: string[];
  videoUrl: string | null;
  isVisible: boolean;
  isVerified: boolean;
  createdAt: string;
  user: { id: string; fullName: string | null; phone: string | null };
  product: { id: string; name: string; slug: string };
}
export const listAdminReviews = (page = 1, visibility?: ReviewVisibilityFilter, rating?: number, limit = 20) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (visibility) params.set('visibility', visibility);
  if (rating) params.set('rating', String(rating));
  return apiFetch<Page<AdminReview>>(`/admin/reviews?${params.toString()}`);
};
/** Route của module reviews (không nằm dưới /admin): BE tự tính lại điểm sao của sản phẩm sau khi ẩn/hiện. */
export const setReviewVisibility = (id: string, isVisible: boolean) =>
  apiFetch<{ ok: boolean; isVisible: boolean }>(`/reviews/${id}/visibility`, { method: 'POST', body: { isVisible } });

export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';
export interface AdminSubscription {
  id: string;
  status: SubscriptionStatus;
  quantity: number;
  intervalWeeks: number;
  nextRunAt: string;
  lastOrderId: string | null;
  createdAt: string;
  user: { id: string; fullName: string | null; phone: string | null };
  variation: { id: string; name: string; sku: string; product: { id: string; name: string } };
}
export const listAdminSubscriptions = (page = 1, status?: SubscriptionStatus, limit = 20) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set('status', status);
  return apiFetch<Page<AdminSubscription>>(`/admin/subscriptions?${params.toString()}`);
};

// ── Xuất CSV đầy đủ (ADMINOPS-12): API ghi dần mọi dòng khớp bộ lọc, không giới hạn ở trang đang xem ──
export interface OrderExportFilter {
  status?: string;
  search?: string;
  recycling?: RecyclingFilter;
  invoice?: InvoiceFilter;
  pancake?: PancakeFilter;
  /** 'YYYY-MM-DD' theo giờ VN, tính cả hai đầu. */
  from?: string;
  to?: string;
}
function orderFilterParams(f: OrderExportFilter): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
  return q;
}
const todayKey = () => new Date().toISOString().slice(0, 10);
export const downloadOrdersCsv = (f: OrderExportFilter) => {
  const qs = orderFilterParams(f).toString();
  return apiDownload(`/admin/orders/export${qs ? `?${qs}` : ''}`, `don-hang-${todayKey()}.csv`);
};
export const downloadUsersCsv = (search?: string) => {
  const qs = search?.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
  return apiDownload(`/admin/users/export${qs}`, `nguoi-dung-${todayKey()}.csv`);
};

// ── Việc cần xử lý + sức khoẻ vận hành (ADMINOPS-13, PLATFORM-5) ──
export type InboxKey =
  | 'pancakeAttention'
  | 'pancakeUnsynced'
  | 'gomdonAttention'
  | 'customerRefunds'
  | 'returnsPending'
  | 'returnsToReceive'
  | 'merchantOverdue'
  | 'merchantProducts'
  | 'consignmentPending'
  | 'merchantToSettle'
  | 'merchantPayoutsPending'
  | 'dealerApplications'
  | 'dealerClaims'
  | 'payouts'
  | 'refillPending';
export interface OpsInbox {
  generatedAt: string;
  items: { key: InboxKey; count: number }[];
}
export const getOpsInbox = () => apiFetch<OpsInbox>('/admin/ops/inbox');

export type StaffPermission = 'CSKH' | 'KHO';
export const STAFF_PERMISSION_LABELS: Record<StaffPermission, string> = {
  CSKH: 'CSKH — đơn, đổi trả, người dùng, mẫu tin nhanh',
  KHO: 'Kho — trạng thái đơn, đẩy lại Pancake, vận đơn thu gom, nhận hàng trả',
};
export interface OpsAccess {
  role: string;
  staffPermissions: StaffPermission[];
}
export const getOpsAccess = () => apiFetch<OpsAccess>('/admin/ops/access');

export interface OpsStuckOrder {
  id: string;
  code: string;
  status: string;
  createdAt: string;
  pancakePushStatus: string | null;
  pancakePushAttempts: number;
  pancakeLastAttemptAt: string | null;
  pancakeSyncError: string | null;
}
export interface OpsQueueRow {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  failedLastHour: number;
}
/** Webhook Pancake/Gomdon lỗi hoặc kẹt chưa ai xử lý (màn Sức khoẻ hệ thống — Chạy lại / Đã xử lý). */
export interface OpsWebhookEvent {
  id: string;
  source: 'pancake' | 'gomdon';
  eventType: string;
  /** Mã đơn Tubu (hoặc #id đơn Pancake); null khi payload không mang mã nào. */
  orderRef: string | null;
  status: string;
  attempts: number;
  error: string | null;
  receivedAt: string;
}
export interface OpsAttentionOrder {
  id: string;
  code: string;
  pancakeAttention: string | null;
  pancakeAttentionAt: string | null;
}
export interface OpsGomdonAlert {
  id: string;
  message: string;
  createdAt: string;
  orderCode: string;
}
export interface OpsBacklogOrder {
  id: string;
  code: string;
  createdAt: string;
  gomdonStatus: string | null;
  paymentMethod: string;
}
/** Email báo động vận hành: trạng thái cấu hình và lần gửi gần nhất (lỗi đã được API che tài khoản/mật khẩu SMTP). */
export interface OpsEmailChannel {
  state: 'DISABLED' | 'READY' | 'MISCONFIGURED';
  recipients: number;
  issues: string[];
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  /** AUTH/PERMANENT: lỗi không tự khỏi, hệ thống không tự gửi lại liên tục. Tuỳ chọn: API cũ chưa trả trường này. */
  lastErrorKind?: 'AUTH' | 'PERMANENT' | 'TRANSIENT' | null;
  /** Cách sửa cho lỗi AUTH/PERMANENT (vd "Lỗi xác thực SMTP — kiểm tra SMTP_USER/SMTP_PASS"); không chứa giá trị cấu hình. */
  lastErrorHint?: string | null;
}
/** Webhook báo động vận hành (OPS_ALERT_WEBHOOK_URL): cùng dạng với kênh email, không bao giờ kèm URL hay token. */
export interface OpsWebhookChannel {
  state: 'DISABLED' | 'READY';
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  /** PERMANENT: hook bị từ chối hẳn (vd 410), hệ thống không tự gửi lại liên tục. TRANSIENT: tự gửi lại ở lượt kiểm sau. */
  lastErrorKind?: 'PERMANENT' | 'TRANSIENT' | null;
  /** Cách sửa cho lỗi PERMANENT. */
  lastErrorHint?: string | null;
}
export interface OpsHealth {
  generatedAt: string;
  thresholds: {
    unsyncedMinutes: number;
    stuckOrders: number;
    webhookFailed: number;
    queueFailed1h: number;
    repeatHours: number;
    gomdonBacklogMinutes: number;
  };
  pancake: {
    configured: boolean;
    lastPushOkAt: string | null;
    lastWebhookAt: string | null;
    lastWebhookProcessedAt: string | null;
    webhookFailed24h: number;
    webhookFailedOpen: number;
    webhookStuck: number;
    failedEvents: OpsWebhookEvent[];
    unsynced: number;
    stuck: number;
    stuckOrders: OpsStuckOrder[];
    attention: number;
    attentionOrders: OpsAttentionOrder[];
    catalog: { lastOkAt: string | null; lastErrorAt: string | null; lastError: string | null; detail: { count?: number; failed?: number } | null };
  };
  gomdon: {
    configured: boolean;
    connection: { lastOkAt: string | null; lastErrorAt: string | null; lastError: string | null; credentialsRejected: boolean } | null;
    credentialsRejected: boolean;
    lastWebhookAt: string | null;
    webhookFailed24h: number;
    webhookFailedOpen: number;
    failedEvents: OpsWebhookEvent[];
    openAlerts: number;
    alerts: OpsGomdonAlert[];
    attention: number;
    backlog: number;
    backlogOrders: OpsBacklogOrder[];
  };
  queues: { ok: true; items: OpsQueueRow[] } | { ok: false; error: string };
  /** Đơn đã giao chưa xong việc sau giao (cũ nhất trước). Tuỳ chọn: API cũ chưa trả trường này. */
  orders?: {
    deliveredEffectsPending: number;
    deliveredEffectsStale: number;
    deliveredEffectsOrders: { id: string; code: string; deliveredAt: string | null }[];
  };
  /** Kênh báo động ngoài app. Tuỳ chọn: API cũ chưa trả trường này. */
  alertChannels?: { email: OpsEmailChannel; webhook?: OpsWebhookChannel };
  problems: { key: string; message: string }[];
}
export const getOpsHealth = () => apiFetch<OpsHealth>('/admin/ops/health');
/** Gửi một email thử tới các địa chỉ nhận báo động (ADMIN, tối đa 5 lần/phút). Lỗi trả về câu tiếng Việt đã che bí mật. */
export const sendOpsTestEmail = () => apiFetch<{ ok: true; message: string }>('/admin/ops/alert-email/test', { method: 'POST' });
/** Đồng bộ danh mục Pancake ngay (không ghi đè tồn kho trừ khi `withStock`). */
export const runPancakeSync = (withStock = false) =>
  apiFetch<{ synced: number; stockOverwritten: boolean }>(`/admin/pancake/sync${withStock ? '?withStock=1' : ''}`, { method: 'POST' });
export const recomputeSoldCounts = () => apiFetch<{ updated: number }>('/admin/products/recompute-sold', { method: 'POST' });
/** "Chạy lại" webhook Pancake/Gomdon lỗi hoặc kẹt — đặt lại số lần thử rồi đưa vào hàng đợi. */
export const retryOpsWebhookEvent = (source: OpsWebhookEvent['source'], id: string) =>
  apiFetch<{ ok: true; message: string }>(`/admin/ops/webhook-events/${source}/${encodeURIComponent(id)}/retry`, { method: 'POST' });
/** "Đã xử lý" — đã sửa tay đơn liên quan, sự kiện rời báo động. */
export const dismissOpsWebhookEvent = (source: OpsWebhookEvent['source'], id: string) =>
  apiFetch<{ ok: true; message: string }>(`/admin/ops/webhook-events/${source}/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });

// ── Chấm công: phiên đang mở + chốt ra ca (ADMINOPS-17) ──
export interface LiveAttendance {
  id: string;
  staffId: string;
  checkinAt: string;
  lastHeartbeatAt: string;
  outOfRangeCount: number;
  isLate: boolean;
  shift: {
    id: string;
    workDate: string;
    startAt: string;
    endAt: string;
    approvedStart: string | null;
    approvedEnd: string | null;
    staff?: { id: string; fullName: string | null; phone: string | null } | null;
  };
}
export const listLiveAttendance = () => apiFetch<LiveAttendance[]>('/admin/attendance/live');
export const manualCheckout = (sessionId: string) =>
  apiFetch<{ checkedOut: boolean }>('/admin/attendance/manual-checkout', { method: 'POST', body: { sessionId } });

// ── Đổi vỏ chai chờ duyệt (route chung với nhân viên quầy) ──
export interface PendingRefill {
  id: string;
  quantity: number;
  seedsAwarded: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  user: { id: string; fullName: string | null; phone?: string | null };
  /** Điểm khách chọn lúc gửi; null ở yêu cầu cũ hoặc khi chưa có điểm nào được cấu hình. */
  pickupLocation?: { id: string; name: string; address: string } | null;
}
export const listPendingRefills = () => apiFetch<PendingRefill[]>('/refill/admin/pending');

// ── Điểm nhận vỏ chai (chỉ ADMIN; không xoá, tắt isActive để giữ lịch sử) ──
export interface RefillLocation {
  id: string;
  name: string;
  address: string;
  hours: string | null;
  phone: string | null;
  isActive: boolean;
  sortOrder: number;
}
export interface RefillLocationInput {
  name: string;
  address: string;
  hours: string;
  phone: string;
  isActive: boolean;
}
export const listRefillLocations = () => apiFetch<RefillLocation[]>('/admin/refill-locations');
export const createRefillLocation = (body: RefillLocationInput) =>
  apiFetch<RefillLocation>('/admin/refill-locations', { method: 'POST', body });
export const updateRefillLocation = (id: string, body: Partial<RefillLocationInput>) =>
  apiFetch<RefillLocation>(`/admin/refill-locations/${encodeURIComponent(id)}`, { method: 'PATCH', body });
/** `ids`: TOÀN BỘ điểm (cả đang tắt) theo thứ tự mới; API trả 409 khi danh sách đã cũ. */
export const reorderRefillLocations = (ids: string[]) =>
  apiFetch<RefillLocation[]>('/admin/refill-locations/order', { method: 'PUT', body: { ids } });
export const approveRefill = (id: string, receivedQuantity?: number) =>
  apiFetch<{ ok: boolean }>(`/refill/admin/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    body: receivedQuantity === undefined ? {} : { receivedQuantity },
  });
export const rejectRefill = (id: string, reason?: string) =>
  apiFetch<{ ok: boolean }>(`/refill/admin/${encodeURIComponent(id)}/reject`, { method: 'POST', body: reason ? { reason } : {} });

// ── Chi tiết người dùng (ADMINOPS-11) + nhóm việc nhân viên (ADMINOPS-10) ──
export interface AdminUserEvent {
  id: string;
  kind: 'ROLE' | 'STAFF_PERMISSIONS' | 'BLOCK' | 'UNBLOCK' | 'STOREFRONT_PARTNER';
  fromValue: string | null;
  toValue: string | null;
  reason: string | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}
export interface AdminUserDetail {
  user: {
    id: string;
    fullName: string | null;
    phone: string | null;
    email: string | null;
    role: string;
    staffPermissions: StaffPermission[];
    referralCode: string | null;
    pointsBalance: number;
    pointsConvertedBalance: number;
    walletBalance: number;
    isBlocked: boolean;
    blockedAt: string | null;
    blockedReason: string | null;
    createdAt: string;
    tier: { name: string } | null;
  };
  orders: {
    items: { id: string; code: string; status: string; paymentMethod: string; paymentStatus: string; total: number; createdAt: string; fulfiller: string }[];
    total: number;
  };
  wallet: { id: string; delta: number; balanceAfter: number; type: string; refType: string | null; refId: string | null; reason: string | null; createdAt: string }[];
  points: { id: string; delta: number; reason: string; refType: string | null; refId: string | null; lot: string | null; expiresAt: string | null; createdAt: string }[];
  roleHistory: AdminUserEvent[];
  blockHistory: AdminUserEvent[];
  partnerHistory?: AdminUserEvent[];
  grants: { id: string; role: string; grantedBy: string; grantedByName: string | null; note: string | null; revokedAt: string | null; createdAt: string }[];
}
export const getUserDetail = (id: string) => apiFetch<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}/detail`);
export const setStaffPermissions = (id: string, permissions: StaffPermission[]) =>
  apiFetch<{ id: string; staffPermissions: StaffPermission[]; changed: boolean }>(`/admin/users/${encodeURIComponent(id)}/staff-permissions`, {
    method: 'PUT',
    body: { permissions },
  });

export interface AdminMission {
  id: string;
  code: string;
  title: string;
  description: string;
  rewardPoints: number;
  goal: number;
  isRepeatable: boolean;
  claimedCount: number;
}
export interface AdminRewardCatalogItem {
  id: string;
  title: string;
  description: string;
  pointsCost: number;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP' | string;
  value: number;
  minOrder?: number | null;
  maxDiscount?: number | null;
  redeemedCount: number;
  redeemed30d: number;
}
export const listAdminMissions = () => apiFetch<AdminMission[]>('/admin/engagement/missions');
export const updateAdminMission = (id: string, body: { title: string; description: string; rewardPoints: number }) =>
  apiFetch<AdminMission>(`/admin/engagement/missions/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const listAdminRewardCatalog = () => apiFetch<AdminRewardCatalogItem[]>('/admin/engagement/rewards');

export interface DealerPriceChange {
  id: string;
  variationId: string;
  sku: string;
  tierId: string;
  oldPrice: number | null;
  newPrice: number;
  changedBy: string;
  createdAt: string;
  productName: string | null;
  variationName: string | null;
  tierName: string | null;
  changedByName: string | null;
}
export const listDealerPriceHistory = (sku: string | undefined, page = 1, limit = 30) =>
  apiFetch<Page<DealerPriceChange>>(
    `/admin/dealer-prices/history?page=${page}&limit=${limit}${sku ? `&sku=${encodeURIComponent(sku)}` : ''}`,
  );

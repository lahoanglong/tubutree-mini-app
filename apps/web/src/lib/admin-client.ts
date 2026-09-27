'use client';

import { apiFetch } from './client-api';

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
  pointsBalance: number;
  createdAt: string;
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
  note?: string | null;
  createdAt: string;
  updatedAt?: string;
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
  /** CANCELLED | FAILED | TOO_LATE | NOT_NEEDED — kết quả huỷ vận đơn khi đơn bị huỷ. */
  gomdonCancelStatus?: string | null;
  deliveredAt?: string | null;
  user?: {
    id: string;
    phone: string | null;
    fullName: string | null;
  } | null;
  items?: AdminOrderItem[];
}
export interface DashboardStats {
  totalRevenue: number;
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
export interface AdminReturnRequest {
  id: string;
  orderId: string;
  userId: string;
  reason: string;
  images: string[];
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  refundMethod: string;
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
  } | null;
  user?: {
    id: string;
    fullName: string | null;
    phone: string | null;
  } | null;
}
export const listReturnRequests = (status?: string, page = 1, limit = ADMIN_QUEUE_PAGE_SIZE, order?: QueueOrder) =>
  apiFetch<AdminReturnRequest[] | Page<AdminReturnRequest>>(`/admin/return-requests?${queueQuery(page, limit, status, order)}`).then(
    (res) => asPage(res, page, limit),
  );
export const reviewReturnRequest = (id: string, approve: boolean, note?: string) =>
  apiFetch<AdminReturnRequest>(`/admin/return-requests/${id}/review`, {
    method: 'POST',
    body: { approve, note },
  });

// ── Nhập giá đại lý B2B & số lượng bán ngoài ──
export const importDealerPrices = (tierId: string, csv: string) =>
  apiFetch<{ updated: number; skipped: number; notFound: string[] }>('/admin/dealer-prices/import', {
    method: 'POST',
    body: { tierId, csv },
  });
export const importSoldExternal = (csv: string) =>
  apiFetch<{ ok: boolean; updatedCount: number }>('/admin/products/sold-external', {
    method: 'POST',
    body: { csv },
  });

export const listUsers = (page = 1) =>
  apiFetch<Page<AdminUser>>(`/admin/users?page=${page}&limit=20`);
export type UserRole = 'CUSTOMER' | 'AFFILIATE' | 'DEALER' | 'STAFF' | 'ADMIN';
export const setUserRole = (phone: string, role: UserRole) =>
  apiFetch<{ ok: boolean; id: string; phone: string | null; fullName: string | null; role: string; previousRole: string }>(
    '/admin/users/role',
    { method: 'POST', body: { phone, role } },
  );
export const getDashboardStats = () =>
  apiFetch<DashboardStats>('/admin/dashboard/stats');
/** attention = hàng đợi "Cần xử lý thu gom"; all = mọi đơn có chọn thu gom tái chế. */
export type RecyclingFilter = 'attention' | 'all';
export const listOrders = (page = 1, status?: string, search?: string, recycling?: RecyclingFilter, limit = 20) =>
  apiFetch<Page<AdminOrder>>(
    `/admin/orders?page=${page}&limit=${limit}${status ? `&status=${status}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}${
      recycling ? `&recycling=${recycling}` : ''
    }`,
  );
/** Số đơn trong hàng đợi "Cần xử lý thu gom" (đọc meta.total, không tải danh sách). */
export const countRecyclingAttention = () =>
  listOrders(1, undefined, undefined, 'attention', 1).then((r) => r.meta.total);

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
}
export const getGomdonStatus = () => apiFetch<GomdonIntegrationStatus>('/admin/gomdon/status');
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
  ingredients: string | null;
  certifications: string[];
  ecoBadges: string[];
  approvalStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  rejectReason?: string | null;
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
}

// P0 A6-07 (docs/audit-2026-09/06-web.md): API trả {data, meta} (paginated(), xem
// admin.service.ts listPendingMerchantProducts) nhưng bản cũ khai kiểu mảng trần rồi gọi `.map`
// thẳng lên response — TypeError, cả trang admin rơi vào app/error.tsx. Sửa ĐÚNG theo pattern đã
// dùng cho tab Đại lý/Đổi-Trả (asPage() + Page<T>), không tự nghĩ ra cách khác.
export const listPendingMerchantProducts = (page = 1, limit = ADMIN_QUEUE_PAGE_SIZE) =>
  apiFetch<AdminPendingProduct[] | Page<AdminPendingProduct>>(
    `/admin/merchant-products/pending?page=${page}&limit=${limit}`,
  ).then((res) => asPage(res, page, limit));

export const reviewMerchantProduct = (
  productId: string,
  approve: boolean,
  rejectReason?: string,
) =>
  apiFetch<{ id: string; approvalStatus: string }>(
    `/admin/merchant-products/${productId}/review`,
    {
      method: 'POST',
      body: { approve, rejectReason },
    },
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

// ── Duyệt yêu cầu rút tiền (P0 A5-08 = A6-05): hoa hồng CTV / Ví Tubu → ngân hàng ──
export type AdminPayoutStatus = 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED';
export interface AdminPayout {
  id: string;
  userId: string;
  /** Số thực nhận (đã trừ phí) — xem wallet.service.ts:withdraw / affiliate.service.ts:requestPayout. */
  amount: number;
  fee: number;
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

// ── Tích điểm tại quầy (POS) ──
export interface PosMember {
  id: string;
  memberCode: string;
  name: string;
  /** SĐT đã che (090****123). */
  phone: string | null;
  tier: string;
  pointsBalance: number;
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

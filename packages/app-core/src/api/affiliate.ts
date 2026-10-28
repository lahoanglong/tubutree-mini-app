import type { HttpClient } from '../http';

export interface AffiliateMe {
  /** CTV, admin, hoặc đại lý còn gian hàng CTV/hoa hồng (D3-03). */
  isAffiliate: boolean;
  /** false với đại lý/nhân viên: đăng ký CTV một chạm bị từ chối. Thiếu khi API cũ (coi như đăng ký được). */
  canRegister?: boolean;
  /** false với đại lý: chưa được lên đơn hộ khách. Thiếu khi API cũ (coi như được). */
  canOrderForCustomer?: boolean;
  /** false với đại lý chưa có gian hàng CTV: trình dựng gian hàng trả 400 cho họ. Thiếu khi API cũ (coi như mở được). */
  canOpenStorefront?: boolean;
  referralCode: string;
  walletBalance: number;
  /** MST cá nhân/CCCD đã khai để kê khai khấu trừ thuế TNCN (null: chưa khai). */
  personalTaxId?: string | null;
  monthRevenue?: number;
  tier?: AffiliateTier;
}

/**
 * Bậc CTV theo doanh số ĐÃ CHỐT tháng (giờ VN). Chỉ là danh hiệu — backend KHÔNG trả "+X% bonus
 * hoa hồng" theo bậc, nên type không có bonusPct để UI không thể hứa khoản đó.
 */
export interface AffiliateTier {
  name: string;
  emoji: string;
  nextName: string | null;
  nextThreshold: number | null;
  toNext: number;
}
export interface AffiliateDashboard {
  todayCommission: number;
  monthCommission: number;
  pendingCommission: number;
  withdrawableCommission: number;
  /** Hoa hồng đã duyệt có tự vào Ví không (affiliate.auto_wallet_transfer_enabled); thiếu khi API cũ, coi như bật. */
  autoWalletTransfer?: boolean;
  /** Đã duyệt nhưng nằm trong lệnh rút ngân hàng cũ chưa chuyển tiền (chỉ còn dữ liệu trước khi bỏ rút); thiếu khi API cũ. */
  withdrawingCommission?: number;
  /** Thuế TNCN sẽ bị khấu trừ nếu chuyển hết ngay (cộng dồn các lần chuyển trong tháng VN); thiếu khi API cũ. */
  withdrawTaxPreview?: number;
  totalClicks: number;
  totalConversions: number;
  monthRevenue: number;
  tier: AffiliateTier;
}

export interface CtvMilestoneItem {
  id: string;
  title: string;
  threshold: number;
  rewardPoints: number;
  description: string;
  achieved: boolean;
  claimed: boolean;
  canClaim: boolean;
  progressPct: number;
}

export interface CtvMilestonesResponse {
  /** Tháng VN 'YYYY-MM'. */
  monthKey: string;
  /** Doanh số ĐÃ CHỐT trong tháng — căn cứ duy nhất để đạt mốc. */
  currentRevenue: number;
  /** Doanh số đang chờ chốt (đơn chưa giao / đang giữ đổi-trả) — chỉ để xem, chưa tính mốc. */
  pendingRevenue: number;
  /** Số ngày giữ đổi/trả trước khi chốt (config affiliate.hold_days). */
  holdDays: number;
  milestones: CtvMilestoneItem[];
  /** Tháng trước còn mốc đạt mà chưa nhận (null nếu không còn). */
  previousMonth: { monthKey: string; revenue: number; milestones: CtvMilestoneItem[] } | null;
}

export interface CtvTiersResponse {
  revenue: number;
  tier: AffiliateTier;
  /** milestoneRewardPoints: thưởng mốc Điểm Xanh cùng ngưỡng bậc (null với bậc khởi đầu). */
  allTiers: { name: string; emoji: string; min: number; milestoneRewardPoints: number | null }[];
}

export interface AffiliateLink {
  id: string;
  shortCode: string;
  targetType: string;
  targetId: string | null;
  clicks: number;
  conversions: number;
  revenue: number;
  createdAt: string;
}

export type CommissionStatus = 'PENDING' | 'LOCKED' | 'APPROVED' | 'PAID' | 'REJECTED';
export interface Commission {
  id: string;
  orderId: string;
  orderTotal: number;
  rate: string;
  amount: number;
  status: CommissionStatus;
  createdAt: string;
  orderCode?: string | null;
  orderStatus?: string | null;
  /** APPROVED nhưng đã nằm trong một lệnh rút ngân hàng chưa chuyển tiền. */
  withdrawing?: boolean;
}

export type PayoutStatus = 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED';
export interface AffiliatePayout {
  id: string;
  /** Số thực nhận (sau thuế TNCN và phí). */
  amount: number;
  grossAmount: number | null;
  /** Thuế TNCN thực giữ (đã trừ phần hoàn về Ví). */
  taxWithheld: number;
  /** Phần thuế giữ dư đã hoàn về Ví khi lệnh khác cùng tháng bị từ chối; thiếu khi API cũ. */
  taxRefunded?: number;
  fee: number;
  method: 'BANK' | 'WALLET_BALANCE' | 'ZALOPAY';
  status: PayoutStatus;
  rejectionReason: string | null;
  bankRef: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
}

export const getAffiliateMe = (http: HttpClient) => http.get<AffiliateMe>('/affiliate/me');
export const getCtvTiers = (http: HttpClient) => http.get<CtvTiersResponse>('/affiliate/tiers');
export const getCtvMilestones = (http: HttpClient) =>
  http.get<CtvMilestonesResponse>('/affiliate/milestones');
/** Nhận thưởng mốc → cộng Điểm Xanh. `month` ('YYYY-MM') bỏ trống = tháng này; chỉ nhận tháng này/tháng trước. */
export const claimCtvMilestone = (http: HttpClient, milestoneId: string, month?: string) =>
  http.post<{ success: boolean; message: string; rewardPoints: number; monthKey: string }>(
    `/affiliate/milestones/${encodeURIComponent(milestoneId)}/claim`,
    month ? { month } : {},
  );
/** `termsVersion` = phiên bản điều khoản hoa hồng/thuế người dùng vừa tick đồng ý (máy chủ lưu lại). */
export const registerAffiliate = (http: HttpClient, termsVersion?: string) =>
  http.post<{ ok: boolean; referralCode: string }>(
    '/affiliate/register',
    termsVersion ? { termsVersion } : {},
  );
export const getAffiliateDashboard = (http: HttpClient) =>
  http.get<AffiliateDashboard>('/affiliate/dashboard');
export const getAffiliateLinks = (http: HttpClient) =>
  http.get<AffiliateLink[]>('/affiliate/links');
export const createAffiliateLink = (http: HttpClient, targetType: string, targetId?: string) =>
  http.post<AffiliateLink>('/affiliate/links', { targetType, targetId });
export const getCommissions = (http: HttpClient) =>
  http.get<Commission[]>('/affiliate/commissions');
export interface PayoutResult {
  ok: boolean;
  method?: string;
  credited?: number;
  note?: string;
  payoutId?: string;
  status?: string;
}
export const getMyPayouts = (http: HttpClient) => http.get<AffiliatePayout[]>('/affiliate/payouts');
/**
 * Chuyển toàn bộ hoa hồng khả dụng vào Ví Tubu (rút về ngân hàng/ZaloPay đã bỏ). Gửi lại cùng Idempotency-Key (chạm đúp, thử lại
 * sau lỗi mạng) không tạo lệnh thứ hai. `taxId`: MST/CCCD khai lần đầu khi lần chuyển bị khấu trừ thuế TNCN.
 */
export const requestPayout = (http: HttpClient, amount: number, idempotencyKey: string, taxId?: string) =>
  http.post<PayoutResult>(
    '/affiliate/payouts',
    { amount, method: 'WALLET_BALANCE', ...(taxId ? { taxId } : {}) },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );

export interface TaxStatement {
  year: number;
  fullName: string | null;
  taxId: string | null;
  items: {
    id: string;
    paidAt: string;
    method: string;
    grossAmount: number;
    taxWithheld: number;
    amount: number;
    taxId: string | null;
  }[];
  totals: { grossAmount: number; taxWithheld: number; netAmount: number };
}
/** Bảng kê thu nhập hoa hồng và thuế TNCN đã khấu trừ trong năm (mặc định năm nay). */
export const getTaxStatement = (http: HttpClient, year?: number) =>
  http.get<TaxStatement>('/affiliate/tax-statement', { query: year ? { year } : {} });

export interface StorefrontStat {
  slug: string;
  title?: string;
  orders: number;
  revenue: number;
  commission: number;
}
export interface ProductStat {
  productName: string;
  commission: number;
  orders: number;
}
export const getStorefrontAnalytics = (http: HttpClient) =>
  http.get<{ storefronts: StorefrontStat[] }>('/affiliate/analytics/storefronts');
export const getProductBreakdown = (http: HttpClient) =>
  http.get<ProductStat[]>('/affiliate/analytics/products');

/** +1 click cho link CTV có `?l=<mã link>`. Chọn mã và chặn báo lặp trong phiên là việc của nơi gọi; lỗi nuốt vì số click không đáng làm hỏng việc mở trang. */
export const reportLinkClick = (http: HttpClient, shortCode: string): void => {
  void http.post('/affiliate/click', { shortCode }).catch(() => {});
};

/** Ghi "chạm" giới thiệu để attribution sống 3 ngày (fallback khi phiên mất). Fire-and-forget. */
export const recordReferralTouch = (
  http: HttpClient,
  dto: { referralCode: string; storefrontSlug?: string; kind?: 'ctv' | 'brand' },
) => http.post<{ ok: boolean }>('/affiliate/touch', dto);

// ── CTV lên đơn hộ khách (CTV đặt hộ, hưởng hoa hồng) ──
export interface CtvOrderItemInput {
  variationId: string;
  quantity: number;
}
export interface CtvOrderCustomerInput {
  recipient: string;
  phone: string;
  province: string;
  district?: string;
  ward: string;
  street: string;
  provinceCode: string;
  districtCode?: string;
  wardCode: string;
}
export interface CtvOrderItemResult {
  productName: string;
  variationName: string;
  unitPrice: number;
  quantity: number;
  total: number;
}
export interface CtvOrderResult {
  id: string;
  code: string;
  total: number;
  status: string;
  items: CtvOrderItemResult[];
}
export interface CtvOrderInput {
  items: CtvOrderItemInput[];
  customer: CtvOrderCustomerInput;
  paymentMethod: 'COD' | 'BANK_TRANSFER';
  note?: string;
  /** Tổng CTV đang thấy ở báo giá: tổng lúc tạo đơn cao hơn thì máy chủ trả TOTAL_CHANGED thay vì ghi đơn đắt hơn. */
  expectedTotal?: number;
}
/** Gửi lại cùng Idempotency-Key (bấm lại sau quá thời gian/mất mạng) thì máy chủ trả lại đơn đã tạo, không tạo đơn thứ hai. */
export const createCtvOrder = (http: HttpClient, dto: CtvOrderInput, idempotencyKey: string) =>
  http.post<CtvOrderResult>('/affiliate/orders', dto, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export interface CtvOrderQuoteItem {
  variationId: string;
  unitPrice: number;
  quantity: number;
  total: number;
  isFlash: boolean;
  /** Vì sao dòng giờ vàng đang tính giá thường (vượt số suất còn mua được); null = không có. */
  flashLimitNotice: string | null;
}
export interface CtvOrderQuote {
  items: CtvOrderQuoteItem[];
  goods: number;
  shippingFee: number;
  total: number;
  /** Cách thanh toán máy chủ sẽ từ chối cho đơn này kèm lý do (vd COD vượt trần mỗi đơn); API cũ không trả. */
  blockedPaymentMethods?: Partial<Record<'COD' | 'BANK_TRANSFER', string>>;
}
/** Báo giá đơn hộ: đúng số tiền máy chủ sẽ ghi khi tạo đơn (giờ vàng như khách tự đặt, phí giao). Không giữ kho hay suất. */
export const quoteCtvOrder = (http: HttpClient, items: CtvOrderItemInput[]) =>
  http.post<CtvOrderQuote>('/affiliate/orders/quote', { items });

// ── Content Kit (bộ nội dung bán hàng theo từng sản phẩm) ──
export interface ContentKitFaq {
  q: string;
  a: string;
}
export interface ContentKit {
  productName: string;
  images: string[];
  /** Đã tự chèn tên CTV + link giới thiệu (thay {ten_ctv}/{link}) — copy là dùng luôn. */
  captions: string[];
  usps: string[];
  faqs: ContentKitFaq[];
  videoUrls: string[];
  shareLink: string;
}
export const fetchContentKit = (http: HttpClient, slug: string) =>
  http.get<ContentKit>(`/affiliate/content-kit/${slug}`);

import { api } from './api';
import { getSessionAttribution } from '../utils/entry-source';

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
  /** Thuế TNCN bị khấu trừ nếu rút hết số khả dụng ngay bây giờ (cộng dồn tháng VN); thiếu khi API cũ. */
  withdrawTaxPreview?: number;
  /** Đã duyệt nhưng nằm trong lệnh rút ngân hàng chưa chuyển tiền; thiếu khi API cũ. */
  withdrawingCommission?: number;
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

export const getAffiliateMe = () => api.get<AffiliateMe>('/affiliate/me').then((r) => r.data);
export const getCtvTiers = () => api.get<CtvTiersResponse>('/affiliate/tiers').then((r) => r.data);
export const getCtvMilestones = () => api.get<CtvMilestonesResponse>('/affiliate/milestones').then((r) => r.data);
/** Nhận thưởng mốc → cộng Điểm Xanh. `month` ('YYYY-MM') bỏ trống = tháng này; chỉ nhận tháng này/tháng trước. */
export const claimCtvMilestone = (milestoneId: string, month?: string) =>
  api
    .post<{ success: boolean; message: string; rewardPoints: number; monthKey: string }>(
      `/affiliate/milestones/${encodeURIComponent(milestoneId)}/claim`,
      month ? { month } : {},
    )
    .then((r) => r.data);
/** `termsVersion` = phiên bản điều khoản hoa hồng/thuế người dùng vừa tick đồng ý (máy chủ lưu lại). */
export const registerAffiliate = (termsVersion?: string) =>
  api.post<{ ok: boolean; referralCode: string }>('/affiliate/register', termsVersion ? { termsVersion } : {}).then((r) => r.data);
export const getAffiliateDashboard = () =>
  api.get<AffiliateDashboard>('/affiliate/dashboard').then((r) => r.data);
export const getAffiliateLinks = () =>
  api.get<AffiliateLink[]>('/affiliate/links').then((r) => r.data);
export const createAffiliateLink = (targetType: string, targetId?: string) =>
  api.post<AffiliateLink>('/affiliate/links', { targetType, targetId }).then((r) => r.data);
export const getCommissions = () =>
  api.get<Commission[]>('/affiliate/commissions').then((r) => r.data);
export interface PayoutResult {
  ok: boolean;
  method?: string;
  credited?: number;
  note?: string;
  payoutId?: string;
  status?: string;
}
export const getMyPayouts = () => api.get<AffiliatePayout[]>('/affiliate/payouts').then((r) => r.data);
/**
 * Gửi lại cùng Idempotency-Key (chạm đúp, thử lại sau lỗi mạng) không tạo lệnh rút thứ hai. `taxId`: MST/CCCD khai lần đầu khi
 * lần rút bị khấu trừ thuế TNCN.
 */
export const requestPayout = (
  amount: number,
  method: 'BANK' | 'WALLET_BALANCE' | 'ZALOPAY',
  bankInfo: { bankName: string; accountNumber: string; accountName: string } | undefined,
  idempotencyKey: string,
  taxId?: string,
) =>
  api
    .post<PayoutResult>(
      '/affiliate/payouts',
      { amount, method, bankInfo, ...(taxId ? { taxId } : {}) },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
    .then((r) => r.data);

export interface TaxStatement {
  year: number;
  fullName: string | null;
  taxId: string | null;
  items: { id: string; paidAt: string; method: string; grossAmount: number; taxWithheld: number; amount: number; taxId: string | null }[];
  totals: { grossAmount: number; taxWithheld: number; netAmount: number };
}
/** Bảng kê thu nhập hoa hồng và thuế TNCN đã khấu trừ trong năm (mặc định năm nay). */
export const getTaxStatement = (year?: number) =>
  api.get<TaxStatement>('/affiliate/tax-statement', { params: year ? { year } : {} }).then((r) => r.data);

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
export const getStorefrontAnalytics = () =>
  api.get('/affiliate/analytics/storefronts').then((r) => r.data as { storefronts: StorefrontStat[] });
export const getProductBreakdown = () =>
  api.get('/affiliate/analytics/products').then((r) => r.data as ProductStat[]);

let linkClickReported = false;

/**
 * Mở app bằng link CTV có `?l=<mã link>` (affiliate.tsx tạo) → báo API +1 click cho link đó. Một lần mỗi phiên app: mở lại từ nền
 * không tính thêm. Fire-and-forget: con số click không đáng làm hỏng việc mở app.
 */
export function reportLaunchLinkClick(): void {
  const shortCode = getSessionAttribution()?.linkCode;
  if (!shortCode || linkClickReported) return;
  linkClickReported = true;
  void api.post('/affiliate/click', { shortCode }).catch(() => {});
}

export function __resetLinkClickForTest(): void {
  linkClickReported = false;
}

/** Ghi "chạm" giới thiệu để attribution sống 3 ngày (fallback khi phiên mất). Fire-and-forget. */
export const recordReferralTouch = (dto: { referralCode: string; storefrontSlug?: string; kind?: 'ctv' | 'brand' }) =>
  api.post('/affiliate/touch', dto).then((r) => r.data as { ok: boolean });

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
export const createCtvOrder = (dto: CtvOrderInput, idempotencyKey: string) =>
  api
    .post<CtvOrderResult>('/affiliate/orders', dto, { headers: { 'Idempotency-Key': idempotencyKey } })
    .then((r) => r.data);

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
export const quoteCtvOrder = (items: CtvOrderItemInput[]) =>
  api.post<CtvOrderQuote>('/affiliate/orders/quote', { items }).then((r) => r.data);

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
export const fetchContentKit = (slug: string) =>
  api.get<ContentKit>(`/affiliate/content-kit/${slug}`).then((r) => r.data);

import type { OrderDTO } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import type { InvoiceRequest } from './checkout';

export type DealerStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface DealerOrderRules {
  minOrderValue: number;
  freeShipThreshold: number;
  shippingFee: number;
}

export interface DealerMe {
  isDealer: boolean;
  status: DealerStatus;
  tier: { id: string; name: string; creditLimit: number } | null;
  currentDebt: number;
  /** Đại lý có gian hàng đối tác thật; thiếu (API cũ) thì coi như không có. */
  hasPartnerStorefront?: boolean;
  /** Luật đơn sỉ do máy chủ cấu hình; thiếu thì màn đặt đơn không tự tính phí/tối thiểu. */
  orderRules?: DealerOrderRules;
  /** Lý do admin từ chối hồ sơ gần nhất (chỉ có khi status REJECTED). */
  rejectionReason?: string | null;
}

export interface DealerApplyInput {
  businessName: string;
  taxCode?: string;
  ownerName: string;
  phone: string;
  address: string;
  cccdFrontUrl: string;
  cccdBackUrl: string;
  storeFrontUrl?: string;
  monthlyVolumeEstimate?: number;
  notes?: string;
}

export interface PricelistRow {
  variationId: string;
  sku: string;
  product: string;
  brand: string;
  variation: string;
  retailPrice: number;
  dealerPrice: number;
  discountPct: number;
  stock: number;
}

export interface CreditEntry {
  id: string;
  delta: number;
  refType: string;
  note: string | null;
  createdAt: string;
}

export const getDealerMe = (http: HttpClient) => http.get<DealerMe>('/dealer/me');
export const applyDealer = (http: HttpClient, data: DealerApplyInput) =>
  http.post('/dealer/apply', data);
export const getPricelist = (http: HttpClient) => http.get<PricelistRow[]>('/dealer/pricelist');
/**
 * Đặt đơn đại lý kèm Idempotency-Key (mirror checkout.placeOrder/wallet.withdraw) — double-tap/retry mạng không tạo đơn công nợ đôi.
 * `invoiceRequest` có thì đơn kèm yêu cầu xuất hoá đơn VAT; không có thì thân yêu cầu không có trường này (máy chủ cũ cùng hợp đồng).
 */
export const placeDealerOrder = (
  http: HttpClient,
  items: { variationId: string; quantity: number }[],
  paymentMethod: 'CREDIT' | 'PREPAID',
  note?: string,
  idempotencyKey?: string,
  invoiceRequest?: InvoiceRequest,
) =>
    http.post<OrderDTO>(
      '/dealer/orders',
      { items, paymentMethod, note, ...(invoiceRequest ? { invoiceRequest } : {}) },
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
    );

// ── Tiến tới bậc chiết khấu kế tiếp (doanh số tháng) ──
export interface DealerTierView {
  id: string;
  name: string;
  /** Doanh số tiền hàng một tháng để được xét vào bậc. */
  minOrderVolume: number;
  /** Chiết khấu chung của bậc, phần trăm nguyên. */
  discountPct: number;
}
export interface DealerTierProgress {
  /** Tháng theo giờ VN, "11/2026". */
  month: string;
  monthStart: string;
  monthEnd: string;
  /** Doanh số tháng ĐÃ CHỐT (đã thanh toán/ghi công nợ + đã đóng gói trở đi), tiền hàng không gồm phí giao. */
  volume: number;
  /** Đơn trong tháng còn chờ thanh toán/đóng gói. */
  pendingVolume: number;
  currentTier: DealerTierView | null;
  /** Bậc chiết khấu kế tiếp; null khi đã ở bậc cao nhất hoặc chưa được gán bậc. */
  nextTier: (DealerTierView & { toGo: number }) | null;
}
export const getDealerTierProgress = (http: HttpClient) => http.get<DealerTierProgress>('/dealer/tier-progress');

// ── Hoá đơn VAT của đại lý ──
/** Thông tin xuất hoá đơn điền sẵn. `saved` = đại lý đã lưu; false = lấy từ hồ sơ đăng ký đại lý (ô có thể trống). */
export interface DealerInvoiceProfile extends InvoiceRequest {
  saved: boolean;
}
export interface DealerInvoiceRequestResult {
  requested: string[];
  skipped: { code: string; reason: string }[];
  profile: DealerInvoiceProfile | null;
}
export const getDealerInvoiceProfile = (http: HttpClient) => http.get<DealerInvoiceProfile>('/dealer/invoice-profile');
export const saveDealerInvoiceProfile = (http: HttpClient, invoice: InvoiceRequest) =>
  http.put<DealerInvoiceProfile>('/dealer/invoice-profile', invoice);
/** Gửi yêu cầu hoá đơn VAT cho nhiều đơn đã đặt; `save` lưu thông tin làm mặc định cho lần sau. */
export const requestDealerInvoices = (http: HttpClient, orderCodes: string[], invoice: InvoiceRequest, save: boolean) =>
  http.post<DealerInvoiceRequestResult>('/dealer/orders/invoice-request', { orderCodes, invoice, save });
export const getDealerOrders = (http: HttpClient) => http.get<OrderDTO[]>('/dealer/orders');

// ── Đặt lại đơn tháng trước (một chạm, ghi công nợ) ──
export interface DealerLastMonthReorderLine {
  variationId: string;
  sku: string;
  /** "Sản phẩm – Phân loại" như trên đơn cũ. */
  name: string;
  quantity: number;
  /** Giá đại lý hôm nay. */
  unitPrice: number;
  lineTotal: number;
  stock: number;
}
export type DealerLastMonthReorderBlockCode =
  | 'NO_ORDERS'
  | 'NOTHING_SELLABLE'
  | 'TOO_MANY_LINES'
  | 'BELOW_MIN'
  | 'OVER_MAX'
  | 'NO_TIER'
  | 'OVERDUE'
  | 'OVER_LIMIT';
export interface DealerLastMonthReorder {
  /** Tháng nguồn theo giờ VN, "10/2026". */
  month: string;
  /** Mã các đơn đã nhận của tháng đó (mới nhất trước); rỗng thì không có gì để đặt lại. */
  orderCodes: string[];
  lines: DealerLastMonthReorderLine[];
  /** Tên mặt hàng không còn bán sỉ, đã bỏ khỏi đơn mới. */
  skipped: string[];
  goodsTotal: number;
  shippingFee: number;
  total: number;
  /** Hạn mức đọc cùng một lần với dư nợ: `available` không âm, `after` âm là phần vượt. */
  credit: { limit: number; debt: number; available: number; after: number };
  /** Dấu của bản xem trước, gửi lại khi đặt để máy chủ từ chối nếu giá hay tồn đã đổi. */
  quote: string;
  /** Lý do không ghi công nợ được bằng một chạm; null là đặt được. */
  block: { code: DealerLastMonthReorderBlockCode; message: string } | null;
}
export const getDealerLastMonthReorder = (http: HttpClient) => http.get<DealerLastMonthReorder>('/dealer/reorder-last-month');
/**
 * Tạo đơn ghi công nợ từ bản xem trước `quote`. Idempotency-Key bắt buộc: giữ nguyên qua mọi lần bấm lại tới khi đặt xong, máy chủ trả lại
 * đơn đã tạo cho cùng khoá. 409 `DEALER_REORDER_CHANGED` khi giá, tồn hay phí giao đã đổi so với bản xem trước.
 */
export const placeDealerLastMonthReorder = (http: HttpClient, quote: string, idempotencyKey: string) =>
  http.post<OrderDTO>('/dealer/reorder-last-month', { quote }, { headers: { 'Idempotency-Key': idempotencyKey } });
export const getCreditLedger = (http: HttpClient) =>
  http.get<{ balance: number; entries: CreditEntry[] }>('/dealer/credit-ledger');
/** Báo đã chuyển khoản trả nợ, kèm Idempotency-Key BẮT BUỘC (mirror placeDealerOrder/wallet.withdraw)
 * — double-tap/retry mạng của 1 lần báo không được trừ nợ 2 lần. */
export const payCredit = (http: HttpClient, amount: number, idempotencyKey: string, note?: string) =>
    http.post<{ ok: boolean }>(
      '/dealer/credit-payment',
      { amount, note },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );

// ── Báo cáo quý (#71) ──
export interface QuarterlyReport {
  quarter: string;
  periodStart: string;
  periodEnd: string;
  /** Doanh số ĐÃ CHỐT (đã thanh toán/ghi công nợ + đã đóng gói trở đi) — nền tính thưởng. */
  revenue: number;
  orderCount: number;
  /** Đơn trong quý chưa thanh toán / chưa đóng gói — chưa tính thưởng. */
  pendingRevenue: number;
  pendingOrderCount: number;
  bonusPct: number;
  bonusAmount: number;
  nextTier: { min: number; pct: number; toNext: number } | null;
  tiers: { min: number; pct: number }[];
}
export const getQuarterlyReport = (http: HttpClient) =>
  http.get<QuarterlyReport>('/dealer/quarterly-report');

/** Vòng đời yêu cầu nhận thưởng: PENDING → APPROVED | REJECTED; APPROVED → PAID. */
export type DealerRewardClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface DealerRewardProgress {
  id: string;
  type: 'TOUR' | 'GIFT' | 'OTHER';
  title: string;
  description: string | null;
  threshold: number;
  period: string;
  /** 'Q3/2026' | '2026' — gửi kèm khi yêu cầu nhận thưởng. */
  periodKey: string;
  periodLabel: string;
  /** false = dòng của kỳ trước (còn trong thời gian gia hạn / đã có yêu cầu). */
  isCurrentPeriod: boolean;
  /** Doanh số ĐÃ CHỐT của kỳ. */
  volume: number;
  /** Đơn trong kỳ chưa thanh toán / chưa đóng gói — chưa tính. */
  pendingVolume: number;
  achieved: boolean;
  toGo: number;
  claimStatus: DealerRewardClaimStatus | null;
  claimId: string | null;
  rejectionReason: string | null;
  /** Mốc (loại trừ) hết hạn gửi yêu cầu cho kỳ này. */
  claimDeadline: string;
  canClaim: boolean;
}
export interface DealerRewardsView {
  quarter: string;
  year: number;
  quarterVolume: number;
  yearVolume: number;
  quarterPendingVolume: number;
  yearPendingVolume: number;
  claimGraceDays: number;
  rewards: DealerRewardProgress[];
}
export const getDealerRewards = (http: HttpClient) =>
  http.get<DealerRewardsView>('/dealer/rewards');

export interface DealerRewardClaimResult {
  success: boolean;
  /** true = đã gửi trước đó (bấm lại/2 request) — backend trả yêu cầu cũ, không tạo thêm. */
  alreadyClaimed: boolean;
  claimStatus: DealerRewardClaimStatus;
  message: string;
  claim: { id: string; status: DealerRewardClaimStatus; periodKey: string; volumeAtClaim: number; createdAt: string };
  reward: { id: string | null; title: string; type: string; threshold: number };
  periodKey: string;
  periodLabel: string;
  currentVolume: number;
}
/** Gửi yêu cầu nhận thưởng mốc cho 1 kỳ — idempotent phía backend (đại lý + kỳ + phần thưởng). */
export const claimDealerReward = (http: HttpClient, rewardId: string, periodKey?: string, note?: string) =>
    http.post<DealerRewardClaimResult>(`/dealer/rewards/${encodeURIComponent(rewardId)}/claim`, { periodKey, note });

// ── Mẫu đơn lưu sẵn (#64) ──
export interface DealerTemplate {
  id: string;
  name: string;
  items: { variationId: string; quantity: number }[];
  createdAt: string;
}
export const getTemplates = (http: HttpClient) => http.get<DealerTemplate[]>('/dealer/templates');
export const saveTemplate = (http: HttpClient, name: string, items: { variationId: string; quantity: number }[]) =>
  http.post<DealerTemplate>('/dealer/templates', { name, items });
export const deleteTemplate = (http: HttpClient, id: string) =>
  http.delete<{ ok: boolean }>(`/dealer/templates/${id}`);

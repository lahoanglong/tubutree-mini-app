import type { WastePublicFlags } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

export interface ShippingEta {
  minDays: number;
  maxDays: number;
}
export interface PublicConfig {
  freeshipThreshold: number;
  /** Tỉ lệ giảm khi đặt định kỳ, dạng phân số (0.12 = 12%). */
  subscribeDiscountPct: number;
  /** Hệ số khi CTV nhận hoa hồng về Ví Tubu (×1.5). */
  affiliateWalletMultiplier: number;
  /** Mốc tối thiểu rút hoa hồng về ngân hàng. */
  affiliateMinWithdrawBank: number;
  /** Thuế TNCN khấu trừ khi rút hoa hồng: `pct` (phân số) áp cho lần rút từ `threshold`; thiếu khi API cũ. */
  affiliatePitWithhold?: { pct: number; threshold: number };
  /** Số ngày giữ trước khi hoàn tiền sàn ngoài về Ví. */
  cashbackHoldDays: number;
  /** Cờ công khai của Đổi rác lấy quà (§11.5). */
  waste: WastePublicFlags;
  /** Khoảng ngày giao dự kiến — null/thiếu khi chủ shop chưa cấu hình (hoặc API cũ) → ẩn. */
  shippingEta?: ShippingEta | null;
  /** Mức giảm (% nguyên) và quy mô nhóm mua chung — thiếu khi API cũ → UI không hứa con số. */
  groupBuy?: { discountPct: number; targetSize: number };
  /** Số ngày được gửi yêu cầu đổi/trả kể từ khi giao (returns.window_days). */
  returnWindowDays?: number;
  /** Kênh hỗ trợ khách; từng trường null khi admin để trống. */
  support?: { hotline: string | null; email: string | null; zaloOaName: string | null };
  /** Số cho khách mới (D2-07): voucher chào mừng và freeship đơn đầu (mặc định bật từ 199.000đ). Thiếu khi API cũ → không hứa con số. */
  newCustomer?: {
    welcomeVoucher: { amount: number; minOrder: number };
    firstOrderFreeShip: { enabled: boolean; minSubtotal: number };
  };
  /**
   * Chi tiêu cho 1 Điểm Xanh được tích, số đồng được giảm khi dùng 1 điểm, trần % giá trị đơn trả được bằng điểm thường (0 = tắt)
   * và số tháng điểm thường có hạn. Thiếu khi API cũ; hai trường sau thiếu khi API chưa phát hành bản có chúng.
   */
  loyalty?: { earnPct?: number; marketplaceEarnPct?: number; marketplaceClaimEnabled?: boolean; vndPerPoint: number; vndPerPointRedeem: number; maxRedeemPct?: number; pointExpireMonths?: number };
  /** Cờ bố cục Trang chủ cho khách mới (home.new_customer_layout). Thiếu khi API cũ → bố cục cũ. */
  homeNewCustomerLayout?: boolean;
  /** AI tư vấn đang bật VÀ có provider dùng được (công tắc tắt khẩn cấp ở API). Thiếu khi API cũ → coi như tắt, ẩn lối vào. */
  aiAdvisorEnabled?: boolean;
  /** Cờ xem trước công khai bảng tin cộng đồng (community.public_preview). Thiếu khi API cũ → phải đăng nhập mới thấy. */
  communityPublicPreview?: boolean;
  /** Chiết khấu đại lý tối đa (phân số) và số giờ hẹn duyệt hồ sơ; null khi cấu hình hỏng, thiếu khi API cũ → UI bỏ con số. */
  dealer?: { maxDiscountPct: number | null; reviewHours: number | null };
  /** Trần Điểm Xanh thưởng một sự kiện cộng đồng (giới hạn của API). Thiếu khi API cũ. */
  community?: { eventRewardMaxPoints: number; zaloGroupUrl?: string | null; facebookUrl?: string | null; tiktokUrl?: string | null };
}

export const getPublicConfig = (http: HttpClient) => http.get<PublicConfig>('/config/public');

export interface FaqItem {
  q: string;
  a: string;
  cat: string;
}

interface FaqEntryDTO {
  id: string;
  category: string | null;
  question: string;
  answer: string;
}

export interface SupportContact {
  hotline: string | null;
  email: string | null;
  zaloOaName: string | null;
}

const DEFAULT_FAQ_CAT = 'Chung';

export const fetchFaqs = async (http: HttpClient): Promise<FaqItem[]> => {
  const rows = await http.get<FaqEntryDTO[]>('/faqs').then((r) => r.data);
  return rows.map((r) => ({ q: r.question, a: r.answer, cat: r.category?.trim() || DEFAULT_FAQ_CAT }));
};

/** Chuỗi rỗng/toàn khoảng trắng hoặc sai kiểu = chưa có giá trị: trang ẩn dòng đó thay vì hiện nhãn trống. */
const cleanText = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export const fetchSupportContact = async (http: HttpClient): Promise<SupportContact> => {
  const cfg = (await getPublicConfig(http)) as { support?: Partial<Record<keyof SupportContact, unknown>> };
  return {
    hotline: cleanText(cfg.support?.hotline),
    email: cleanText(cfg.support?.email),
    zaloOaName: cleanText(cfg.support?.zaloOaName),
  };
};

import { api } from '../services/api';
import { getPublicConfig, type PublicConfig } from '../services/shop-api';
import { formatVnd } from '../utils/format';
import { earnPctOf, percentLabel } from '../utils/loyalty-copy';

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

type FaqConfig = { loyalty?: Partial<Record<keyof NonNullable<PublicConfig['loyalty']>, unknown>>; returnWindowDays?: unknown };

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Câu trả lời "Điểm Xanh là gì": mọi con số lấy từ cấu hình công khai (admin đổi được). Thiếu hay hỏng thì bỏ riêng phần đó,
 * không điền số mặc định vì sẽ nói sai khi admin đã đổi.
 */
function pointsAnswer(loyalty: FaqConfig['loyalty']): string {
  const { earnPct, vndPerPoint, vndPerPointRedeem, maxRedeemPct, pointExpireMonths } = loyalty ?? {};
  const pct = earnPctOf({ earnPct: positive(earnPct) ? earnPct : undefined, vndPerPoint: positive(vndPerPoint) ? vndPerPoint : undefined });
  const earn = pct != null ? `Mỗi đơn đã giao tích ${percentLabel(pct)} tiền hàng thành Điểm Xanh.` : 'Mỗi đơn đã giao được tích Điểm Xanh.';
  let redeem = 'Điểm Xanh dùng để giảm giá khi thanh toán.';
  if (positive(vndPerPointRedeem)) {
    const value = formatVnd(vndPerPointRedeem);
    if (typeof maxRedeemPct !== 'number' || !Number.isFinite(maxRedeemPct) || maxRedeemPct < 0 || maxRedeemPct > 1) {
      redeem = `1 Điểm Xanh đổi ${value} khi thanh toán.`;
    } else if (maxRedeemPct === 0) {
      redeem = `1 Điểm Xanh đổi ${value} khi đổi mã giảm giá.`;
    } else {
      redeem = `1 Điểm Xanh đổi ${value} khi thanh toán, tối đa ${Math.round(maxRedeemPct * 100)}% giá trị đơn.`;
    }
  }
  const expiry = positive(pointExpireMonths) ? `Điểm có hạn ${pointExpireMonths} tháng.` : 'Điểm có hạn dùng.';
  // "100%" là luật cố định của lô điểm quy đổi từ xu cũ (không có khoá cấu hình), khác với trần % của điểm thường ở trên.
  const converted =
    'Điểm quy đổi từ xu cũ thì không hết hạn và trừ được tới 100% giá trị hàng khi thanh toán, nhưng không dùng để đổi mã giảm giá.';
  return [earn, redeem, expiry, converted].join(' ');
}

/**
 * Dùng khi admin chưa nhập FAQ nào hoặc gọi API lỗi, để trang không trống. `cfg` là cấu hình công khai (/config/public):
 * số trong câu trả lời đọc từ đó, chưa có (đang tải, API cũ, lỗi mạng) thì câu nói chung, không con số.
 */
export function fallbackFaq(cfg?: FaqConfig): FaqItem[] {
  const returnDays = positive(cfg?.returnWindowDays) ? `trong vòng ${cfg.returnWindowDays} ngày từ khi nhận` : 'trong thời hạn đổi/trả';
  return [
    {
      cat: 'Chung',
      q: 'Tubu Tree bán những gì?',
      a: 'Tubu Tree tuyển chọn sản phẩm sống xanh từ nhiều thương hiệu Việt: mỹ phẩm thiên nhiên, tẩy rửa sinh học, đồ cho mẹ & bé — ưu tiên thành phần lành tính, bao bì thân thiện môi trường.',
    },
    { cat: 'Điểm & Vườn', q: 'Điểm Xanh là gì và dùng thế nào?', a: pointsAnswer(cfg?.loyalty) },
    {
      cat: 'Mua sắm',
      q: 'Tôi thanh toán bằng cách nào?',
      a: 'Bạn có thể thanh toán khi nhận hàng (COD), chuyển khoản ngân hàng, trả bằng Ví Tubu. Dùng Điểm Xanh để giảm giá ngay ở bước thanh toán.',
    },
    {
      cat: 'Đổi trả',
      q: 'Chính sách đổi/trả thế nào?',
      a: `Chỉ đổi/trả khi sản phẩm bị lỗi nhà sản xuất (hỏng bao bì, sai HSD, sai mã, không đúng mô tả) ${returnDays}. Tubu chịu phí ship 2 chiều.`,
    },
  ];
}

const DEFAULT_CAT = 'Chung';

export async function fetchFaqs(): Promise<FaqItem[]> {
  const rows = await api.get<FaqEntryDTO[]>('/faqs').then((r) => r.data);
  return rows.map((r) => ({ q: r.question, a: r.answer, cat: r.category?.trim() || DEFAULT_CAT }));
}

/** Chuỗi rỗng/toàn khoảng trắng hoặc sai kiểu = chưa có giá trị: trang ẩn dòng đó thay vì hiện nhãn trống. */
const cleanText = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Khớp mặc định của API và web (DEFAULT_SUPPORT): khi không đọc được cấu hình vẫn còn đường liên hệ. */
export const DEFAULT_SUPPORT: SupportContact = { hotline: '0984 606 774', email: 'tubutree@gmail.com', zaloOaName: null };

export async function fetchSupportContact(): Promise<SupportContact> {
  const cfg = (await getPublicConfig()) as { support?: Partial<Record<keyof SupportContact, unknown>> };
  return {
    hotline: cleanText(cfg.support?.hotline),
    email: cleanText(cfg.support?.email),
    zaloOaName: cleanText(cfg.support?.zaloOaName),
  };
}

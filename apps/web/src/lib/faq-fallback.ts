import type { PublicConfig } from '@tubutree/app-core/api/config';
import { formatVnd } from './format-vnd';

export interface FaqView {
  q: string;
  a: string;
  cat: string;
}

type FaqConfig = { loyalty?: Partial<Record<keyof NonNullable<PublicConfig['loyalty']>, unknown>>; returnWindowDays?: unknown };

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Số thập phân kiểu Việt, bỏ ",0": 2.4 → "2,4", 5 → "5". */
const percentLabel = (pct: number) => `${String(Math.round(pct * 10) / 10).replace('.', ',')}%`;

/** Phần trăm tiền hàng tích thành điểm: ưu tiên `earnPct`, cấu hình cũ chỉ có `vndPerPoint` thì quy ngược; null khi không có số dùng được. */
function earnPctOf(earnPct: unknown, vndPerPoint: unknown): number | null {
  if (positive(earnPct)) return earnPct;
  return positive(vndPerPoint) ? 100 / vndPerPoint : null;
}

/**
 * Câu trả lời "Điểm Xanh là gì": mọi con số lấy từ cấu hình công khai (admin đổi được). Thiếu hay hỏng thì bỏ riêng phần đó,
 * không điền số mặc định vì sẽ nói sai khi admin đã đổi.
 */
function pointsAnswer(loyalty: FaqConfig['loyalty']): string {
  const { earnPct, vndPerPoint, vndPerPointRedeem, maxRedeemPct, pointExpireMonths } = loyalty ?? {};
  const pct = earnPctOf(earnPct, vndPerPoint);
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
 * Dùng khi admin chưa nhập FAQ nào hoặc gọi API lỗi, để trang không trống (cùng nội dung với `fallbackFaq` của Mini App).
 * `cfg` là cấu hình công khai (/config/public): chưa có (đang tải, API cũ, lỗi mạng) thì câu nói chung, không con số.
 */
export function fallbackFaq(cfg?: FaqConfig): FaqView[] {
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

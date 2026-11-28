import { formatVnNumber } from '../number-format';
import { ctvFunnel } from './affiliate-deep-link';
import { vnd } from './money';
import { shareOfferLine, type WelcomeOffer } from './share-offer';

/**
 * Thẻ chia sẻ ở tab Chia sẻ của trang CTV (Mini App `pages/affiliate.tsx`, web `/ctv`): mã giới thiệu, ưu đãi khách mới, hai nút một chạm
 * và ba số của CTV. Hai app chỉ vẽ; chữ và số nằm ở đây.
 */
export const CTV_SHARE_CARD_COPY = {
  codeLabel: 'Mã giới thiệu của bạn',
  shareZalo: 'Chia sẻ Zalo',
  copyLink: 'Sao chép link',
  copied: 'Đã sao chép link',
  copyFail: 'Không sao chép được — hãy chọn và chép thủ công.',
  metricsLabel: 'Số liệu của bạn',
  metricsScope: 'Lượt bấm đếm ở link rút gọn bạn tạo. Đơn và hoa hồng tính chung mọi kênh.',
  clicks: 'Lượt bấm',
  orders: 'Đơn thành công',
  pending: 'Hoa hồng chờ rút',
} as const;

/** Đường dẫn Trang chủ kèm mã giới thiệu; null khi chưa có mã (CTV chưa được cấp): không chia sẻ link thiếu mã, khách mua không tính hoa hồng. */
export function ctvReferralPath(code: string | null | undefined): string | null {
  const c = (code ?? '').trim();
  return c === '' ? null : `/?ref=${encodeURIComponent(c)}`;
}

/** Link tuyệt đối tới Trang chủ kèm mã: `baseUrl` là link Mini App (Zalo) hoặc SITE_URL của web. */
export function ctvReferralUrl(baseUrl: string, code: string | null | undefined): string | null {
  const path = ctvReferralPath(code);
  if (!path) return null;
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** Dòng ưu đãi khách mới trên thẻ: cùng câu và cùng số với lời mời kèm thẻ chia sẻ (mã chào mừng thật của Admin, không đoán số). */
export const ctvShareOfferLine = (offer: WelcomeOffer | null | undefined): string => shareOfferLine(offer);

export type CtvShareMetricKey = 'clicks' | 'orders' | 'pending';

export interface CtvShareMetric {
  key: CtvShareMetricKey;
  label: string;
  /** Đã định dạng: số có dấu chấm nghìn, hoa hồng có "đ". */
  value: string;
}

interface DashboardForStrip {
  totalClicks?: number;
  totalConversions?: number;
  pendingCommission?: number;
  withdrawableCommission?: number;
}

const money = (n: number | undefined): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

/**
 * Ba số: lượt bấm, đơn thành công (đếm chung mọi kênh, cùng nguồn `ctvFunnel` với dòng trước đây) và hoa hồng chưa vào Ví
 * (đang chờ duyệt cộng phần đã duyệt chờ chuyển). Thiếu số (API cũ) coi là 0.
 */
export function ctvShareMetrics(d: DashboardForStrip | undefined): CtvShareMetric[] {
  const f = ctvFunnel(d);
  return [
    { key: 'clicks', label: CTV_SHARE_CARD_COPY.clicks, value: formatVnNumber(f.clicks) },
    { key: 'orders', label: CTV_SHARE_CARD_COPY.orders, value: formatVnNumber(f.orders) },
    { key: 'pending', label: CTV_SHARE_CARD_COPY.pending, value: vnd(money(d?.pendingCommission) + money(d?.withdrawableCommission)) },
  ];
}

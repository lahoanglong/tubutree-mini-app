import { percentLabel } from './loyalty-copy';
import { formatVnNumber } from './number-format';

/**
 * Chữ của màn Quét mã (tab giữa thanh đáy, W42): Mini `/points/scan` và web `/quet-ma` cùng đọc ở đây để hai bên nói giống nhau. Từ W44 cả hai
 * bên đều gửi mã được (web có camera trình duyệt và ô nhập mã), chữ gửi mã và lịch sử dùng chung ở `marketplace-claim-copy.ts`.
 * Tỉ lệ tích đơn sàn lấy từ cấu hình công khai (`loyalty.marketplaceEarnPct`), không ghi cứng: cấu hình chưa về hay số hỏng thì bước 2
 * chỉ nói "tích Điểm Xanh" mà không hứa con số.
 */
export const MARKETPLACE_SCAN_COPY = {
  guideTitle: 'Đơn mua trên sàn cũng được tích điểm',
  step1: 'Quét mã vận đơn Shopee, TikTok, Lazada',
  step2Pct: 'Tích {pct} giá trị đơn thành Điểm Xanh',
  step2Plain: 'Tích Điểm Xanh theo giá trị đơn',
  step3: 'Dùng giảm thẳng khi mua trên Mini App, Web',
  /** Dòng gập hướng dẫn (W46): khách đã có đơn sàn trong lịch sử thì 3 bước thu về một dòng, chạm để mở. */
  guideToggle: 'Hướng dẫn quét mã',
  /**
   * Nút chính sau khi quét xong, khách đang có điểm dùng được. "đang có" tách rõ khỏi "{n} Điểm Xanh đang chờ cộng" của thẻ kết quả ngay trên
   * (W44, PO duyệt U2): số trên nút là điểm khách dùng được NGAY, không phải điểm của đơn vừa quét.
   */
  ctaUsePoints: 'Dùng {n} Điểm Xanh đang có',
  /** Nút chính sau khi quét xong ở Mini App, khách chưa có điểm dùng được (điểm của đơn vừa quét còn chờ; nút nói việc điểm sẽ làm: giảm lần mua sau). */
  ctaShop: 'Dùng điểm mua lần sau',
  /** Như `ctaShop` ở web: cùng chữ, nút dẫn về Trang chủ web. */
  ctaShopWeb: 'Dùng điểm mua lần sau',
  /** Liên kết chữ dưới nút chính sau khi quét xong (w55-01): xoá kết quả và quét mã khác. */
  scanAnother: 'Quét đơn khác',
  /** Tính năng chưa mở (cờ `loyalty.marketplace_claim_enabled` tắt), cùng ý với màn "sắp mở" của Mini App. */
  soonTitle: 'Tích điểm đơn sàn sắp mở',
  webSoonBody: 'Bạn cứ giữ lại phiếu giao hàng. Khi tính năng mở, bạn quét mã vận đơn ngay trên web hoặc trong Tubu Tree trên Zalo để tích điểm cho đơn này.',
} as const;

const okPct = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Ba bước hướng dẫn, theo đúng thứ tự vẽ. */
export function marketplaceScanSteps(marketplaceEarnPct: number | null | undefined): readonly [string, string, string] {
  const step2 = okPct(marketplaceEarnPct)
    ? MARKETPLACE_SCAN_COPY.step2Pct.replace('{pct}', percentLabel(marketplaceEarnPct))
    : MARKETPLACE_SCAN_COPY.step2Plain;
  return [MARKETPLACE_SCAN_COPY.step1, step2, MARKETPLACE_SCAN_COPY.step3];
}

/**
 * Hướng dẫn 3 bước gập thành một dòng (W46) khi khách đã từng gửi mã: lịch sử có đơn (`meta.total`) hay có mã đang tìm (`searching`). Lịch sử
 * chưa về (`undefined`) cũng gập, để khung quét không bị đẩy xuống khi danh sách về; lịch sử rỗng mới mở đủ 3 bước cho khách mới.
 */
export function scanGuideCollapsed(history: { meta: { total: number }; searching: readonly unknown[] } | undefined): boolean {
  if (!history) return true;
  return history.meta.total > 0 || history.searching.length > 0;
}

/**
 * Nhãn nút chính sau khi gửi mã thành công. Điểm của đơn vừa quét còn CHỜ (giao xong + hạn đối soát) nên nút chỉ nhắc số điểm khách đang
 * có và dùng được ngay ("đang có", khác "đang chờ cộng" ở thẻ kết quả); chưa có điểm hay chưa biết số dư thì mời mua sắm (thẻ kết quả ngay
 * trên đã nói ngày cộng). `surface` chỉ đổi câu mời mua sắm: Mini App nói "trên Mini App", web thì không.
 */
export function scanSuccessCtaLabel(availablePoints: number | null | undefined, surface: 'mini' | 'web' = 'mini'): string {
  const n = typeof availablePoints === 'number' && Number.isFinite(availablePoints) ? Math.floor(availablePoints) : 0;
  if (n > 0) return MARKETPLACE_SCAN_COPY.ctaUsePoints.replace('{n}', formatVnNumber(n));
  return surface === 'web' ? MARKETPLACE_SCAN_COPY.ctaShopWeb : MARKETPLACE_SCAN_COPY.ctaShop;
}

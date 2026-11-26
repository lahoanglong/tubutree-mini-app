import { percentLabel } from './loyalty-copy';
import { formatVnNumber } from './number-format';

/**
 * Chữ của màn Quét mã (tab giữa thanh đáy, W42): Mini `/points/scan` và web `/quet-ma` cùng đọc ở đây để hai bên nói giống nhau.
 * Tỉ lệ tích đơn sàn lấy từ cấu hình công khai (`loyalty.marketplaceEarnPct`), không ghi cứng: cấu hình chưa về hay số hỏng thì bước 2
 * chỉ nói "tích Điểm Xanh" mà không hứa con số.
 */
export const MARKETPLACE_SCAN_COPY = {
  guideTitle: 'Đơn mua trên sàn cũng được tích điểm',
  step1: 'Quét mã vận đơn Shopee, TikTok, Lazada',
  step2Pct: 'Tích {pct} giá trị đơn thành Điểm Xanh',
  step2Plain: 'Tích Điểm Xanh theo giá trị đơn',
  step3: 'Dùng giảm thẳng khi mua trên Mini App, Web',
  /** Nút chính sau khi quét xong, khách đang có điểm dùng được. */
  ctaUsePoints: 'Dùng {n} Điểm Xanh mua ngay',
  /** Nút chính sau khi quét xong, khách chưa có điểm (điểm của đơn vừa quét còn chờ). */
  ctaShop: 'Mua sắm ngay trên Mini App',
  /** Web: nút mở đúng màn quét của Mini App. */
  webOpenMiniApp: 'Mở Mini App để quét',
  webWhy: 'Quét mã cần camera và số điện thoại Zalo đã xác minh, nên làm trong Tubu Tree trên Zalo.',
  /** Web: tính năng chưa mở (cờ `loyalty.marketplace_claim_enabled` tắt), cùng ý với màn "sắp mở" của Mini App. */
  soonTitle: 'Tích điểm đơn sàn sắp mở',
  webSoonBody: 'Bạn cứ giữ lại phiếu giao hàng. Khi tính năng mở, hãy quét mã vận đơn trong Tubu Tree trên Zalo để tích điểm cho đơn này.',
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
 * Nhãn nút chính sau khi gửi mã thành công. Điểm của đơn vừa quét còn CHỜ (giao xong + hạn đối soát) nên nút chỉ nhắc số điểm khách đang
 * dùng được ngay; chưa có điểm hay chưa biết số dư thì mời mua sắm (thẻ kết quả ngay trên đã nói ngày cộng).
 */
export function scanSuccessCtaLabel(availablePoints: number | null | undefined): string {
  const n = typeof availablePoints === 'number' && Number.isFinite(availablePoints) ? Math.floor(availablePoints) : 0;
  return n > 0 ? MARKETPLACE_SCAN_COPY.ctaUsePoints.replace('{n}', formatVnNumber(n)) : MARKETPLACE_SCAN_COPY.ctaShop;
}

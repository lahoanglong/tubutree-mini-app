import { MARKETPLACE_SCAN_COPY, marketplaceScanSteps } from '@tubutree/app-core/marketplace-scan-guide';

/**
 * Hướng dẫn 3 bước của màn Quét mã, cùng chữ và cùng số đo với `ScanGuide` của Mini App (`pages/external-points.tsx`, lớp `.tubu-scan-guide`
 * ở `components/mini/mini.css`). Tỉ lệ tích đơn sàn đọc từ cấu hình công khai; chưa có thì bước 2 không hứa con số.
 */
export function ScanGuide({ marketplaceEarnPct }: { marketplaceEarnPct: number | null | undefined }) {
  return (
    <ol className="tubu-scan-guide" aria-label={MARKETPLACE_SCAN_COPY.guideTitle} data-testid="scan-guide">
      {marketplaceScanSteps(marketplaceEarnPct).map((step, i) => (
        <li key={step} className="tubu-scan-guide__step">
          <span aria-hidden="true" className="tubu-scan-guide__num">
            {i + 1}
          </span>
          <span className="tubu-scan-guide__text">{step}</span>
        </li>
      ))}
    </ol>
  );
}

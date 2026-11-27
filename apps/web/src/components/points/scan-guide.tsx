'use client';

import { useId, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { MARKETPLACE_SCAN_COPY, marketplaceScanSteps } from '@tubutree/app-core/marketplace-scan-guide';

/**
 * Hướng dẫn 3 bước của màn Quét mã, cùng chữ và cùng số đo với `ScanGuide` của Mini App (`pages/external-points.tsx`, lớp `.tubu-scan-guide`
 * ở `components/mini/mini.css`). Tỉ lệ tích đơn sàn đọc từ cấu hình công khai; chưa có thì bước 2 không hứa con số. `collapsed` (W46, khách đã
 * có đơn sàn, luật `scanGuideCollapsed`): chỉ còn dòng "Hướng dẫn quét mã", chạm để mở 3 bước, để khung quét lên gần đầu màn.
 */
export function ScanGuide({ marketplaceEarnPct, collapsed = false }: { marketplaceEarnPct: number | null | undefined; collapsed?: boolean }) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const showList = !collapsed || expanded;
  return (
    <>
      {collapsed && (
        <button
          type="button"
          className="tubu-scan-guide-toggle"
          aria-expanded={expanded}
          aria-controls={listId}
          data-testid="scan-guide-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          <Info aria-hidden="true" />
          {MARKETPLACE_SCAN_COPY.guideToggle}
          <ChevronDown aria-hidden="true" className="tubu-scan-guide-toggle__chevron" />
        </button>
      )}
      {showList && (
        <ol id={listId} className="tubu-scan-guide" aria-label={MARKETPLACE_SCAN_COPY.guideTitle} data-testid="scan-guide">
          {marketplaceScanSteps(marketplaceEarnPct).map((step, i) => (
            <li key={step} className="tubu-scan-guide__step">
              <span aria-hidden="true" className="tubu-scan-guide__num">
                {i + 1}
              </span>
              <span className="tubu-scan-guide__text">{step}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

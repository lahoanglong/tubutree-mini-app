'use client';

import { MARKETPLACE_SCAN_COPY } from '@tubutree/app-core/marketplace-scan-guide';
import { MiniAppOnlyNotice } from '@/components/mini-app-only-notice';
import { ScanGuide } from '@/components/points/scan-guide';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_NARROW } from '@/lib/page-frame';
import { usePublicConfig } from '@/lib/use-public-config';

/**
 * Tab giữa "Quét mã" của web (W42): cùng hướng dẫn 3 bước với Mini App `/points/scan` và một nút mở đúng màn quét trên Zalo. Gửi mã chỉ làm
 * trong Mini App (quyết định Q2: quét bằng camera Zalo, SĐT đã xác minh), nên trang này không có ô nhập mã.
 * Cờ `loyalty.marketplace_claim_enabled` tắt: chỉ báo "sắp mở", không hứa tỉ lệ tích và không mời mở màn quét đang đóng. Cấu hình chưa về: chỉ tiêu đề.
 */
export function ScanView() {
  const cfg = usePublicConfig();
  const enabled = cfg.isLoaded && cfg.loyalty?.marketplaceClaimEnabled === true;
  return (
    <main className={`${PAGE_NARROW} pb-6 pt-0 md:pt-6`}>
      <PageHeader title="Tích điểm đơn sàn" />
      {enabled && (
        <>
          <ScanGuide marketplaceEarnPct={cfg.loyalty?.marketplaceEarnPct} />
          <MiniAppOnlyNotice compact miniappPath="/points/scan" body={MARKETPLACE_SCAN_COPY.webWhy} ctaLabel={MARKETPLACE_SCAN_COPY.webOpenMiniApp} />
        </>
      )}
      {cfg.isLoaded && !enabled && (
        <section role="status" data-testid="scan-soon" className="py-10 text-center">
          <h2 className="font-semibold text-stone-900">{MARKETPLACE_SCAN_COPY.soonTitle}</h2>
          <p className="mx-auto mt-2 max-w-sm text-stone-700">{MARKETPLACE_SCAN_COPY.webSoonBody}</p>
        </section>
      )}
    </main>
  );
}

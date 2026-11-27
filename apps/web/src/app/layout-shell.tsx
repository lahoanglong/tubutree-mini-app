'use client';

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Providers } from './providers';
import SiteHeader from '@/components/site-header';
import HideOnPortals from '@/components/hide-on-portals';
import PortalHeader from '@/components/admin/portal-header';
import { ReferralCapture } from '@/components/storefront-tracker';
import { AppGates } from '@/components/app-gates';
import BottomNav from '@/components/bottom-nav';
import BackButton from '@/components/mini/back-button';
import { ErrorReporter } from '@/components/error-reporter';
import { EntrySourceCapture } from '@/components/entry-source-capture';
import { ScreenTracker } from '@/components/analytics/screen-tracker';
import { PdpNavSkeleton } from '@/components/skeletons/pdp-nav-skeleton';
import { SkipLink } from '@/components/skip-link';
import { MD_DOWN, useMediaQuery } from '@/lib/use-media-query';
import { MINI_APP_BAR_ATTR } from '@/lib/mini-app-attr';

/**
 * Cổng tải lười của "tự mở Mini App trên web điện thoại": chỉ khung nhìn điện thoại mới tải phần còn lại (đọc cờ, luật, lớp phủ, dải mời),
 * nên `lib/mini-app-auto-open.ts` không vào JS tải đầu. Server và lượt hydrate đầu là false nên HTML dựng sẵn không đổi.
 * Tự `import()` trong hiệu ứng thay vì `next/dynamic`: ranh giới Suspense của `next/dynamic` đặt cạnh nội dung trang làm thẻ `<meta>` của trang
 * cũ còn lại trong `<head>` sau khi chuyển trang phía client (hai `meta[name="robots"]` ở `/don` trên điện thoại, web-guest-checkout e2e).
 */
function MiniAppAutoOpenGate() {
  const mobile = useMediaQuery(MD_DOWN);
  const [AutoOpen, setAutoOpen] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!mobile || AutoOpen) return;
    let alive = true;
    import('@/components/layout/mini-app-auto-open')
      .then((m) => {
        if (alive) setAutoOpen(() => m.MiniAppAutoOpen);
      })
      .catch(() => {
        // Mạng chập chờn: bỏ qua tự mở ở lượt này, trang vẫn dùng bình thường; gỡ chỗ giữ cho dải mời (script ở <head> đã đoán) để không hở khoảng trống.
        document.documentElement.removeAttribute(MINI_APP_BAR_ATTR);
      });
    return () => {
      alive = false;
    };
  }, [mobile, AutoOpen]);
  return mobile && AutoOpen ? <AutoOpen /> : null;
}

/**
 * Phần client của khung trang chung, gom trong MỘT thành phần client: mỗi thành phần client mà layout server dựng trực tiếp thêm một dòng
 * tham chiếu vào dữ liệu RSC của MỌI trang, và dòng đó chép lại cả danh sách chunk của layout (~0,8 KB). Mười ba thành phần riêng là ~10 KB
 * HTML trên mỗi trang. Phần server (đo tốc độ, chân trang, nội dung trang) đi vào qua prop, đúng chỗ cũ.
 */
export function LayoutShell({ vitals, footer, children }: { vitals: ReactNode; footer: ReactNode; children: ReactNode }) {
  return (
    <Providers>
      {/* Link CTV chia sẻ thường trỏ thẳng tới trang sản phẩm kèm ?ref= — bắt ở mọi trang. */}
      <ReferralCapture />
      <EntrySourceCapture />
      <ScreenTracker />
      {vitals}
      <ErrorReporter />
      <AppGates />
      <PdpNavSkeleton />
      <SkipLink />
      {/* Nút lùi nổi (position: fixed) đặt trước nội dung để thứ tự Tab/đọc màn hình khớp vị trí: ở điện thoại nó là điểm dừng đầu của trang con, không phải cuối cùng sau chân trang. */}
      <HideOnPortals>
        <BackButton className="md:!hidden" />
      </HideOnPortals>
      <HideOnPortals>
        <SiteHeader />
      </HideOnPortals>
      <PortalHeader />
      {/* Dải mời mở Zalo nằm trong luồng, ngay trên nội dung trang (không nổi đè danh sách). Ô bọc giữ sẵn đúng chiều cao dải khi script ở <head>
          đoán được dải sẽ hiện (`html[data-miniapp-bar]`, components/mini/mini.css), nên dải hiện sau không đẩy trang. */}
      <HideOnPortals>
        <div className="tubu-miniapp-slot">
          <MiniAppAutoOpenGate />
        </div>
      </HideOnPortals>
      {children}
      <HideOnPortals>{footer}</HideOnPortals>
      <HideOnPortals>
        <BottomNav />
      </HideOnPortals>
    </Providers>
  );
}

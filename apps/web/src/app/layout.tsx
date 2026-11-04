import type { Metadata, Viewport } from 'next';
import { preconnect, prefetchDNS } from 'react-dom';
import './globals.css';
import { Providers } from './providers';
import SiteHeader from '@/components/site-header';
import SiteFooter from '@/components/site-footer';
import HideOnPortals from '@/components/hide-on-portals';
import PortalHeader from '@/components/admin/portal-header';
import { ReferralCapture } from '@/components/storefront-tracker';
import { AppGates } from '@/components/app-gates';
import BottomNav from '@/components/bottom-nav';
import BackButton from '@/components/mini/back-button';
import { ErrorReporter } from '@/components/error-reporter';
import { EntrySourceCapture } from '@/components/entry-source-capture';
import { PdpNavSkeleton } from '@/components/skeletons/pdp-nav-skeleton';
import { apiImageOrigin } from '@/lib/image-origin';
import { SITE_URL, restoringBootScript, tenantHostBootScript } from '@/lib/site';

export const metadata: Metadata = {
  // metadataBase để ảnh openGraph khai bằng đường dẫn tương đối dựng được URL tuyệt đối (thiếu
  // nó thì link chia sẻ mất ảnh và Next cảnh báo mỗi lần build).
  metadataBase: new URL(SITE_URL),
  title: 'Tubu Tree — Sống xanh An Lành',
  description: 'Mỹ phẩm & đồ tiêu dùng thiên nhiên Tubu Tree.',
  openGraph: { type: 'website', siteName: 'Tubu Tree', locale: 'vi_VN' },
};

// viewport-fit=cover để env(safe-area-inset-bottom) có giá trị: thanh dính đáy chừa chỗ cho thanh home của iPhone.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Không `crossOrigin`: thẻ img (no-cors) dùng nhóm kết nối có thông tin xác thực; preconnect `anonymous` mở nhóm khác nên ảnh không dùng lại được.
  const imageOrigin = apiImageOrigin(process.env.NEXT_PUBLIC_API_BASE_URL);
  if (imageOrigin) {
    prefetchDNS(imageOrigin);
    preconnect(imageOrigin);
  }
  return (
    // suppressHydrationWarning: script ở <head> thêm data-tenant-host / data-restoring lên <html> trước khi React hydrate.
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: tenantHostBootScript() }} />
        <script dangerouslySetInnerHTML={{ __html: restoringBootScript() }} />
      </head>
      <body className="flex min-h-screen flex-col font-ui">
        <Providers>
          {/* Link CTV chia sẻ thường trỏ thẳng tới trang sản phẩm kèm ?ref= — bắt ở mọi trang. */}
          <ReferralCapture />
          <EntrySourceCapture />
          <ErrorReporter />
          <AppGates />
          <PdpNavSkeleton />
          <HideOnPortals>
            <SiteHeader />
          </HideOnPortals>
          <PortalHeader />
          {/* Khối bọc để trang ngắn vẫn đẩy chân trang xuống đáy; <main> bên trong giữ nguyên bố cục. */}
          <div className="flex-1">{children}</div>
          <HideOnPortals>
            <SiteFooter />
          </HideOnPortals>
          <HideOnPortals>
            <BackButton className="md:!hidden" />
            <BottomNav />
          </HideOnPortals>
        </Providers>
      </body>
    </html>
  );
}

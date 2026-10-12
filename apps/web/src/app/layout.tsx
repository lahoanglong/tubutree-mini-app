import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import SiteHeader from '@/components/site-header';
import SiteFooter from '@/components/site-footer';
import HideOnPortals from '@/components/hide-on-portals';
import { ReferralCapture } from '@/components/storefront-tracker';
import { SITE_URL, tenantHostBootScript } from '@/lib/site';

export const metadata: Metadata = {
  // metadataBase để ảnh openGraph khai bằng đường dẫn tương đối dựng được URL tuyệt đối (thiếu
  // nó thì link chia sẻ mất ảnh và Next cảnh báo mỗi lần build).
  metadataBase: new URL(SITE_URL),
  title: 'Tubu Tree — Sống xanh An Lành',
  description: 'Mỹ phẩm & đồ tiêu dùng thiên nhiên Tubu Tree.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: script ở <head> thêm data-tenant-host lên <html> trước khi React hydrate.
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: tenantHostBootScript() }} />
      </head>
      <body className="flex min-h-screen flex-col font-ui">
        <Providers>
          {/* Link CTV chia sẻ thường trỏ thẳng tới trang sản phẩm kèm ?ref= — bắt ở mọi trang. */}
          <ReferralCapture />
          <SiteHeader />
          {/* Khối bọc để trang ngắn vẫn đẩy chân trang xuống đáy; <main> bên trong giữ nguyên bố cục. */}
          <div className="flex-1">{children}</div>
          <HideOnPortals>
            <SiteFooter />
          </HideOnPortals>
        </Providers>
      </body>
    </html>
  );
}

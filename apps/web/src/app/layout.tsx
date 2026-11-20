import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import { preconnect, prefetchDNS } from 'react-dom';
import './globals.css';
import { LayoutShell } from './layout-shell';
import SiteFooter from '@/components/site-footer';
import { VitalsGate } from '@/lib/vitals/vitals-gate';
import { apiImageOrigin } from '@/lib/image-origin';
import { SITE_URL, fontScaleBootScript, offersHintBootScript, recentlyViewedBootScript, restoringBootScript, tenantHostBootScript } from '@/lib/site';

export const metadata: Metadata = {
  // metadataBase để ảnh openGraph khai bằng đường dẫn tương đối dựng được URL tuyệt đối (thiếu
  // nó thì link chia sẻ mất ảnh và Next cảnh báo mỗi lần build).
  metadataBase: new URL(SITE_URL),
  // Template chỉ áp lên title dạng chuỗi của trang con; trang cần tiêu đề nguyên văn (trang chủ) dùng `title: { absolute }`.
  title: { default: 'Tubu Tree — Sống xanh An Lành', template: '%s — Tubu Tree' },
  description: 'Mỹ phẩm và đồ tiêu dùng thiên nhiên Tubu Tree: sống xanh an lành cùng các thương hiệu Việt, từ chăm sóc da, mẹ và bé đến đồ dùng trong nhà.',
  openGraph: { type: 'website', siteName: 'Tubu Tree', locale: 'vi_VN' },
};

// viewport-fit=cover để env(safe-area-inset-bottom) có giá trị: thanh dính đáy chừa chỗ cho thanh home của iPhone.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

// Hai bản Inter dùng nhiều nhất (400 chữ thường, 600 nhãn và tiêu đề) tải trước để chữ không đổi phông giữa chừng; `new URL` ra đúng tệp mà
// @font-face của design-tokens (globals.css) trỏ tới, nên không tải trùng. 500 và 700 vẫn tải khi cần.
const PRELOAD_FONTS = [
  new URL('../../../../packages/design-tokens/src/fonts/inter-400.woff2', import.meta.url),
  new URL('../../../../packages/design-tokens/src/fonts/inter-600.woff2', import.meta.url),
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Không `crossOrigin`: thẻ img (no-cors) dùng nhóm kết nối có thông tin xác thực; preconnect `anonymous` mở nhóm khác nên ảnh không dùng lại được.
  const imageOrigin = apiImageOrigin(process.env.NEXT_PUBLIC_API_BASE_URL);
  if (imageOrigin) {
    prefetchDNS(imageOrigin);
    preconnect(imageOrigin);
  }
  return (
    // suppressHydrationWarning: script ở <head> thêm data-tenant-host / data-restoring / data-has-recent / data-has-offers / data-font-scale + font-size lên <html> trước khi React hydrate.
    <html lang="vi" suppressHydrationWarning>
      <head>
        {PRELOAD_FONTS.map((u) => (
          <link key={u.pathname} rel="preload" href={u.pathname} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
        <script dangerouslySetInnerHTML={{ __html: tenantHostBootScript() }} />
        <script dangerouslySetInnerHTML={{ __html: restoringBootScript() }} />
        <script dangerouslySetInnerHTML={{ __html: recentlyViewedBootScript() }} />
        <script dangerouslySetInnerHTML={{ __html: fontScaleBootScript() }} />
        <script dangerouslySetInnerHTML={{ __html: offersHintBootScript() }} />
      </head>
      <body className="flex min-h-screen flex-col font-ui">
        {/* Thanh đầu, nút lùi, thanh đáy và các bộ bắt sự kiện nằm trong LayoutShell (một thành phần client: ít dòng tham chiếu RSC trong HTML mỗi trang). */}
        <LayoutShell
          // Cờ đo tốc độ đọc ở máy chủ (bất đồng bộ): ranh giới riêng để nó không bao giờ giữ khung trang lại.
          vitals={
            <Suspense fallback={null}>
              <VitalsGate />
            </Suspense>
          }
          footer={<SiteFooter />}
        >
          {/* Khối bọc cao ít nhất phần khung nhìn còn lại dưới thanh đầu: chân trang luôn bắt đầu ở mép dưới màn đầu, nên khi nội dung thay khung chờ
              (dài ra hay ngắn lại) chân trang chỉ dịch ngoài tầm nhìn, không gây CLS. <main> bên trong giữ nguyên bố cục. Đích của liên kết bỏ qua tự nhận tabindex khi được kích hoạt (SkipLink). */}
          <div id="main-content" className="flex-1 min-h-[calc(100svh_-_var(--header-h))] outline-none">
            {children}
          </div>
        </LayoutShell>
      </body>
    </html>
  );
}

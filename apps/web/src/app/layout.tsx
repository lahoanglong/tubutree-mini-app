import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import SiteHeader from '@/components/site-header';
import { ReferralCapture } from '@/components/storefront-tracker';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  // metadataBase để ảnh openGraph khai bằng đường dẫn tương đối dựng được URL tuyệt đối (thiếu
  // nó thì link chia sẻ mất ảnh và Next cảnh báo mỗi lần build).
  metadataBase: new URL(SITE_URL),
  title: 'Tubu Tree — Sống xanh An Lành',
  description: 'Mỹ phẩm & đồ tiêu dùng thiên nhiên Tubu Tree.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="font-sans">
        <Providers>
          {/* Link CTV chia sẻ thường trỏ thẳng tới trang sản phẩm kèm ?ref= — bắt ở mọi trang. */}
          <ReferralCapture />
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { LandingJsonLd } from '@/components/seo/landing-json-ld';
import { landingMetadata } from '@/lib/landing-seo';
import { zaloWebViewBootScript } from '@/lib/zalo-webview';

export const metadata: Metadata = landingMetadata('dealer');

export default function DealerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Chạy trước khi vẽ nội dung bên dưới: đặt data-zalo-webview lên <html> để ZaloWebViewGate giấu trang thật ngay khung hình đầu. */}
      <script dangerouslySetInnerHTML={{ __html: zaloWebViewBootScript() }} />
      {children}
      <LandingJsonLd landing="dealer" />
    </>
  );
}

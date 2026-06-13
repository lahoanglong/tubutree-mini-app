import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import SiteHeader from '@/components/site-header';

export const metadata: Metadata = {
  title: 'Tubu Tree — Sống xanh An Lành',
  description: 'Mỹ phẩm & đồ tiêu dùng thiên nhiên Tubu Tree.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="font-sans">
        <Providers>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}

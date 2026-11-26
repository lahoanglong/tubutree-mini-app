import type { Metadata } from 'next';
import { staticPageMetadata } from '@/lib/page-seo';
import { ScanView } from './scan-view';

const SEO = {
  path: '/quet-ma',
  title: 'Tích điểm đơn sàn',
  description: 'Quét mã vận đơn Shopee, TikTok, Lazada trong Tubu Tree trên Zalo để tích Điểm Xanh, dùng giảm giá khi mua trên Mini App và web.',
};

export const metadata: Metadata = staticPageMetadata(SEO);

export default function ScanPage() {
  return <ScanView />;
}

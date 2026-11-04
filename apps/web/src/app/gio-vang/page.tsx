import type { Metadata } from 'next';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ogBase, withBrand } from '@/lib/og';
import FlashSlotsView from './flash-slots-view';

const TITLE = fillCopy('flash.title');
const DESCRIPTION = 'Giá Giờ vàng theo từng khung giờ trong ngày. Đặt nhắc cho khung sắp mở để không lỡ suất.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/gio-vang' },
  openGraph: { ...ogBase, url: '/gio-vang', title: withBrand(TITLE), description: DESCRIPTION },
};

export default function FlashSalePage() {
  return <FlashSlotsView />;
}

import type { Metadata } from 'next';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { JsonLd } from '@/components/seo/json-ld';
import { staticPageJsonLd, staticPageMetadata } from '@/lib/page-seo';
import FlashSlotsView from './flash-slots-view';

const SEO = {
  path: '/gio-vang',
  title: fillCopy('flash.title'),
  description: 'Giá Giờ vàng theo từng khung giờ trong ngày. Đặt nhắc cho khung sắp mở để không lỡ suất.',
};

export const metadata: Metadata = staticPageMetadata(SEO);

export default function FlashSalePage() {
  return (
    <>
      <FlashSlotsView />
      <JsonLd data={staticPageJsonLd(SEO)} />
    </>
  );
}

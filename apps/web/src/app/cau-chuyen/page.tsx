import type { Metadata } from 'next';
import { JsonLd } from '@/components/seo/json-ld';
import { staticPageJsonLd, staticPageMetadata } from '@/lib/page-seo';
import { BrandStoryView } from './brand-story-view';

export const revalidate = 3600;

const SEO = {
  path: '/cau-chuyen',
  title: 'Hành trình nguyên liệu',
  description: 'Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Khám phá xuất xứ nguyên liệu trên bản đồ vùng nguyên liệu Việt Nam.',
};

export const metadata: Metadata = staticPageMetadata(SEO);

export default function BrandStoryPage() {
  return (
    <>
      <BrandStoryView />
      <JsonLd data={staticPageJsonLd(SEO)} />
    </>
  );
}

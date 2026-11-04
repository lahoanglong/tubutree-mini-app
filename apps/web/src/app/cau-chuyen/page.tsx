import type { Metadata } from 'next';
import { ogBase, withBrand } from '@/lib/og';
import { BrandStoryView } from './brand-story-view';

export const revalidate = 3600;

const TITLE = 'Hành trình nguyên liệu';
const DESCRIPTION = 'Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Khám phá xuất xứ nguyên liệu trên bản đồ gỗ 3D.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/cau-chuyen' },
  openGraph: { ...ogBase, url: '/cau-chuyen', title: withBrand(TITLE), description: DESCRIPTION },
};

export default function BrandStoryPage() {
  return <BrandStoryView />;
}

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { BrandStoryView } from './brand-story-view';

export const revalidate = 3600;

const TITLE = 'Hành trình nguyên liệu — Tubu Tree';
const DESCRIPTION = 'Mỗi thương hiệu Tubu Tree đều gắn liền với một tỉnh thành Việt Nam. Khám phá xuất xứ nguyên liệu trên bản đồ gỗ 3D.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/cau-chuyen' },
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website' },
};

export default function BrandStoryPage() {
  // useSearchParams (?brand= mở sẵn câu chuyện của nhãn) cần Suspense để trang vẫn render tĩnh.
  return (
    <Suspense>
      <BrandStoryView />
    </Suspense>
  );
}

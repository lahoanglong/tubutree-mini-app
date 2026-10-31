import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DsGallery } from './gallery';

export const metadata: Metadata = {
  title: 'Thư viện thành phần (dev)',
  robots: { index: false, follow: false },
};

/** Trang dev của bộ section-kit: bản production trả 404, không bao giờ lộ ra khách. */
export default function DsGalleryPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DsGallery />;
}

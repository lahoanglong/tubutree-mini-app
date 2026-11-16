import type { Metadata } from 'next';
import { RecycleHome } from '@/components/recycle/recycle-home';
import { JsonLd } from '@/components/seo/json-ld';
import { landingJsonLd, landingMetadata } from '@/lib/landing-seo';

// Khai ở page, không ở layout: /doi-rac không có layout, và các trang con (/doi-rac/tao, /yeu-cau…) tự có layout noindex của riêng chúng.
export const metadata: Metadata = landingMetadata('recycle');

export default function RecyclePage() {
  return (
    <>
      <RecycleHome />
      <JsonLd data={landingJsonLd('recycle')} />
    </>
  );
}

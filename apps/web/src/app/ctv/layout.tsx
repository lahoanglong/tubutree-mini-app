import type { Metadata } from 'next';
import { LandingJsonLd } from '@/components/seo/landing-json-ld';
import { landingMetadataWithTemplate } from '@/lib/landing-seo';

// /ctv/gian-hang (con riêng tư, noindex) kế thừa metadata này: nó tự gỡ canonical/og (PRIVATE_CHILD_SEO) và JSON-LD chỉ in ở chính /ctv.
export const metadata: Metadata = landingMetadataWithTemplate('affiliate');

export default function CtvLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <LandingJsonLd landing="affiliate" />
    </>
  );
}

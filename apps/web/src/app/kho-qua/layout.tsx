import type { Metadata } from 'next';
import { LandingJsonLd } from '@/components/seo/landing-json-ld';
import { landingMetadataWithTemplate } from '@/lib/landing-seo';

// /kho-qua/cua-toi (con riêng tư, noindex) kế thừa metadata này: nó tự gỡ canonical/og (PRIVATE_CHILD_SEO) và JSON-LD chỉ in ở chính /kho-qua.
export const metadata: Metadata = landingMetadataWithTemplate('rewards');

export default function RewardsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <LandingJsonLd landing="rewards" />
    </>
  );
}

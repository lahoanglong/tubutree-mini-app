import type { Metadata } from 'next';
import { LandingJsonLd } from '@/components/seo/landing-json-ld';
import { landingMetadata } from '@/lib/landing-seo';

export const metadata: Metadata = landingMetadata('dealer');

export default function DealerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <LandingJsonLd landing="dealer" />
    </>
  );
}

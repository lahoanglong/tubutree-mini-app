import type { Metadata } from 'next';
import { LandingJsonLd } from '@/components/seo/landing-json-ld';
import { landingMetadata } from '@/lib/landing-seo';

export const metadata: Metadata = landingMetadata('advisor');

export default function AdvisorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <LandingJsonLd landing="advisor" />
    </>
  );
}

import type { Metadata } from 'next';
import { LandingJsonLd } from '@/components/seo/landing-json-ld';
import { landingMetadata } from '@/lib/landing-seo';

export const metadata: Metadata = landingMetadata('garden');

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <LandingJsonLd landing="garden" />
    </>
  );
}

import type { Metadata } from 'next';
import { BRAND_OWNER_TITLE } from '@tubutree/app-core/client-copy';

export const metadata: Metadata = { title: `${BRAND_OWNER_TITLE} — Tubu Tree`, robots: { index: false, follow: false } };

export default function BrandOwnerLayout({ children }: { children: React.ReactNode }) {
  return children;
}

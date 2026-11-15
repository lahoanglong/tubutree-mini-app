import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { default: 'Kho quà Điểm Xanh', template: '%s — Tubu Tree' },
};

export default function RewardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

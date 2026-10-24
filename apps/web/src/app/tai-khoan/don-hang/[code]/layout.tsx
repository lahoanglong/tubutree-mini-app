import type { Metadata } from 'next';

function readCode(raw: string): string | null {
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const code = readCode((await params).code);
  return { title: `${code ? `Đơn ${code}` : 'Đơn hàng'} — Tubu Tree`, robots: { index: false, follow: false } };
}

export default function OrderDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}

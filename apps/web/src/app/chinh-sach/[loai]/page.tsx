import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getLegalDoc, getPublicSupport } from '@/lib/api';
import { LEGAL_DRAFT_NOTICE, LEGAL_PAGES, LEGAL_SLUGS, defaultLegalContent, isLegalSlug } from '@/lib/legal';
import { LegalMarkdown } from '@/components/legal-markdown';
import { PAGE_NARROW } from '@/lib/page-frame';

export const revalidate = 300;

type Params = { params: Promise<{ loai: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { loai } = await params;
  if (!isLegalSlug(loai)) notFound();
  const { content } = await getLegalDoc(loai);
  const page = LEGAL_PAGES[loai];
  return {
    title: `${page.title} — Tubu Tree`,
    description: page.description,
    alternates: { canonical: `/chinh-sach/${loai}` },
    // Bản nháp chưa được duyệt không nên nằm trên Google như chính sách thật của cửa hàng.
    ...(content === null ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function LegalPage({ params }: Params) {
  const { loai } = await params;
  if (!isLegalSlug(loai)) notFound();
  const [doc, support] = await Promise.all([getLegalDoc(loai), getPublicSupport()]);
  const isDraft = doc.content === null;
  const text = doc.content ?? defaultLegalContent(loai, doc.vars, support);
  const others = LEGAL_SLUGS.filter((s) => s !== loai);

  return (
    <main className={`${PAGE_NARROW} py-8`}>
      {isDraft && (
        <div
          role="note"
          data-testid="legal-draft-banner"
          className="mb-6 rounded-card bg-warning-bg px-4 py-3 text-sm font-semibold text-warning-fg"
        >
          {LEGAL_DRAFT_NOTICE}. Nội dung dưới đây là bản soạn sẵn, các chỗ trong dấu [ ] sẽ được điền khi Tubu Tree duyệt.
        </div>
      )}
      <h1 className="font-display text-3xl font-semibold text-stone-900">{LEGAL_PAGES[loai].title}</h1>
      <div className="mt-4">
        <LegalMarkdown source={text} />
      </div>
      <nav aria-label="Các chính sách khác" className="mt-10 border-t border-stone-200 pt-4">
        <ul className="flex flex-wrap gap-x-6">
          {others.map((s) => (
            <li key={s}>
              <Link
                href={`/chinh-sach/${s}`}
                className="inline-flex min-h-11 items-center text-sm font-medium text-forest-700 hover:text-forest-800 hover:underline"
              >
                {LEGAL_PAGES[s].title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}

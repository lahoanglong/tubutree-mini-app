import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Award, Tag, Sparkles, Building2, Leaf } from 'lucide-react';
import { getBrand, formatVnd, formatSold } from '@/lib/api';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) return { title: 'Nhãn hàng — Tubu Tree' };
  const title = `${b.name}${b.isVerified ? ' ✓' : ''} — Tubu Tree`;
  const description = b.tagline ?? 'Nhãn hàng sống xanh trên Tubu Tree';
  const img = b.coverUrl ?? b.logoUrl ?? b.products?.[0]?.thumbnail ?? undefined;
  return {
    title,
    description,
    openGraph: { title, description, images: img ? [img] : [], type: 'website' },
  };
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      {b.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.coverUrl} alt={b.name} className="mb-4 h-44 w-full rounded-xl object-cover" />
      )}
      <div className="flex items-center gap-3">
        {b.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logoUrl} alt={b.name} className="h-14 w-14 rounded-full object-cover ring-2 ring-white" />
        )}
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-neutral-900">
            {b.name}
            {b.isVerified && (
              <span className="rounded-full bg-leaf-600 px-2 py-0.5 text-xs font-medium text-white">
                ✓ Chính hãng
              </span>
            )}
          </h1>
          {b.tagline && <p className="text-neutral-600">{b.tagline}</p>}
        </div>
      </div>

      {b.certifications.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 font-semibold text-neutral-900 flex items-center gap-1.5">
            <Award className="h-4 w-4 text-primary-600" />
            <span>Chứng nhận</span>
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {b.certifications.map((c) => (
              <span
                key={c.code}
                className="whitespace-nowrap rounded-lg bg-leaf-50 px-3 py-1.5 text-sm text-leaf-800 border border-leaf-200 flex items-center gap-1"
              >
                <Leaf className="h-3.5 w-3.5 text-leaf-600" />
                <span>{c.label}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {b.promotions.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 font-semibold text-neutral-900 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-amber-500" />
            <span>Khuyến mãi</span>
          </h2>
          <div className="space-y-2">
            {b.promotions.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-clay-200 bg-clay-50 p-3"
                style={p.themeColor ? { borderColor: p.themeColor } : undefined}
              >
                <p className="font-semibold text-clay-800">{p.title}</p>
                {p.subtitle && <p className="text-sm text-neutral-600">{p.subtitle}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {b.products.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-semibold text-neutral-900">Sản phẩm</h2>
          <div className="grid grid-cols-2 gap-3">
            {b.products.map((p) => (
              <a
                key={p.id}
                href={`/san-pham/${p.slug}`}
                className="block overflow-hidden rounded-2xl bg-white shadow-sm hover:shadow-md transition"
              >
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumbnail}
                    alt={p.name}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-leaf-50 text-leaf-600">
                    <Leaf className="h-10 w-10 text-leaf-600" />
                  </div>
                )}
                <div className="p-2">
                  <p className="line-clamp-2 text-sm text-neutral-900">{p.name}</p>
                  <p className="mt-1 font-bold text-clay-700">
                    {formatVnd(p.salePrice ?? p.basePrice)}
                  </p>
                  {formatSold(p.sold) && <p className="mt-0.5 text-xs text-neutral-400">{formatSold(p.sold)}</p>}
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {b.dealerRewards.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold text-neutral-900 flex items-center gap-1.5">
            <Building2 className="h-4 w-4 text-primary-700" />
            <span>Chương trình đại lý</span>
          </h2>
          <div className="space-y-2">
            {b.dealerRewards.map((d) => (
              <div key={d.id} className="rounded-xl border border-neutral-200 bg-white p-3">
                <p className="font-semibold text-neutral-900">{d.title}</p>
                {d.description && <p className="text-sm text-neutral-600">{d.description}</p>}
                <p className="mt-1 text-xs text-neutral-500">
                  Đạt doanh số {formatVnd(d.threshold)} / {d.period === 'YEAR' ? 'năm' : 'quý'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {b.story && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold text-neutral-900">Câu chuyện thương hiệu</h2>
          <p className="whitespace-pre-line text-neutral-700">{b.story}</p>
        </section>
      )}
    </main>
  );
}

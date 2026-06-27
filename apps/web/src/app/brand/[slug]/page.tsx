import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBrand, formatVnd } from '@/lib/api';

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
              <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-medium text-white">
                ✓ Chính hãng
              </span>
            )}
          </h1>
          {b.tagline && <p className="text-neutral-600">{b.tagline}</p>}
        </div>
      </div>

      {b.certifications.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 font-semibold text-neutral-900">Chứng nhận</h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {b.certifications.map((c) => (
              <span
                key={c.code}
                className="whitespace-nowrap rounded-lg bg-green-50 px-3 py-1.5 text-sm text-green-800"
              >
                🌿 {c.label}
              </span>
            ))}
          </div>
        </section>
      )}

      {b.promotions.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 font-semibold text-neutral-900">🎉 Khuyến mãi</h2>
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
                className="block overflow-hidden rounded-2xl bg-white shadow-sm"
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
                  <div className="flex aspect-square w-full items-center justify-center bg-green-50 text-4xl">
                    🌿
                  </div>
                )}
                <div className="p-2">
                  <p className="line-clamp-2 text-sm text-neutral-900">{p.name}</p>
                  <p className="mt-1 font-bold text-clay-700">
                    {formatVnd(p.salePrice ?? p.basePrice)}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {b.dealerRewards.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold text-neutral-900">🏪 Chương trình đại lý</h2>
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

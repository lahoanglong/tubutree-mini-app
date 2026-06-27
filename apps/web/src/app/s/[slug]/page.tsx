import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getStorefront, formatVnd, formatSold } from '@/lib/api';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sf = await getStorefront(slug);
  if (!sf) return { title: 'Gian hàng — Tubu Tree' };
  const firstImg =
    sf.collections?.[0]?.items?.[0]?.product?.thumbnail ?? sf.coverUrl ?? undefined;
  const title = `${sf.title} — Tubu Tree`;
  const description = sf.headerNote ?? 'Gian hàng sống xanh tuyển chọn trên Tubu Tree';
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: firstImg ? [firstImg] : [],
      type: 'website',
    },
  };
}

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sf = await getStorefront(slug);
  if (!sf) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      {sf.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sf.coverUrl}
          alt={sf.title}
          className="mb-4 h-40 w-full rounded-xl object-cover"
        />
      )}
      <h1 className="text-2xl font-bold text-neutral-900">{sf.title}</h1>
      {sf.headerNote && <p className="mt-1 text-neutral-600">{sf.headerNote}</p>}

      {sf.collections?.map((c) => (
        <section key={c.id} className="mt-6">
          <h2 className="mb-3 font-semibold text-neutral-900">{c.title}</h2>
          <div className="grid grid-cols-2 gap-3">
            {c.items.map((it) => (
              <a
                key={it.id}
                href={`/san-pham/${it.product.slug}`}
                className="block overflow-hidden rounded-2xl bg-white shadow-sm"
              >
                {it.product.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.product.thumbnail}
                    alt={it.product.name}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-green-50 text-4xl">
                    🌿
                  </div>
                )}
                <div className="p-2">
                  <p className="line-clamp-2 text-sm text-neutral-900">{it.product.name}</p>
                  <p className="mt-1 font-bold text-clay-700">
                    {formatVnd(it.product.salePrice ?? it.product.basePrice)}
                  </p>
                  {formatSold(it.product.sold) && (
                    <p className="mt-0.5 text-xs text-neutral-400">{formatSold(it.product.sold)}</p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  CheckCircle2,
  Globe,
  MapPin,
  Phone,
  CreditCard,
  ShieldCheck,
  Truck,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { getStorefront, formatVnd, formatSold } from '@/lib/api';
import { StorefrontTracker } from '@/components/storefront-tracker';

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
    twitter: {
      card: firstImg ? 'summary_large_image' : 'summary',
      title,
      description,
      images: firstImg ? [firstImg] : [],
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

  // Màu chủ đề do chủ gian hàng chọn (dữ liệu, không phải token) — CHỈ dùng làm điểm nhấn không mang chữ
  // (ảnh bìa, avatar, thanh tiêu đề bộ sưu tập). Mọi chữ dùng token để luôn đủ tương phản bất kể màu họ chọn.
  const themeColor = sf.themeColor || 'var(--color-action-primary-bg)';
  // Chỉ gian hàng tự giao mới gửi hàng từ kho riêng; gian hàng CTV/nhãn hàng bán hàng kho Tubu, địa chỉ cũ còn lưu không được
  // hiện như "kho xuất hàng" (SELLER-8).
  const selfFulfils = sf.type === 'MERCHANT';
  const warehouseParts = [
    sf.warehouseAddress,
    sf.warehouseWard,
    sf.warehouseDistrict,
    sf.warehouseCity,
  ].filter(Boolean);
  const fullWarehouseAddress = selfFulfils && warehouseParts.length > 0 ? warehouseParts.join(', ') : null;
  const contactPhone = selfFulfils ? sf.warehousePhone : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      {/* Ghi nhớ gian hàng để đơn đặt sau đó còn ghi nhận hoa hồng CTV + áp combo của gian hàng. */}
      <StorefrontTracker slug={sf.slug} type={sf.type ?? undefined} referralCode={sf.referralCode} />

      {/* ── Storefront Banner Cover ── */}
      <div className="relative mb-6 overflow-hidden rounded-sheet shadow-card">
        {sf.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sf.coverUrl}
            alt={sf.title}
            className="h-48 w-full object-cover sm:h-64"
          />
        ) : (
          <div
            className="h-36 w-full sm:h-48"
            style={{
              background: `linear-gradient(135deg, ${themeColor} 0%, var(--color-bg-inverse) 100%)`,
            }}
          />
        )}
        {/* Soft gradient overlay at bottom of cover */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-900/40 via-transparent to-transparent" />
      </div>

      {/* ── Brand Identity & Header Card ── */}
      <div className="relative -mt-16 mb-6 rounded-card border border-stone-200 bg-stone-0 p-5 shadow-card sm:-mt-20 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            {/* Brand Avatar */}
            <div className="relative shrink-0">
              {sf.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sf.avatarUrl}
                  alt={sf.title}
                  className="h-16 w-16 rounded-card border-4 border-stone-0 object-cover shadow-raised sm:h-20 sm:w-20"
                />
              ) : (
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-card border-4 border-stone-0 font-display text-2xl font-semibold text-stone-0 shadow-raised sm:h-20 sm:w-20 sm:text-3xl"
                  style={{ backgroundColor: themeColor }}
                >
                  {sf.title.slice(0, 1).toUpperCase()}
                </div>
              )}
              {/* Verified check badge */}
              <div className="absolute -bottom-1.5 -right-1.5 rounded-full bg-stone-0 p-0.5 shadow-card">
                <CheckCircle2 className="h-5 w-5 fill-forest-600 text-stone-0" aria-hidden="true" />
              </div>
            </div>

            {/* Brand Title & Meta */}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl font-semibold tracking-tight text-stone-900 sm:text-2xl">
                  {sf.title}
                </h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-forest-700 px-2.5 py-0.5 text-xs font-semibold text-stone-0 shadow-card">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  {sf.type === 'MERCHANT' ? 'Đối tác chính hãng' : 'CTV tuyển chọn'}
                </span>
                {sf.ownerTier && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2.5 py-0.5 text-xs font-semibold text-warning-fg ring-1 ring-inset ring-warning-fg">
                    <span aria-hidden="true">{sf.ownerTier.emoji}</span>
                    {sf.ownerTier.name}
                  </span>
                )}
              </div>

              {sf.subdomain && (
                <p className="flex items-center gap-1 text-xs font-medium text-stone-600">
                  <Globe className="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
                  <span>https://{sf.subdomain}.tubutree.com</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bio / Slogan */}
        {sf.headerNote && (
          <p className="mt-4 border-t border-stone-200 pt-3.5 text-sm leading-relaxed text-stone-700">
            {sf.headerNote}
          </p>
        )}

        {/* Warehouse & Dispatch Origin */}
        {(fullWarehouseAddress || contactPhone) && (
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-card border border-stone-200 bg-stone-50 p-3.5 text-xs text-stone-700">
            {fullWarehouseAddress && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
                <span>
                  <strong className="font-semibold text-stone-900">Kho xuất hàng:</strong>{' '}
                  {fullWarehouseAddress}
                </span>
              </div>
            )}
            {contactPhone && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
                <span>
                  <strong className="font-semibold text-stone-900">Hotline:</strong>{' '}
                  <a
                    href={`tel:${contactPhone}`}
                    className="inline-flex min-h-11 items-center font-semibold text-stone-900 underline hover:text-forest-700"
                  >
                    {contactPhone}
                  </a>
                </span>
              </div>
            )}
          </div>
        )}
        {/* Đã BỎ card "Thanh toán trực tiếp cho Đối tác" (VietQR thẳng vào bankBin/bankAccountNo
         * của storefront) — audit A2-01=A5-02=A6-03 (2026-09-27): mã QR này không gắn với đơn
         * hàng/số tiền nào (chỉ addInfo=DONHANG_<slug>, không phải mã đơn thật), nên khách quét
         * và chuyển khoản xong là MẤT DẤU VẾT hoàn toàn — không đơn nào được tạo, không cách nào
         * đối soát. Quyết định: MỌI thanh toán chuyển khoản đều phải đi qua checkout thật (nhận
         * tiền vào tài khoản Tubu, xem bank-transfer.service.ts) để có đơn + đối soát; không
         * storefront nào (CTV/dealer/brand) được nhận tiền trực tiếp cho tới khi có một hệ thống
         * đối tác-tự-thu-tiền thật sự (xem A5-34, còn mở). */}
      </div>

      {/* ── Trust Ribbon ── */}
      <section aria-labelledby="cam-ket-gian-hang" className="mb-8">
        <h2 id="cam-ket-gian-hang" className="sr-only">
          Cam kết của gian hàng
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <div className="flex items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <ShieldCheck className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
            <span className="text-xs font-semibold text-stone-800">100% Chính hãng</span>
          </div>
          <div className="flex items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <Truck className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
            <span className="text-xs font-semibold text-stone-800">Xuất kho tận gốc</span>
          </div>
          <div className="flex items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <CreditCard className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
            <span className="text-xs font-semibold text-stone-800">VietQR Napas247</span>
          </div>
          <div className="flex items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <RotateCcw className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
            <span className="text-xs font-semibold text-stone-800">Đổi trả 7 ngày (hàng lỗi NSX)</span>
          </div>
        </div>
      </section>

      {/* ── Product Collections ── */}
      {sf.collections?.map((c) => (
        <section key={c.id} className="mt-8">
          <div className="mb-4 flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-5 w-1.5 rounded-full"
              style={{ backgroundColor: themeColor }}
            />
            <h2 className="font-display text-lg font-semibold text-stone-900 sm:text-xl">{c.title}</h2>
            <span className="text-xs text-stone-600">({c.items?.length ?? 0} sản phẩm)</span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
            {c.items.map((it) => {
              const price = it.product.salePrice ?? it.product.basePrice;
              const hasSale = it.product.salePrice != null && it.product.salePrice < it.product.basePrice;
              const discountPct = hasSale
                ? Math.round(((it.product.basePrice - price) / it.product.basePrice) * 100)
                : 0;

              return (
                <Link
                  key={it.id}
                  href={`/san-pham/${it.product.slug}`}
                  className="group flex flex-col overflow-hidden rounded-card border border-stone-200 bg-stone-0 shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-forest-600/40 hover:shadow-raised"
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-stone-100">
                    {it.product.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.product.thumbnail}
                        alt={it.product.name}
                        className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-forest-50 text-forest-600">
                        <svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                          <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="currentColor" fillOpacity="0.3" />
                          <path d="M24 37c-1-8 4-15 14-16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </div>
                    )}

                    {hasSale && discountPct > 0 && (
                      <div className="absolute left-2 top-2 rounded-full bg-promo-solid px-2 py-0.5 text-xs font-bold text-stone-0 shadow-card">
                        -{discountPct}%
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-3.5">
                    <p className="text-xs font-semibold text-forest-800">{it.product.brand}</p>
                    <h3 className="line-clamp-2 min-h-[2.5rem] text-xs font-medium text-stone-900 group-hover:text-forest-700 sm:text-sm">
                      {it.product.name}
                    </h3>

                    <div className="mt-2 flex items-baseline gap-1.5">
                      <p className="text-sm font-bold text-stone-900 sm:text-base">{formatVnd(price)}</p>
                      {hasSale && (
                        <p className="text-xs text-stone-500 line-through">
                          {formatVnd(it.product.basePrice)}
                        </p>
                      )}
                    </div>

                    {formatSold(it.product.sold) && (
                      <p className="mt-1 text-xs text-stone-600">{formatSold(it.product.sold)}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}

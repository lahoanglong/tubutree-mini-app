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
  QrCode,
} from 'lucide-react';
import { getStorefront, formatVnd, formatSold } from '@/lib/api';
import { CopyButton } from '@/components/copy-button';
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

  const themeColor = sf.themeColor || '#16a34a';
  const warehouseParts = [
    sf.warehouseAddress,
    sf.warehouseWard,
    sf.warehouseDistrict,
    sf.warehouseCity,
  ].filter(Boolean);
  const fullWarehouseAddress = warehouseParts.length > 0 ? warehouseParts.join(', ') : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      {/* Ghi nhớ gian hàng để đơn đặt sau đó còn ghi nhận hoa hồng CTV + áp combo của gian hàng. */}
      <StorefrontTracker slug={slug} type={sf.type ?? undefined} />

      {/* ── Storefront Banner Cover ── */}
      <div className="relative mb-6 overflow-hidden rounded-3xl shadow-sm">
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
              background: `linear-gradient(135deg, ${themeColor} 0%, #1e293b 100%)`,
            }}
          />
        )}
        {/* Soft gradient overlay at bottom of cover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
      </div>

      {/* ── Brand Identity & Header Card ── */}
      <div className="relative mb-6 -mt-16 sm:-mt-20 rounded-2xl border border-neutral-200/80 bg-white p-5 sm:p-7 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            {/* Brand Avatar */}
            <div className="relative shrink-0">
              {sf.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sf.avatarUrl}
                  alt={sf.title}
                  className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl border-4 border-white object-cover shadow-md"
                  style={{ borderColor: '#ffffff' }}
                />
              ) : (
                <div
                  className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-2xl border-4 border-white text-2xl sm:text-3xl font-bold text-white shadow-md"
                  style={{ backgroundColor: themeColor }}
                >
                  {sf.title.slice(0, 1).toUpperCase()}
                </div>
              )}
              {/* Verified check badge */}
              <div className="absolute -bottom-1.5 -right-1.5 rounded-full bg-white p-0.5 shadow-sm">
                <CheckCircle2 className="h-5 w-5 fill-leaf-600 text-white" />
              </div>
            </div>

            {/* Brand Title & Meta */}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-extrabold text-neutral-900 tracking-tight">
                  {sf.title}
                </h1>
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm"
                  style={{ backgroundColor: themeColor }}
                >
                  <Sparkles className="h-3 w-3" />
                  {sf.type === 'MERCHANT' ? 'Đối tác chính hãng' : 'CTV tuyển chọn'}
                </span>
              </div>

              {sf.subdomain && (
                <p className="flex items-center gap-1 text-xs font-medium text-neutral-500">
                  <Globe className="h-3.5 w-3.5 text-neutral-400" />
                  <span>https://{sf.subdomain}.tubutree.com</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bio / Slogan */}
        {sf.headerNote && (
          <p className="mt-4 border-t border-neutral-100 pt-3.5 text-sm leading-relaxed text-neutral-700">
            {sf.headerNote}
          </p>
        )}

        {/* Warehouse & Dispatch Origin */}
        {(fullWarehouseAddress || sf.warehousePhone) && (
          <div className="mt-4 flex flex-wrap gap-4 rounded-xl bg-neutral-50/80 border border-neutral-200/60 p-3.5 text-xs text-neutral-600">
            {fullWarehouseAddress && (
              <div className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 shrink-0 text-leaf-700" />
                <span>
                  <strong className="font-semibold text-neutral-900">Kho xuất hàng:</strong>{' '}
                  {fullWarehouseAddress}
                </span>
              </div>
            )}
            {sf.warehousePhone && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-4 w-4 shrink-0 text-leaf-700" />
                <span>
                  <strong className="font-semibold text-neutral-900">Hotline:</strong>{' '}
                  <a
                    href={`tel:${sf.warehousePhone}`}
                    className="font-semibold text-neutral-900 underline hover:text-primary-700"
                  >
                    {sf.warehousePhone}
                  </a>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Direct VietQR Payment Card */}
        {sf.bankBin && sf.bankAccountNo && (
          <div className="mt-4 rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 to-teal-50/40 p-4 text-xs text-neutral-700 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                  <CreditCard className="h-4 w-4 text-emerald-700" />
                  <span>Thanh toán trực tiếp cho Đối tác (VietQR Napas247 - 0đ phí)</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-neutral-700">
                  <span>Ngân hàng: <strong className="text-neutral-900">{sf.bankName || 'NHTM'}</strong></span>
                  <span>·</span>
                  <span className="flex items-center gap-1.5">
                    STK: <strong className="font-mono text-sm font-bold text-neutral-900">{sf.bankAccountNo}</strong>
                    <CopyButton text={sf.bankAccountNo} label="Sao chép" />
                  </span>
                  {sf.bankAccountName && <span>({sf.bankAccountName})</span>}
                </div>
                <p className="text-[11px] text-emerald-800/80">
                  ✓ Tiền về trực tiếp tài khoản đối tác, xử lý và xuất kho thần tốc.
                </p>
              </div>

              {/* QR Code thumbnail */}
              <div className="shrink-0 flex items-center gap-2 sm:flex-col sm:items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://img.vietqr.io/image/${sf.bankBin}-${sf.bankAccountNo}-compact.png?addInfo=DONHANG_${sf.slug}`}
                  alt="VietQR Đối tác"
                  className="h-16 w-16 sm:h-20 sm:w-20 rounded-xl border border-white bg-white p-1 shadow-sm"
                  loading="lazy"
                />
                <span className="text-[10px] font-semibold text-emerald-800 flex items-center gap-1">
                  <QrCode className="h-3 w-3" /> Quét VietQR
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Trust Ribbon ── */}
      <section className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200/70 bg-white p-3 shadow-sm">
          <ShieldCheck className="h-4 w-4 shrink-0 text-leaf-700" />
          <span className="text-xs font-semibold text-neutral-800">100% Chính hãng</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200/70 bg-white p-3 shadow-sm">
          <Truck className="h-4 w-4 shrink-0 text-primary-600" />
          <span className="text-xs font-semibold text-neutral-800">Xuất kho tận gốc</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200/70 bg-white p-3 shadow-sm">
          <CreditCard className="h-4 w-4 shrink-0 text-emerald-600" />
          <span className="text-xs font-semibold text-neutral-800">VietQR Napas247</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200/70 bg-white p-3 shadow-sm">
          <RotateCcw className="h-4 w-4 shrink-0 text-leaf-700" />
          <span className="text-xs font-semibold text-neutral-800">Đổi trả 7 ngày (hàng lỗi NSX)</span>
        </div>
      </section>

      {/* ── Product Collections ── */}
      {sf.collections?.map((c) => (
        <section key={c.id} className="mt-8">
          <div className="mb-4 flex items-center gap-2.5">
            <span
              className="h-5 w-1.5 rounded-full"
              style={{ backgroundColor: themeColor }}
            />
            <h2 className="text-lg sm:text-xl font-bold text-neutral-900">{c.title}</h2>
            <span className="text-xs text-neutral-400">({c.items?.length ?? 0} sản phẩm)</span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 sm:gap-4">
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
                  className="group flex flex-col overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md"
                >
                  <div className="relative aspect-square w-full overflow-hidden bg-neutral-100/60">
                    {it.product.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.product.thumbnail}
                        alt={it.product.name}
                        className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-leaf-50/70 text-leaf-600">
                        <svg width="40" height="40" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                          <path d="M14 36c-1.5-14 8-26 24-27 1 16-7 27-20 28-2 .2-3.4-.4-4-1z" fill="#95D222" />
                          <path d="M24 37c-1-8 4-15 14-16" stroke="#509018" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </div>
                    )}

                    {hasSale && discountPct > 0 && (
                      <div className="absolute left-2 top-2 rounded-full bg-primary-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                        -{discountPct}%
                      </div>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col p-3.5">
                    <p className="text-[10px] font-semibold text-leaf-800">{it.product.brand}</p>
                    <p className="line-clamp-2 min-h-[2.5rem] text-xs sm:text-sm font-medium text-neutral-900 group-hover:text-primary-700">
                      {it.product.name}
                    </p>

                    <div className="mt-2 flex items-baseline gap-1.5">
                      <p className="font-bold text-sm sm:text-base" style={{ color: themeColor }}>
                        {formatVnd(price)}
                      </p>
                      {hasSale && (
                        <p className="text-[11px] text-neutral-400 line-through">
                          {formatVnd(it.product.basePrice)}
                        </p>
                      )}
                    </div>

                    {formatSold(it.product.sold) && (
                      <p className="mt-1 text-[11px] text-neutral-400">{formatSold(it.product.sold)}</p>
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


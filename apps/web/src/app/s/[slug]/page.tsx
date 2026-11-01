import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Globe, MapPin, PackageSearch, Phone, CreditCard, ShieldCheck, RotateCcw } from 'lucide-react';
import { sampleShareText } from '@tubutree/app-core/storefront-signup';
import { returnsPromise } from '@tubutree/app-core/returns-copy';
import { getReturnWindowDays, getStorefront } from '@/lib/api';
import { SITE_URL } from '@/lib/site';
import { StorefrontTracker } from '@/components/storefront-tracker';
import { isPartnerStore } from '@/lib/partner-store';
import { LearnStorefrontLink, MoreAtTubuLink, StorefrontEmpty } from '@/components/affiliate/storefront-owner';
import { storefrontBadgeLabel } from '@/lib/storefront-badge';
import { PAGE_WIDE } from '@/lib/page-frame';
import { StorefrontBody } from '@/components/shop-page/storefront-body';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sf = await getStorefront(slug);
  if (!sf) return { title: 'Gian hàng — Tubu Tree' };
  // Ảnh chia sẻ do opengraph-image.tsx của trang này dựng: ảnh gốc có thể là base64 nên không đưa thẳng vào og:image.
  const canonical = `${SITE_URL}/s/${sf.slug}`;
  const title = sampleShareText(`${sf.title} — Tubu Tree`, sf.isSample);
  const description = sampleShareText(sf.headerNote ?? 'Gian hàng sống xanh trên Tubu Tree', sf.isSample);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
    ...(sf.isSample ? { robots: { index: false, follow: false } } : {}),
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
  const returns = returnsPromise(await getReturnWindowDays());

  // Chỉ gian hàng tự giao mới gửi hàng từ kho riêng; gian hàng CTV/nhãn hàng bán hàng kho Tubu, địa chỉ cũ còn lưu không được
  // hiện như "kho xuất hàng" (SELLER-8). Vì vậy kho không đi xuống thân trang client: chỉ khối dựng sẵn bên dưới mới có chữ kho.
  const selfFulfils = isPartnerStore(sf);
  const warehouseParts = [
    sf.warehouseAddress,
    sf.warehouseWard,
    sf.warehouseDistrict,
    sf.warehouseCity,
  ].filter(Boolean);
  const fullWarehouseAddress = selfFulfils && warehouseParts.length > 0 ? warehouseParts.join(', ') : null;
  const contactPhone = selfFulfils ? sf.warehousePhone : null;
  const badgeLabel = storefrontBadgeLabel(sf);
  const collections = (sf.collections ?? [])
    .map((c) => ({ ...c, items: (c.items ?? []).filter((it) => Boolean(it?.product)) }))
    .filter((c) => c.items.length > 0);

  const intro = (
    <>
      {sf.subdomainEnabled && sf.subdomain && (
        <p className="flex items-center gap-1 px-4 pt-2 text-xs font-medium text-stone-600 md:px-0">
          <Globe className="h-3.5 w-3.5 text-stone-500" aria-hidden="true" />
          <span>https://{sf.subdomain}.tubutree.com</span>
        </p>
      )}

      {(fullWarehouseAddress || contactPhone) && (
        <div className="mx-4 mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-card border border-stone-200 bg-stone-50 p-3.5 text-xs text-stone-700 md:mx-0">
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

      {/* ── Trust Ribbon: chỉ từ md; điện thoại giống Mini App không có dải này ── */}
      <section aria-labelledby="cam-ket-gian-hang" className="mt-4 max-md:hidden">
        <h2 id="cam-ket-gian-hang" className="sr-only">
          Cam kết của gian hàng
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
          <div className="flex items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <ShieldCheck className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
            <span className="text-xs font-semibold text-stone-800">Sản phẩm đã qua duyệt của Tubu Tree</span>
          </div>
          <div className="flex items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <PackageSearch className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
            <span className="text-xs font-semibold text-stone-800">Theo dõi đơn trên Tubu Tree</span>
          </div>
          <div className="flex items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <CreditCard className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
            <span className="text-xs font-semibold text-stone-800">Thanh toán qua Tubu Tree</span>
          </div>
          {returns && (
            <div className="flex items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
              <RotateCcw className="h-4 w-4 shrink-0 text-forest-700" aria-hidden="true" />
              <span className="text-xs font-semibold text-stone-800">{returns}</span>
            </div>
          )}
        </div>
      </section>
    </>
  );

  return (
    <main data-page-bleed className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0 md:py-8 max-md:pb-[calc(90px+var(--safe-bottom))]`}>
      {/* Ghi nhớ gian hàng để đơn đặt sau đó còn ghi nhận hoa hồng CTV + áp combo của gian hàng. */}
      <StorefrontTracker slug={sf.slug} type={sf.type ?? undefined} referralCode={sf.referralCode} />

      <StorefrontBody
        storefront={{
          slug: sf.slug,
          title: sf.title,
          type: sf.type,
          isPartner: sf.isPartner,
          isSample: sf.isSample,
          headerNote: sf.headerNote,
          coverUrl: sf.coverUrl,
          avatarUrl: sf.avatarUrl,
          ownerTier: sf.ownerTier,
          referralCode: sf.referralCode,
          collections,
        }}
        badgeLabel={badgeLabel}
        intro={intro}
      />

      {collections.length === 0 && <StorefrontEmpty referralCode={sf.referralCode} />}
      {sf.type === 'CTV' && <LearnStorefrontLink referralCode={sf.referralCode} />}
      {collections.length > 0 && <MoreAtTubuLink referralCode={sf.referralCode} />}
    </main>
  );
}

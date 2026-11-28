import Image from 'next/image';
import Link from 'next/link';
import { ExternalLink, Mail, Phone } from 'lucide-react';
import { getPublicSupport, type SupportContact } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/phone-display';
import tubuLogo from '@/assets/tubu-logo.png';
import { LEGAL_PAGES, LEGAL_SLUGS, companyLegalLine, isBctNoticeUrl, merchantIdentityOrDefault } from '@/lib/legal';
import { PAGE_WIDE } from '@/lib/page-frame';
import { isWebRouteReady } from '@/lib/route-map';
import { FooterProgramLinks } from '@/components/footer-program-links';
import { guestCopy } from '@/lib/guest-checkout/copy';
import { REFILL_LANDING_PATH, refillLandingCopy } from '@tubutree/app-core/refill/refill-landing';

const LINK =
  'inline-flex min-h-11 min-w-11 items-center gap-2 text-sm font-medium text-forest-700 transition-colors hover:text-forest-800 hover:underline';
/** Dải cuối (chính sách, kênh cộng đồng, huy hiệu Bộ Công Thương): chữ nhỏ cho gọn một hàng ở 360px, vùng chạm vẫn 44px. */
const SMALL_LINK =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 text-xs font-medium text-stone-600 transition-colors hover:text-forest-800 hover:underline';

/**
 * "Đơn vị vận hành: <tên> · MST <mã> · <địa chỉ>". Admin chưa nhập thông tin nào thì hiện thương nhân đã đăng ký của Tubu Tree
 * (website bán hàng của công ty phải luôn nêu rõ chủ website); đã nhập thì ẩn từng phần để trống.
 */
function operatorLine(company: SupportContact['company']): string | null {
  const id = merchantIdentityOrDefault(company);
  const parts = [id.legalName, id.taxCode ? `MST ${id.taxCode}` : undefined, id.address].filter(Boolean);
  return parts.length > 0 ? `Đơn vị vận hành: ${parts.join(' · ')}` : null;
}

/** Khách đặt không đăng nhập mất đường dẫn theo dõi: chỉ chữ, không icon (chân trang nằm trong HTML mọi trang, kể cả trang chủ). */
const LOOKUP_LABEL = guestCopy('lookupTitle');

type DiscoverLink = { to: string; label: string; external?: boolean };

/** Lối vào chức năng ở chân trang máy tính: các chương trình trước đây không có link nào ngoài thanh đáy điện thoại. Route chưa làm xong thì ẩn. */
const DISCOVER_LINKS: DiscoverLink[] = [
  { to: '/san-pham', label: 'Danh mục sản phẩm' },
  { to: '/ban-chay', label: 'Bán chạy nhất' },
  // Chỉ khi cờ Refill bật (xem `SiteFooter`): cờ tắt thì trang này chỉ còn lời trống.
  { to: REFILL_LANDING_PATH.web, label: refillLandingCopy('title') },
  { to: '/uu-dai', label: 'Ưu đãi' },
  { to: '/gio-vang', label: 'Giờ vàng' },
  // Mã giảm giá nằm trong hub Ưu đãi; `?codes=all` mở sẵn cả danh sách mã nhận được (đích cũ /ma-giam-gia chỉ còn là chuyển hướng).
  { to: '/uu-dai?codes=all', label: 'Mã giảm giá' },
  { to: '/bo-qua-tang', label: 'Bộ quà tặng' },
  { to: '/mua-chung', label: 'Mua chung' },
  { to: '/cong-dong', label: 'Cộng đồng' },
  { to: '/cau-chuyen', label: 'Câu chuyện thương hiệu' },
  { to: 'https://blog.tubutree.com', label: 'Blog', external: true },
  { to: '/gioi-thieu', label: 'Về Tubu Tree' },
];

/** Cột "Khám phá" chiếm hai rãnh lưới và chia hai cột con, để mười hai lối vào chỉ cao sáu hàng thay vì một cột dài. */
function LinkColumn({ title, links }: { title: string; links: DiscoverLink[] }) {
  const ready = links.filter((l) => l.external || isWebRouteReady(l.to));
  if (ready.length === 0) return null;
  return (
    <nav aria-label={title} className="lg:col-span-2">
      <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
      <ul className="mt-1 grid grid-cols-2 gap-x-6">
        {ready.map((l) => (
          <li key={l.to}>
            {l.external ? (
              <a href={l.to} target="_blank" rel="noopener noreferrer" className={LINK}>
                <span>{l.label}</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            ) : (
              <Link href={l.to} className={LINK}>
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function CompanyInfo({ company, className }: { company: SupportContact['company']; className?: string }) {
  const line = operatorLine(company);
  // Người đại diện, ngày và nơi cấp ĐKDN chỉ hiện khi admin đã nhập (không bịa). Số ĐKDN để trống thì doanh nghiệp dùng MST (mã số doanh nghiệp), hộ kinh doanh thì ẩn.
  const legalLine = companyLegalLine(company);
  const bctRaw = company?.bctNoticeUrl;
  const bctUrl = isBctNoticeUrl(bctRaw) ? bctRaw : null;
  if (!line && !legalLine && !bctUrl) return null;
  return (
    <div className={className} data-testid="footer-company">
      {line && <p className="text-xs text-stone-600">{line}</p>}
      {legalLine && (
        <p className="text-xs text-stone-600" data-testid="footer-company-legal">
          {legalLine}
        </p>
      )}
      {bctUrl && (
        <a href={bctUrl} target="_blank" rel="noopener noreferrer" className={SMALL_LINK}>
          Đã thông báo Bộ Công Thương
        </a>
      )}
    </div>
  );
}

function LegalNav({ label, className }: { label: string; className?: string }) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap gap-x-2 md:gap-x-4">
        {LEGAL_SLUGS.map((slug) => (
          <li key={slug}>
            <Link href={`/chinh-sach/${slug}`} className={SMALL_LINK}>
              {LEGAL_PAGES[slug].footerLabel}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Chân trang web khách: liên hệ hỗ trợ lấy từ cấu hình công khai (admin đổi được). */
export default async function SiteFooter() {
  const { hotline, email, community, company, guestOrderLookup, refillLanding } = await getPublicSupport();
  const discover = refillLanding ? DISCOVER_LINKS : DISCOVER_LINKS.filter((l) => l.to !== REFILL_LANDING_PATH.web);
  // `tel:` chỉ nhận chữ số và dấu +, bỏ khoảng trắng/dấu chấm cho số hiển thị "0984 606 774".
  const tel = hotline.replace(/[^\d+]/g, '');
  const channels = [
    { label: 'Nhóm Zalo', href: community?.zaloGroupUrl },
    { label: 'Facebook', href: community?.facebookUrl },
    { label: 'TikTok', href: community?.tiktokUrl },
  ].filter((c): c is { label: string; href: string } => Boolean(c.href));

  return (
    <>
    <footer className="mt-10 hidden md:block border-t border-stone-200 bg-stone-0">
      <div className={`${PAGE_WIDE} grid gap-x-8 gap-y-4 py-6 md:grid-cols-2 lg:grid-cols-5`}>
        <div>
          <Image src={tubuLogo} alt="Tubu Tree" width={110} height={40} className="h-10 w-auto" />
          <p className="mt-1 max-w-xs text-sm text-stone-600">Sống xanh An Lành — mỹ phẩm, đồ dùng thiên nhiên từ thương hiệu Việt.</p>
          {channels.length > 0 && (
            <nav aria-label="Kênh cộng đồng">
              <ul className="flex flex-wrap gap-x-3">
                {channels.map((c) => (
                  <li key={c.label}>
                    <a href={c.href} target="_blank" rel="noopener noreferrer" className={SMALL_LINK}>
                      <span>{c.label}</span>
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>

        <LinkColumn title="Khám phá" links={discover} />
        <FooterProgramLinks />

        <div>
          <h2 className="text-sm font-semibold text-stone-900">Hỗ trợ khách hàng</h2>
          <ul className="mt-1">
            <li>
              <a href={`tel:${tel}`} className={LINK}>
                <Phone className="h-4 w-4" aria-hidden="true" />
                <span>Hotline: {formatPhoneDisplay(hotline)}</span>
              </a>
            </li>
            <li>
              <a href={`mailto:${email}`} className={LINK}>
                <Mail className="h-4 w-4" aria-hidden="true" />
                <span>{email}</span>
              </a>
            </li>
            {guestOrderLookup && (
              <li>
                <Link href="/don" className={LINK}>
                  {LOOKUP_LABEL}
                </Link>
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className={`${PAGE_WIDE} border-t border-stone-200 pb-3`}>
        <LegalNav label="Chính sách" />
        <CompanyInfo company={company} />
      </div>
    </footer>

    {/* Điện thoại: chân trang đầy đủ ẩn (Mini App không có), nhưng hotline, email và chính sách vẫn phải với tới được từ mọi trang (Bộ Công Thương).
        Trang có thanh dính đáy ([data-sticky-bar]) thì globals.css ẩn luôn chân trang gọn này, nhắm theo data-compact-footer. */}
    <footer aria-label="Hỗ trợ và chính sách" data-compact-footer className="mt-6 border-t border-stone-200 bg-stone-0 px-4 pb-3 md:hidden">
      <div className="flex flex-wrap items-center gap-x-4">
        <a href={`tel:${tel}`} className={LINK}>
          <Phone className="h-4 w-4" aria-hidden="true" />
          <span>
            <span className="sr-only">Hotline: </span>
            {formatPhoneDisplay(hotline)}
          </span>
        </a>
        <a href={`mailto:${email}`} className={`${LINK} min-w-0`}>
          <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="break-all">{email}</span>
        </a>
        {guestOrderLookup && (
          <Link href="/don" className={LINK}>
            {LOOKUP_LABEL}
          </Link>
        )}
        <a href="https://blog.tubutree.com" target="_blank" rel="noopener noreferrer" className={LINK}>
          <span>Blog</span>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
      <LegalNav label="Chính sách (điện thoại)" className="border-t border-stone-100" />
      <CompanyInfo company={company} />
    </footer>
    </>
  );
}

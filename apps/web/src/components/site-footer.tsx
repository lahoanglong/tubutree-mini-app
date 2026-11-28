import Image from 'next/image';
import Link from 'next/link';
import { BadgeCheck, ExternalLink, Mail, Phone } from 'lucide-react';
import { getPublicSupport, type SupportContact } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/phone-display';
import tubuLogo from '@/assets/tubu-logo.png';
import { FOOTER_POLICY_LINKS, footerCompanyLine, isBctNoticeUrl } from '@/lib/legal';
import { PAGE_WIDE } from '@/lib/page-frame';
import { isWebRouteReady } from '@/lib/route-map';
import { FooterProgramLinks } from '@/components/footer-program-links';
import { guestCopy } from '@/lib/guest-checkout/copy';
import { REFILL_LANDING_PATH, refillLandingCopy } from '@tubutree/app-core/refill/refill-landing';

const LINK =
  'inline-flex min-h-11 min-w-11 items-center gap-2 text-sm font-medium text-forest-700 transition-colors hover:text-forest-800 hover:underline';
/** Kênh cộng đồng: chữ nhỏ cho gọn một hàng ở 360px, vùng chạm vẫn 44px. */
const SMALL_LINK =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1 text-xs font-medium text-stone-600 transition-colors hover:text-forest-800 hover:underline';
/** Ô của lưới chính sách / hỗ trợ: chữ nhỏ canh trái, vùng chạm 44px; lưới đều cột nên không có link lẻ rớt dòng. */
const GRID_BASE = 'inline-flex min-h-11 min-w-0 items-center gap-1.5 text-xs font-medium transition-colors hover:text-forest-800 hover:underline';
const GRID_LINK = `${GRID_BASE} text-stone-600`;
const GRID_CONTACT = `${GRID_BASE} text-forest-700`;

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

/**
 * Khối pháp lý gọn (Bộ Công Thương): "CÔNG TY TNHH TUBU TREE · MST … · Cấp ngày … tại … · <địa chỉ>" kèm `contact` (hotline, email) khi chỗ vẽ
 * chưa có link liên hệ riêng. Ô huy hiệu "Đã thông báo Bộ Công Thương" chỉ hiện khi admin dán link thật của cổng online.gov.vn (company.bctNoticeUrl).
 */
function LegalBlock({ company, contact, className }: { company: SupportContact['company']; contact?: string; className?: string }) {
  const text = [footerCompanyLine(company), contact].filter(Boolean).join(' · ');
  const bctRaw = company?.bctNoticeUrl;
  const bctUrl = isBctNoticeUrl(bctRaw) ? bctRaw : null;
  if (!text && !bctUrl) return null;
  return (
    <div className={className} data-testid="footer-company">
      {text && <p className="text-xs leading-relaxed text-stone-600 [text-wrap:pretty]">{text}</p>}
      {bctUrl && (
        <a
          href={bctUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="footer-bct-badge"
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-control border border-stone-200 px-3 text-xs font-semibold text-stone-700 transition-colors hover:border-forest-600 hover:text-forest-800"
        >
          <BadgeCheck className="h-4 w-4 text-forest-700" aria-hidden="true" />
          Đã thông báo Bộ Công Thương
        </a>
      )}
    </div>
  );
}

/** Lối chính sách theo danh mục Bộ Công Thương (FOOTER_POLICY_LINKS): lưới đều cột, `cols` là số cột theo khổ màn. */
function PolicyNav({ label, cols }: { label: string; cols: string }) {
  return (
    <nav aria-label={label}>
      <ul className={`grid gap-x-4 ${cols}`}>
        {FOOTER_POLICY_LINKS.map((l) => (
          <li key={l.label} className="min-w-0">
            <Link href={`/chinh-sach/${l.slug}${l.anchor ? `#${l.anchor}` : ''}`} className={GRID_LINK}>
              {l.label}
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
        <PolicyNav label="Chính sách" cols="grid-cols-4 lg:grid-cols-7" />
        <LegalBlock company={company} contact={`Hotline ${formatPhoneDisplay(hotline)} · ${email}`} />
      </div>
    </footer>

    {/* Điện thoại: chân trang đầy đủ ẩn (Mini App không có), nhưng hotline, email, chính sách và thông tin thương nhân vẫn phải với tới được từ
        mọi trang (Bộ Công Thương). Hai lưới 2 cột đều nhau (liên hệ, chính sách) thay hàng link tự xuống dòng. Trang có thanh dính đáy
        ([data-sticky-bar]) thì globals.css ẩn luôn chân trang gọn này, nhắm theo data-compact-footer. */}
    <footer aria-label="Hỗ trợ và chính sách" data-compact-footer className="mt-6 border-t border-stone-200 bg-stone-0 px-4 pb-3 md:hidden">
      <ul aria-label="Hỗ trợ" className="grid grid-cols-2 gap-x-4">
        <li className="min-w-0">
          <a href={`tel:${tel}`} className={GRID_CONTACT}>
            <Phone className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            <span>
              <span className="sr-only">Hotline: </span>
              {formatPhoneDisplay(hotline)}
            </span>
          </a>
        </li>
        <li className="min-w-0">
          <a href={`mailto:${email}`} className={GRID_CONTACT}>
            <Mail className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
            <span className="break-all">{email}</span>
          </a>
        </li>
        {guestOrderLookup && (
          <li className="min-w-0">
            <Link href="/don" className={GRID_LINK}>
              {LOOKUP_LABEL}
            </Link>
          </li>
        )}
        <li className="min-w-0">
          <a href="https://blog.tubutree.com" target="_blank" rel="noopener noreferrer" className={GRID_LINK}>
            <span>Blog</span>
            <ExternalLink className="h-3 w-3 flex-none" aria-hidden="true" />
          </a>
        </li>
      </ul>
      <div className="border-t border-stone-100">
        <PolicyNav label="Chính sách (điện thoại)" cols="grid-cols-2" />
      </div>
      <LegalBlock company={company} className="border-t border-stone-100 pt-2" />
    </footer>
    </>
  );
}

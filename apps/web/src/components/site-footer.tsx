import Image from 'next/image';
import Link from 'next/link';
import { ExternalLink, Mail, Phone } from 'lucide-react';
import { getPublicSupport, type SupportContact } from '@/lib/api';
import { formatPhoneDisplay } from '@/lib/phone-display';
import tubuLogo from '@/assets/tubu-logo.png';
import { LEGAL_PAGES, LEGAL_SLUGS } from '@/lib/legal';

const LINK =
  'inline-flex min-h-11 items-center gap-2 text-sm font-medium text-forest-700 transition-colors hover:text-forest-800 hover:underline';

/** "Đơn vị vận hành: <tên> · MST <mã> · <địa chỉ>"; ẩn từng phần admin chưa nhập, ẩn cả dòng khi không còn gì. */
function operatorLine(company: SupportContact['company']): string | null {
  const parts = [company?.legalName, company?.taxCode ? `MST ${company.taxCode}` : undefined, company?.address].filter(Boolean);
  return parts.length > 0 ? `Đơn vị vận hành: ${parts.join(' · ')}` : null;
}

function CompanyInfo({ company, className }: { company: SupportContact['company']; className: string }) {
  const line = operatorLine(company);
  if (!line && !company?.bctNoticeUrl) return null;
  return (
    <div className={className} data-testid="footer-company">
      {line && <p className="text-xs text-stone-600">{line}</p>}
      {company?.bctNoticeUrl && (
        <a href={company.bctNoticeUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
          Đã thông báo Bộ Công Thương
        </a>
      )}
    </div>
  );
}

/** Chân trang web khách: liên hệ hỗ trợ lấy từ cấu hình công khai (admin đổi được). */
export default async function SiteFooter() {
  const { hotline, email, community, company } = await getPublicSupport();
  // `tel:` chỉ nhận chữ số và dấu +, bỏ khoảng trắng/dấu chấm cho số hiển thị "0984 606 774".
  const tel = hotline.replace(/[^\d+]/g, '');
  const channels = [
    { label: 'Nhóm Zalo', href: community?.zaloGroupUrl },
    { label: 'Facebook', href: community?.facebookUrl },
    { label: 'TikTok', href: community?.tiktokUrl },
  ].filter((c): c is { label: string; href: string } => Boolean(c.href));

  return (
    <>
    <footer className="mt-12 hidden md:block border-t border-stone-200 bg-stone-0">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-2">
        <div>
          <Image src={tubuLogo} alt="Tubu Tree" width={110} height={40} className="h-10 w-auto" />
          <p className="mt-1 max-w-sm text-sm text-stone-600">
            Sống xanh An Lành — mỹ phẩm và đồ tiêu dùng thiên nhiên tuyển chọn từ các thương hiệu Việt.
          </p>
        </div>

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
          </ul>
        </div>
      </div>

      {channels.length > 0 && (
        <nav aria-label="Kênh cộng đồng" className="mx-auto max-w-6xl px-4 pb-2">
          <ul className="flex flex-wrap gap-x-6">
            {channels.map((c) => (
              <li key={c.label}>
                <a href={c.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  <span>{c.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <nav aria-label="Chính sách" className="mx-auto max-w-6xl px-4 pb-6">
        <ul className="flex flex-wrap gap-x-6 border-t border-stone-200 pt-2">
          {LEGAL_SLUGS.map((slug) => (
            <li key={slug}>
              <Link href={`/chinh-sach/${slug}`} className={LINK}>
                {LEGAL_PAGES[slug].footerLabel}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <CompanyInfo company={company} className="mx-auto max-w-6xl px-4 pb-6" />
    </footer>

    {/* Điện thoại: chân trang đầy đủ ẩn (Mini App không có), nhưng hotline và chính sách vẫn phải với tới được từ mọi trang.
        Trang có thanh dính đáy ([data-sticky-bar]) thì globals.css ẩn luôn chân trang gọn này, nhắm theo data-compact-footer. */}
    <footer aria-label="Hỗ trợ và chính sách" data-compact-footer className="mt-8 border-t border-stone-200 bg-stone-0 px-4 py-4 md:hidden">
      <a href={`tel:${tel}`} className={LINK}>
        <Phone className="h-4 w-4" aria-hidden="true" />
        <span>Hotline: {formatPhoneDisplay(hotline)}</span>
      </a>
      <nav aria-label="Chính sách (điện thoại)">
        <ul className="flex flex-wrap gap-x-4">
          {LEGAL_SLUGS.map((slug) => (
            <li key={slug}>
              <Link href={`/chinh-sach/${slug}`} className={LINK}>
                {LEGAL_PAGES[slug].footerLabel}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <CompanyInfo company={company} className="mt-1" />
    </footer>
    </>
  );
}

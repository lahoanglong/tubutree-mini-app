import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { pdpLinkHubCopy, type PdpFaqItem, type PdpLinkItem } from '@tubutree/app-core/commerce/pdp-link-hub';
import { pdpSectionTitle } from './pdp-ui';

const BODY_SM = 'text-[length:var(--type-body-sm-size)] leading-[var(--type-body-sm-lh)]';
const LINK = `${BODY_SM} inline-flex min-h-11 items-center text-[color:var(--color-text-brand)] underline-offset-2 hover:underline`;

const productHref = (slug: string) => `/san-pham/${encodeURIComponent(slug)}`;
const categoryHref = (id: string) => `/san-pham?category=${encodeURIComponent(id)}`;

export interface PdpLinkHubProps {
  /** Hỏi–đáp dựng từ dữ liệu trang (`pdpGeneratedFaq`); trang khai đúng các câu này trong JSON-LD FAQPage. */
  faq: PdpFaqItem[];
  /** Vệt danh mục (gốc → lá, mỗi mục một liên kết) và sản phẩm cùng danh mục; null khi sản phẩm không thuộc danh mục công khai nào. */
  category: { trail: { id: string; name: string }[]; products: PdpLinkItem[] } | null;
  /** Gói Refill đã ghép với chai này (`pdpRefillLink`); null khi chưa ghép, gói hết hàng hay gian hàng chưa nhận đơn. */
  refill: { slug: string; title: string; text: string } | null;
}

/**
 * Khối cuối trang sản phẩm web: "Hỏi nhanh về sản phẩm" (mỗi câu một `<details>` gập sẵn) và liên kết nội bộ "Cùng danh mục" / "Bản Refill
 * tiết kiệm". Thành phần máy chủ: trình duyệt tự gập/mở nên trang không thêm byte JS, chữ và liên kết nằm sẵn trong HTML đầu cho công cụ tìm kiếm.
 * CHỈ hiện từ md (như `RefillLandingLink`): Mini App không có khối này, nên web khổ điện thoại giữ đúng giao diện Mini; dưới md khối vẫn trong
 * HTML (ẩn bằng CSS), các câu trả lời vẫn là chữ đang hiện ở khối Thành phần, Nguồn gốc & cách dùng và thẻ gói Refill phía trên.
 */
export function PdpLinkHub({ faq, category, refill }: PdpLinkHubProps) {
  const hasLinks = category !== null || refill !== null;
  if (faq.length === 0 && !hasLinks) return null;
  return (
    <div data-section="pdp-links" data-testid="pdp-link-hub" className="mt-8 hidden md:block">
      {faq.length > 0 && (
        <section data-testid="pdp-faq" aria-labelledby="pdp-faq-title">
          <h2 id="pdp-faq-title" className={pdpSectionTitle}>
            {pdpLinkHubCopy('faqTitle')}
          </h2>
          <div className="mt-2">
            {faq.map((f) => (
              <details key={f.key} data-testid={`pdp-faq-${f.key}`} className="group border-b border-[var(--color-border-subtle)]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                  <span className={`${BODY_SM} min-w-0 flex-1 font-semibold text-[var(--color-text-primary)]`}>{f.q}</span>
                  <ChevronDown aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 flex-none text-[var(--color-text-tertiary)] group-open:rotate-180" />
                </summary>
                {f.lines.length > 1 ? (
                  <ul className={`${BODY_SM} m-0 list-disc pb-3 pl-4 text-[var(--color-text-secondary)]`}>
                    {f.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={`${BODY_SM} m-0 pb-3 text-[var(--color-text-secondary)]`}>{f.lines[0]}</p>
                )}
              </details>
            ))}
          </div>
        </section>
      )}
      {hasLinks && (
        <nav aria-label={pdpLinkHubCopy('linksLabel')} className={`grid gap-x-8 gap-y-4 lg:grid-cols-2 ${faq.length > 0 ? 'mt-6' : ''}`}>
          {category && (
            <section data-testid="pdp-same-category" className="min-w-0">
              <h2 className={pdpSectionTitle}>{pdpLinkHubCopy('sameCategory')}</h2>
              <p data-testid="pdp-category-trail" className="m-0 flex flex-wrap items-center gap-x-1">
                {category.trail.map((c, i) => (
                  <span key={c.id} className="inline-flex items-center gap-x-1">
                    {i > 0 && <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 flex-none text-[var(--color-text-tertiary)]" />}
                    <Link href={categoryHref(c.id)} className={`${LINK} font-semibold`}>
                      {c.name}
                    </Link>
                  </span>
                ))}
              </p>
              {category.products.length > 0 && (
                <ul className="m-0 flex list-none flex-wrap gap-x-4 p-0">
                  {category.products.map((p) => (
                    <li key={p.slug} className="min-w-0 max-w-full">
                      <Link href={productHref(p.slug)} className={`${LINK} max-w-full`}>
                        <span className="truncate">{p.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {refill && (
            <section data-testid="pdp-refill-link" className="min-w-0">
              <h2 className={pdpSectionTitle}>{refill.title}</h2>
              <Link href={productHref(refill.slug)} className={`${LINK} max-w-full gap-1`}>
                <span className="truncate">{refill.text}</span>
                <ChevronRight aria-hidden="true" className="h-4 w-4 flex-none" />
              </Link>
            </section>
          )}
        </nav>
      )}
    </div>
  );
}

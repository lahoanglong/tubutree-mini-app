'use client';

import { useEffect, useRef } from 'react';
import { BadgeCheck, Check, Leaf } from 'lucide-react';
import type { PdpHighlightRow } from '@tubutree/app-core/commerce/pdp-highlights';
import { fillEcoWebCopy } from '@tubutree/app-core/eco/web-copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { trackWebEvent } from '@/lib/analytics';

export interface PdpHighlightsProps {
  /** Tối đa 3 dòng do `pdpHighlights` (app-core) chọn từ mô tả ngắn, Điểm cộng xanh và chứng nhận. */
  rows: readonly PdpHighlightRow[];
  productSlug: string;
}

/**
 * Khối "Điểm nổi bật" (w47-01), bản web của `apps/miniapp/src/components/product/pdp-highlights.tsx` (cùng lớp `.tubu-highlights*`): một dải trắng thay
 * ba khối mô tả ngắn, Điểm cộng xanh và chứng nhận. Web mở được trang ngoài nên nguồn của dòng Điểm cộng xanh là link mở tab mới; khối lọt vào màn
 * hình lần đầu thì đếm `eco_badge_opened` một lần mỗi sản phẩm.
 */
export function PdpHighlights({ rows, productSlug }: PdpHighlightsProps) {
  const ref = useRef<HTMLElement>(null);
  const sent = useRef<string | null>(null);
  const firstEco = rows.find((r) => r.kind === 'eco');
  const firstKind = firstEco?.kind === 'eco' ? firstEco.ecoKind : null;

  useEffect(() => {
    const el = ref.current;
    if (!el || !firstKind || sent.current === productSlug) return;
    const send = () => {
      sent.current = productSlug;
      trackWebEvent('eco_badge_opened', { productSlug, kind: firstKind });
    };
    if (typeof IntersectionObserver === 'undefined') return send();
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        send();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [productSlug, firstKind]);

  if (rows.length === 0) return null;
  return (
    <section ref={ref} data-pdp-block="benefits" data-testid="pdp-highlights" aria-label={fillCopy('pdp.highlights')} className="tubu-highlights">
      <ul className="tubu-highlights-list">
        {rows.map((r) => (
          <li key={r.key} data-kind={r.kind} className="tubu-highlights-row">
            {r.kind === 'certs' ? (
              <>
                <BadgeCheck size={16} aria-hidden="true" className="tubu-highlights-icon" />
                <div data-testid="pdp-certs" aria-label={fillCopy('pdp.certifications')} className="tubu-highlights-certs">
                  {r.certs.map((c) => (
                    <span key={c} className="tubu-highlights-cert">
                      {c}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                {r.kind === 'eco' ? (
                  <Leaf size={16} aria-hidden="true" className="tubu-highlights-icon" />
                ) : (
                  <Check size={16} aria-hidden="true" className="tubu-highlights-icon" />
                )}
                <div className="tubu-highlights-body">
                  <p className="tubu-highlights-text">{r.text}</p>
                  {r.kind === 'eco' && (
                    <p className="tubu-highlights-source">
                      <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[var(--color-text-link)] underline underline-offset-2">
                        {fillCopy('eco.sourceOf', { host: r.sourceHost })}
                        <span className="sr-only">, {fillEcoWebCopy('newTab')}</span>
                      </a>
                    </p>
                  )}
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

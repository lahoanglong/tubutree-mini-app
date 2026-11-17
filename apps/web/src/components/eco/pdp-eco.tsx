'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Leaf } from 'lucide-react';
import { ecoFactLines } from '@tubutree/app-core/eco/facts';
import { ecoPassportQuery } from '@tubutree/app-core/eco/passport';
import { ecoCompareCard, fillEcoWebCopy } from '@tubutree/app-core/eco/web-copy';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Icon } from '@/components/mini/icon';
import { SectionTitle } from '@/components/mini/section-title';
import { Text } from '@/components/mini/text';
import { usePdpSelection } from '@/components/pdp-selection';
import { trackWebEvent } from '@/lib/analytics';
import { useAuthPhase } from '@/lib/auth-phase';
import { coreHttp } from '@/lib/core-http';
import { phoneBand } from '@/lib/phone-ui';

/**
 * Khối "Điểm cộng xanh" (bản web của `apps/miniapp/src/components/eco/pdp-eco.tsx`): tối đa 4 sự thật đã duyệt của phân loại đang chọn, mỗi dòng
 * có link "Nguồn" mở tab mới; thẻ so sánh khi Giảm nhựa có mốc; dòng dẫn sang Hộ chiếu Xanh khi khách đã đăng nhập và API trả hộ chiếu (cờ
 * `eco.passport_enabled` tắt thì 404, không có dòng). API chỉ gửi `ecoFacts` khi cờ `eco.product_badges_enabled` bật: cờ tắt thì không có khối.
 */
export function PdpEco({ facts, productSlug }: { facts: unknown; productSlug: string }) {
  const variationId = usePdpSelection()?.selectedId ?? null;
  const lines = ecoFactLines(facts, variationId);
  const cmp = ecoCompareCard(facts, variationId);
  const authed = useAuthPhase() === 'authenticated';
  // Chỉ hỏi khi khối có dòng: cờ nhãn xanh tắt thì không có dòng nên không có request; cờ hộ chiếu tắt thì API 404 và không có dòng dẫn.
  const passport = useQuery({ ...ecoPassportQuery(coreHttp), enabled: authed && lines.length > 0 });
  const ref = useRef<HTMLElement>(null);
  const sent = useRef<string | null>(null);
  const firstKind = lines[0]?.kind ?? null;

  // Đếm một lần mỗi sản phẩm khi khối lọt vào màn hình, cùng cách với Mini.
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

  if (lines.length === 0) return null;
  return (
    <section ref={ref} data-testid="pdp-eco" className={`mt-6 md:rounded-card md:border md:border-[var(--color-border-subtle)] md:p-4 ${phoneBand}`}>
      <SectionTitle block>{fillCopy('eco.title')}</SectionTitle>
      <ul style={{ listStyle: 'none', margin: 'var(--space-stack-sm) 0 0', padding: 0, display: 'grid', gap: 'var(--space-stack-sm)' }}>
        {lines.map((l) => (
          <li key={l.kind} style={{ display: 'flex', gap: 'var(--space-inline-sm)', alignItems: 'flex-start' }}>
            <Icon icon={Leaf} size="sm" tone="brand" style={{ flexShrink: 0, marginTop: 'var(--space-inline-xs)' }} />
            <div style={{ minWidth: 0 }}>
              <Text as="p" variant="body-sm">
                {l.text}
              </Text>
              <Text as="p" variant="caption" tone="tertiary" style={{ overflowWrap: 'anywhere' }}>
                <a
                  href={l.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="-my-1 inline-block py-1 text-[var(--color-text-link)] underline underline-offset-2"
                >
                  {fillCopy('eco.sourceOf', { host: l.sourceHost })}
                  <span className="sr-only">, {fillEcoWebCopy('newTab')}</span>
                </a>
              </Text>
            </div>
          </li>
        ))}
      </ul>
      {cmp && (
        <div data-testid="pdp-eco-compare" className="mt-3 grid grid-cols-2 overflow-hidden rounded-card border border-[var(--color-border-subtle)]">
          <div className="bg-[var(--color-bg-subtle)] p-3">
            <Text as="p" variant="caption" tone="secondary">
              {fillEcoWebCopy('cmpThis')}
            </Text>
            <Text as="p" variant="body-sm" tone="brand" style={{ fontWeight: 600 }}>
              {cmp.saved}
            </Text>
          </div>
          <div className="p-3">
            <Text as="p" variant="caption" tone="secondary">
              {cmp.baseline}
            </Text>
            {cmp.bottles && (
              <Text as="p" variant="body-sm" style={{ fontWeight: 600 }}>
                {cmp.bottles}
              </Text>
            )}
          </div>
        </div>
      )}
      {passport.isSuccess && (
        <Link
          href="/tai-khoan/ho-chieu-xanh"
          data-testid="pdp-eco-passport"
          className="tubu-press mt-2 flex min-h-11 items-center justify-between gap-2 text-sm font-semibold text-[var(--color-text-brand)]"
        >
          {fillEcoWebCopy('passportLink')}
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      )}
    </section>
  );
}

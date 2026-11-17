import { useEffect, useRef } from 'react';
import { Box } from 'zmp-ui';
import { Leaf } from 'lucide-react';
import { ecoFactLines } from '@tubutree/app-core/eco/facts';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { trackEvent } from '../../services/analytics';
import { Icon } from '../ui/icon';
import { SectionTitle } from '../ui/section-title';
import { Text } from '../ui/text';

/**
 * Khối "Điểm cộng xanh" của trang sản phẩm: tối đa 4 sự thật đã duyệt của phân loại đang chọn, mỗi dòng ghi tên miền nguồn bằng chữ (webview
 * Zalo không mở link ngoài). API chỉ trả `ecoFacts` khi cờ `eco.product_badges_enabled` bật, nên cờ tắt hay chưa có sự thật nào thì không có
 * khối. Thẻ so sánh bao bì và dòng dẫn sang Hộ chiếu Xanh chỉ có trên web (gói Mini không đủ chỗ, xem `gaps` trong route-map.json).
 */
export function PdpEco({ facts, variationId, productSlug }: { facts: unknown; variationId: string | null | undefined; productSlug: string }) {
  const lines = ecoFactLines(facts, variationId);
  const ref = useRef<HTMLDivElement>(null);
  const sent = useRef<string | null>(null);
  const firstKind = lines[0]?.kind ?? null;

  // Đếm một lần mỗi sản phẩm khi khối lọt vào màn hình: khối nằm dưới nếp gấp, đếm lúc dựng thì gồm cả khách không kéo tới.
  useEffect(() => {
    const el = ref.current;
    if (!el || !firstKind || sent.current === productSlug) return;
    const send = () => {
      sent.current = productSlug;
      trackEvent('eco_badge_opened', 'miniapp', { productSlug, kind: firstKind });
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
    <Box data-testid="pdp-eco" p={4} mt={2} style={{ background: 'var(--color-bg-surface)' }}>
      <div ref={ref}>
        <SectionTitle block>{fillCopy('eco.title')}</SectionTitle>
        <ul style={{ listStyle: 'none', margin: 'var(--space-stack-sm) 0 0', padding: 0, display: 'grid', gap: 'var(--space-stack-sm)' }}>
          {lines.map((l) => (
            <li key={l.kind} style={{ display: 'flex', gap: 'var(--space-inline-sm)', alignItems: 'flex-start' }}>
              <Icon icon={Leaf} size="sm" tone="brand" style={{ flexShrink: 0, marginTop: 'var(--space-inline-xs)' }} />
              <div>
                <Text as="p" variant="body-sm">
                  {l.text}
                </Text>
                <Text as="p" variant="caption" tone="tertiary">
                  {fillCopy('eco.sourceOf', { host: l.sourceHost })}
                </Text>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Box>
  );
}

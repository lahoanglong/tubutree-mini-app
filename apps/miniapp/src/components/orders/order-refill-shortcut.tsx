import { useRef } from 'react';
import { useNavigate } from 'zmp-ui';
import { useQuery } from '@tanstack/react-query';
import { refillLandingCopy, refillLandingQuery, refillOrderShortcut, type RefillLandingRow } from '@tubutree/app-core/refill/refill-landing';
import { PdpRefillOffer } from '../product/pdp-refill-offer';
import { useRefillOfferAdd } from '../refill/use-refill-offer-add';
import { Text } from '../ui/text';
import { coreHttp } from '../../services/core-http';

export interface OrderRefillShortcutProps {
  /** Đơn đã giao: khách đã có chai, lúc nên gợi ý rót lại. */
  delivered: boolean;
  /** Cờ `catalog.refill_first_enabled`. */
  refillOn: boolean;
  /** Slug lúc mua của các dòng không phải quà. */
  slugs: readonly (string | null | undefined)[];
}

/**
 * Lối tắt Refill một chạm ở Chi tiết đơn đã giao: gói Refill thay cho một chai có trong đơn (gói chưa có trong đơn), cùng thẻ `PdpRefillOffer` của trang chi tiết chai
 * (surface `order`), cùng luật và chữ với web. Chỉ hỏi trang Refill khi đơn đã giao và cờ bật; không có cặp hợp thì không có khối.
 */
export function OrderRefillShortcut({ delivered, refillOn, slugs }: OrderRefillShortcutProps) {
  const enabled = delivered && refillOn && slugs.some((s) => !!s);
  const q = useQuery({ ...refillLandingQuery(coreHttp), enabled });
  const row = enabled ? refillOrderShortcut(q.data, slugs) : null;
  if (!row) return null;
  return <ShortcutCard row={row} />;
}

function ShortcutCard({ row }: { row: RefillLandingRow }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLElement>(null);
  const refill = useRefillOfferAdd('order', refillLandingQuery(coreHttp).queryKey);
  const busy = refill.busyVariationId;
  const title = refillLandingCopy('orderTitle');
  return (
    <section
      ref={ref}
      aria-label={title}
      data-testid="order-refill"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-inset-card)', marginTop: 'var(--space-stack-sm)', padding: 'var(--space-inset-page)', background: 'var(--color-bg-surface)' }}
    >
      <Text variant="body-sm" as="h2" style={{ fontWeight: 700 }}>
        {title}
      </Text>
      <PdpRefillOffer
        view={row.view}
        surface="order"
        busy={busy === row.view.variationId}
        blocked={busy !== null && busy !== row.view.variationId}
        onAdd={(v) => void refill.add(v, ref.current?.querySelector('[data-testid="pdp-refill-add"]') ?? null)}
        onOpen={(slug) => navigate(`/product/${encodeURIComponent(slug)}`)}
      />
    </section>
  );
}

'use client';

import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { refillLandingCopy, refillLandingQuery, refillOrderShortcut, type RefillLandingRow } from '@tubutree/app-core/refill/refill-landing';
import { PdpRefillOffer } from '@/components/mini/pdp-refill-offer';
import { useRefillOfferAdd } from '@/components/refill/use-refill-offer-add';
import { coreHttp } from '@/lib/core-http';

export interface OrderRefillShortcutProps {
  /** Đơn đã giao: khách đã có chai, lúc nên gợi ý rót lại. */
  delivered: boolean;
  /** Cờ `catalog.refill_first_enabled`. */
  refillOn: boolean;
  /** Slug lúc mua của các dòng không phải quà. */
  slugs: readonly (string | null | undefined)[];
  className?: string;
  titleClassName?: string;
}

/**
 * Lối tắt Refill một chạm ở Chi tiết đơn đã giao: gói Refill thay cho một chai có trong đơn (gói chưa có trong đơn), cùng thẻ `PdpRefillOffer` của trang chi tiết chai
 * (surface `order`). Chỉ hỏi trang Refill khi đơn đã giao và cờ bật; không có cặp hợp thì không có khối. Giỏ nhanh chỉ dựng khi có thẻ.
 */
export function OrderRefillShortcut({ delivered, refillOn, slugs, className, titleClassName }: OrderRefillShortcutProps) {
  const enabled = delivered && refillOn && slugs.some((s) => !!s);
  const q = useQuery({ ...refillLandingQuery(coreHttp), enabled });
  const row = enabled ? refillOrderShortcut(q.data, slugs) : null;
  if (!row) return null;
  return <ShortcutCard row={row} className={className} titleClassName={titleClassName} />;
}

function ShortcutCard({ row, className, titleClassName }: { row: RefillLandingRow; className?: string; titleClassName?: string }) {
  const ref = useRef<HTMLElement>(null);
  const refill = useRefillOfferAdd('order', refillLandingQuery(coreHttp).queryKey);
  const busy = refill.busyVariationId;
  return (
    <section ref={ref} aria-labelledby="order-refill-title" data-testid="order-refill" className={className}>
      <h2 id="order-refill-title" className={titleClassName}>
        {refillLandingCopy('orderTitle')}
      </h2>
      <PdpRefillOffer
        view={row.view}
        surface="order"
        busy={busy === row.view.variationId}
        blocked={busy !== null && busy !== row.view.variationId}
        onAdd={(v) => refill.add(v, ref.current?.querySelector('[data-testid="pdp-refill-add"]') ?? null)}
      />
      {refill.feedback}
    </section>
  );
}

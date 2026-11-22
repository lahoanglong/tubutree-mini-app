import { ExternalLink, Truck } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';

/**
 * Viên tra cứu hành trình trên trang hãng vận chuyển, đặt ngay dưới thẻ trạng thái của Chi tiết đơn để khách đang chờ hàng thấy ngay, không phải cuộn tới khối
 * Vận chuyển. Là lối tra cứu DUY NHẤT của trang: khối Vận chuyển chỉ còn hãng, mã vận đơn và nút chép. `href` đã lọc chỉ http/https.
 */
export function OrderTrackingPill({ href, partner }: { href: string; partner?: string | null }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="order-tracking-pill"
      className="tubu-press inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-4 text-sm font-semibold text-[color:var(--color-text-brand)]"
    >
      <Truck className="h-4 w-4 flex-none" aria-hidden="true" />
      <span className="truncate">
        {fillCopy('order.shipping.track')}
        {partner && <span className="font-normal text-[color:var(--color-text-secondary)]"> · {partner}</span>}
      </span>
      <ExternalLink className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
    </a>
  );
}

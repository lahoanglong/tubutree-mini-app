import { ChevronRight, PackageCheck, RotateCcw, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { ProductTrustCta, ProductTrustStripView, TrustPillarKey } from '@tubutree/app-core/commerce/product-trust-strip';
import { Icon } from './icon';
import '../../css/product-trust.css';

export interface ProductTrustStripProps {
  /** Kết quả của `productTrustStrip` (app-core); null thì không vẽ gì (hàng gian hàng tự giao không có cam kết của Tubu). */
  view: ProductTrustStripView | null;
  /** Chạm lối xem chính sách: Mini mở chính sách ngay trong app (`PolicySheet`), không rời trang sản phẩm. */
  onOpenPolicy: (slug: ProductTrustCta['slug']) => void;
}

const PILLAR_ICON: Record<TrustPillarKey, LucideIcon> = { origin: ShieldCheck, delivery: PackageCheck, returns: RotateCcw };

/**
 * Dải cam kết dưới khối chọn phân loại ở trang chi tiết: ba trụ cột ngắn (nguồn gốc, giao hàng, đổi trả) và một lối xem chính sách.
 * Chữ, số trụ cột và đích của lối xem do `productTrustStrip` quyết, dùng chung với web.
 */
export function ProductTrustStrip({ view, onOpenPolicy }: ProductTrustStripProps) {
  if (!view) return null;
  return (
    <section data-testid="product-trust-strip" aria-label={view.groupAria} className="tubu-trust">
      <ul className="tubu-trust-list" data-count={view.pillars.length}>
        {view.pillars.map((p) => (
          <li key={p.key} data-testid={`trust-pillar-${p.key}`} className="tubu-trust-item">
            <span aria-hidden="true" className="tubu-trust-icon">
              <Icon icon={PILLAR_ICON[p.key]} size="md" tone="brand" />
            </span>
            <p className="tubu-trust-title">{p.title}</p>
            <p className="tubu-trust-sub">{p.sub}</p>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid="product-trust-cta"
        data-policy={view.cta.slug}
        aria-label={view.cta.ariaLabel}
        className="tubu-press tubu-hit-44 tubu-trust-cta"
        onClick={() => onOpenPolicy(view.cta.slug)}
      >
        <span>{view.cta.label}</span>
        <Icon icon={ChevronRight} size="sm" tone="muted" />
      </button>
    </section>
  );
}

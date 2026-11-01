'use client';

// Nguồn: apps/miniapp/src/components/ui/section-card.tsx
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { BUILDER_COPY, type SectionCardView } from '@tubutree/app-core/commerce/storefront-builder';
import { Icon } from './icon';
import { ProductThumb } from './product-thumb';

export interface SectionCardProps {
  view: SectionCardView;
  onOpen: () => void;
  /** Đứng ngoài nút mở (một nút khác, vd menu), để không lồng nút trong nút. */
  trailing?: ReactNode;
}

const THUMB = 40;

/**
 * Một khối ở màn chính của trình dựng gian hàng: tên, kiểu và số món khách thấy, dải ảnh, cảnh báo ngân sách. Cả thẻ là MỘT nút mở
 * trang chi tiết; tên đọc là câu của `sectionCardView` (tên, kiểu, số món, cảnh báo) vì ảnh chỉ trang trí.
 */
export function SectionCard({ view, onOpen, trailing }: SectionCardProps) {
  const label = view.tabOnly ? `${view.spoken} ${BUILDER_COPY.tabOnly}.` : view.spoken;
  return (
    <div
      data-testid="section-card"
      data-section-id={view.id}
      style={{ display: 'flex', alignItems: 'stretch', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--elevation-1)' }}
    >
      <button
        type="button"
        aria-label={label}
        className="tubu-press"
        onClick={onOpen}
        style={{
          flex: 1, minWidth: 0, minHeight: 44, padding: 12, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer',
          font: 'inherit', color: 'inherit', borderRadius: 'var(--radius-card)', display: 'block',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
            <span
              style={{
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere',
                fontFamily: 'var(--font-ui)', fontSize: 'var(--type-title-sm-size)', lineHeight: 'var(--type-title-sm-lh)', fontWeight: 700,
                letterSpacing: '-0.01em', color: 'var(--color-text-primary)',
              }}
            >
              {view.title}
            </span>
            <span style={{ display: 'block', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-tertiary)' }}>
              {view.countText}
            </span>
          </span>
          <Icon icon={ChevronRight} size="sm" tone="muted" style={{ flexShrink: 0 }} />
        </span>
        {view.thumbs.length > 0 && (
          <span data-testid="section-thumbs" aria-hidden="true" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {view.thumbs.map((src, i) => (
              <ProductThumb key={`${src}-${i}`} src={src} alt="" size={THUMB} />
            ))}
          </span>
        )}
        {view.warnings.map((w) => (
          <span key={w} style={{ display: 'block', marginTop: 6, fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-status-warning-fg)' }}>
            {w}
          </span>
        ))}
        {view.tabOnly && (
          <span style={{ display: 'block', marginTop: 6, fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-tertiary)' }}>
            {BUILDER_COPY.tabOnly}
          </span>
        )}
      </button>
      {trailing}
    </div>
  );
}

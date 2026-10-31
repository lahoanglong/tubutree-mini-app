import { useEffect } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useScrollHints } from './use-scroll-hints';

export interface SortOption {
  value: string;
  label: string;
  /** Tên đọc khi nhãn nhìn thấy không đủ nghĩa ("Giá ⇅" → "Giá, đổi chiều sắp xếp"). */
  spoken?: string;
}

export interface SortBarProps {
  value: string;
  options: SortOption[];
  /** Gọi cả khi bấm lại tab đang chọn: tab "Giá" tự đảo chiều ở nơi gọi. */
  onChange: (value: string) => void;
  filterCount?: number;
  onFilter?: () => void;
  sticky?: boolean;
}

/**
 * Một hàng sắp xếp dính cao 44px (critique-shop BR-01) thay hàng chip + hàng "Bộ lọc" riêng. Mục đang chọn có gạch chân 2px vẽ bằng
 * bóng trong (không đổi kích thước nên hàng không nhảy). Nhóm nút bật/tắt `aria-pressed`, không phải tablist: đây là chọn kiểu sắp
 * xếp, không đổi nội dung của một tabpanel. Dính dưới ô tìm: nơi gọi đặt `--sort-bar-top`.
 */
export function SortBar({ value, options, onChange, filterCount, onFilter, sticky }: SortBarProps) {
  const hints = useScrollHints<HTMLDivElement>();
  useEffect(() => {
    // Chỉ cuộn ngang trong hàng: scrollIntoView sẽ kéo cả trang tới thanh sắp xếp khi nó nằm dưới màn hình lúc mới vào.
    const row = hints.ref.current;
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !on) return;
    const a = row.getBoundingClientRect();
    const b = on.getBoundingClientRect();
    if (b.left < a.left) row.scrollLeft += b.left - a.left;
    else if (b.right > a.right) row.scrollLeft += b.right - a.right;
  }, [value, hints.ref]);
  if (options.length === 0 && !onFilter) return null;
  const n = typeof filterCount === 'number' && Number.isFinite(filterCount) && filterCount > 0 ? Math.floor(filterCount) : 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: 'var(--color-bg-surface)',
        boxShadow: 'inset 0 -1px 0 var(--color-border-subtle)',
        ...(sticky ? { position: 'sticky', top: 'var(--sort-bar-top, 0px)', zIndex: 2 } : null),
      }}
    >
      <div {...hints} role="group" aria-label={fillCopy('sort.groupLabel')} className="scroll-x tubu-scroll-fade" style={{ display: 'flex', flex: '1 1 auto', minWidth: 0 }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              className="tubu-press"
              aria-pressed={on}
              aria-label={o.spoken}
              onClick={() => onChange(o.value)}
              style={{
                flex: '1 0 auto',
                minHeight: 44,
                minWidth: 44,
                padding: '0 8px',
                border: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 'var(--type-body-sm-size)',
                lineHeight: 'var(--type-body-sm-lh)',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                color: on ? 'var(--color-text-brand)' : 'var(--color-text-secondary)',
                ...(on ? { boxShadow: 'inset 0 -2px 0 var(--color-border-selected)' } : null),
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {onFilter && (
        <button
          type="button"
          className="tubu-press"
          aria-label={n > 0 ? fillCopy('sort.filterSpoken', { n }) : undefined}
          onClick={onFilter}
          style={{
            flex: '0 0 auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minHeight: 44,
            minWidth: 44,
            padding: '0 8px',
            border: 'none',
            background: 'transparent',
            fontFamily: 'inherit',
            fontSize: 'var(--type-body-sm-size)',
            lineHeight: 'var(--type-body-sm-lh)',
            fontWeight: 600,
            cursor: 'pointer',
            color: n > 0 ? 'var(--color-text-brand)' : 'var(--color-text-secondary)',
          }}
        >
          <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
          {n > 0 ? fillCopy('sort.filterCount', { n }) : fillCopy('sort.filter')}
        </button>
      )}
    </div>
  );
}

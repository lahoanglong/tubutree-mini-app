import { Fragment, useEffect, useId, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { tabKeyTarget } from '@tubutree/app-core/commerce/flash-slots';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { SR_ONLY } from './sr-only';
import { useScrollHints } from './use-scroll-hints';

export interface SortOption {
  value: string;
  label: string;
  /** Tên đọc khi nhãn nhìn thấy không đủ nghĩa ("Giá ⇅" → "Giá, đổi chiều sắp xếp"). */
  spoken?: string;
  /** Gợi ý đọc thêm sau tên ("Chạm để đổi chiều"): để ở aria-describedby, vì tên phải bắt đầu bằng chữ nhìn thấy (WCAG 2.5.3). */
  hint?: string;
}

export interface SortBarProps {
  value: string;
  options: SortOption[];
  /** Gọi cả khi bấm lại tab đang chọn: tab "Giá" tự đảo chiều ở nơi gọi. */
  onChange: (value: string) => void;
  filterCount?: number;
  onFilter?: () => void;
  /** Bảng lọc mà nút "Lọc" mở đang mở hay đóng; có truyền thì nút báo `aria-expanded` + `aria-haspopup="dialog"`. */
  filterExpanded?: boolean;
  sticky?: boolean;
}

/**
 * Một hàng sắp xếp dính cao 44px (critique-shop BR-01) thay hàng chip + hàng "Bộ lọc" riêng. Mục đang chọn có gạch chân 2px vẽ bằng
 * bóng trong (không đổi kích thước nên hàng không nhảy). Nhóm nút bật/tắt `aria-pressed`, không phải tablist: đây là chọn kiểu sắp
 * xếp, không đổi nội dung của một tabpanel. Dính dưới ô tìm: nơi gọi đặt `--sort-bar-top`. Phím mũi tên, Home, End chọn và đưa tiêu
 * điểm sang mục kế (như SlotTabs); tiêu điểm luôn đi theo phím, còn `onChange` chỉ gọi khi sang mục khác mục đang chọn (bấm lại "Giá" là đảo chiều).
 */
export function SortBar({ value, options, onChange, filterCount, onFilter, filterExpanded, sticky }: SortBarProps) {
  const hints = useScrollHints<HTMLDivElement>();
  const uid = useId();
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
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
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <Fragment key={o.value}>
            <button
              ref={(el) => {
                buttonRefs.current[i] = el;
              }}
              type="button"
              className="tubu-press"
              aria-pressed={on}
              aria-label={o.spoken}
              aria-describedby={o.hint ? `${uid}-hint-${o.value}` : undefined}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                if (e.altKey || e.ctrlKey || e.metaKey) return;
                const target = tabKeyTarget(e.key, i, options.length);
                if (target === null) return;
                e.preventDefault();
                const next = options[target]!;
                // Chọn lại mục đang chọn là đảo chiều ("Giá"): chỉ gọi onChange khi sang mục khác. `target !== i` chặn thêm lần gọi thứ hai khi `value` chưa kịp cập nhật (giữ phím End).
                if (target !== i && next.value !== value) onChange(next.value);
                buttonRefs.current[target]?.focus();
              }}
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
            {o.hint && (
              <span id={`${uid}-hint-${o.value}`} style={SR_ONLY}>
                {o.hint}
              </span>
            )}
            </Fragment>
          );
        })}
      </div>
      {onFilter && (
        <button
          type="button"
          className="tubu-press"
          aria-label={n > 0 ? fillCopy('sort.filterSpoken', { n }) : undefined}
          aria-expanded={typeof filterExpanded === 'boolean' ? filterExpanded : undefined}
          aria-haspopup={typeof filterExpanded === 'boolean' ? 'dialog' : undefined}
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

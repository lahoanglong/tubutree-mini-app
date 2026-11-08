'use client';

// Nguồn: apps/miniapp/src/components/ui/frequently-bought-together.tsx (cùng props, cùng test-id, cùng lớp tubu-fbt-*).
import { useEffect, useRef } from 'react';
import type { FbtLine, FbtSummary } from '@tubutree/app-core/commerce/frequently-bought';
import { vnd } from '@tubutree/app-core/commerce/money';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { CheckMark, miniCheckbox, miniCheckboxWrap } from '@/components/order-mobile/mobile-ui';
import { Badge } from './badge';
import { Button } from './button';
import { PriceTag } from './price-tag';
import { ProductThumb } from './product-thumb';
import { SectionHeader } from './section-header';

export interface FrequentlyBoughtTogetherProps {
  /** Món đang xem đứng đầu rồi các món bổ trợ (`buildFrequentlyBoughtBundle`). */
  lines: readonly FbtLine[];
  /** `FbtLine.key` của các dòng đang tick. */
  picked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Tổng của các dòng đang tick (`frequentlyBoughtSummary`). */
  summary: FbtSummary;
  /** Đang thêm cả bộ vào giỏ. */
  busy?: boolean;
  onAdd: () => void;
  /** Tick lại cả bộ một chạm. Nút "Chọn tất cả" chỉ hiện khi có hàm này và khách đã bỏ tick ít nhất một món. */
  onSelectAll?: () => void;
}

function FbtRow({ line, on, onToggle }: { line: FbtLine; on: boolean; onToggle: () => void }) {
  return (
    <label data-testid="fbt-row" data-variation-id={line.variationId} className="tubu-press tubu-fbt-row">
      <span className="tubu-fbt-check">
        <span className={miniCheckboxWrap}>
          <input
            type="checkbox"
            aria-label={fillCopy('fbt.pickSpoken', { name: line.name, price: vnd(line.price) })}
            checked={on}
            onChange={onToggle}
            className={miniCheckbox}
          />
          <CheckMark />
        </span>
      </span>
      <ProductThumb src={line.thumbnail} alt="" size={48} />
      <span className="tubu-fbt-body">
        {line.isCurrent && (
          <span className="tubu-fbt-tag">
            <Badge tone="brand" size="sm">
              {fillCopy('fbt.current')}
            </Badge>
          </span>
        )}
        <span className="tubu-fbt-name">{line.name}</span>
        <PriceTag value={line.price} compareAt={line.compareAt} size="md" tone={line.compareAt && line.compareAt > line.price ? 'deal' : 'default'} />
      </span>
    </label>
  );
}

/**
 * "Gợi ý mua kèm hợp vị" ở trang chi tiết: món đang xem và tối đa 2 món bổ trợ, mỗi dòng tick chọn, một nút "Thêm n món vào giỏ · tổng".
 * Chỉ vẽ: chọn món, giá và tổng là việc của `buildFrequentlyBoughtBundle` / `frequentlyBoughtSummary` ở app-core (dùng chung với Mini App). Không có
 * khuyến mãi riêng của bộ nên dòng "Tiết kiệm" chỉ là phần Giờ vàng và giá bán đã giảm của từng món, và để trống khi không có (vẫn giữ chỗ một dòng).
 */
export function FrequentlyBoughtTogether({ lines, picked, onToggle, summary, busy = false, onAdd, onSelectAll }: FrequentlyBoughtTogetherProps) {
  const root = useRef<HTMLElement>(null);
  const refocus = useRef(false);
  const showSelectAll = onSelectAll !== undefined && picked.size < lines.length;
  // Nút tự gỡ khi bộ đã chọn đủ: đưa tiêu điểm sang nút Thêm để bàn phím và trình đọc màn hình không rơi về đầu trang, và nghe luôn số món, tổng mới.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (!showSelectAll) root.current?.querySelector<HTMLElement>('[data-testid="fbt-add"]')?.focus();
  });
  if (lines.length === 0) return null;
  const title = fillCopy('fbt.title');
  return (
    <section ref={root} aria-label={title} data-testid="fbt" className="tubu-fbt">
      {showSelectAll ? (
        <div className="tubu-fbt-head">
          <SectionHeader title={title} />
          <button
            type="button"
            data-testid="fbt-select-all"
            aria-label={fillCopy('fbt.selectAllSpoken', { title })}
            onClick={() => {
              refocus.current = true;
              onSelectAll();
            }}
            className="tubu-press tubu-fbt-select-all"
          >
            {fillCopy('fbt.selectAll')}
          </button>
        </div>
      ) : (
        <SectionHeader title={title} />
      )}
      <div role="group" aria-label={title} className="tubu-fbt-list">
        {lines.map((l) => (
          <FbtRow key={l.key} line={l} on={picked.has(l.key)} onToggle={() => onToggle(l.key)} />
        ))}
      </div>
      {/* Là vùng đọc để trình đọc màn hình nghe số tiền tiết kiệm khi khách tick hay bỏ tick. */}
      <div data-testid="fbt-save" aria-live="polite" className="tubu-fbt-save">
        {summary.count > 0 && summary.bundleSavings > 0 ? fillCopy('combo.save', { save: vnd(summary.bundleSavings) }) : null}
      </div>
      <Button fullWidth data-testid="fbt-add" variant="primary" loading={busy} disabled={summary.count === 0} onPress={onAdd}>
        {summary.count > 0 ? fillCopy('fbt.add', { n: summary.count, total: vnd(summary.bundleTotal) }) : fillCopy('fbt.pickHint')}
      </Button>
    </section>
  );
}

'use client';

import { CATALOG_ISSUE_LABELS, COPY_STATUS_LABELS, type CatalogIssueKind, type CatalogIssueRow, type CopyStatus } from '@tubutree/app-core/commerce/catalog-quality-audit';
import { ToneBadge } from '@/components/admin/ui';
import type { Tone } from '@/lib/recycling';

export const ISSUE_TONE: Record<CatalogIssueKind, Tone> = {
  known_media_mismatch: 'danger',
  missing_thumbnail: 'warning',
  invalid_retail_price: 'danger',
  placeholder_stock: 'warning',
  unnamed_variation: 'warning',
  empty_native_description: 'neutral',
};

export const COPY_STATUS_TONE: Record<CopyStatus, Tone> = {
  native: 'success',
  fallback: 'info',
  none: 'warning',
  unknown: 'neutral',
};

interface Props {
  rows: readonly CatalogIssueRow[];
  selected: ReadonlySet<string>;
  /** Đã chọn đủ trần một lượt soạn: ô chưa tích bị khoá, ô đã tích vẫn bỏ được. */
  selectionFull: boolean;
  onToggle: (id: string, on: boolean) => void;
}

/** Danh sách sản phẩm cần sửa; ô tích chọn là để đưa sản phẩm vào lượt soạn mô tả bằng AI. */
export function CatalogIssueList({ rows, selected, selectionFull, onToggle }: Props) {
  return (
    <ul className="divide-y divide-stone-200 rounded-control border border-stone-200" aria-label="Sản phẩm cần sửa">
      {rows.map((r) => {
        const id = r.id;
        const checked = id !== undefined && selected.has(id);
        return (
          <li key={r.slug} className="flex min-w-0 items-start gap-1 p-3 pl-1">
            {id !== undefined ? (
              <label className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && selectionFull}
                  onChange={(e) => onToggle(id, e.target.checked)}
                  aria-label={`Chọn ${r.name} để soạn mô tả bằng AI`}
                  className="h-5 w-5"
                />
              </label>
            ) : (
              <span aria-hidden="true" className="min-w-[44px] shrink-0" />
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 break-words text-sm font-medium text-stone-900">{r.name}</span>
                <ToneBadge tone={COPY_STATUS_TONE[r.copyStatus]}>{COPY_STATUS_LABELS[r.copyStatus]}</ToneBadge>
                {r.isActive === false && <ToneBadge tone="neutral">Đang ẩn</ToneBadge>}
                {r.inStock === false && <ToneBadge tone="neutral">Hết hàng</ToneBadge>}
              </div>
              <div className="break-all font-mono text-[11px] text-stone-500">{r.slug}</div>
              <ul className="space-y-1.5">
                {r.issues.map((i) => (
                  <li key={i.kind} className="space-y-0.5 text-sm text-stone-700">
                    <ToneBadge tone={ISSUE_TONE[i.kind]} wrap>
                      {CATALOG_ISSUE_LABELS[i.kind]}
                    </ToneBadge>
                    <p className="min-w-0 break-words">{i.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

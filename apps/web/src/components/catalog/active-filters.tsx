'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { browseText } from '@/lib/browse-text';
import type { ActiveFilterChip, SearchState } from '@/lib/search-state';
import { Chip } from '@/components/mini/chip';
import { Icon } from '@/components/mini/icon';
import { Text } from '@/components/mini/text';

export interface ActiveFiltersProps {
  chips: ActiveFilterChip[];
  filtersIgnored: boolean;
  onPatch: (patch: Partial<SearchState>) => void;
  /** Id của tiêu đề kết quả: nhận focus khi chip cuối bị gỡ (chip biến mất kéo theo focus về đầu trang). */
  emptyFocusId?: string;
}

/** Chip "đang lọc" gỡ được từng cái + câu báo khi API cũ bỏ qua bộ lọc. Không có gì để nói thì không vẽ gì (không để khoảng trống). */
export function ActiveFilters({ chips, filtersIgnored, onPatch, emptyFocusId = 'danh-sach-san-pham' }: ActiveFiltersProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<number | null>(null);
  const signature = chips.map((c) => c.key).join('|');
  // Gỡ chip làm nút đang giữ focus biến mất: chuyển focus sang chip kế (cùng vị trí), hết chip thì sang tiêu đề kết quả.
  // Chạy theo bộ chip đổi (URL cập nhật sau lúc bấm), không theo mỗi lần vẽ.
  useEffect(() => {
    const at = focusAfter.current;
    if (at === null) return;
    focusAfter.current = null;
    const buttons = groupRef.current?.querySelectorAll<HTMLElement>('button');
    (buttons && buttons.length > 0 ? buttons[Math.min(at, buttons.length - 1)] : document.getElementById(emptyFocusId))?.focus();
  }, [signature, emptyFocusId]);
  if (chips.length === 0 && !filtersIgnored) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {chips.length > 0 && (
        <div ref={groupRef} role="group" aria-label={browseText.activeFilters} className="scroll-x tubu-bleed px-4 md:px-0" style={{ gap: 8, paddingTop: 6, paddingBottom: 6 }}>
          {chips.map((c, i) => (
            // Nút hành động (gỡ lọc), không phải nút bật/tắt: không dùng `selected` (aria-pressed=true đọc thành "đã bấm"); màu giữ như chip đang chọn.
            <Chip
              key={c.key}
              ariaLabel={browseText.removeFilter(c.label)}
              style={{ background: 'var(--color-action-primary-bg)', color: 'var(--color-action-primary-fg)', boxShadow: 'none' }}
              onPress={() => {
                focusAfter.current = i;
                onPatch(c.patch);
              }}
            >
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
              <Icon icon={X} size="sm" tone="inverse" style={{ flexShrink: 0 }} />
            </Chip>
          ))}
        </div>
      )}
      {filtersIgnored && (
        <p role="status" style={{ margin: 0 }}>
          <Text variant="caption" tone="warning">
            {browseText.filtersIgnored}
          </Text>
        </p>
      )}
    </div>
  );
}

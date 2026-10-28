import type { CategoryEntry } from '../../hooks/use-categories';
import { vi } from '../../i18n/vi';
import { haptic } from '../../utils/haptic';
import { Chip } from '../ui/chip';

export interface CategoryChipsProps {
  entries: CategoryEntry[];
  /** Danh mục hoặc phân khúc đang xem. */
  active: { kind: CategoryEntry['kind']; key: string } | null;
  onSelect: (entry: CategoryEntry) => void;
}

/**
 * Một hàng chip danh mục cuộn ngang ở đầu trang khi đã chọn danh mục: đổi sang danh mục khác bằng một chạm, không phải gỡ chip lọc rồi
 * chọn lại. Chip đang xem được tô đậm; chạm lại chip đó không làm gì. Đệm dọc 6px để vùng chạm 44px của Chip không bị `.scroll-x` cắt.
 */
export function CategoryChips({ entries, active, onSelect }: CategoryChipsProps) {
  if (entries.length === 0) return null;
  return (
    <div role="group" aria-label={vi.browse.categoryChips} className="scroll-x" style={{ gap: 8, padding: '6px 16px' }}>
      {entries.map((e) => {
        const selected = active !== null && active.kind === e.kind && active.key === e.key;
        return (
          <Chip
            key={`${e.kind}:${e.key}`}
            selected={selected}
            onPress={() => {
              if (selected) return;
              haptic('light');
              onSelect(e);
            }}
          >
            {e.label}
          </Chip>
        );
      })}
    </div>
  );
}

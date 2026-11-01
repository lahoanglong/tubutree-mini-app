import type { CategoryNode } from '@tubutree/app-core/browse/category-tree';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { haptic } from '../../utils/haptic';
import { Chip } from '../ui/chip';

export interface CategoryChipRowProps {
  parent: CategoryNode;
  chips: CategoryNode[];
  /** Danh mục đang xem: chính `parent` hoặc một trong `chips`. */
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Chip danh mục tầng 2 (chỉ khi danh mục có con): "Tất cả" quay về cha, mỗi con một chip. Chạm chip đang chọn không làm gì.
 * Đệm dọc 6px để vùng chạm 44px của Chip không bị `.scroll-x` cắt.
 */
export function CategoryChipRow({ parent, chips, activeId, onSelect }: CategoryChipRowProps) {
  const pick = (id: string) => {
    if (id === activeId) return;
    haptic('light');
    onSelect(id);
  };
  return (
    <div role="group" aria-label={fillCopy('browse.chipsLabel')} className="scroll-x" style={{ gap: 8, padding: '6px 16px' }}>
      <Chip selected={activeId === parent.id} onPress={() => pick(parent.id)}>
        {fillCopy('browse.all')}
      </Chip>
      {chips.map((c) => (
        <Chip key={c.id} selected={activeId === c.id} onPress={() => pick(c.id)}>
          {c.name}
        </Chip>
      ))}
    </div>
  );
}

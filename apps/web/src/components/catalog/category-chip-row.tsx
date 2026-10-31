'use client';

import type { CategoryNode } from '@tubutree/app-core/browse/category-tree';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Chip } from '@/components/mini/chip';

export interface CategoryChipRowProps {
  parent: CategoryNode;
  chips: CategoryNode[];
  /** Danh mục đang xem: chính `parent` hoặc một trong `chips`. */
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * Chip danh mục tầng 2 (chỉ khi danh mục có con): "Tất cả" quay về cha, mỗi con một chip. Chạm chip đang chọn không làm gì.
 * Đệm dọc 6px để vùng chạm 44px của Chip không bị `.scroll-x` cắt; hàng tràn ra mép màn hình điện thoại như Mini App. Từ lg cột lọc
 * bên trái đã có cây danh mục nên hàng chip ẩn đi.
 */
export function CategoryChipRow({ parent, chips, activeId, onSelect }: CategoryChipRowProps) {
  const pick = (id: string) => {
    if (id !== activeId) onSelect(id);
  };
  return (
    <div role="group" aria-label={fillCopy('browse.chipsLabel')} className="scroll-x -mx-4 px-4 md:mx-0 md:px-0 lg:hidden" style={{ gap: 8, paddingTop: 6, paddingBottom: 6 }}>
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

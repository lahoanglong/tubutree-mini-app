/**
 * Nút của cây danh mục như `GET /categories` trả. `children` và `productCount` optional vì API trước đợt shop 2026-10 trả danh sách
 * phẳng (thiếu `children`) và API cũ hơn thiếu `productCount`: nơi đọc không được giả định chúng có.
 */
export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  image: string | null;
  productCount?: number;
  children?: CategoryNode[];
}

const kids = (n: CategoryNode): CategoryNode[] => n.children ?? [];

/** Đường từ gốc tới nút (gồm chính nó); id lạ trả []. `visited` để vòng `children` hỏng không treo. */
export function categoryTrail(tree: CategoryNode[] | undefined, id: string): CategoryNode[] {
  const visited = new Set<string>();
  const walk = (nodes: CategoryNode[], path: CategoryNode[]): CategoryNode[] | null => {
    for (const n of nodes) {
      if (visited.has(n.id)) continue;
      visited.add(n.id);
      const here = [...path, n];
      if (n.id === id) return here;
      const found = walk(kids(n), here);
      if (found) return found;
    }
    return null;
  };
  return walk(tree ?? [], []) ?? [];
}

export function findCategory(tree: CategoryNode[] | undefined, id: string): CategoryNode | null {
  return categoryTrail(tree, id).at(-1) ?? null;
}

/**
 * Hàng chip danh mục tầng 2: con của danh mục đang xem (gốc có con), hoặc anh em (đang ở lá). `parent` là danh mục mà chip
 * "Tất cả" chọn. Con hết hàng bị ẩn, trừ chính nút đang xem; gốc không có con thì không có hàng chip (null).
 */
export function chipScope(tree: CategoryNode[] | undefined, activeId: string): { parent: CategoryNode; chips: CategoryNode[] } | null {
  const trail = categoryTrail(tree, activeId);
  const active = trail.at(-1);
  if (!active) return null;
  const parent = kids(active).length > 0 ? active : trail.length > 1 ? trail[trail.length - 2]! : null;
  if (!parent) return null;
  const chips = kids(parent).filter((c) => c.id === activeId || c.productCount === undefined || c.productCount > 0);
  return chips.length > 0 ? { parent, chips } : null;
}

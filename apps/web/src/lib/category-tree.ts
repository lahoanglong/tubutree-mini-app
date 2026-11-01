import type { AdminCategory } from './product-categories';

export interface CategoryLimits {
  maxRoots: number;
  maxChildren: number;
}
export interface CategoryNode extends AdminCategory {
  children: AdminCategory[];
}

const byOrder = (a: AdminCategory, b: AdminCategory) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

/** Gốc = không cha hoặc cha không còn trong danh sách (giống cây công khai); mỗi nhóm sắp theo (sortOrder, id). */
export function buildCategoryTree(items: readonly AdminCategory[]): CategoryNode[] {
  const ids = new Set(items.map((c) => c.id));
  const isRoot = (c: AdminCategory) => !c.parentId || c.parentId === c.id || !ids.has(c.parentId);
  const childrenOf = new Map<string, AdminCategory[]>();
  for (const c of items) {
    if (isRoot(c)) continue;
    const list = childrenOf.get(c.parentId!) ?? [];
    list.push(c);
    childrenOf.set(c.parentId!, list);
  }
  return items
    .filter(isRoot)
    .sort(byOrder)
    .map((c) => ({ ...c, children: (childrenOf.get(c.id) ?? []).sort(byOrder) }));
}

export const canAddRoot = (rootCount: number, limits: CategoryLimits): boolean => rootCount < limits.maxRoots;
export const canAddChild = (childCount: number, limits: CategoryLimits): boolean => childCount < limits.maxChildren;

/** Chỉ danh mục lá mới nhận sản phẩm: gốc không có con, hoặc một mục con. */
export function isLeaf(tree: readonly CategoryNode[], id: string): boolean {
  for (const root of tree) {
    if (root.id === id) return root.children.length === 0;
    if (root.children.some((c) => c.id === id)) return true;
  }
  return false;
}

/** Thứ tự mới sau khi đổi chỗ `id` với láng giềng; null khi đã ở đầu/cuối hoặc không có id. */
export function moveInOrder(ids: readonly string[], id: string, dir: 'up' | 'down'): string[] | null {
  const from = ids.indexOf(id);
  const to = dir === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

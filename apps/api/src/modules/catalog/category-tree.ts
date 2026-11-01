import { foldVietnamese } from './search-text';

/** Cây danh mục hai tầng của gian hàng: ≤8 gốc, ≤8 con mỗi gốc (01-thiet-ke §4, P16). */
export const CATEGORY_MAX_ROOTS = 8;
export const CATEGORY_MAX_CHILDREN = 8;
export const CATEGORY_NAME_MAX = 60;

/** Khoá advisory chung cho mọi thao tác ghi cây và gán ADD, để trần 8 và luật "chỉ gán vào lá" không bị thao tác xen giữa vượt qua. */
export const CATEGORY_TREE_LOCK = 'catalog.category_tree';

export function categorySlugBase(name: string): string {
  const slug = foldVietnamese(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'danh-muc';
}

export function uniqueCategorySlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function sameCategoryName(a: string, b: string): boolean {
  return foldVietnamese(a) === foldVietnamese(b);
}

export const CATEGORY_MSG = {
  rootsFull: () => `Đã đủ ${CATEGORY_MAX_ROOTS} danh mục gốc. Xoá hoặc gộp bớt một mục trước khi thêm.`,
  childrenFull: (parentName: string) =>
    `Danh mục "${parentName}" đã đủ ${CATEGORY_MAX_CHILDREN} mục con. Xoá bớt một mục con trước khi thêm.`,
  parentNotRoot: () => 'Chỉ có hai tầng: mục con không chứa thêm mục con.',
  hasChildrenCannotNest: (name: string) =>
    `Danh mục "${name}" đang có mục con nên không chuyển thành mục con được. Chuyển các mục con đi trước.`,
  duplicateName: (name: string) => `Đã có mục tên "${name}" ở cùng cấp.`,
  removeHasChildren: (name: string, n: number) => `Danh mục "${name}" còn ${n} mục con. Xoá hoặc chuyển các mục con trước.`,
  removeHasProducts: (name: string, n: number) =>
    `Danh mục "${name}" còn ${n} sản phẩm. Gỡ sản phẩm khỏi danh mục này trước khi xoá.`,
  notLeaf: (name: string) => `Danh mục "${name}" có mục con. Chỉ gán sản phẩm vào danh mục lá: chọn một mục con.`,
  notFound: () => 'Danh mục không tồn tại (có thể vừa bị xoá). Tải lại danh sách danh mục.',
  staleOrder: () => 'Danh sách danh mục đã đổi. Tải lại rồi sắp xếp lại.',
} as const;

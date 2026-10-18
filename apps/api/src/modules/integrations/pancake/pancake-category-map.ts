import type { PancakeProductDTO, PancakeCategoryNode } from './pancake.types';

/** Khoá cấu hình: { mã hoặc tên nhóm hàng Pancake → id danh mục Tubu }. */
export const PANCAKE_CATEGORY_MAP_KEY = 'pancake.category_map';
const MAP_MAX_ENTRIES = 500;

export type PancakeCategoryMap = Record<string, string>;

const norm = (s: string): string => s.trim().toLowerCase();

/** Mã và tên nhóm hàng một sản phẩm Pancake mang theo (đã chuẩn hoá để so khớp khoá của bản đồ). */
export function pancakeCategoryRefs(p: Pick<PancakeProductDTO, 'category_ids' | 'categories'>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if ((typeof v === 'string' && v.trim()) || (typeof v === 'number' && Number.isFinite(v))) out.push(norm(String(v)));
  };
  for (const id of p.category_ids ?? []) push(id);
  for (const c of p.categories ?? []) {
    if (c && typeof c === 'object') {
      push(c.id);
      push(c.name);
      push(c.text);
    } else push(c);
  }
  return [...new Set(out)];
}

/** Id danh mục Tubu cho sản phẩm; chỉ giữ id còn tồn tại (`validIds`) để bản đồ lỗi không ghi id ma vào sản phẩm. */
export function mapPancakeCategories(
  p: Pick<PancakeProductDTO, 'category_ids' | 'categories'>,
  map: PancakeCategoryMap,
  validIds: ReadonlySet<string>,
): string[] {
  const lookup = new Map(Object.entries(map).map(([k, v]) => [norm(k), v]));
  const out = new Set<string>();
  for (const ref of pancakeCategoryRefs(p)) {
    const target = lookup.get(ref);
    if (target && validIds.has(target)) out.add(target);
  }
  return [...out];
}

/** Luật ghi cho `pancake.category_map` (SystemConfigService.JSON_RULES). */
export function categoryMapProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'phải là object { "mã hoặc tên nhóm Pancake": "id danh mục Tubu" }, vd {"865301":"cmabc123"}';
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAP_MAX_ENTRIES) return `tối đa ${MAP_MAX_ENTRIES} dòng`;
  for (const [k, v] of entries) {
    if (!k.trim() || k.length > 120) return 'khoá (mã hoặc tên nhóm Pancake) không được để trống hoặc dài quá 120 ký tự';
    if (typeof v !== 'string' || !v.trim() || v.length > 64) return `giá trị của "${k}" phải là id danh mục Tubu (chuỗi, xem Quản trị, Danh mục sản phẩm)`;
  }
  return null;
}

export interface FlatPancakeCategory {
  id: string;
  name: string;
  /** "Cha > Con" để admin phân biệt nhóm trùng tên. */
  path: string;
}

export function flattenPancakeCategories(nodes: readonly PancakeCategoryNode[], parents: string[] = []): FlatPancakeCategory[] {
  const out: FlatPancakeCategory[] = [];
  for (const n of nodes) {
    const name = n.text ?? n.name ?? String(n.id);
    out.push({ id: String(n.id), name, path: [...parents, name].join(' > ') });
    if (n.nodes?.length) out.push(...flattenPancakeCategories(n.nodes, [...parents, name]));
  }
  return out;
}

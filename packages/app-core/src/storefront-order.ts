export type MoveDirection = 'up' | 'down';

/**
 * Mọi lần đổi thứ tự (bộ sưu tập và món) chạy lần lượt: mỗi yêu cầu mang cả thứ tự đầy đủ, nên hai yêu cầu bay song song
 * có thể đến máy chủ ngược chiều và làm mất bước sau. `scope` của TanStack Query xếp chúng vào một hàng.
 */
export const STOREFRONT_REORDER_MUTATION = { mutationKey: ['storefront-reorder'], scope: { id: 'storefront-reorder' } } as const;

/**
 * Đổi chỗ phần tử `id` với hàng xóm. Trả mảng mới, hoặc null khi không đổi được: đã ở rìa, không có trong danh sách, hay hàng
 * xóm khác nhóm (`sameGroup`). Món ghim của gian hàng luôn nằm trên món thường nên chỉ đổi chỗ trong cùng nhóm mới thấy tác dụng.
 */
export function moveInList<T extends { id: string }>(
  list: readonly T[],
  id: string,
  dir: MoveDirection,
  sameGroup: (a: T, b: T) => boolean = () => true,
): T[] | null {
  const from = list.findIndex((r) => r.id === id);
  const to = dir === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= list.length) return null;
  if (!sameGroup(list[from]!, list[to]!)) return null;
  const next = [...list];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** Thứ tự id đầy đủ sau khi đổi chỗ, đúng dạng `orderedIds` mà API sắp xếp nhận; null khi không đổi được. */
export function orderedIdsAfterMove<T extends { id: string }>(
  list: readonly T[],
  id: string,
  dir: MoveDirection,
  sameGroup?: (a: T, b: T) => boolean,
): string[] | null {
  return moveInList(list, id, dir, sameGroup)?.map((r) => r.id) ?? null;
}

/** Sắp `list` theo `orderedIds` như API: id có trong danh sách đi trước theo thứ tự đã gửi, phần thiếu nối cuối theo thứ tự cũ, id lạ bị bỏ. */
function sortByIds<T extends { id: string }>(list: readonly T[], orderedIds: readonly string[]): T[] {
  const byId = new Map(list.map((r) => [r.id, r]));
  const first = orderedIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const seen = new Set(first.map((r) => r.id));
  return [...first, ...list.filter((r) => !seen.has(r.id))];
}

/** Bản gian hàng với các bộ sưu tập đã sắp lại: để màn hiện thứ tự mới ngay, trước khi máy chủ trả lời. */
export function withReorderedCollections<S extends { collections: readonly { id: string }[] }>(sf: S, orderedIds: readonly string[]): S {
  return { ...sf, collections: sortByIds(sf.collections, orderedIds) };
}

/** Bản gian hàng với các món của một bộ sưu tập đã sắp lại. */
export function withReorderedItems<S extends { collections: readonly { id: string; items: readonly { id: string }[] }[] }>(
  sf: S,
  collectionId: string,
  orderedIds: readonly string[],
): S {
  return { ...sf, collections: sf.collections.map((c) => (c.id === collectionId ? { ...c, items: sortByIds(c.items, orderedIds) } : c)) };
}

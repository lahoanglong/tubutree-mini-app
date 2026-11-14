import type { WpImageList, WpImageRow, WpRowState } from '@/lib/wp-image-candidates';
import { includesFolded } from '@/lib/vn-fold';

export type TriageFilter = 'all' | 'pending' | 'exact' | 'applied' | 'skipped' | 'noImage' | 'suggested' | 'noSuggestion';

/** Thứ tự và chữ của các nhóm lọc ở đầu trang. */
export const TRIAGE_FILTERS: ReadonlyArray<{ key: TriageFilter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending', label: 'Chờ duyệt' },
  { key: 'exact', label: 'Khớp chính xác' },
  { key: 'applied', label: 'Đã duyệt' },
  { key: 'skipped', label: 'Đã bỏ qua' },
  { key: 'noImage', label: 'Chưa có ảnh' },
  { key: 'suggested', label: 'Có ảnh gợi ý' },
  { key: 'noSuggestion', label: 'Chưa có gợi ý' },
];

/** "Chưa có ảnh" = sản phẩm vẫn đang rỗng ảnh (chờ duyệt hoặc đã bỏ qua); đã nạp ảnh hay vốn có ảnh thì không tính. */
export const stillWithoutImage = (row: WpImageRow): boolean => row.state === 'PENDING' || row.state === 'SKIPPED';

/**
 * Dòng có ảnh WordPress để chọn (bảng làm tay hoặc gợi ý theo tên). Dòng NONE không có gì để duyệt: hoặc cần ảnh mới ("Chưa có gợi ý"),
 * hoặc chưa hỏi được WordPress (`suggestUnavailable`, không tính vào "Chưa có gợi ý" vì chưa biết).
 */
export const hasSuggestion = (row: WpImageRow): boolean => row.tier !== 'NONE';

export function matchesFilter(row: WpImageRow, filter: TriageFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'pending':
      return row.state === 'PENDING' && hasSuggestion(row);
    case 'exact':
      return row.tier === 'EXACT';
    case 'applied':
      return row.state === 'APPLIED';
    case 'skipped':
      return row.state === 'SKIPPED';
    case 'noImage':
      return stillWithoutImage(row);
    case 'suggested':
      return stillWithoutImage(row) && hasSuggestion(row);
    case 'noSuggestion':
      return stillWithoutImage(row) && !hasSuggestion(row) && !row.suggestUnavailable;
  }
}

/** Ô tìm: mọi từ gõ vào phải có trong tên hoặc mã sản phẩm, không phân biệt dấu và hoa thường ("ca phe" ra "Cà phê", "9fbabb" ra đúng mã). Ô trống thì giữ hết. */
export function matchesQuery(row: WpImageRow, query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${row.name} ${row.productSlug}`;
  return words.every((w) => includesFolded(haystack, w));
}

export function filterCounts(items: readonly WpImageRow[]): Record<TriageFilter, number> {
  const counts = Object.fromEntries(TRIAGE_FILTERS.map((f) => [f.key, 0])) as Record<TriageFilter, number>;
  for (const row of items) for (const f of TRIAGE_FILTERS) if (matchesFilter(row, f.key)) counts[f.key] += 1;
  return counts;
}

export type TriageAction = { kind: 'approve'; productId: string; imageCount: number } | { kind: 'skip'; productId: string } | { kind: 'restore'; productId: string };

const NEXT_STATE: Record<TriageAction['kind'], WpRowState> = { approve: 'APPLIED', skip: 'SKIPPED', restore: 'PENDING' };

/**
 * Bản cập nhật lạc quan: thẻ đổi trạng thái ngay khi bấm, máy chủ trả lỗi thì phía gọi trả về bản cũ rồi nạp lại.
 * Máy chủ vẫn là nguồn đúng: sau mỗi lượt danh sách được nạp lại.
 */
export function applyOptimistic(list: WpImageList, action: TriageAction): WpImageList {
  const next = NEXT_STATE[action.kind];
  const items = list.items.map((row) =>
    row.productId !== action.productId
      ? row
      : {
          ...row,
          state: next,
          appliedCount: action.kind === 'approve' ? action.imageCount : null,
          // Duyệt xong không còn ảnh ứng viên để chọn; bỏ qua/khôi phục giữ nguyên ảnh đã hỏi để thẻ không trống.
          ...(action.kind === 'approve' ? { wp: null, defaultImageUrls: null } : {}),
        },
  );
  const counts: Record<WpRowState, number> = { PENDING: 0, SKIPPED: 0, APPLIED: 0, HAS_IMAGES: 0 };
  for (const row of items) counts[row.state] += 1;
  return { items, counts };
}

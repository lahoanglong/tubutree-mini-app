import type { WpImageList, WpImageRow, WpRowState } from '@/lib/wp-image-candidates';

export type TriageFilter = 'all' | 'pending' | 'exact' | 'applied' | 'skipped' | 'noImage';

/** Thứ tự và chữ của các nhóm lọc ở đầu trang. */
export const TRIAGE_FILTERS: ReadonlyArray<{ key: TriageFilter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending', label: 'Chờ duyệt' },
  { key: 'exact', label: 'Khớp chính xác' },
  { key: 'applied', label: 'Đã duyệt' },
  { key: 'skipped', label: 'Đã bỏ qua' },
  { key: 'noImage', label: 'Chưa có ảnh' },
];

/** "Chưa có ảnh" = sản phẩm vẫn đang rỗng ảnh (chờ duyệt hoặc đã bỏ qua); đã nạp ảnh hay vốn có ảnh thì không tính. */
export const stillWithoutImage = (row: WpImageRow): boolean => row.state === 'PENDING' || row.state === 'SKIPPED';

export function matchesFilter(row: WpImageRow, filter: TriageFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'pending':
      return row.state === 'PENDING';
    case 'exact':
      return row.tier === 'EXACT';
    case 'applied':
      return row.state === 'APPLIED';
    case 'skipped':
      return row.state === 'SKIPPED';
    case 'noImage':
      return stillWithoutImage(row);
  }
}

export function filterCounts(items: readonly WpImageRow[]): Record<TriageFilter, number> {
  const counts: Record<TriageFilter, number> = { all: 0, pending: 0, exact: 0, applied: 0, skipped: 0, noImage: 0 };
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

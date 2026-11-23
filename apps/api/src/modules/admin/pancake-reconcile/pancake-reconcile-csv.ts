import { formatVnDateTime } from '../../../common/vn-time';
import { row, text } from '../admin-export';
import type { ReconcileFlag, ReconcileRow } from './pancake-reconcile';

/** Cùng chữ với chip ở `/admin/doi-soat-kho` (`FLAG_META` trong `reconcile-board.tsx`), để người đếm kho đối chiếu file với màn. */
export const RECONCILE_FLAG_LABELS: Record<ReconcileFlag, string> = {
  NEGATIVE_LOCAL: 'Tồn âm',
  ZERO_LOCAL_PANCAKE_POSITIVE: 'Hết ở cửa hàng, Pancake còn',
  DRIFT: 'Lệch tồn',
  UNLINKED: 'Chưa gắn Pancake',
  NEVER_SYNCED: 'Chưa đồng bộ lần nào',
};

/**
 * Việc cần làm theo từng cờ, ghi vào cột "Cách xử lý". Trang đối soát chỉ đọc: tồn sửa ở Pancake, cửa hàng nhận số ở lượt đồng bộ.
 * Không gợi ý "ghi đè tồn kho" (nút đó xoá phần giữ chỗ của đơn chưa đẩy) — việc đó để quản trị viên tự quyết ở Sức khoẻ hệ thống.
 */
export const RECONCILE_TRIAGE: Record<ReconcileFlag, string> = {
  NEGATIVE_LOCAL: 'Cửa hàng đã bán quá số có: đếm lại kệ, sửa tồn ở Pancake, xem đơn chưa đẩy đang giữ chỗ.',
  ZERO_LOCAL_PANCAKE_POSITIVE:
    'Khách thấy "Hết hàng" oan: đếm lại kệ; Pancake đúng thì chạy "Đồng bộ danh mục Pancake" (Sức khoẻ hệ thống), vẫn lệch thì báo quản trị viên.',
  DRIFT: 'Đếm lại kệ: Pancake sai thì sửa ở Pancake; cửa hàng sai thì chờ lượt đồng bộ kế tiếp hoặc chạy "Đồng bộ danh mục Pancake".',
  UNLINKED: 'Chưa có mã Pancake nên tồn không bao giờ tự cập nhật: tạo hoặc gắn món trên Pancake POS rồi đồng bộ danh mục; không bán nữa thì tắt biến thể.',
  NEVER_SYNCED: 'Đã gắn mà chưa nhận số tồn nào: chạy "Đồng bộ danh mục Pancake"; vẫn trống thì kiểm mã biến thể trên Pancake.',
};

export const RECONCILE_CSV_HEADERS = [
  'SKU',
  'Sản phẩm',
  'Biến thể',
  'Sản phẩm đang bán',
  'Đã gắn Pancake',
  'Tồn cửa hàng',
  'Đang giữ chỗ',
  'Tồn Pancake',
  'Tồn đúng ra',
  'Lệch',
  'Cờ',
  'Cách xử lý',
  'Đồng bộ gần nhất',
] as const;

/** Số dòng mỗi đoạn ghi xuống kết nối. */
const CHUNK_ROWS = 500;

export function reconcileCsvRow(r: ReconcileRow): string {
  return row([
    // SKU toàn số (vd "00123") giữ nguyên số 0 đầu khi mở bằng Excel.
    text(r.sku),
    r.productName,
    r.variationName && r.variationName !== r.productName ? r.variationName : '',
    r.productActive ? 'Có' : 'Đang ẩn',
    r.linked ? 'Có' : 'Chưa',
    r.stock,
    r.reservedStock,
    r.pancakeStock,
    r.expectedStock,
    // Số (không phải chuỗi "+4"): ô số không bao giờ bị Excel đọc thành công thức.
    r.drift,
    r.flags.map((f) => RECONCILE_FLAG_LABELS[f]).join(' | '),
    r.flags.map((f) => RECONCILE_TRIAGE[f]).join(' '),
    r.lastSyncedAt ? formatVnDateTime(new Date(r.lastSyncedAt)) : '',
  ]);
}

/** Mọi dòng có cờ, không cắt ở trần dòng của bảng. Ô chữ đi qua `csvCell` nên tên sản phẩm mở đầu bằng = + - @ tab bị chặn thành chữ. */
export async function* reconcileCsvChunks(rows: readonly ReconcileRow[]): AsyncGenerator<string> {
  yield row([...RECONCILE_CSV_HEADERS]);
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    yield rows
      .slice(i, i + CHUNK_ROWS)
      .map(reconcileCsvRow)
      .join('');
  }
}

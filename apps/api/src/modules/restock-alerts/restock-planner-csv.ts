import { row, text } from '../admin/admin-export';
import { RESTOCK_VELOCITY_WINDOW_DAYS, type RestockPlanRow } from './restock-planner';

/**
 * Cột file "Đơn đặt hàng nhà cung cấp": năm cột đầu là phần gửi nhà cung cấp (xoá các cột sau là gửi được), các cột sau là căn cứ
 * để người đặt hàng tự sửa số. Không có giá vốn, mã Pancake hay thông tin khách.
 */
export const RESTOCK_PO_CSV_HEADERS = [
  'Nhà cung cấp',
  'SKU',
  'Sản phẩm',
  'Phân loại',
  'Số lượng đặt',
  'Tồn bán được',
  `Bán ${RESTOCK_VELOCITY_WINDOW_DAYS} ngày`,
  'Đủ bán (ngày)',
  'Khách chờ hàng về',
  'Đại lý đặt trước chưa có hàng',
  'Ghi chú',
] as const;

/** Số dòng mỗi đoạn ghi xuống kết nối. */
const CHUNK_ROWS = 500;

/** Lý do ngắn của dòng, cùng chữ với nhãn trên màn: "Hết hàng · 3 khách chờ hàng về · Đại lý chờ 5". */
export function restockReason(r: RestockPlanRow): string {
  const parts: string[] = [];
  if (r.urgency === 'OUT') parts.push('Hết hàng');
  else if (r.urgency === 'LOW') parts.push(`Còn đủ bán ${r.coverDays} ngày`);
  if (r.waiting > 0) parts.push(`${r.waiting} khách chờ hàng về`);
  if (r.backordered > 0) parts.push(`Đại lý chờ ${r.backordered}`);
  return parts.join(' · ');
}

export function restockPoCsvRow(r: RestockPlanRow): string {
  return row([
    r.supplier,
    // SKU toàn số (vd "00123") giữ nguyên số 0 đầu khi mở bằng Excel.
    text(r.sku),
    r.productName,
    r.variationName && r.variationName !== r.productName ? r.variationName : '',
    r.suggestedQty,
    r.stock,
    r.sold,
    r.coverDays,
    r.waiting,
    r.backordered,
    restockReason(r),
  ]);
}

/** Mọi dòng cần nhập khớp bộ lọc, không cắt ở trần dòng của bảng. Ô chữ đi qua `csvCell` nên tên mở đầu bằng = + - @ tab bị chặn thành chữ. */
export async function* restockPoCsvChunks(rows: readonly RestockPlanRow[]): AsyncGenerator<string> {
  yield row([...RESTOCK_PO_CSV_HEADERS]);
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    yield rows
      .slice(i, i + CHUNK_ROWS)
      .map(restockPoCsvRow)
      .join('');
  }
}

import type { OrderStatus } from '@tubutree/shared-types';

/**
 * Việc cần làm với một trạng thái đơn Pancake:
 *  - `status`: chuyển đơn Tubu sang trạng thái này (qua OrderStatusService);
 *  - `returned`: hàng đã hoàn về kho — chưa giao thì huỷ đơn, đã giao thì trả hàng (processor quyết);
 *  - `attention`: hệ thống không tự xử lý được → đưa vào hàng đợi "Cần xử lý Pancake" cho admin;
 *  - `partialReturned`: kho đã nhận lại một phần hàng — processor xét yêu cầu trả trên Tubu (đã duyệt thì tiền đã hoàn),
 *    `reason` là lời cho trường hợp Tubu không có yêu cầu trả nào.
 */
export type PancakeStatusAction =
  | { kind: 'status'; status: OrderStatus }
  | { kind: 'returned' }
  | { kind: 'attention'; reason: string }
  | { kind: 'partialReturned'; reason: string };

const to = (status: OrderStatus): PancakeStatusAction => ({ kind: 'status', status });
const RETURNED: PancakeStatusAction = { kind: 'returned' };
/** Mở đầu lý do "ĐANG HOÀN" — gỡ khỏi hàng đợi khi Pancake báo "Đã hoàn" và đơn đã tự huỷ/trả. */
export const PANCAKE_RETURNING_PREFIX = 'Pancake báo ĐANG HOÀN';
const RETURNING: PancakeStatusAction = {
  kind: 'attention',
  reason: `${PANCAKE_RETURNING_PREFIX} (giao không thành, hàng đang quay về kho). Liên hệ khách; khi kho nhận lại hàng, Pancake báo "Đã hoàn" thì đơn tự huỷ và hoàn tiền.`,
};

/**
 * Theo enum `status` của đơn hàng trong Pancake POS Open API (api-docs.pancake.vn — schema "Đơn hàng" và
 * "Webhook đơn hàng"). Mã không có ở đây → null (giữ nguyên trạng thái).
 */
const NUMERIC: Record<string, PancakeStatusAction | null> = {
  '0': null, // Mới — đơn Tubu đã có trạng thái riêng từ lúc đặt
  '17': null, // Chờ xác nhận
  '11': null, // Chờ hàng
  '20': null, // Đã đặt hàng
  '1': to('CONFIRMED'), // Đã xác nhận
  '12': to('PACKED'), // Chờ in
  '13': to('PACKED'), // Đã in
  '8': to('PACKED'), // Đang đóng hàng
  '9': to('PACKED'), // Chờ chuyển hàng
  '2': to('SHIPPING'), // Đã gửi hàng
  '3': to('DELIVERED'), // Đã nhận
  '16': to('DELIVERED'), // Đã thu tiền
  '4': RETURNING, // Đang hoàn
  '15': {
    kind: 'partialReturned',
    reason: 'Pancake báo HOÀN MỘT PHẦN. Kiểm tra hàng nhận lại rồi hoàn tiền/điểm cho phần bị trả bằng tay.',
  }, // Hoàn một phần
  '5': RETURNED, // Đã hoàn
  '6': to('CANCELLED'), // Đã huỷ
  '7': {
    kind: 'attention',
    reason: 'Đơn bị XOÁ trên Pancake nên kho sẽ không giao. Xác nhận với kho rồi huỷ đơn (hoàn tiền, hoàn kho) nếu đúng.',
  },
};

/** Chuỗi trạng thái (cấu hình/luồng cũ gửi tên thay vì mã số). */
const NAMED: Record<string, PancakeStatusAction> = {
  confirmed: to('CONFIRMED'),
  packed: to('PACKED'),
  shipping: to('SHIPPING'),
  shipped: to('SHIPPING'),
  delivered: to('DELIVERED'),
  completed: to('DELIVERED'),
  cancelled: to('CANCELLED'),
  canceled: to('CANCELLED'),
  returning: RETURNING,
  returned: RETURNED,
};

export function resolvePancakeStatus(raw: unknown): PancakeStatusAction | null {
  if (raw === null || raw === undefined) return null;
  const key = String(raw).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NUMERIC, key)) return NUMERIC[key] ?? null;
  return NAMED[key] ?? null;
}

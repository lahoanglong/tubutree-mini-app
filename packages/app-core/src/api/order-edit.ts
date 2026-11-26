import type { EditOrderDeliveryBody, OrderEditResultDTO } from '@tubutree/shared-types';
import type { HttpClient } from '../http';

// Tách khỏi `api/orders.ts`: mô-đun đó nằm trong chunk dùng chung mà mọi route web tải lần đầu, còn lời gọi sửa đơn chỉ chi tiết đơn cần.

/** Khách đăng nhập tự sửa địa chỉ cùng tỉnh và ghi chú của đơn chưa đóng gói. Từ chối: 409 (400 khi khác tỉnh) `ORDER_EDIT_REFUSED`, `message` là câu cho khách. */
export const editOrderDelivery = (http: HttpClient, code: string, body: EditOrderDeliveryBody) =>
  http.patch<OrderEditResultDTO>(`/orders/${code}/delivery`, body);

/** Hiện lối "Sửa" ở khối địa chỉ: chỉ khi máy chủ báo `canEdit` (API cũ không trả = ẩn). */
export const canEditOrder = (o: { canEdit?: boolean }) => o.canEdit === true;

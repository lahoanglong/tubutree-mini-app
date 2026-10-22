import { Prisma } from '@prisma/client';

/**
 * Đơn được tính là CHI TIÊU của người đứng tên đơn khi xét hạng thành viên và mốc voucher: chỉ đơn mua lẻ khách tự đặt cho
 * mình. Đơn nhập sỉ của đại lý (type DEALER) và đơn CTV lên hộ khách (placedForCustomer) không phải tiền mua lẻ của chính
 * người đó (người nhận hộ không có userId trên đơn nên cũng không được cộng). Phí giao vẫn nằm trong `total`.
 * Hai dạng dưới đây là MỘT điều kiện: Prisma cho aggregate/findMany, SQL cho truy vấn thô (bí danh bảng `o`).
 */
export const OWN_RETAIL_SPEND_WHERE = { type: 'RETAIL', placedForCustomer: false } as const satisfies Prisma.OrderWhereInput;

export const OWN_RETAIL_SPEND_SQL = Prisma.sql`o.type::text = 'RETAIL' AND o."placedForCustomer" = false`;

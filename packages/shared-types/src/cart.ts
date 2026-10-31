/** Mã lỗi ổn định: batch thêm giỏ bị từ chối vì một món (hết hàng, ngừng bán); không có món nào được ghi. API ném, FE so khớp. Vượt trần số lượng thì API trả 400 thường, không mang mã này. */
export const CART_BATCH_REJECTED = 'CART_BATCH_REJECTED';

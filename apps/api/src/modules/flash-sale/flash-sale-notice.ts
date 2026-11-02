/**
 * Câu của Giờ vàng mà khách đọc (lỗi giỏ/đặt đơn, đặt nhắc). Tách khỏi `flash-sale.service.ts` để bộ quét chữ cấm
 * (`terminology.spec.ts`, đuôi `*-notice.ts`) tự quét; chữ quản trị của đợt giảm giá ở lại service.
 */

/** Hết suất hoặc hết giờ. Client cũ so khớp đúng câu này (nhánh PRICE_CHANGED/hỏi lại giá): không đổi chữ. */
export const FLASH_SOLD_OUT_MSG = 'Hết suất ưu đãi.';
/** Câu của API cũ; client cũ vẫn khớp nó. Lỗi mới mang mã FLASH_LIMIT (xem `FlashSaleService.overLimitError`). */
export const FLASH_OVER_LIMIT_MSG = 'Vượt giới hạn mua ưu đãi.';
export const FLASH_LIMIT = 'FLASH_LIMIT';
export const flashOverLimitMessage = (n: number) => `Giá Giờ vàng chỉ áp cho ${n} sản phẩm mỗi khách. Bạn giảm số lượng rồi đặt lại nhé.`;
export const FLASH_ALREADY_STARTED_MSG = 'Ưu đãi đã bắt đầu.';
export const FLASH_SLOT_NOT_FOUND_MSG = 'Không tìm thấy khung Giờ vàng.';
export const FLASH_ITEM_NOT_FOUND_MSG = 'Không tìm thấy sản phẩm Giờ vàng.';

/**
 * Luật hiển thị tồn kho (Smart Stock) dùng chung cho API và hai app, một nơi định nghĩa.
 *
 * Tồn 1..LOW_STOCK_NOTICE ghi đúng số ("Chỉ còn n sản phẩm"); tồn cao hơn không bao giờ ghi số, chỉ ghi còn hàng.
 */

/** Còn từng này trở xuống là tồn thấp: được ghi đúng số và hiện màu cảnh báo. */
export const LOW_STOCK_NOTICE = 20;

/** Từ mức này trở lên là tồn ảo (Pancake báo 99.999.988 cho hàng không quản kho): không bao giờ gửi con số thật ra ngoài. */
export const PLENTY_STOCK = 100_000;

/**
 * Tồn gửi cho client: tồn ảo bị kẹp ở PLENTY_STOCK để con số Pancake không ra khỏi API. Dưới ngưỡng giữ nguyên (bảng chọn cần để ghi "Chỉ còn n").
 * Đã áp ở trang chi tiết sản phẩm (`GET /products/:slug`), ảnh bìa dòng đơn hàng và danh sách mua lại. Thẻ danh sách sản phẩm không mang số tồn (chỉ có cờ `inStock`, xem `cardInStock` ở API);
 * giỏ hàng kẹp thấp hơn nữa bằng trần riêng của nó (MAX_ITEM_QUANTITY + 1).
 */
export function exposedStock(stock: number): number {
  return Math.min(stock, PLENTY_STOCK);
}

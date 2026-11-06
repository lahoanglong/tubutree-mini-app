/**
 * Luật hiển thị tồn kho (Smart Stock) dùng chung cho API và hai app, một nơi định nghĩa.
 *
 * Tồn 1..LOW_STOCK_NOTICE ghi đúng số ("Chỉ còn n sản phẩm"); tồn cao hơn không bao giờ ghi số, chỉ ghi còn hàng.
 */

/** Còn từng này trở xuống là tồn thấp: được ghi đúng số và hiện màu cảnh báo. */
export const LOW_STOCK_NOTICE = 20;

/** Từ mức này trở lên là tồn ảo (Pancake báo 99.999.988 cho hàng không quản kho): không bao giờ gửi con số thật ra ngoài. */
export const PLENTY_STOCK = 100_000;

/** Số tồn công khai thay cho mọi tồn thật từ LOW_STOCK_NOTICE + 1 tới dưới PLENTY_STOCK: client chỉ cần biết "còn hàng, không ghi số", và bằng trần bộ chọn số lượng (QTY_PICK_CAP). */
export const PUBLIC_STOCK_IN = 99;

/**
 * Tồn gửi cho client, không bao giờ là con số thật trên LOW_STOCK_NOTICE: hết hàng 0; 1..LOW_STOCK_NOTICE đúng số (bảng chọn ghi "Chỉ còn n");
 * cao hơn thì PUBLIC_STOCK_IN; tồn ảo (từ PLENTY_STOCK) thì đúng PLENTY_STOCK, là dấu "Sẵn sàng giao ngay" chứ không phải số đếm.
 * Áp ở trang chi tiết sản phẩm (`GET /products/:slug`), dòng đơn hàng (Mua lại) và danh sách đã mua. Thẻ danh sách sản phẩm không mang số tồn
 * (chỉ có cờ `inStock`, xem `cardInStock` ở API); giỏ hàng dùng `cartLineStock`. Kiểm kho trên máy chủ luôn đọc số thật trong DB, không đọc số này.
 */
export function exposedStock(stock: number): number {
  if (!(stock > 0)) return 0;
  if (stock <= LOW_STOCK_NOTICE) return stock;
  return stock >= PLENTY_STOCK ? PLENTY_STOCK : PUBLIC_STOCK_IN;
}

/**
 * Tồn gửi cho một dòng giỏ. Client nhận ra dòng vượt tồn bằng `quantity > stock` (cảnh báo ở giỏ, chặn và nút sửa ở thanh toán), nên:
 * tồn 0..LOW_STOCK_NOTICE gửi đúng số (đã được in ra); tồn cao hơn mà dòng đang vượt thì gửi `quantity - 1` (vẫn trên LOW_STOCK_NOTICE vì
 * quantity > stock > LOW_STOCK_NOTICE, nên client kéo về LOW_STOCK_NOTICE như `overStockTarget`); còn lại gửi `max(PUBLIC_STOCK_IN, quantity)`:
 * không nhỏ hơn số đang có trong giỏ để dòng hợp lệ không bị coi là vượt. Trên LOW_STOCK_NOTICE, số gửi đi chỉ phụ thuộc số lượng và việc dòng có vượt
 * tồn hay không, không phụ thuộc tồn thật. Dòng vượt đúng một đơn vị thì quantity − 1 trùng tồn: khách tự biết điều đó, như khi máy chủ từ chối ở tồn + 1.
 */
export function cartLineStock(stock: number, quantity: number): number {
  if (stock <= LOW_STOCK_NOTICE) return Math.max(stock, 0);
  if (quantity > stock) return quantity - 1;
  return Math.max(PUBLIC_STOCK_IN, quantity);
}

/**
 * Số lượng mà một dòng đang đòi quá tồn được kéo về: giỏ bấm −, nút sửa ở màn thanh toán, máy chủ kẹp khi mua lại. Tồn 1..LOW_STOCK_NOTICE
 * đã được in ra nên về đúng tồn; tồn cao hơn về LOW_STOCK_NOTICE, vì kéo về sát tồn là đặt con số tồn thật lên bộ chọn. Hết hàng trả 1.
 */
export function overStockTarget(stock: number): number {
  return Math.max(1, Math.min(stock, LOW_STOCK_NOTICE));
}

import { LOW_STOCK_NOTICE } from '@tubutree/shared-types';

/**
 * Câu lỗi khi số lượng khách chọn vượt tồn, theo luật Smart Stock: chỉ tồn 1..LOW_STOCK_NOTICE được ghi đúng số.
 * Tồn cao hơn (kể cả tồn ảo 99.999.988 của hàng không quản kho) không bao giờ vào câu lỗi: con số thật là thông tin kinh doanh.
 * `productName` có thì câu mở đầu bằng tên món (dùng cho lỗi cả lô, nơi khách cần biết món nào bị chặn).
 * Câu tồn thấp viết dạng "chỉ còn {n} sản phẩm" rồi thay `{n}`: đúng mẫu `terminology.spec` cho phép riêng cho tồn 1–20 (file này nằm trong `API_COPY_EXTRA` của spec đó).
 */
export function overStockText(stock: number, productName?: string): string {
  if (!(stock > 0)) return productName ? `${productName} đã hết hàng.` : 'Sản phẩm đã hết hàng.';
  if (stock <= LOW_STOCK_NOTICE) {
    const few = 'chỉ còn {n} sản phẩm.'.replace('{n}', String(stock));
    return productName ? `${productName} ${few}` : `C${few.slice(1)}`;
  }
  return productName ? `${productName}: số lượng này vượt số hàng đang có.` : 'Số lượng này vượt số hàng đang có.';
}

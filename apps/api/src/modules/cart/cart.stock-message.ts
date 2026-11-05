import { LOW_STOCK_NOTICE } from '@tubutree/shared-types';

/**
 * Câu lỗi khi số lượng khách chọn vượt tồn, theo luật Smart Stock: chỉ tồn 1..LOW_STOCK_NOTICE được ghi đúng số.
 * Tồn cao hơn (kể cả tồn ảo 99.999.988 của hàng không quản kho) không bao giờ vào câu lỗi: con số thật là thông tin kinh doanh.
 * `productName` có thì câu mở đầu bằng tên món (dùng cho lỗi cả lô, nơi khách cần biết món nào bị chặn).
 */
export function overStockText(stock: number, productName?: string): string {
  if (!(stock > 0)) return productName ? `${productName} đã hết hàng.` : 'Sản phẩm đã hết hàng.';
  if (stock <= LOW_STOCK_NOTICE) return productName ? `${productName} chỉ còn ${stock} sản phẩm.` : `Chỉ còn ${stock} sản phẩm.`;
  return productName ? `${productName}: số lượng này vượt số hàng đang có.` : 'Số lượng này vượt số hàng đang có.';
}

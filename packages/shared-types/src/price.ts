/**
 * Giá gạch (giá "gốc" khách thấy bị gạch) của một phân loại: MỘT luật cho thẻ, trang Giờ vàng, trang chi tiết và dòng giỏ.
 * Giờ vàng thắng (rẻ hơn giá đang bán) thì gạch giá đang bán trước Giờ vàng (`salePrice ?? retailPrice`), để mọi chỗ cùng một sản phẩm
 * không hiện hai "giá gốc" khác nhau; còn lại gạch giá niêm yết. Màn vẽ gạch khi giá này cao hơn giá khách trả (`discountView`).
 * Ba nơi gọi hàm này: API giỏ (`CartLine.listUnitPrice`), `variationPricing` và `cardPricing` của app-core. `flashDisplay.was` (dải Giờ vàng)
 * không gọi hàm nhưng luôn bằng nó khi Giờ vàng thắng: `strike-price.spec.ts` ghim cả bốn nơi vào cùng một số. Chỉ là số hiển thị, không vào tiền.
 */
export function strikePrice(i: { retailPrice: number; salePrice?: number | null; flashPrice?: number | null }): number {
  const standing = i.salePrice ?? i.retailPrice;
  return i.flashPrice != null && i.flashPrice < standing ? standing : i.retailPrice;
}

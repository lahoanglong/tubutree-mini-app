/**
 * Mốc "giá trên thẻ có thể vừa đổi", dùng chung trong tiến trình API. Nơi ghi Giờ vàng (FlashSaleService) và giá (đồng bộ Pancake) gọi
 * `markCardPricesChanged` SAU khi ghi xong; CatalogService bỏ danh sách "Đang ưu đãi" đã nhớ khi mốc khác mốc lúc nạp. Không đi qua DI vì
 * CatalogModule đã nhập FlashSaleModule, tiêm CatalogService ngược vào FlashSaleService tạo vòng. Tệp không import gì để không kéo theo vòng
 * import nào (xem common/di-paramtypes.spec.ts). Cùng hạn chế với các cache RAM khác của API: chạy từ 2 replica trở lên thì chuyển sang Redis.
 */
let epoch = 0;

export function markCardPricesChanged(): void {
  epoch += 1;
}

export function cardPriceEpoch(): number {
  return epoch;
}

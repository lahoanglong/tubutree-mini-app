/** Số dòng mỗi lần tải ở lịch sử hoa hồng và lịch sử chuyển vào Ví (nút "Tải thêm"). */
export const AFFILIATE_PAGE_SIZE = 50;

/** Trang đầy thì còn có thể còn nữa: con trỏ là id dòng cuối. Trang chưa đầy là hết (trang rỗng sau trang đầy đúng cỡ chỉ ẩn nút). */
export function affiliateNextCursor(last: readonly { id: string }[]): string | undefined {
  return last.length >= AFFILIATE_PAGE_SIZE ? last[last.length - 1]!.id : undefined;
}

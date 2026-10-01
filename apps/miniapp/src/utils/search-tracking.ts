/**
 * Quy tắc bắn `search_performed` (một quy tắc duy nhất): mỗi KHOÁ tìm kiếm (q + sắp xếp + bộ lọc, tức
 * `urlKey`) được ghi đúng một lần cho tới khi khoá khác được ghi. Nhờ vậy các lần Browse mount lại với
 * dữ liệu đã có trong cache — Back từ trang sản phẩm, làm mới nền — không bị tính là lượt tìm mới;
 * ngược lại đổi sắp xếp/bộ lọc (khoá đổi) hay gõ từ khoá mới vẫn được ghi.
 *
 * Trạng thái ở cấp module (không phải sessionStorage): tải lại trang/mở link mới là một phiên mới nên
 * ghi một lần; còn trong cùng phiên thì sống sót qua việc Browse unmount/mount. Browse gọi
 * `forgetTrackedSearch()` khi mở mới bằng PUSH (khách chủ động mở lại cùng từ khoá) và khi không còn `q`.
 */
let lastTrackedKey: string | null = null;

/** true nếu `urlKey` chưa phải khoá vừa ghi → ghi nhận nó là khoá vừa ghi. */
export function shouldTrackSearch(urlKey: string): boolean {
  if (lastTrackedKey === urlKey) return false;
  lastTrackedKey = urlKey;
  return true;
}

export function forgetTrackedSearch(): void {
  lastTrackedKey = null;
}

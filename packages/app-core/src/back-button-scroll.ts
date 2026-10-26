/** Cuộn xuống quá mức này (px) thì nút Quay lại nổi mới được phép ẩn: ở đầu trang nút nằm trong dải tiêu đề, không đè gì. */
export const BACK_HIDE_AFTER = 80;
/** Cuộn ngược lên tối thiểu bấy nhiêu px mới hiện lại, để rung nhẹ của ngón tay không làm nút nhấp nháy. */
export const BACK_SHOW_DELTA = 6;

/**
 * Nút Quay lại là vòng tròn nổi (position: fixed) ở góc trái: khi trang cuộn xuống nó đè lên số dư, giá, thẻ.
 * Cuộn xuống thì ẩn, cuộn lên hoặc về đầu trang thì hiện. `delta` là scrollTop mới trừ scrollTop trước (dương = xuống).
 */
export function nextBackHidden(hidden: boolean, scrollTop: number, delta: number): boolean {
  if (scrollTop <= BACK_HIDE_AFTER) return false;
  if (delta > 0) return true;
  if (delta <= -BACK_SHOW_DELTA) return false;
  return hidden;
}

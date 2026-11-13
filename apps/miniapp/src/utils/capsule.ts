/**
 * Bề rộng vùng phải mà viên thuốc (nút ⋯ ✕) của Zalo chiếm ở đầu trang, tính từ mép màn hình. `actionBarHidden: true` nên nội dung tràn lên dưới nó,
 * và SDK không cho đo; số này là quy ước đã dùng ở `ShopTopBar` (`padding: 0 96px 0 64px`). Hàng đầu trang có nút bên phải phải chừa đúng bề rộng này.
 */
export const CAPSULE_INSET_END = 96;

/**
 * Phần phải bù thêm cho một hàng đã có sẵn lề phải `gutter` (vd `PageHeader` có đệm 16): lề + phần bù = `CAPSULE_INSET_END`.
 * Không âm: hàng đã có lề phải lớn hơn vùng viên thuốc thì không cần bù.
 */
export const capsuleExtra = (gutter: number): number => Math.max(0, CAPSULE_INSET_END - gutter);

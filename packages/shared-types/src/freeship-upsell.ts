import { PRODUCT_SLUGS_LIST_MAX } from './campaign';

/**
 * Dải "Thêm 1 món nhỏ để đủ Miễn phí giao hàng" ở đầu Giỏ (cờ `commerce.freeship_booster_enabled`). API (`GET /upsell/freeship`) và app-core
 * (`pickFreeshipAddons`) cùng đọc các số này để máy chủ không trả món mà hai app sẽ bỏ, và ngược lại.
 */

/** Món đóng được khoảng thiếu một mình được đắt hơn số còn thiếu tối đa chừng này (đồng). */
export const FREESHIP_UPSELL_WINDOW = 45_000;

/**
 * Trần giá một món gợi ý mua thêm (đồng, tubu-w7-02): dải chỉ đưa "món nhỏ", kể cả khi khoảng thiếu lớn (giỏ còn xa mốc) hay đang nhắm mốc quà dùng thử 0đ.
 * Máy chủ cắt ở đây để tám thẻ trả về không phí chỗ cho món mà app sẽ bỏ.
 */
export const FREESHIP_UPSELL_MAX_PRICE = 120_000;

/** Số thẻ tối đa máy chủ trả; app còn lọc lại theo giá Giờ vàng và giỏ mới nhất rồi hiện tối đa 4. */
export const FREESHIP_UPSELL_LIMIT = 8;

/** Số slug đã có trong giỏ gửi kèm để máy chủ bỏ qua; giỏ đông hơn thì app tự lọc phần còn lại. Cùng trần với `?slugs=` của `/products`. */
export const FREESHIP_UPSELL_EXCLUDE_MAX = PRODUCT_SLUGS_LIST_MAX;

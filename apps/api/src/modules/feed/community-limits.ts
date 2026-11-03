/** Khoảng Điểm Xanh thưởng người thắng một sự kiện cộng đồng (quyết định C, 1 điểm = 1đ theo loyalty.vnd_per_point_redeem); 0 = sự kiện không quà. Là giới hạn của API chứ không phải SystemConfig; service và config công khai dùng chung một số. */
export const EVENT_REWARD_MIN_POINTS = 20_000;
export const EVENT_REWARD_MAX_POINTS = 50_000;

/**
 * Khách vãng lai (zaloId `guest_...`, chưa có SĐT) tạo được vô hạn tài khoản chỉ bằng deviceId mới, nên trần 5 bài/phút theo
 * tài khoản không giữ được đĩa: mỗi bài tới 6 ảnh × 700 nghìn ký tự nằm thẳng trong Postgres. Hai trần cho bài PENDING kèm ảnh base64
 * của khách vãng lai; bài chữ và ảnh Cloudinary không tính. Luật ai được đăng không đổi.
 * - 2 bài mỗi khách: đủ cho người thật vừa gửi bài vừa sửa/gửi lại, đủ chặn một tài khoản ghi ~8 MB.
 * - 100 MB tổng (~1% đĩa 12G của Vietnix): bài kèm 3 ảnh thật cỡ 300 KB là ~1,2 MB nên chứa chừng 80 bài chờ duyệt cùng lúc.
 */
export const GUEST_PENDING_IMAGE_POSTS_MAX = 2;
export const GUEST_PENDING_IMAGE_BYTES_MAX = 100 * 1024 * 1024;
export const GUEST_IMAGE_OWN_LIMIT_MESSAGE =
  'Bạn đang có bài kèm ảnh chờ Tubu duyệt. Đợi duyệt xong rồi đăng tiếp nhé, hoặc đăng bài chỉ có chữ.';
export const GUEST_IMAGE_TOTAL_LIMIT_MESSAGE =
  'Hiện Tubu chưa nhận thêm bài kèm ảnh từ khách chưa đăng nhập. Bạn đăng nhập Zalo hoặc đăng bài chỉ có chữ nhé.';

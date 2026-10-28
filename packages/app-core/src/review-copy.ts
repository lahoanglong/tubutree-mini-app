// Biểu mẫu không biết khách đã nhận thưởng sản phẩm này trước đó hay chưa (xoá đánh giá rồi viết lại thì BE cho
// pointsEarned = 0), nên mọi câu nhắc điểm phải nêu điều kiện này thay vì hứa vô điều kiện.
export const FIRST_REVIEW_ONLY = 'Lần đầu đánh giá sản phẩm này';
// Cờ hết thưởng không hứa điểm nữa nhưng cũng không được im lặng: khách gửi xong chỉ thấy thông báo không kèm điểm.
export const REWARD_ALREADY_GIVEN =
  'Bạn đã nhận Điểm Xanh cho đánh giá đầu tiên của sản phẩm này, đánh giá lần mua này không cộng thêm điểm.';
export const EDIT_HINT = 'Chỉ lần đánh giá đầu tiên của mỗi sản phẩm được cộng Điểm Xanh, sửa đánh giá không cộng thêm.';

/** Câu về Điểm Xanh dưới form đánh giá. Số điểm chỉ để báo trước; máy chủ vẫn quyết định thưởng lúc tạo. */
export function rewardHint(o: { isEdit: boolean; rewardAvailable: boolean; hasImages: boolean; hasVideo: boolean }): string {
  if (o.isEdit) return EDIT_HINT;
  if (!o.rewardAvailable) return REWARD_ALREADY_GIVEN;
  if (o.hasVideo) return `Tuyệt! ${FIRST_REVIEW_ONLY}, đánh giá có video nhận +15.000 Điểm Xanh!`;
  if (o.hasImages) return `${FIRST_REVIEW_ONLY}, bạn nhận +10.000 Điểm Xanh cho đánh giá có ảnh! Thêm video để được +15.000.`;
  return `${FIRST_REVIEW_ONLY}: thêm video +15.000 / ảnh +10.000 Điểm Xanh (chỉ chữ +5.000). Chỉ đánh giá được khi đã mua và nhận hàng.`;
}

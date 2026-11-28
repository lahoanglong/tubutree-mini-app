import { formatVnNumber } from './number-format';

// Biểu mẫu không biết khách đã nhận thưởng sản phẩm này trước đó hay chưa (xoá đánh giá rồi viết lại thì BE cho
// pointsEarned = 0), nên mọi câu nhắc điểm phải nêu điều kiện này thay vì hứa vô điều kiện.
export const FIRST_REVIEW_ONLY = 'Lần đầu đánh giá sản phẩm này';
// Cờ hết thưởng không hứa điểm nữa nhưng cũng không được im lặng: khách gửi xong chỉ thấy thông báo không kèm điểm.
export const REWARD_ALREADY_GIVEN =
  'Bạn đã nhận Điểm Xanh cho đánh giá đầu tiên của sản phẩm này, lần này không cộng thêm.';
// Đơn có một biến thể đã trả mà biến thể kia vẫn mời viết (PO A2.1): máy chủ không thưởng đánh giá cho sản phẩm đã trả ở đơn đó.
export const REWARD_RETURNED = 'Sản phẩm này đã có phần được trả ở đơn này nên đánh giá không cộng Điểm Xanh.';
export const REVIEW_NEEDS_PURCHASE = 'Mua và nhận hàng để đánh giá';
export const EDIT_HINT = 'Chỉ đánh giá đầu tiên của mỗi sản phẩm được cộng Điểm Xanh.';

/** Chữ trên ô chọn video và nút gửi khi video đang tải lên; ở đây để form nạp được mà không kéo theo mã tải video. */
export const VIDEO_UPLOADING = 'Đang tải video…';

/**
 * Câu về Điểm Xanh dưới form đánh giá. Số điểm chỉ để báo trước; máy chủ vẫn quyết định thưởng lúc tạo.
 * `canUploadVideo` false (bản build chưa cấu hình Cloudinary, ô chọn video bị ẩn) thì không mời video: câu hứa phải làm được.
 */
export function rewardHint(o: {
  isEdit: boolean;
  rewardAvailable: boolean;
  hasImages: boolean;
  hasVideo: boolean;
  canUploadVideo?: boolean;
  /** Sản phẩm đã có phần được trả ở đúng đơn đang viết (`reviewOrderReturned`). */
  returned?: boolean;
}): string {
  if (o.isEdit) return EDIT_HINT;
  if (o.returned) return REWARD_RETURNED;
  if (!o.rewardAvailable) return REWARD_ALREADY_GIVEN;
  if (o.hasVideo) return `Tuyệt! ${FIRST_REVIEW_ONLY}, đánh giá có video nhận +15.000 Điểm Xanh!`;
  const videoOffer = o.canUploadVideo !== false;
  if (o.hasImages) {
    return `${FIRST_REVIEW_ONLY}, bạn nhận +10.000 Điểm Xanh cho đánh giá có ảnh!${videoOffer ? ' Thêm video để được +15.000.' : ''}`;
  }
  return `${FIRST_REVIEW_ONLY}: thêm ${videoOffer ? 'video +15.000 / ' : ''}ảnh +10.000 Điểm Xanh (chỉ chữ +5.000). Chỉ đánh giá được khi đã mua và nhận hàng.`;
}

/**
 * Đánh giá MỚI cho đúng đơn `orderId` (mở từ chi tiết đơn) mà sản phẩm đã có phần được trả ở đơn đó (can-review `returned`): máy chủ thưởng 0 dù
 * `rewardAvailable` là true nhờ một đơn khác, nên ô soạn không được hứa điểm. API cũ không trả cờ thì false.
 */
export function reviewOrderReturned(
  elig: { reviewableOrders?: readonly { orderId: string; returned?: boolean }[] } | null | undefined,
  orderId: string | null | undefined,
): boolean {
  return !!orderId && (elig?.reviewableOrders ?? []).some((o) => o.orderId === orderId && o.returned === true);
}

/** Luật Góc Sống Xanh đọc từ cấu hình công khai (`reviewGreenCorner`); null khi tắt hoặc API cũ: form và lời báo như cũ. */
export interface GreenCornerRules {
  rewardPoints: number;
  dailyCap: number;
  maxPhotos: number;
}

export function greenCornerRules(cfg: (GreenCornerRules & { enabled: boolean }) | null | undefined): GreenCornerRules | null {
  if (cfg?.enabled !== true) return null;
  return { rewardPoints: cfg.rewardPoints, dailyCap: cfg.dailyCap, maxPhotos: cfg.maxPhotos };
}

/**
 * Câu về Điểm Xanh dưới form khi Góc Sống Xanh bật: đánh giá có ảnh chờ Tubu duyệt rồi mới hiện và mới cộng điểm. Nêu trần theo ngày vì đó là điều
 * kiện thật của phần thưởng; không hứa điểm khi lần mua này không còn được thưởng hoặc cấu hình thưởng 0.
 */
export function greenCornerHint(o: { isEdit: boolean; rewardAvailable: boolean; hasMedia: boolean; rules: GreenCornerRules }): string {
  const { rewardPoints, dailyCap, maxPhotos } = o.rules;
  if (o.isEdit) return 'Đổi ảnh thì Tubu duyệt lại. Sửa đánh giá không cộng thêm Điểm Xanh.';
  const reviewed = `Đánh giá có ảnh (tối đa ${maxPhotos}) được Tubu duyệt trước khi hiện công khai.`;
  if (!o.rewardAvailable) return `${reviewed} Lần mua này không cộng thêm Điểm Xanh.`;
  if (rewardPoints <= 0 || dailyCap <= 0) return reviewed;
  const cap = `Mỗi ngày tối đa ${dailyCap} đánh giá được cộng.`;
  if (o.hasMedia) return `Tubu duyệt ảnh xong sẽ cộng +${formatVnNumber(rewardPoints)} Điểm Xanh. ${cap}`;
  return `Thêm ảnh thật (tối đa ${maxPhotos}) để nhận +${formatVnNumber(rewardPoints)} Điểm Xanh sau khi Tubu duyệt. ${cap}`;
}

/** Lời báo sau khi gửi đánh giá có ảnh đang chờ duyệt (máy chủ trả `awaitingApproval: true`). */
export const REVIEW_PENDING_SAVED = 'Đã gửi. Ảnh đang chờ Tubu duyệt, duyệt xong đánh giá sẽ hiện.';

/** Đánh giá của chính khách đang chờ duyệt không có trong danh sách công khai: khách chỉ biết qua câu này. Bỏ hết ảnh thì đánh giá hiện ngay. */
export function pendingNotice(orderCode: string | null): string {
  return `Đánh giá${orderCode ? ` cho đơn ${orderCode}` : ''} của bạn đang chờ Tubu duyệt ảnh nên chưa hiện công khai.`;
}

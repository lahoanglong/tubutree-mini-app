import type { MiniSortBin } from '@tubutree/shared-types';

/**
 * Chữ khách đọc do API Sổ tay Xanh trả (câu hỏi của ván "Ôn 5 thẻ", lỗi). Tên tệp `-notice.ts` để `terminology.spec` quét thuật ngữ cấm.
 * Tên thùng phải trùng `sort.bin.*` của bảng chữ game mini (app-core): album-cards.spec so hai bảng.
 */
export const ALBUM_BIN_LABEL: Record<MiniSortBin, string> = {
  recycle: 'Tái chế',
  food: 'Thực phẩm',
  other: 'Còn lại',
  hazardous: 'Nguy hại',
};

export const albumQuestion = {
  sort: (label: string) => `${label}: bỏ vào thùng nào?`,
  match: (ingredient: string) => `${ingredient} dùng để làm gì?`,
  kitchen: (item: string) => `${item}: đổi sang sản phẩm nào?`,
};

export const ALBUM_MESSAGES = {
  disabled: 'Sổ tay Xanh đang tạm nghỉ. Bạn quay lại sau nhé.',
  login: 'Bạn đăng nhập để mở Sổ tay Xanh nhé.',
  nothingDue: 'Chưa có thẻ nào cần ôn lúc này. Bạn chơi thêm một ván để mở thẻ mới nhé.',
  limit: 'Hôm nay bạn đã ôn rất nhiều. Mai mình ôn tiếp nhé.',
  notFound: 'Không tìm thấy ván ôn này. Bạn bấm Ôn 5 thẻ để bắt đầu ván mới nhé.',
  submitted: 'Ván ôn này đã nộp rồi. Bạn bấm Ôn 5 thẻ để ôn tiếp nhé.',
  expired: 'Ván ôn này đã quá 10 phút nên không chấm được. Bạn bắt đầu ván mới nhé.',
  tooFast: 'Ván ôn này nộp nhanh quá. Bạn đọc kỹ rồi nộp lại nhé.',
  invalid: 'Bài nộp chưa đúng dạng. Bạn tải lại Sổ tay Xanh rồi thử lại nhé.',
} as const;

/** Chữ của khối đánh giá, kệ gợi ý và bộ nội dung bán hàng ở trang sản phẩm. Tách khỏi `vi.ts` vì chỉ màn tải lười dùng: `vi.ts` nằm trong gói đầu của Mini App. Quy tắc chữ như `vi.ts`. */

export const viSuggested = {
  title: 'Có thể bạn thích',
} as const;

export const viReviews = {
  eligibilityFailed: 'Chưa kiểm tra được quyền đánh giá.',
  hiddenNotice: (orderCode: string | null) =>
    `Đánh giá${orderCode ? ` cho đơn ${orderCode}` : ''} của bạn đang được Tubu xem xét nên chưa hiện công khai. Sửa nội dung không làm nó hiện lại.`,
  editHiddenNote: 'Đánh giá đang chờ Tubu xem xét nên chưa hiện công khai.',
  savedHidden: 'Đã lưu. Đánh giá đang được Tubu xem xét nên chưa hiện công khai.',
} as const;

export const viContentKit = {
  sheetTitle: 'Nội dung bán hàng',
  captionsHeading: 'Bài mẫu (chạm để sao chép)',
  uspsHeading: 'Điểm bán hàng',
  faqHeading: 'Câu hỏi thường gặp',
  videosHeading: 'Video tham khảo',
  shareZalo: 'Chia sẻ Zalo',
  copyLink: 'Sao chép link',
  copied: 'Đã sao chép',
  empty: 'Sản phẩm này chưa có nội dung mẫu.',
} as const;

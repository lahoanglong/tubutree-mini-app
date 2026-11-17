/**
 * Chữ của trang xem trước nội dung nháp MSS. Người đọc là người soạn nội dung ở MSS (nhúng iframe), không phải khách mua, nên chữ không vào
 * `shop-copy.ts` của gian hàng (bảng đó vào cả gói Mini App). Thông báo lỗi khớp đúng câu API trả (mss-preview.ts) để hai bên nói cùng một câu.
 */
export const PREVIEW_COPY = {
  pageTitle: 'Bản xem trước',
  banner: 'BẢN XEM TRƯỚC',
  bannerNote: 'Nội dung nháp từ MSS, khách chưa thấy.',
  bannerVersion: 'Bản {v}, hết hạn lúc {t}',
  buy: 'Mua ngay',
  buyDisabledNote: 'Bản xem trước không mua được.',
  expired: { title: 'Hết phiên xem trước', message: 'Phiên xem trước đã hết hạn, mở lại từ MSS' },
  missing: { title: 'Chưa có trên Tubu Tree', message: 'Sản phẩm này chưa có trên Tubu Tree nên chưa xem trước được. Đồng bộ xong thì mở lại từ MSS' },
  unavailable: { title: 'Chưa có bản nháp', message: 'MSS chưa trả được bản nháp, thử lại sau' },
} as const;

export type PreviewProblem = 'expired' | 'missing' | 'unavailable';

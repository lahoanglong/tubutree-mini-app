/**
 * `onError` cho `<img>` thô (ảnh cộng đồng, danh mục, thương hiệu, đánh giá...): ảnh lỗi mạng hay link chết thì trình duyệt vẽ icon ảnh gãy kèm
 * chữ alt, xấu và lệch giữa Chrome/Safari/WebView Zalo. Ẩn bằng `visibility` (không phải `display:none`) để khung giữ nguyên chỗ, trang không xê dịch.
 * Không dùng state nên không dựng lại thành phần; khung bọc đã có nền nhạt nên khách thấy một ô trống sạch thay vì icon gãy.
 *
 * Ảnh sản phẩm có đường lui riêng (`ProductImage`/`ProductThumb`: thử ảnh gốc rồi vẽ lá), đừng thay bằng hàm này.
 * Kiểu tham số viết theo hình dạng để app-core không cần thư viện DOM; `SyntheticEvent<HTMLImageElement>` của React khớp kiểu này.
 */
export interface BrokenImageEvent {
  currentTarget: { style: { visibility: string } };
}

export function hideBrokenImage(event: BrokenImageEvent): void {
  event.currentTarget.style.visibility = 'hidden';
}

// Spec miniapp giả định giờ Việt Nam (formatDateTime đọc giờ cục bộ của thiết bị). CI chạy UTC
// nên phải ghim múi giờ trước khi worker khởi tạo, nếu không mọi mốc giờ lệch 7 tiếng.
export default function setup() {
  process.env.TZ = 'Asia/Ho_Chi_Minh';
}

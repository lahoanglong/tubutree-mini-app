// Spec dựng mốc giờ bằng new Date(y, m, d, h) (giờ cục bộ) và mong ra giờ Việt Nam; CI chạy UTC nên ghim múi giờ trước khi worker khởi tạo.
// Mã chạy thật không đọc giờ máy: vn-timezone.spec.ts tự đổi TZ để chứng minh điều đó.
export default function setup() {
  process.env.TZ = 'Asia/Ho_Chi_Minh';
}

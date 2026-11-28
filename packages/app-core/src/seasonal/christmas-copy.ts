import { formatVnNumber as num } from '../number-format';

/**
 * Chữ của giao diện Noel Xanh trên Trang chủ (Mini App và web): thẻ cây thông rung quà, lịch quà 12 ngày, nút tuyết rơi.
 * Tách khỏi `shop-copy` để chunk mùa lễ không kéo cả bảng chữ gian hàng (~52 KB) về Trang chủ; trần độ dài ở seasonal.spec
 * (thẻ rộng 288px ở khổ 320px, cột chữ ~170px).
 */
export const christmasCopy = {
  /** Tên vùng của cả thẻ (aria-label của section). */
  heroLabel: 'Noel Xanh Tubu Tree',
  title: 'Noel Xanh',
  subtitle: 'Rung cây mỗi ngày, mở một hộp quà xanh',
  shake: 'Rung cây nhận quà',
  shaking: 'Cây đang rung…',
  open: 'Mở quà',
  opening: 'Đang mở quà…',
  opened: 'Đã mở quà hôm nay',
  doneToday: 'Quà hôm nay đã mở',
  nextGift: (clock: string) => `Quà mới sau ${clock}`,
  /** Tiêu đề hộp quà đã mở của khách chưa đăng nhập: lời chúc thay cho quà, kèm nút đăng nhập (không cụt đường). */
  guestWish: 'Giáng sinh an lành!',
  guestLead: 'Đăng nhập để nhận Điểm Xanh và giọt nước mỗi ngày',
  login: 'Đăng nhập nhận quà',
  loadFailed: 'Chưa tải được quà hôm nay, rung cây để thử lại',
  /** Tên đọc của nút ❄️ (aria-pressed = tuyết đang rơi). */
  snow: 'Tuyết rơi',
  adventTitle: 'Lịch quà 12 ngày',
  adventLabel: (claimed: number, total: number) => `Lịch quà ${total} ngày, đã mở ${claimed}/${total}`,
  /** Trước ngày đầu của lịch: ô đầu ghi số ngày còn lại. */
  adventStartsIn: (days: number) => `còn ${num(days)} ngày`,
  tileAria: (day: number, date: string, state: 'claimed' | 'missed' | 'open' | 'locked') =>
    `Ngày ${day}, ${date}: ${state === 'claimed' ? 'đã mở quà' : state === 'missed' ? 'đã qua' : state === 'open' ? 'mở quà hôm nay' : 'chưa tới ngày'}`,
} as const;

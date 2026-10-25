/**
 * Cờ bật/tắt tính năng hiện ở thẻ "Bật/tắt tính năng" của tab Cấu hình. `fallback` trùng giá trị mặc định ở API
 * khi khoá chưa có dòng trong DB (API chỉ coi đúng boolean `true` là bật).
 */
export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  fallback: boolean;
  /** Dặn thêm trong hộp xác nhận khi BẬT. */
  onWarning?: string;
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: 'loyalty.marketplace_claim_enabled',
    label: 'Khách nhập mã đơn sàn để nhận điểm',
    description: 'Khách gửi mã vận đơn của đơn mua trên Shopee, TikTok Shop... để nhận Điểm Xanh. Nên bật thêm "Tra đơn trên Pancake" để hệ thống tự tìm đơn. Duyệt ở mục Tích điểm đơn sàn.',
    fallback: false,
    onWarning: 'Khách bắt đầu gửi được mã đơn và nhận điểm ngay.',
  },
  {
    key: 'pancake.external_lookup_enabled',
    label: 'Tra đơn trên Pancake khi khách nhập mã',
    description: 'Khi mã khách nhập chưa có trong sổ, hệ thống hỏi Pancake để tìm đơn. Chỉ chạy khi đã cài khoá kết nối Pancake.',
    fallback: false,
  },
  {
    key: 'pancake.external_poll_enabled',
    label: 'Tự kéo đơn sàn từ Pancake định kỳ',
    description: 'Kéo bù các đơn sàn và đơn chat bị lỡ khi Pancake gửi báo. Chỉ chạy khi đã cài khoá kết nối Pancake.',
    fallback: false,
  },
  {
    key: 'loyalty.chat_order_points_enabled',
    label: 'Tích điểm cho đơn chốt qua chat hoặc điện thoại',
    description: 'Đơn nhân viên chốt trên Pancake được cộng Điểm Xanh cho khách sau khi giao thành công. Cần có SĐT khách và mã vận đơn.',
    fallback: false,
    onWarning: 'Khách bắt đầu nhận điểm từ các đơn chốt qua chat.',
  },
  {
    key: 'loyalty.pos_credit_enabled',
    label: 'Tích điểm tại quầy',
    description: 'Nhân viên thu ngân cộng Điểm Xanh cho thành viên ở màn thu ngân. Hạn mức ngày chỉnh ở thẻ Tích điểm bên dưới.',
    fallback: false,
    onWarning: 'Thu ngân bắt đầu cộng điểm cho thành viên ngay.',
  },
  {
    key: 'waste.enabled',
    label: 'Đổi rác lấy quà',
    description: 'Khách tạo yêu cầu đổi rác, điểm nhận rác của đại lý hoạt động. Từng cách giao (mang tới điểm, gửi kho, thu kèm đơn) bật riêng ở Khách hàng, Đổi rác, Cấu hình chung.',
    fallback: false,
    onWarning: 'Mini App và web hiện chương trình cho khách.',
  },
  {
    key: 'chat.enabled',
    label: 'Cho khách chat với cửa hàng',
    description: 'Tin khách gửi được chuyển vào nhóm Zalo qua cầu nối. Chỉ bật khi cầu nối đang kết nối (xem ở Khách hàng, Chat CSKH). Cầu nối mất kết nối thì tin của khách không tới nhóm.',
    fallback: false,
    onWarning: 'Hãy kiểm tra cầu nối Zalo đang "Đã kết nối" ở mục Chat CSKH trước khi bật. Nếu không, tin khách gửi sẽ không tới nhóm.',
  },
  {
    key: 'storefront.require_approval',
    label: 'Bắt duyệt gian hàng CTV trước khi hiện',
    description: 'Bật: gian hàng CTV mới chỉ hiện với khách sau khi bạn duyệt ở mục Gian hàng. Tắt: hiện ngay khi CTV đăng, chỉ gian hàng đã duyệt mới có dấu tick xanh.',
    fallback: true,
  },
  {
    key: 'community.public_preview',
    label: 'Cho khách chưa đăng nhập xem thử Cộng đồng',
    description: 'Khách chưa đăng nhập thấy vài bài mới nhất do người dùng viết (tối đa 5 bài). Tắt: phải đăng nhập mới xem được.',
    fallback: true,
  },
];

/**
 * Cờ bật/tắt tính năng hiện ở thẻ "Bật/tắt tính năng" của tab Cấu hình. `fallback` trùng giá trị mặc định ở API
 * khi khoá chưa có dòng trong DB (API chỉ coi đúng boolean `true` là bật).
 */
export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  fallback: boolean;
  /** Hệ quả khi BẬT, hiện trong hộp xác nhận. */
  onWarning?: string;
  /** Hệ quả khi TẮT. Không có thì dùng câu chung "ngừng với khách ngay". */
  offWarning?: string;
  /** Cờ có điều kiện bật riêng ở một mục khác: thẻ chỉ hiện trạng thái và dẫn tới mục đó, không có công tắc. */
  manageIn?: { tab: 'supportChat'; label: string };
}

export const DEFAULT_OFF_WARNING = 'Tính năng ngừng với khách ngay. Dữ liệu đã có được giữ nguyên.';

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: 'loyalty.marketplace_claim_enabled',
    label: 'Khách nhập mã đơn sàn để nhận điểm',
    description: 'Khách gửi mã vận đơn của đơn mua trên Shopee, TikTok Shop... để nhận Điểm Xanh. Nên bật thêm "Tra đơn trên Pancake" để hệ thống tự tìm đơn. Duyệt ở mục Tích điểm đơn sàn.',
    fallback: false,
    onWarning: 'Khách bắt đầu gửi được mã đơn. Điểm chỉ cộng sau khi đơn giao thành công và qua số ngày đối soát; đơn giá trị lớn chờ nhân viên duyệt. Chỉ bật khi Pancake đã gửi đơn về Tubu thành công.',
    offWarning: 'Khách không gửi được mã đơn mới. Các mã đã gửi và đang chờ cộng điểm sẽ đứng yên: chưa cộng, không bị mất, và chạy tiếp khi bạn bật lại. Dữ liệu đã có được giữ nguyên.',
  },
  {
    key: 'pancake.external_lookup_enabled',
    label: 'Tra đơn trên Pancake khi khách nhập mã',
    description: 'Khi mã khách nhập chưa có trong sổ, hệ thống hỏi Pancake để tìm đơn. Chỉ chạy khi đã cài khoá kết nối Pancake.',
    fallback: false,
    onWarning: 'Hệ thống bắt đầu hỏi Pancake mỗi khi khách nhập mã chưa có trong sổ. Chỉ bật khi đã thử và Pancake tìm được đơn theo mã vận đơn.',
  },
  {
    key: 'pancake.external_poll_enabled',
    label: 'Tự kéo đơn sàn từ Pancake định kỳ',
    description: 'Kéo bù các đơn sàn và đơn chat bị lỡ khi Pancake gửi báo. Chỉ chạy khi đã cài khoá kết nối Pancake.',
    fallback: false,
    onWarning: 'Hệ thống bắt đầu kéo đơn từ Pancake mỗi 10 phút. Điểm vẫn chỉ cộng sau khi đơn giao thành công và qua số ngày đối soát. Chỉ bật khi Pancake đã gửi đơn về Tubu thành công và bạn đã thử kéo thử thấy đúng đơn.',
  },
  {
    key: 'loyalty.chat_order_points_enabled',
    label: 'Tích điểm cho đơn chốt qua chat hoặc điện thoại',
    description: 'Đơn nhân viên chốt trên Pancake được cộng Điểm Xanh cho khách sau khi giao thành công. Cần có SĐT khách và mã vận đơn.',
    fallback: false,
    onWarning: 'Các đơn chốt qua chat bắt đầu được ghi nhận để tích điểm. Điểm chỉ cộng sau khi đơn giao thành công và qua số ngày đối soát. Chỉ bật khi Pancake đã gửi đơn về Tubu thành công và đã khai báo nguồn đơn chat.',
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
    description: 'Tin khách gửi được chuyển vào nhóm Zalo qua cầu nối. Chỉ bật được khi cầu nối đang kết nối và đã chọn nhóm nhận tin, nên công tắc nằm ở mục Chat CSKH.',
    fallback: false,
    manageIn: { tab: 'supportChat', label: 'Bật/tắt ở Chat CSKH' },
  },
  {
    key: 'storefront.require_approval',
    label: 'Bắt duyệt gian hàng CTV trước khi hiện',
    description: 'Bật: gian hàng CTV mới chỉ hiện với khách sau khi bạn duyệt ở mục Gian hàng. Tắt: hiện ngay khi CTV đăng, chỉ gian hàng đã duyệt mới có dấu tick xanh.',
    fallback: true,
    onWarning: 'Gian hàng CTV chưa được duyệt sẽ bị ẩn khỏi khách ngay, kể cả gian hàng đang hiện. Gian hàng hiện lại sau khi bạn duyệt ở mục Gian hàng.',
    offWarning: 'Mọi gian hàng CTV đã đăng mà chưa duyệt sẽ hiện công khai ngay, không cần bạn duyệt. Chỉ gian hàng đã duyệt mới có dấu tick xanh.',
  },
  {
    key: 'community.public_preview',
    label: 'Cho khách chưa đăng nhập xem thử Cộng đồng',
    description: 'Khách chưa đăng nhập thấy vài bài mới nhất do người dùng viết (tối đa 5 bài). Tắt: phải đăng nhập mới xem được.',
    fallback: true,
    offWarning: 'Khách chưa đăng nhập không còn thấy bài nào, phải đăng nhập mới xem được Cộng đồng.',
  },
];

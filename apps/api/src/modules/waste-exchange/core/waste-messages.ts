import { formatPoints } from '../../../common/format-points';
import { PICKUP_BATTERY_HCM_ONLY_MESSAGE } from './waste-pickup-rules';

type MinMethod = 'MAIL_IN' | 'PICKUP' | 'HOME_PICKUP';

const MIN_LABEL: Record<MinMethod, string> = { MAIL_IN: 'Gói gửi về kho', PICKUP: 'Thu kèm đơn', HOME_PICKUP: 'Đơn shipper lấy tận nhà' };
const CAP_LABEL: Record<MinMethod, string> = { MAIL_IN: 'gói gửi kho', PICKUP: 'gói thu kèm đơn', HOME_PICKUP: 'đơn shipper lấy tận nhà' };

export const WASTE_MESSAGES = {
  PROGRAMME_OFF: 'Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.',
  NEED_PHONE: 'Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà.',
  BLOCKED: 'Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.',
  SHIP_LOCKED: 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.',
  POINT_UNAVAILABLE: 'Điểm nhận đang tạm ngừng, hãy chọn điểm khác',
  ITEM_NOT_ACTIVE: 'Món này hiện chưa nhận, hãy bỏ khỏi danh sách',
  NOT_MAIL_IN: 'Yêu cầu này không dùng mã vận đơn',
  RETRY: 'Bạn thử lại nhé',

  BELOW_MIN: (method: MinMethod, minPoints: number, missingPoints: number) =>
    `${MIN_LABEL[method]} cần tối thiểu ${formatPoints(minPoints)} điểm, bạn cần thêm ${formatPoints(missingPoints)} điểm nữa`,
  MONTH_CAP_FOR_MIN: (method: MinMethod) => `Tháng này bạn không đủ trần tháng cho ${CAP_LABEL[method]}`,
  ITEM_MONTH_CAP: (itemName: string, remaining: number, unitLabel: string) =>
    `${itemName}: tháng này bạn chỉ còn gửi được ${remaining} ${unitLabel}`,
  ITEM_DAY_CAP: (itemName: string, remaining: number, unitLabel: string) =>
    `${itemName}: hôm nay bạn chỉ còn mang tới điểm nhận được ${remaining} ${unitLabel}`,
  POINTS_MONTH_CAP: (remaining: number) => `Tháng này bạn chỉ còn ${formatPoints(remaining)} Điểm Xanh trong trần đổi rác`,
  MAX_OPEN: (max: number) => `Bạn đang có ${max} yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm`,
  PICKUP_PENDING: (code: string) => `Bạn đã có yêu cầu thu kèm ${code}, hãy gắn vào đơn kế tiếp`,
  ITEM_DROPOFF_ONLY: (names: string[]) => `${names.join(', ')} không gửi qua đường vận chuyển, chỉ mang tới điểm nhận được`,
  HAZARDOUS_HCM_ONLY: PICKUP_BATTERY_HCM_ONLY_MESSAGE,
  POINT_MISSING_ITEMS: (names: string[]) => `Điểm nhận này không nhận: ${names.join(', ')}`,

  REQUEST_NOT_FOUND: 'Không tìm thấy yêu cầu',
  STAFF_ONLY: 'Chỉ nhân viên hoặc quản trị viên mới làm được thao tác này.',
  ADMIN_ONLY: 'Chỉ quản trị viên mới làm được thao tác này.',
  POINT_NOT_FOUND: 'Không tìm thấy điểm nhận',
  POINT_INACTIVE: 'Điểm nhận này đang không hoạt động',
  ACCOUNT_LOCKED: 'Tài khoản của bạn không thao tác được tại điểm nhận',
  NOT_POINT_STAFF: 'Bạn không phải người ở điểm nhận này',
  POINT_OWNER_INVALID: 'Điểm nhận này đang chờ Tubu kiểm tra chủ điểm, tạm chưa thao tác được',
  LANE_DISABLED: 'Cách giao này đang tạm tắt, hãy chọn cách khác',
  POINT_QUOTA_FULL: 'Điểm nhận đã hết hạn mức tháng này, hãy chọn điểm khác',
  NEED_POINT: 'Hãy chọn điểm nhận',
  DUPLICATE_LINE: 'Mỗi món chỉ khai một dòng',
  REQUEST_POINTS_MAX: 'Một yêu cầu tối đa 2.000.000 điểm, hãy tách thành nhiều yêu cầu',
  MAILIN_CONSENT: 'Bạn cần đồng ý quy tắc đóng gói và cam kết đã trả đủ cước để gửi về kho',
  RULES_UPDATED: 'Thể lệ đã được cập nhật. Bạn hãy đọc lại Thể lệ rồi đồng ý lại để tạo yêu cầu',
  IDEMPOTENCY_CONFLICT: 'Mã chống gửi lặp này đã dùng cho một yêu cầu khác',
  NOT_EDITABLE: 'Yêu cầu này không còn sửa được',
  NOT_CANCELLABLE: 'Yêu cầu này không còn huỷ được',
  TRACKING_CLOSED: 'Yêu cầu này không còn nhập mã vận đơn được',
  TRACKING_DUPLICATE_OWN: 'Bạn đã dùng mã vận đơn này cho một yêu cầu khác',

  HOME_PICKUP_UNAVAILABLE: 'Đặt shipper tới lấy rác tạm thời chưa dùng được, bạn chọn cách khác hoặc thử lại sau nhé',
  HOME_PICKUP_NEED_ADDRESS: 'Hãy chọn địa chỉ để shipper tới lấy rác',
  HOME_PICKUP_ADDRESS_NOT_FOUND: 'Không tìm thấy địa chỉ này trong sổ địa chỉ của bạn',
  HOME_PICKUP_WEIGHT: (minGrams: number, maxGrams: number) => `Cân nặng gói rác cần từ ${minGrams / 1000} kg tới ${maxGrams / 1000} kg`,
  HOME_PICKUP_ADDRESS_UNRECOGNIZED: 'Đơn vị vận chuyển chưa nhận diện được địa chỉ này, hãy sửa lại phường/xã trong sổ địa chỉ',
  HOME_PICKUP_NEED_POINTS: (shortfallPoints: number) =>
    `Phí shipper lấy rác cần trả bằng Điểm Xanh, bạn còn thiếu ${shortfallPoints.toLocaleString('vi-VN')} điểm. Hãy chọn mang tới điểm thu gom hoặc đổi rác kèm đơn mua nhé`,
  HOME_PICKUP_FEE_CHANGED: (cashDueVnd: number) =>
    `Số tiền phí còn phải trả vừa đổi thành ${cashDueVnd.toLocaleString('vi-VN')}đ, bạn kiểm tra lại báo phí trước khi đặt nhé`,
  HOME_PICKUP_BANK_DISABLED: 'Chuyển khoản phí lấy rác hiện chưa mở, bạn chọn cách khác nhé',
  HOME_PICKUP_WALLET_INSUFFICIENT: 'Số dư Ví Tubu không đủ để trả phần phí lấy rác còn thiếu',
  HOME_PICKUP_FEE_UNAVAILABLE: 'Chưa báo được phí shipper lúc này, bạn thử lại sau ít phút nhé',
  HOME_PICKUP_POINTS_CHANGED: 'Số Điểm Xanh dùng được của bạn vừa thay đổi, hãy mở lại màn đặt shipper để xem phí mới',
  HOME_PICKUP_PICKED_UP: 'Bưu tá đã lấy rác nên không huỷ được nữa',
  HOME_PICKUP_CREATING: 'Tubu đang tạo vận đơn cho yêu cầu này, bạn thử huỷ lại sau ít phút',
  HOME_PICKUP_MANUAL_CHECK: 'Tubu đang kiểm tra vận đơn của yêu cầu này, hãy nhắn CSKH nếu bạn muốn huỷ',
  HOME_PICKUP_CANCEL_REFUSED: 'Đơn vị vận chuyển chưa cho huỷ vận đơn này (có thể bưu tá đã nhận hàng), yêu cầu vẫn được giữ nguyên',
  HOME_PICKUP_CARRIER_BUSY: 'Chưa liên lạc được đơn vị vận chuyển để huỷ, bạn thử lại sau ít phút',
} as const;

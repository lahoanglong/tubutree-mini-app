import { formatPoints } from '../../../common/format-points';

type MinMethod = 'MAIL_IN' | 'PICKUP';

export const WASTE_MESSAGES = {
  PROGRAMME_OFF: 'Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.',
  NEED_PHONE: 'Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà.',
  BLOCKED: 'Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.',
  SHIP_LOCKED: 'Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.',
  POINT_UNAVAILABLE: 'Điểm nhận đang tạm ngừng, hãy chọn điểm khác',
  ITEM_NOT_ACTIVE: 'Món này hiện chưa nhận, hãy bỏ khỏi danh sách',
  NOT_MAIL_IN: 'Yêu cầu này không dùng mã vận đơn',
  RETRY: 'Vui lòng thử lại',

  BELOW_MIN: (method: MinMethod, minPoints: number, missingPoints: number) =>
    `${method === 'MAIL_IN' ? 'Gói gửi về kho' : 'Thu kèm đơn'} cần tối thiểu ${formatPoints(minPoints)} điểm, bạn cần thêm ${formatPoints(missingPoints)} điểm nữa`,
  MONTH_CAP_FOR_MIN: (method: MinMethod) =>
    `Tháng này bạn không đủ trần tháng cho ${method === 'MAIL_IN' ? 'gói gửi kho' : 'gói thu kèm đơn'}`,
  ITEM_MONTH_CAP: (itemName: string, remaining: number, unitLabel: string) =>
    `${itemName}: tháng này bạn chỉ còn gửi được ${remaining} ${unitLabel}`,
  ITEM_DAY_CAP: (itemName: string, remaining: number, unitLabel: string) =>
    `${itemName}: hôm nay bạn chỉ còn mang tới điểm nhận được ${remaining} ${unitLabel}`,
  POINTS_MONTH_CAP: (remaining: number) => `Tháng này bạn chỉ còn ${formatPoints(remaining)} Điểm Xanh trong trần đổi rác`,
  MAX_OPEN: (max: number) => `Bạn đang có ${max} yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm`,
  PICKUP_PENDING: (code: string) => `Bạn đã có yêu cầu thu kèm ${code}, hãy gắn vào đơn kế tiếp`,
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
  IDEMPOTENCY_CONFLICT: 'Mã chống gửi lặp này đã dùng cho một yêu cầu khác',
  NOT_EDITABLE: 'Yêu cầu này không còn sửa được',
  NOT_CANCELLABLE: 'Yêu cầu này không còn huỷ được',
  TRACKING_CLOSED: 'Yêu cầu này không còn nhập mã vận đơn được',
  TRACKING_DUPLICATE_OWN: 'Bạn đã dùng mã vận đơn này cho một yêu cầu khác',
} as const;

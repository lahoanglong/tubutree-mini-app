import { WASTE_MESSAGES as M } from './waste-messages';

describe('WASTE_MESSAGES (registry 4.13 pinned sentences)', () => {
  it('pinned sentences', () => {
    expect(M.PROGRAMME_OFF).toBe('Tính năng Đổi rác lấy quà đang tắt. Liên hệ quản trị viên.');
    expect(M.NEED_PHONE).toBe('Bạn cần chia sẻ số điện thoại để dùng Đổi rác lấy quà.');
    expect(M.BLOCKED).toBe('Tài khoản của bạn tạm không tham gia Đổi rác, liên hệ Tubu Tree.');
    expect(M.SHIP_LOCKED).toBe('Đường gửi kho và thu kèm đơn đang tạm dừng với tài khoản của bạn, liên hệ CSKH.');
    expect(M.POINT_UNAVAILABLE).toBe('Điểm nhận đang tạm ngừng, hãy chọn điểm khác');
    expect(M.ITEM_NOT_ACTIVE).toBe('Món này hiện chưa nhận, hãy bỏ khỏi danh sách');
    expect(M.NOT_MAIL_IN).toBe('Yêu cầu này không dùng mã vận đơn');
    expect(M.RETRY).toBe('Vui lòng thử lại');
  });
  it('builders', () => {
    expect(M.BELOW_MIN('MAIL_IN', 15_000, 5_000)).toBe('Gói gửi về kho cần tối thiểu 15.000 điểm, bạn cần thêm 5.000 điểm nữa');
    expect(M.BELOW_MIN('PICKUP', 10_000, 1_000)).toBe('Thu kèm đơn cần tối thiểu 10.000 điểm, bạn cần thêm 1.000 điểm nữa');
    expect(M.MONTH_CAP_FOR_MIN('MAIL_IN')).toBe('Tháng này bạn không đủ trần tháng cho gói gửi kho');
    expect(M.MONTH_CAP_FOR_MIN('PICKUP')).toBe('Tháng này bạn không đủ trần tháng cho gói thu kèm đơn');
    expect(M.ITEM_MONTH_CAP('Thùng carton', 10, 'thùng')).toBe('Thùng carton: tháng này bạn chỉ còn gửi được 10 thùng');
    expect(M.ITEM_DAY_CAP('Thùng carton', 4, 'thùng')).toBe('Thùng carton: hôm nay bạn chỉ còn mang tới điểm nhận được 4 thùng');
    expect(M.POINTS_MONTH_CAP(10_000)).toBe('Tháng này bạn chỉ còn 10.000 Điểm Xanh trong trần đổi rác');
    expect(M.MAX_OPEN(3)).toBe('Bạn đang có 3 yêu cầu chưa xong, hãy hoàn tất hoặc huỷ bớt trước khi tạo thêm');
    expect(M.PICKUP_PENDING('TR-AAAAA')).toBe('Bạn đã có yêu cầu thu kèm TR-AAAAA, hãy gắn vào đơn kế tiếp');
    expect(M.POINT_MISSING_ITEMS(['Màng xốp', 'Vỏ hộp sữa'])).toBe('Điểm nhận này không nhận: Màng xốp, Vỏ hộp sữa');
  });
  it('the 19 fixed sentences used by later M2 tasks', () => {
    expect(M).toMatchObject({
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
    });
  });
  it('no apostrophe, no voucher, no standalone xu in any sentence', () => {
    const texts = [
      ...Object.values(M as Record<string, unknown>).filter((v): v is string => typeof v === 'string'),
      M.BELOW_MIN('MAIL_IN', 15_000, 5_000), M.BELOW_MIN('PICKUP', 10_000, 1_000), M.MONTH_CAP_FOR_MIN('MAIL_IN'), M.MONTH_CAP_FOR_MIN('PICKUP'),
      M.ITEM_MONTH_CAP('Thùng carton', 10, 'thùng'), M.ITEM_DAY_CAP('Thùng carton', 4, 'thùng'), M.POINTS_MONTH_CAP(10_000), M.MAX_OPEN(3),
      M.PICKUP_PENDING('TR-AAAAA'), M.POINT_MISSING_ITEMS(['Màng xốp', 'Vỏ hộp sữa']),
    ];
    for (const t of texts) {
      expect(t).not.toContain("'");
      expect(t).not.toMatch(/voucher/i);
      expect(t).not.toMatch(/(?<![\p{L}_])xu(?![\p{L}_])/iu);
    }
  });
});

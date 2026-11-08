import { describe, expect, it } from 'vitest';
import { formatDobDisplay, orderCopy, profileCopy } from './account-copy';

describe('formatDobDisplay', () => {
  it('đổi yyyy-MM-dd sang dd/MM/yyyy', () => {
    expect(formatDobDisplay('1990-05-01')).toBe('01/05/1990');
  });

  it.each([null, undefined, '', '1990-5-1', '01/05/1990', 'abc'])('giá trị %s không phải ngày thì trả rỗng', (v) => {
    expect(formatDobDisplay(v)).toBe('');
  });
});

describe('profileCopy', () => {
  it('câu xác nhận nêu ngày theo dd/MM/yyyy', () => {
    expect(profileCopy.dobConfirm('01/05/1990')).toBe('Ngày sinh 1 tháng 5 năm 1990 chỉ đặt được một lần. Xác nhận?');
  });

  it('ngày kiểu Mỹ dán vào "03/05/1990" hiện 3 tháng 5 để khách thấy ngày bị đảo', () => {
    expect(profileCopy.dobConfirm('03/05/1990')).toBe('Ngày sinh 3 tháng 5 năm 1990 chỉ đặt được một lần. Xác nhận?');
    expect(profileCopy.dobConfirm('05/03/1990')).toBe('Ngày sinh 5 tháng 3 năm 1990 chỉ đặt được một lần. Xác nhận?');
  });

  it('chuỗi không đúng dd/mm/yyyy giữ nguyên', () => {
    expect(profileCopy.dobConfirm('abc')).toBe('Ngày sinh abc chỉ đặt được một lần. Xác nhận?');
  });
});

describe('orderCopy — ô tìm trong danh sách đơn', () => {
  it('nhãn, gợi ý và nút xoá là một nguồn chữ cho Mini App và web', () => {
    expect(orderCopy.searchLabel).toBe('Tìm đơn theo mã đơn hoặc tên sản phẩm');
    expect(orderCopy.searchPlaceholder).toBe('Mã đơn hoặc tên sản phẩm');
    expect(orderCopy.searchClear).toBe('Xoá tìm kiếm');
  });

  it('kết quả rỗng nêu từ khoá; đang lọc một trạng thái thì thêm "ở trạng thái này"', () => {
    expect(orderCopy.searchNoMatch('zzz', false)).toBe('Không tìm thấy đơn nào khớp “zzz”');
    expect(orderCopy.searchNoMatch('zzz', true)).toBe('Không tìm thấy đơn nào khớp “zzz” ở trạng thái này');
  });
});

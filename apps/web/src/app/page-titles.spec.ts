import { describe, expect, it } from 'vitest';
import { metadata as cart } from './gio-hang/layout';
import { metadata as checkout } from './thanh-toan/layout';
import { metadata as login } from './dang-nhap/layout';
import { metadata as account } from './tai-khoan/layout';

// R3-UI-7: các trang client không có tiêu đề riêng nên mọi tab đều tên "Tubu Tree — Sống xanh An Lành", khó phân biệt
// trong lịch sử trình duyệt và với trình đọc màn hình.
describe('tiêu đề trang khách', () => {
  it.each([
    ['/gio-hang', cart, 'Giỏ hàng — Tubu Tree'],
    ['/thanh-toan', checkout, 'Thanh toán — Tubu Tree'],
    ['/dang-nhap', login, 'Đăng nhập — Tubu Tree'],
    ['/tai-khoan', account, 'Tài khoản — Tubu Tree'],
  ])('%s có tiêu đề riêng và không lập chỉ mục', (_path, meta, title) => {
    expect(meta.title).toBe(title);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});

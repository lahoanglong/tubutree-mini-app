import type { Metadata } from 'next';
import { describe, expect, it } from 'vitest';
import { metadata as cart } from './gio-hang/layout';
import { metadata as checkout } from './thanh-toan/layout';
import { metadata as login } from './dang-nhap/layout';
import { metadata as account } from './tai-khoan/layout';
import { metadata as addresses } from './tai-khoan/dia-chi/layout';
import { metadata as points } from './tai-khoan/diem-xanh/layout';
import { metadata as wallet } from './tai-khoan/vi-tubu/layout';
import { metadata as editProfile } from './tai-khoan/ho-so/layout';
import { metadata as settings } from './tai-khoan/cai-dat/layout';
import { metadata as notifications } from './tai-khoan/thong-bao/layout';
import { metadata as rewards } from './kho-qua/layout';
import { metadata as myRewards } from './kho-qua/cua-toi/layout';
import { metadata as game } from './vuon-xanh/layout';
import { metadata as recycle } from './doi-rac/page';
import { metadata as recycleRules } from './doi-rac/quy-dinh/page';
import { metadata as recycleRequests } from './doi-rac/yeu-cau/layout';
import { metadata as recycleNew } from './doi-rac/tao/layout';
import { metadata as recyclePoints } from './doi-rac/diem-nhan/layout';
import { metadata as recycleRequest } from './doi-rac/yeu-cau/[id]/layout';
import { metadata as recycleEdit } from './doi-rac/yeu-cau/[id]/sua/layout';
import { metadata as recycleDone } from './doi-rac/xong/[id]/layout';
import { metadata as recycleDesk } from './doi-rac/quay/layout';
import { metadata as advisor } from './tu-van/layout';
import { metadata as cashback } from './hoan-tien/layout';
import { metadata as wishlist } from './tai-khoan/yeu-thich/layout';
import { metadata as supportChat } from './ho-tro/chat/layout';
import { metadata as orders } from './tai-khoan/don-hang/layout';
import { metadata as bankPayment } from './thanh-toan/chuyen-khoan/[code]/layout';
import { metadata as ctv } from './ctv/layout';
import { metadata as ctvStorefront } from './ctv/gian-hang/layout';
import { metadata as leaderboard } from './cong-dong/xep-hang/layout';
import { metadata as events } from './cong-dong/su-kien/layout';
import { metadata as postDetail } from './cong-dong/[id]/layout';
import { metadata as dealer } from './dai-ly/layout';
import { metadata as staff } from './nhan-vien/layout';
import { metadata as payroll } from './nhan-vien/bang-luong/layout';
import { metadata as brandOwner } from './chu-thuong-hieu/layout';
import { generateMetadata as orderDetail } from './tai-khoan/don-hang/[code]/layout';

type TitleCase = [string, Metadata, string];
const CORE: TitleCase[] = [
  ['/gio-hang', cart, 'Giỏ hàng — Tubu Tree'],
  ['/thanh-toan', checkout, 'Thanh toán — Tubu Tree'],
  ['/dang-nhap', login, 'Đăng nhập — Tubu Tree'],
  ['/tai-khoan', account, 'Tài khoản — Tubu Tree'],
  ['/tai-khoan/dia-chi', addresses, 'Sổ địa chỉ — Tubu Tree'],
  ['/tai-khoan/vi-tubu', wallet, 'Ví Tubu — Tubu Tree'],
];
const SHOP: TitleCase[] = [
  ['/tai-khoan/yeu-thich', wishlist, 'Sản phẩm yêu thích — Tubu Tree'],
  ['/ho-tro/chat', supportChat, 'Chat với Tubu Tree — Tubu Tree'],
];
const ORDER: TitleCase[] = [
  ['/thanh-toan/chuyen-khoan/[code]', bankPayment, 'Thanh toán chuyển khoản — Tubu Tree'],
  ['/tai-khoan/don-hang', orders, 'Đơn hàng — Tubu Tree'],
];
const ACCOUNT: TitleCase[] = [
  ['/tai-khoan/ho-so', editProfile, 'Sửa hồ sơ — Tubu Tree'],
  ['/tai-khoan/cai-dat', settings, 'Cài đặt — Tubu Tree'],
  ['/tai-khoan/thong-bao', notifications, 'Thông báo — Tubu Tree'],
];
const LOYALTY: TitleCase[] = [
  ['/tai-khoan/diem-xanh', points, 'Hạng thành viên & Điểm Xanh — Tubu Tree'],
  ['/kho-qua', rewards, 'Kho quà — Tubu Tree'],
  ['/kho-qua/cua-toi', myRewards, 'Quà của tôi — Tubu Tree'],
  ['/hoan-tien', cashback, 'Hoàn tiền — Tubu Tree'],
];
const COMMUNITY: TitleCase[] = [
  ['/cong-dong/xep-hang', leaderboard, 'Bảng xếp hạng — Tubu Tree'],
  ['/cong-dong/su-kien', events, 'Sự kiện — Tubu Tree'],
  ['/cong-dong/[id]', postDetail, 'Bài viết cộng đồng — Tubu Tree'],
];
const AFFILIATE: TitleCase[] = [
  ['/ctv', ctv, 'Cộng tác viên — Tubu Tree'],
  ['/ctv/gian-hang', ctvStorefront, 'Gian hàng của tôi — Tubu Tree'],
];
const GAME: TitleCase[] = [
  ['/vuon-xanh', game, 'Vườn Xanh — Tubu Tree'],
  ['/tu-van', advisor, 'Trợ lý AI Tubu — Tubu Tree'],
];
const PRO: TitleCase[] = [
  ['/dai-ly', dealer, 'Kênh đại lý — Tubu Tree'],
  ['/nhan-vien', staff, 'Ca làm của tôi — Tubu Tree'],
  ['/nhan-vien/bang-luong', payroll, 'Lương của tôi — Tubu Tree'],
  ['/chu-thuong-hieu', brandOwner, 'Quản lý nhãn hàng — Tubu Tree'],
];
const RECYCLE: TitleCase[] = [
  ['/doi-rac', recycle, 'Đổi rác lấy quà — Tubu Tree'],
  ['/doi-rac/yeu-cau', recycleRequests, 'Yêu cầu của tôi — Tubu Tree'],
  ['/doi-rac/tao', recycleNew, 'Tạo yêu cầu đổi rác — Tubu Tree'],
  ['/doi-rac/diem-nhan', recyclePoints, 'Chọn điểm nhận — Tubu Tree'],
  ['/doi-rac/yeu-cau/[id]', recycleRequest, 'Yêu cầu đổi rác — Tubu Tree'],
  ['/doi-rac/yeu-cau/[id]/sua', recycleEdit, 'Sửa yêu cầu đổi rác — Tubu Tree'],
  ['/doi-rac/xong/[id]', recycleDone, 'Kết quả đổi rác — Tubu Tree'],
  ['/doi-rac/quay', recycleDesk, 'Nhận hàng tại điểm — Tubu Tree'],
];
const TITLES: TitleCase[] = [...CORE, ...SHOP, ...ORDER, ...ACCOUNT, ...LOYALTY, ...COMMUNITY, ...AFFILIATE, ...GAME, ...PRO, ...RECYCLE];

// R3-UI-7: các trang client không có tiêu đề riêng nên mọi tab đều tên "Tubu Tree — Sống xanh An Lành", khó phân biệt
// trong lịch sử trình duyệt và với trình đọc màn hình.
// R5-BUYER-5: các trang con của /tai-khoan kế thừa "Tài khoản — Tubu Tree" nên mở nhiều tab (địa chỉ, điểm, ví, đơn)
// vẫn giống hệt nhau.
describe('tiêu đề trang khách', () => {
  it.each(TITLES)('%s có tiêu đề riêng và không lập chỉ mục', (_path, meta, title) => {
    expect(meta.title).toBe(title);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('/doi-rac/quy-dinh là trang công khai: có tiêu đề riêng và cho lập chỉ mục', () => {
    expect(recycleRules.title).toBe('Thể lệ Đổi rác lấy quà — Tubu Tree');
    expect(recycleRules.robots).toBeUndefined();
  });

  it('/tai-khoan/don-hang/[code] có tiêu đề theo mã đơn, không lập chỉ mục', async () => {
    const meta = await orderDetail({ params: Promise.resolve({ code: 'TB260901' }) });
    expect(meta.title).toBe('Đơn TB260901 — Tubu Tree');
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('mã đơn trên URL được giải mã; mã hỏng không làm vỡ tiêu đề', async () => {
    expect((await orderDetail({ params: Promise.resolve({ code: 'TB%2F1' }) })).title).toBe('Đơn TB/1 — Tubu Tree');
    expect((await orderDetail({ params: Promise.resolve({ code: '%E0%A4%A' }) })).title).toBe('Đơn hàng — Tubu Tree');
  });
});

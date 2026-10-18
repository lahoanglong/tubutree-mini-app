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
import { metadata as leaderboard } from './cong-dong/xep-hang/layout';
import { generateMetadata as orderDetail } from './tai-khoan/don-hang/[code]/layout';

type TitleCase = [string, Metadata, string];
const CORE: TitleCase[] = [
  ['/gio-hang', cart, 'Giỏ hàng — Tubu Tree'],
  ['/thanh-toan', checkout, 'Thanh toán — Tubu Tree'],
  ['/dang-nhap', login, 'Đăng nhập — Tubu Tree'],
  ['/tai-khoan', account, 'Tài khoản — Tubu Tree'],
  ['/tai-khoan/dia-chi', addresses, 'Sổ địa chỉ — Tubu Tree'],
  ['/tai-khoan/diem-xanh', points, 'Lịch sử Điểm Xanh — Tubu Tree'],
  ['/tai-khoan/vi-tubu', wallet, 'Ví Tubu — Tubu Tree'],
];
const SHOP: TitleCase[] = [];
const ORDER: TitleCase[] = [];
const ACCOUNT: TitleCase[] = [
  ['/tai-khoan/ho-so', editProfile, 'Sửa hồ sơ — Tubu Tree'],
  ['/tai-khoan/cai-dat', settings, 'Cài đặt — Tubu Tree'],
  ['/tai-khoan/thong-bao', notifications, 'Thông báo — Tubu Tree'],
];
const LOYALTY: TitleCase[] = [];
const COMMUNITY: TitleCase[] = [['/cong-dong/xep-hang', leaderboard, 'Bảng xếp hạng — Tubu Tree']];
const AFFILIATE: TitleCase[] = [];
const GAME: TitleCase[] = [];
const PRO: TitleCase[] = [];
const RECYCLE: TitleCase[] = [];
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

  it('/tai-khoan/don-hang/[code] có tiêu đề theo mã đơn, không lập chỉ mục', async () => {
    const meta = await orderDetail({ params: { code: 'TB260901' } });
    expect(meta.title).toBe('Đơn TB260901 — Tubu Tree');
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('mã đơn trên URL được giải mã; mã hỏng không làm vỡ tiêu đề', async () => {
    expect((await orderDetail({ params: { code: 'TB%2F1' } })).title).toBe('Đơn TB/1 — Tubu Tree');
    expect((await orderDetail({ params: { code: '%E0%A4%A' } })).title).toBe('Đơn hàng — Tubu Tree');
  });
});

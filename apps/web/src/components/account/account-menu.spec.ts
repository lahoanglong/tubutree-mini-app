import { describe, expect, it } from 'vitest';
import routeMap from '@tubutree/app-core/route-map.json';
import { buildAccountMenu, type AccountMenuContext, type AccountMenuGroup } from './account-menu';

// Chép ý profile.spec.ts và profile-hub.spec.tsx (Mini App): nhóm menu, mục theo vai trò/cờ, đại lý/chủ nhãn đổi theo dữ liệu.

const ready = () => true;
const ctx = (over: Partial<AccountMenuContext> = {}): AccountMenuContext => ({
  role: 'CUSTOMER',
  aiEnabled: false,
  claimEnabled: false,
  cashbackEnabled: false,
  dealer: null,
  ownedBrandName: null,
  isReady: ready,
  ...over,
});
const labels = (menu: AccountMenuGroup[], group: string) => menu.find((g) => g.group === group)?.items.map((i) => i.label) ?? [];
const all = (menu: AccountMenuGroup[]) => menu.flatMap((g) => g.items);

describe('nhóm menu hub tài khoản', () => {
  it('bốn nhóm theo thứ tự Mua sắm, Tài sản, Hợp tác, Khác; khách thường không có nhóm Công việc', () => {
    expect(buildAccountMenu(ctx()).map((g) => g.group)).toEqual(['Mua sắm', 'Tài sản', 'Hợp tác', 'Khác']);
  });

  it('mục đúng như Mini App khi mọi route đã xong và cờ tắt', () => {
    const m = buildAccountMenu(ctx());
    expect(labels(m, 'Mua sắm')).toEqual(['Mua chung nhóm', 'Đổi rác lấy quà', 'Sản phẩm yêu thích', 'Sổ địa chỉ', 'Cộng đồng hỏi đáp']);
    expect(labels(m, 'Tài sản')).toEqual(['Hạng thành viên & Điểm Xanh', 'Ví Tubu']);
    expect(labels(m, 'Hợp tác')).toEqual(['Cộng tác viên', 'Đăng ký đại lý']);
    expect(labels(m, 'Khác')).toEqual(['Thông báo', 'Câu chuyện thương hiệu', 'Cài đặt', 'Về Tubu Tree & Hỗ trợ']);
  });

  it('đích là route web của mục Mini App tương ứng', () => {
    const to = (label: string) => all(buildAccountMenu(ctx({ aiEnabled: true }))).find((i) => i.label === label)?.to;
    expect(to('Sổ địa chỉ')).toBe('/tai-khoan/dia-chi');
    expect(to('Ví Tubu')).toBe('/tai-khoan/vi-tubu');
    expect(to('Hạng thành viên & Điểm Xanh')).toBe('/tai-khoan/diem-xanh');
    expect(to('Thông báo')).toBe('/tai-khoan/thong-bao');
    expect(to('Cài đặt')).toBe('/tai-khoan/cai-dat');
    expect(to('Trợ lý AI 24/7')).toBe('/tu-van');
  });

  it('không trùng đích trong menu (kể cả khi bật hết cờ và đủ vai trò)', () => {
    const m = buildAccountMenu(ctx({ role: 'ADMIN', aiEnabled: true, claimEnabled: true, cashbackEnabled: true, ownedBrandName: 'Nhãn A' }));
    const dests = all(m).map((i) => i.to);
    expect(new Set(dests).size).toBe(dests.length);
  });

  it('mọi đích web đều có trong route map (tránh link tới route không tồn tại)', () => {
    const webPaths = new Set(
      (routeMap.routes as { items: { web?: string }[] }[]).flatMap((g) => g.items).flatMap((i) => (i.web ? [i.web.split('?')[0]!] : [])),
    );
    const m = buildAccountMenu(ctx({ role: 'ADMIN', aiEnabled: true, claimEnabled: true, cashbackEnabled: true, ownedBrandName: 'Nhãn A' }));
    for (const item of all(m).filter((i) => !i.miniAppOnly)) expect(webPaths.has(item.to), item.to).toBe(true);
  });

  it('mục trỏ route còn pending thì ẩn; route xong thì hiện', () => {
    const m = buildAccountMenu(ctx({ isReady: (p) => p === '/tai-khoan/dia-chi' || p === '/tai-khoan/vi-tubu' }));
    expect(labels(m, 'Mua sắm')).toEqual(['Sổ địa chỉ']);
    expect(labels(m, 'Tài sản')).toEqual(['Ví Tubu']);
    expect(m.map((g) => g.group)).toEqual(['Mua sắm', 'Tài sản']);
  });
});

describe('mục theo cờ', () => {
  it('Trợ lý AI 24/7 chỉ hiện khi máy chủ báo bật, nằm sau Đổi rác', () => {
    expect(labels(buildAccountMenu(ctx()), 'Mua sắm')).not.toContain('Trợ lý AI 24/7');
    expect(labels(buildAccountMenu(ctx({ aiEnabled: true })), 'Mua sắm').slice(0, 3)).toEqual(['Mua chung nhóm', 'Đổi rác lấy quà', 'Trợ lý AI 24/7']);
  });

  it('Tích điểm đơn sàn: ẩn khi cờ tắt; bật thì hiện ở nhóm Tài sản và đánh dấu chỉ Mini App (không có route web)', () => {
    expect(labels(buildAccountMenu(ctx()), 'Tài sản')).not.toContain('Tích điểm đơn sàn');
    const item = all(buildAccountMenu(ctx({ claimEnabled: true }))).find((i) => i.label === 'Tích điểm đơn sàn')!;
    expect(item.miniAppOnly).toBe(true);
    expect(item.hint).toBe('Nhập mã vận đơn Shopee, Lazada, TikTok');
    expect(labels(buildAccountMenu(ctx({ claimEnabled: true })), 'Tài sản')).toEqual(['Hạng thành viên & Điểm Xanh', 'Ví Tubu', 'Tích điểm đơn sàn']);
  });

  it('Hoàn tiền sàn ngoài chỉ hiện khi bật CASHBACK_ENABLED, giữa Cộng tác viên và đại lý', () => {
    expect(labels(buildAccountMenu(ctx()), 'Hợp tác')).not.toContain('Hoàn tiền sàn ngoài');
    expect(labels(buildAccountMenu(ctx({ cashbackEnabled: true })), 'Hợp tác')).toEqual(['Cộng tác viên', 'Hoàn tiền sàn ngoài', 'Đăng ký đại lý']);
  });

  it('khi cờ tắt, không nhãn nào nhắc "sàn ngoài"', () => {
    const text = JSON.stringify(buildAccountMenu(ctx({ role: 'ADMIN' })));
    expect(text).not.toContain('sàn ngoài');
  });
});

describe('mục đại lý và chủ nhãn đổi theo dữ liệu', () => {
  const dealerItem = (dealer: AccountMenuContext['dealer']) =>
    buildAccountMenu(ctx({ dealer })).find((g) => g.group === 'Hợp tác')!.items.find((i) => i.to === '/dai-ly')!;

  it('chưa có hồ sơ hoặc chưa tải: "Đăng ký đại lý"', () => {
    expect(dealerItem(null).label).toBe('Đăng ký đại lý');
    expect(dealerItem({ status: 'NONE', isDealer: false } as never).label).toBe('Đăng ký đại lý');
  });

  it('đã duyệt (isDealer hoặc APPROVED): "Kênh đại lý" kèm tên hạng, thiếu hạng thì mô tả bảng giá sỉ', () => {
    expect(dealerItem({ status: 'APPROVED', isDealer: true, tier: { name: 'Bạc' } } as never)).toMatchObject({ label: 'Kênh đại lý', hint: 'Bạc' });
    expect(dealerItem({ status: 'APPROVED', isDealer: false } as never)).toMatchObject({ label: 'Kênh đại lý', hint: 'Bảng giá sỉ — công nợ' });
  });

  it('đang chờ duyệt: "Hồ sơ đại lý" — "Đang chờ duyệt"', () => {
    expect(dealerItem({ status: 'PENDING', isDealer: false } as never)).toMatchObject({ label: 'Hồ sơ đại lý', hint: 'Đang chờ duyệt' });
  });

  it('chủ nhãn thấy "Quản lý nhãn hàng" kèm tên nhãn ở cuối nhóm Hợp tác; người khác thì không', () => {
    const last = buildAccountMenu(ctx({ ownedBrandName: 'Nhãn A' })).find((g) => g.group === 'Hợp tác')!.items.at(-1)!;
    expect(last).toMatchObject({ label: 'Quản lý nhãn hàng', to: '/chu-thuong-hieu', hint: 'Nhãn A' });
    expect(labels(buildAccountMenu(ctx()), 'Hợp tác')).not.toContain('Quản lý nhãn hàng');
  });
});

describe('nhóm Công việc theo vai trò', () => {
  it('STAFF: Ca làm & chấm công, Lương của tôi; không có Quản trị', () => {
    const m = buildAccountMenu(ctx({ role: 'STAFF' }));
    expect(m.at(-1)!.group).toBe('Công việc');
    expect(labels(m, 'Công việc')).toEqual(['Ca làm & chấm công', 'Lương của tôi']);
    expect(all(m).find((i) => i.label === 'Ca làm & chấm công')!.to).toBe('/nhan-vien');
    expect(all(m).find((i) => i.label === 'Lương của tôi')!.to).toBe('/nhan-vien/bang-luong');
  });

  it('ADMIN: thêm Quản trị nhân sự', () => {
    const m = buildAccountMenu(ctx({ role: 'ADMIN' }));
    expect(labels(m, 'Công việc')).toEqual(['Ca làm & chấm công', 'Lương của tôi', 'Quản trị nhân sự']);
    expect(all(m).find((i) => i.label === 'Quản trị nhân sự')!.to).toBe('/admin');
  });

  it('khách thường hoặc vai trò lạ: không có nhóm Công việc', () => {
    expect(buildAccountMenu(ctx({ role: 'CUSTOMER' })).some((g) => g.group === 'Công việc')).toBe(false);
    expect(buildAccountMenu(ctx({ role: undefined })).some((g) => g.group === 'Công việc')).toBe(false);
  });

  it('route nhân viên còn pending thì nhóm Công việc ẩn cả nhóm, nhưng /admin (đã xong) vẫn hiện cho ADMIN', () => {
    const m = buildAccountMenu(ctx({ role: 'ADMIN', isReady: (p) => p === '/admin' }));
    expect(labels(m, 'Công việc')).toEqual(['Quản trị nhân sự']);
    expect(m.some((g) => g.group === 'Công việc')).toBe(true);
    expect(buildAccountMenu(ctx({ role: 'STAFF', isReady: () => false })).some((g) => g.group === 'Công việc')).toBe(false);
  });
});

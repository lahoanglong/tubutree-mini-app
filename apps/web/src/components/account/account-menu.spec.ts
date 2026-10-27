import { describe, expect, it } from 'vitest';
import routeMap from '@tubutree/app-core/route-map.json';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { isWebRouteReady } from '@/lib/route-map';
import { buildAccountMenu, type AccountMenuContext, type AccountMenuGroup } from './account-menu';

// Chép ý profile.spec.ts và profile-hub.spec.tsx (Mini App): nhóm menu, mục theo vai trò/cờ, đại lý/chủ nhãn đổi theo dữ liệu.

const ready = () => true;
const ctx = (over: Partial<AccountMenuContext> = {}): AccountMenuContext => ({
  role: 'CUSTOMER',
  aiEnabled: false,
  chatEnabled: false,
  dealer: null,
  ownedBrandName: null,
  isReady: ready,
  ...over,
});
const labels = (menu: AccountMenuGroup[], group: string) => menu.find((g) => g.group === group)?.items.map((i) => i.label) ?? [];
const all = (menu: AccountMenuGroup[]) => menu.flatMap((g) => g.items);

describe('nhóm menu hub tài khoản', () => {
  it('CTV thấy "Cộng tác viên" (bảng điều khiển), không còn lời mời mở gian hàng', () => {
    const items = buildAccountMenu(ctx({ role: 'AFFILIATE' })).find((g) => g.group === 'Kiếm tiền cùng Tubu')!.items;
    expect(items.find((i) => i.to === '/ctv')!.label).toBe('Cộng tác viên');
    expect(items.map((i) => i.label)).not.toContain('Mở gian hàng Cộng tác viên');
  });

  it('đại lý chỉ thấy mục Cộng tác viên khi còn quyền CTV; đại lý thuần hoặc chưa biết quyền thì không có mục này', () => {
    const find = (over: Partial<AccountMenuContext>) => buildAccountMenu(ctx(over)).find((g) => g.group === 'Kiếm tiền cùng Tubu')!.items.find((i) => i.to === '/ctv');
    expect(find({ role: 'DEALER', ctvAccess: { isAffiliate: true, canRegister: false } })?.label).toBe('Cộng tác viên');
    expect(find({ role: 'DEALER', ctvAccess: { isAffiliate: false, canRegister: false } })).toBeUndefined();
    expect(find({ role: 'DEALER' })).toBeUndefined();
  });

  it('lời mời mở gian hàng không nhắc hoa hồng (chính sách Zalo)', () => {
    const entry = buildAccountMenu(ctx()).find((g) => g.group === 'Kiếm tiền cùng Tubu')!.items.find((i) => i.to === '/ctv')!;
    expect(`${entry.label} ${entry.hint}`).not.toMatch(/hoa hồng/i);
  });

  it('ba nhóm theo thứ tự Kiếm tiền cùng Tubu, Tài khoản, Hỗ trợ; khách thường không có nhóm Công việc', () => {
    expect(buildAccountMenu(ctx()).map((g) => g.group)).toEqual(['Kiếm tiền cùng Tubu', 'Tài khoản', 'Hỗ trợ']);
  });

  it('mục đúng như Mini App khi mọi route đã xong và cờ tắt', () => {
    const m = buildAccountMenu(ctx());
    expect(labels(m, 'Kiếm tiền cùng Tubu')).toEqual(['Mở gian hàng Cộng tác viên', 'Học viện Tubu', 'Đại lý']);
    expect(labels(m, 'Tài khoản')).toEqual(['Sản phẩm yêu thích', 'Sổ địa chỉ', 'Thông báo', 'Cài đặt']);
    expect(labels(m, 'Hỗ trợ')).toEqual(['Câu chuyện thương hiệu', 'Về Tubu Tree & Hỗ trợ']);
  });

  it('"Chat với Tubu Tree" chỉ hiện khi chat bật, đứng đầu nhóm Hỗ trợ và dẫn tới /ho-tro/chat', () => {
    expect(all(buildAccountMenu(ctx())).some((i) => i.to === '/ho-tro/chat')).toBe(false);
    const m = buildAccountMenu(ctx({ chatEnabled: true }));
    expect(labels(m, 'Hỗ trợ')).toEqual(['Chat với Tubu Tree', 'Câu chuyện thương hiệu', 'Về Tubu Tree & Hỗ trợ']);
    expect(all(m).find((i) => i.label === 'Chat với Tubu Tree')?.to).toBe('/ho-tro/chat');
  });

  it('Trợ lý AI 24/7 chỉ hiện khi máy chủ báo bật, nằm sau Chat', () => {
    expect(labels(buildAccountMenu(ctx()), 'Hỗ trợ')).not.toContain('Trợ lý AI 24/7');
    expect(labels(buildAccountMenu(ctx({ aiEnabled: true, chatEnabled: true })), 'Hỗ trợ').slice(0, 2)).toEqual(['Chat với Tubu Tree', 'Trợ lý AI 24/7']);
  });

  it('đích là route web của mục Mini App tương ứng', () => {
    const to = (label: string) => all(buildAccountMenu(ctx({ aiEnabled: true }))).find((i) => i.label === label)?.to;
    expect(to('Sổ địa chỉ')).toBe('/tai-khoan/dia-chi');
    expect(to('Thông báo')).toBe('/tai-khoan/thong-bao');
    expect(to('Cài đặt')).toBe('/tai-khoan/cai-dat');
    expect(to('Học viện Tubu')).toBe('/hoc-vien');
    expect(to('Trợ lý AI 24/7')).toBe('/tu-van');
  });

  it('không còn Ví, Điểm Xanh, Mua chung, Đổi rác, Tích điểm đơn sàn hay Hoàn tiền trong menu (đã chuyển sang Ưu đãi hoặc dải số liệu)', () => {
    const text = JSON.stringify(buildAccountMenu(ctx({ role: 'ADMIN', aiEnabled: true, chatEnabled: true })));
    for (const gone of ['Ví Tubu', 'Hạng thành viên', 'Mua chung', 'Đổi rác', 'Tích điểm đơn sàn', 'Hoàn tiền', 'Cộng đồng hỏi đáp']) expect(text).not.toContain(gone);
  });

  it('không trùng đích trong menu (kể cả khi bật hết cờ và đủ vai trò)', () => {
    const m = buildAccountMenu(ctx({ role: 'ADMIN', aiEnabled: true, chatEnabled: true, ownedBrandName: 'Nhãn A' }));
    const dests = all(m).map((i) => i.to);
    expect(new Set(dests).size).toBe(dests.length);
  });

  it('mọi đích web đều có trong route map (tránh link tới route không tồn tại)', () => {
    const webPaths = new Set(
      (routeMap.routes as { items: { web?: string }[] }[]).flatMap((g) => g.items).flatMap((i) => (i.web ? [i.web.split('?')[0]!] : [])),
    );
    const m = buildAccountMenu(ctx({ role: 'ADMIN', aiEnabled: true, chatEnabled: true, ownedBrandName: 'Nhãn A' }));
    for (const item of all(m)) expect(webPaths.has(item.to), item.to).toBe(true);
  });

  it('mục trỏ route còn pending thì ẩn; route xong thì hiện', () => {
    const m = buildAccountMenu(ctx({ isReady: (p) => p === '/tai-khoan/dia-chi' }));
    expect(labels(m, 'Tài khoản')).toEqual(['Sổ địa chỉ']);
    expect(m.map((g) => g.group)).toEqual(['Tài khoản']);
  });
});

describe('mục đại lý và chủ nhãn đổi theo dữ liệu', () => {
  const dealerItem = (dealer: AccountMenuContext['dealer']) =>
    buildAccountMenu(ctx({ dealer })).find((g) => g.group === 'Kiếm tiền cùng Tubu')!.items.find((i) => i.to === '/dai-ly')!;

  it('chưa có hồ sơ hoặc chưa tải: "Đăng ký đại lý"', () => {
    expect(dealerItem(null).label).toBe(homeCopy.earn.dealer.label);
    expect(dealerItem({ status: 'NONE', isDealer: false } as never).label).toBe(homeCopy.earn.dealer.label);
  });

  it('đã duyệt (isDealer hoặc APPROVED): "Kênh đại lý" kèm tên hạng, thiếu hạng thì mô tả bảng giá sỉ', () => {
    expect(dealerItem({ status: 'APPROVED', isDealer: true, tier: { name: 'Bạc' } } as never)).toMatchObject({ label: 'Kênh đại lý', hint: 'Bạc' });
    expect(dealerItem({ status: 'APPROVED', isDealer: false } as never)).toMatchObject({ label: 'Kênh đại lý', hint: homeCopy.earn.dealer.hint });
  });

  it('đang chờ duyệt: "Hồ sơ đại lý" — "Đang chờ duyệt"', () => {
    expect(dealerItem({ status: 'PENDING', isDealer: false } as never)).toMatchObject({ label: 'Hồ sơ đại lý', hint: 'Đang chờ duyệt' });
  });

  it('chủ nhãn thấy "Quản lý nhãn hàng" kèm tên nhãn ở cuối nhóm Hợp tác; người khác thì không', () => {
    const last = buildAccountMenu(ctx({ ownedBrandName: 'Nhãn A' })).find((g) => g.group === 'Kiếm tiền cùng Tubu')!.items.at(-1)!;
    expect(last).toMatchObject({ label: 'Quản lý nhãn hàng', to: '/chu-thuong-hieu', hint: 'Nhãn A' });
    expect(labels(buildAccountMenu(ctx()), 'Kiếm tiền cùng Tubu')).not.toContain('Quản lý nhãn hàng');
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

describe('với route map thật (sau khi lane pro và recycle gộp)', () => {
  const real = { isReady: isWebRouteReady };

  it('đại lý, chủ nhãn, nhân viên và Học viện có lối vào như Mini App (profile.tsx)', () => {
    const m = buildAccountMenu(ctx({ ...real, role: 'ADMIN', ownedBrandName: 'Nhãn A', ctvAccess: { isAffiliate: true } }));
    const to = all(m).map((i) => i.to);
    expect(to).toEqual(expect.arrayContaining(['/ctv', '/dai-ly', '/chu-thuong-hieu', '/nhan-vien', '/nhan-vien/bang-luong', '/admin', '/hoc-vien']));
  });

  it('admin/nhân viên chưa có kết quả /affiliate/me (đang tải, lỗi, 401): mục Cộng tác viên ẩn, không đổi chữ', () => {
    for (const role of ['ADMIN', 'STAFF', 'DEALER']) {
      expect(all(buildAccountMenu(ctx({ ...real, role }))).map((i) => i.to)).not.toContain('/ctv');
    }
  });

  it('khách thường chưa có nhãn: không thấy màn nội bộ', () => {
    const to = all(buildAccountMenu(ctx(real))).map((i) => i.to);
    expect(to).toContain('/dai-ly');
    expect(to).not.toContain('/chu-thuong-hieu');
    expect(to).not.toContain('/nhan-vien');
    expect(to).not.toContain('/admin');
  });
});

describe('lối vào Hoàn tiền sàn ngoài theo cờ CASHBACK_ENABLED', () => {
  it('cờ bật: mục nằm ở nhóm Tài khoản, sau Thông báo, trỏ /hoan-tien', () => {
    const items = buildAccountMenu(ctx({ cashbackEnabled: true })).find((g) => g.group === 'Tài khoản')!.items;
    expect(items.map((i) => i.label)).toEqual(['Sản phẩm yêu thích', 'Sổ địa chỉ', 'Thông báo', 'Hoàn tiền sàn ngoài', 'Cài đặt']);
    expect(items.find((i) => i.label === 'Hoàn tiền sàn ngoài')!.to).toBe('/hoan-tien');
  });

  it('cờ tắt hoặc không truyền: không có mục', () => {
    expect(all(buildAccountMenu(ctx({ cashbackEnabled: false }))).map((i) => i.to)).not.toContain('/hoan-tien');
    expect(all(buildAccountMenu(ctx())).map((i) => i.to)).not.toContain('/hoan-tien');
  });

  it('route /hoan-tien có thật trong route map (mục không bị ẩn khi bật cờ)', () => {
    expect(isWebRouteReady('/hoan-tien')).toBe(true);
  });
});

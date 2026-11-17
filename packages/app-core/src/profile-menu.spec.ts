import { describe, expect, it } from 'vitest';
import routeMap from './route-map.json';
import { buildProfileMenu, hasPartnerRole, PROFILE_ORDER_ROW, type ProfileMenuContext, type ProfileMenuRow } from './profile-menu';

const ctx = (over: Partial<ProfileMenuContext> = {}): ProfileMenuContext => ({
  role: 'CUSTOMER',
  chatEnabled: true,
  aiEnabled: true,
  wasteEnabled: true,
  recycleOpenRequests: false,
  badgesEnabled: false,
  hasReferralCode: true,
  couponCount: 2,
  dealer: null,
  ownedBrandName: null,
  ...over,
});
const keys = (rows: ProfileMenuRow[]) => rows.map((r) => r.key);
const row = (rows: ProfileMenuRow[], key: string) => rows.find((r) => r.key === key);
const children = (rows: ProfileMenuRow[], key: string) => {
  const r = row(rows, key);
  return r?.kind === 'accordion' ? r.children : [];
};

describe('dòng của trang Cá nhân', () => {
  it('khách thường, đổi rác bật: đúng bảy dòng theo thứ tự, không có dòng đối tác', () => {
    const rows = buildProfileMenu(ctx());
    expect(keys(rows)).toEqual(['offers', 'invite', 'addresses', 'wishlist', 'recycle', 'support', 'settings']);
    expect(rows.map((r) => r.label)).toEqual(['Ưu đãi & quà', 'Mời bạn nhận quà', 'Sổ địa chỉ', 'Sản phẩm yêu thích', 'Đổi rác lấy quà', 'Hỗ trợ', 'Cài đặt']);
  });

  it('Mời bạn và Hỗ trợ là dòng mở tại chỗ; còn lại là liên kết có đích Mini và web', () => {
    const rows = buildProfileMenu(ctx());
    expect(rows.filter((r) => r.kind === 'accordion').map((r) => r.key)).toEqual(['invite', 'support']);
    const links = Object.fromEntries(rows.flatMap((r) => (r.kind === 'link' ? [[r.key, [r.mini, r.web]]] : [])));
    expect(links).toEqual({
      offers: ['/offers', '/uu-dai'],
      addresses: ['/addresses', '/tai-khoan/dia-chi'],
      wishlist: ['/wishlist', '/tai-khoan/yeu-thich'],
      recycle: ['/recycle', '/doi-rac'],
      settings: ['/settings', '/tai-khoan/cai-dat'],
    });
  });

  it('không có Hoàn tiền sàn ngoài, Đơn hàng, Ví, Điểm Xanh trong danh sách (đã có ô số dư, hàng đơn); Thông báo chỉ khi có tin chưa đọc', () => {
    const rows = buildProfileMenu(ctx({ role: 'ADMIN', ownedBrandName: 'Nhãn A', deskPointNames: ['Kho'], unreadNotifications: 0 }));
    const dests = rows.flatMap((r) => (r.kind === 'link' ? [r.mini, r.web] : r.children.flatMap((c) => [c.mini, c.web])));
    for (const gone of ['/notifications', '/tai-khoan/thong-bao', '/cashback', '/hoan-tien', '/orders', '/wallet', '/loyalty']) expect(dests).not.toContain(gone);
  });

  it('có thông báo chưa đọc: dòng Thông báo đứng đầu, gợi ý nêu số tin (chấm nhắc ở tab Cá nhân trỏ tới đây)', () => {
    const rows = buildProfileMenu(ctx({ unreadNotifications: 3 }));
    expect(keys(rows)).toEqual(['notifications', 'offers', 'invite', 'addresses', 'wishlist', 'recycle', 'support', 'settings']);
    expect(rows[0]).toEqual({ kind: 'link', key: 'notifications', label: 'Thông báo', hint: '3 thông báo chưa đọc', mini: '/notifications', web: '/tai-khoan/thong-bao' });
    expect(keys(buildProfileMenu(ctx({ unreadNotifications: undefined })))).not.toContain('notifications');
  });

  it('không có mã giới thiệu: không có dòng Mời bạn', () => {
    expect(keys(buildProfileMenu(ctx({ hasReferralCode: false })))).not.toContain('invite');
  });

  it('Ưu đãi & quà: gợi ý nêu số mã khi đã tải và lớn hơn 0; chưa tải hoặc không có mã thì gợi ý tĩnh', () => {
    expect(row(buildProfileMenu(ctx({ couponCount: 3 })), 'offers')!.hint).toBe('3 mã giảm giá đang có');
    expect(row(buildProfileMenu(ctx({ couponCount: 0 })), 'offers')!.hint).toBe('Mã giảm giá và đổi quà');
    expect(row(buildProfileMenu(ctx({ couponCount: undefined })), 'offers')!.hint).toBe('Mã giảm giá và đổi quà');
  });
});

describe('dòng Đổi rác theo chương trình', () => {
  it('chương trình bật: "Đổi rác lấy quà" mở /recycle (web /doi-rac)', () => {
    expect(row(buildProfileMenu(ctx()), 'recycle')).toMatchObject({ label: 'Đổi rác lấy quà', mini: '/recycle', web: '/doi-rac' });
  });

  it('chương trình tạm dừng mà còn yêu cầu mở: "Yêu cầu của tôi" kèm gợi ý tạm dừng', () => {
    expect(row(buildProfileMenu(ctx({ wasteEnabled: false, recycleOpenRequests: true })), 'recycle')).toMatchObject({
      label: 'Yêu cầu của tôi',
      hint: 'Chương trình đang tạm dừng, xem yêu cầu còn mở',
      mini: '/recycle',
    });
  });

  it('chương trình tắt và không còn yêu cầu: không có dòng', () => {
    expect(keys(buildProfileMenu(ctx({ wasteEnabled: false })))).not.toContain('recycle');
  });
});

describe('dòng Hỗ trợ', () => {
  it('mở ra: Chat, Trợ lý AI, Về Tubu Tree & Hỗ trợ, Câu chuyện thương hiệu', () => {
    const items = children(buildProfileMenu(ctx()), 'support');
    expect(items.map((i) => i.label)).toEqual(['Chat với Tubu Tree', 'Trợ lý AI 24/7', 'Về Tubu Tree & Hỗ trợ', 'Câu chuyện thương hiệu']);
    expect(items.map((i) => [i.mini, i.web])).toEqual([
      ['/chat', '/ho-tro/chat'],
      ['/ai-advisor', '/tu-van'],
      ['/about', '/gioi-thieu'],
      ['/brand-story', '/cau-chuyen'],
    ]);
  });

  it('chat tắt, AI tắt: chỉ còn hai mục giới thiệu; hàng huy hiệu bật thì bỏ Câu chuyện thương hiệu', () => {
    expect(children(buildProfileMenu(ctx({ chatEnabled: false, aiEnabled: false })), 'support').map((i) => i.key)).toEqual(['about', 'brandStory']);
    expect(children(buildProfileMenu(ctx({ badgesEnabled: true })), 'support').map((i) => i.key)).toEqual(['chat', 'ai', 'about']);
  });
});

describe('dòng Dành cho đối tác', () => {
  it('khách thường không hồ sơ nào: không có dòng (lối Đăng ký CTV/Đại lý ở sheet Kiếm tiền Trang chủ)', () => {
    expect(hasPartnerRole(ctx())).toBe(false);
    expect(keys(buildProfileMenu(ctx({ dealer: { isDealer: false, status: 'NONE' } })))).not.toContain('partner');
    expect(keys(buildProfileMenu(ctx({ dealer: { isDealer: false, status: 'REJECTED' } })))).not.toContain('partner');
  });

  it.each([
    ['CTV', { role: 'AFFILIATE' }],
    ['đại lý', { role: 'DEALER' }],
    ['nhân viên', { role: 'STAFF' }],
    ['quản trị', { role: 'ADMIN' }],
    ['khách có hồ sơ đại lý chờ duyệt', { dealer: { isDealer: false, status: 'PENDING' } }],
    ['khách có hồ sơ đại lý đã duyệt', { dealer: { isDealer: false, status: 'APPROVED' } }],
    ['khách là đại lý (isDealer)', { dealer: { isDealer: true, status: null } }],
    ['khách sở hữu nhãn hàng', { ownedBrandName: 'Nhãn A' }],
    ['nhân viên điểm đối tác mang vai CUSTOMER', { deskPointNames: ['Đại lý An Phát'] }],
  ] as [string, Partial<ProfileMenuContext>][])('%s: có một dòng "Dành cho đối tác" ở cuối', (_n, over) => {
    const rows = buildProfileMenu(ctx(over));
    expect(rows.at(-1)).toMatchObject({ kind: 'accordion', key: 'partner', label: 'Dành cho đối tác' });
    expect(rows.filter((r) => r.key === 'partner')).toHaveLength(1);
  });

  it('CTV: Cộng tác viên, Học viện, Đại lý (đúng nhãn, gợi ý, đích cũ)', () => {
    const items = children(buildProfileMenu(ctx({ role: 'AFFILIATE' })), 'partner');
    expect(items.map((i) => [i.label, i.mini, i.web])).toEqual([
      ['Cộng tác viên', '/affiliate', '/ctv'],
      ['Học viện Tubu', '/academy', '/hoc-vien'],
      ['Đại lý', '/dealer', '/dai-ly'],
    ]);
  });

  it('khách có hồ sơ đại lý chờ duyệt: lời mời mở gian hàng CTV (không nhắc hoa hồng), "Hồ sơ đại lý — Đang chờ duyệt"; không có Học viện', () => {
    const items = children(buildProfileMenu(ctx({ dealer: { isDealer: false, status: 'PENDING' } })), 'partner');
    expect(items.map((i) => i.label)).toEqual(['Mở gian hàng Cộng tác viên', 'Hồ sơ đại lý']);
    expect(items[1]!.hint).toBe('Đang chờ duyệt');
    expect(items.map((i) => `${i.label} ${i.hint ?? ''}`).join(' ')).not.toMatch(/hoa hồng/i);
  });

  it('đại lý đã duyệt: "Kênh đại lý" kèm tên hạng; thiếu hạng thì mô tả bảng giá sỉ', () => {
    const dealer = (d: ProfileMenuContext['dealer']) => children(buildProfileMenu(ctx({ role: 'DEALER', dealer: d })), 'partner').find((i) => i.key === 'dealer');
    expect(dealer({ isDealer: true, status: 'APPROVED', tier: { name: 'Bạc' } })).toMatchObject({ label: 'Kênh đại lý', hint: 'Bạc' });
    expect(dealer({ isDealer: false, status: 'APPROVED' })).toMatchObject({ label: 'Kênh đại lý', hint: 'Bảng giá sỉ, công nợ' });
  });

  it('đại lý thuần (chưa biết quyền CTV hoặc không có): không có mục Cộng tác viên; còn quyền CTV thì có', () => {
    const has = (over: Partial<ProfileMenuContext>) => children(buildProfileMenu(ctx({ role: 'DEALER', ...over })), 'partner').some((i) => i.key === 'ctv');
    expect(has({})).toBe(false);
    expect(has({ ctvAccess: { isAffiliate: false, canRegister: false } })).toBe(false);
    expect(has({ ctvAccess: { isAffiliate: true } })).toBe(true);
  });

  it('ADMIN có điểm và nhãn: thứ tự Học viện, Đại lý, Chủ thương hiệu, Ca làm, Lương, Nhận hàng tại điểm, Quản trị nhân sự', () => {
    const items = children(buildProfileMenu(ctx({ role: 'ADMIN', ownedBrandName: 'Nhãn A', deskPointNames: ['Kho Tubu HCMC', 'Đại lý An Phát'] })), 'partner');
    expect(items.map((i) => i.key)).toEqual(['academy', 'dealer', 'brandOwner', 'staff', 'payroll', 'desk', 'admin']);
    expect(items.find((i) => i.key === 'brandOwner')).toMatchObject({ label: 'Quản lý thương hiệu', hint: 'Nhãn A', mini: '/brand-owner', web: '/chu-thuong-hieu' });
    expect(items.find((i) => i.key === 'desk')).toMatchObject({ label: 'Nhận hàng tại điểm', hint: 'Kho Tubu HCMC, Đại lý An Phát', mini: '/recycle/desk', web: '/doi-rac/quay' });
    expect(items.find((i) => i.key === 'admin')).toMatchObject({ label: 'Quản trị nhân sự', mini: '/admin', web: '/admin?tab=staffRoster' });
    expect(items.find((i) => i.key === 'staff')).toMatchObject({ label: 'Ca làm & chấm công', mini: '/staff', web: '/nhan-vien' });
    expect(items.find((i) => i.key === 'payroll')).toMatchObject({ label: 'Lương của tôi', mini: '/my-payroll', web: '/nhan-vien/bang-luong' });
  });

  it('STAFF: Ca làm và Lương, không có Quản trị', () => {
    const items = children(buildProfileMenu(ctx({ role: 'STAFF' })), 'partner');
    expect(items.map((i) => i.key)).toEqual(['academy', 'dealer', 'staff', 'payroll']);
  });
});

describe('đích và hàng đơn', () => {
  const all = buildProfileMenu(ctx({ role: 'ADMIN', ownedBrandName: 'Nhãn A', deskPointNames: ['Kho'], ctvAccess: { isAffiliate: true }, unreadNotifications: 2 }));
  const links = all.flatMap((r) => (r.kind === 'link' ? [{ mini: r.mini, web: r.web }] : r.children));

  it('không trùng đích (kể cả bật hết cờ, đủ vai trò)', () => {
    expect(new Set(links.map((l) => l.mini)).size).toBe(links.length);
    expect(new Set(links.map((l) => l.web)).size).toBe(links.length);
  });

  it('mọi đích Mini và web đều có trong route map', () => {
    const items = (routeMap.routes as { items: { miniapp?: string; web?: string }[] }[]).flatMap((g) => g.items);
    const mini = new Set(items.flatMap((i) => (i.miniapp ? [i.miniapp] : [])));
    const web = new Set(items.flatMap((i) => (i.web ? [i.web.split('?')[0]!] : [])));
    for (const l of links) {
      expect(mini.has(l.mini), l.mini).toBe(true);
      expect(web.has(l.web.split('?')[0]!), l.web).toBe(true);
    }
  });

  it('hàng đơn bốn ô, không có Định kỳ', () => {
    expect(PROFILE_ORDER_ROW.map((r) => r.key)).toEqual(['pending_payment', 'processing', 'shipping', 'delivered']);
  });
});

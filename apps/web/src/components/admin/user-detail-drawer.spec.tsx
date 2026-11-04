// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { UserDetailDrawer } from './user-detail-drawer';
import { answerAsk, answerConfirm, byText, click, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminUserDetail } from '@/lib/admin-client';
import type { WasteUserFlagsDTO } from '@tubutree/shared-types';

const NO_FLAGS: WasteUserFlagsDTO = { userId: 'u1', shipLockedAt: null, shipUnlockedAt: null, blockedAt: null, reason: null, setByUserId: null, updatedAt: null };
const calls: { url: string; init?: RequestInit }[] = [];

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  calls.length = 0;
  vi.unstubAllGlobals();
});

const DETAIL: AdminUserDetail = {
  user: {
    id: 'u1',
    fullName: 'Nguyễn Văn An',
    phone: '0944444444',
    email: null,
    role: 'CUSTOMER',
    staffPermissions: [],
    referralCode: null,
    pointsBalance: 55,
    pointsConvertedBalance: 0,
    walletBalance: 220000,
    isBlocked: false,
    blockedAt: null,
    blockedReason: null,
    affiliateRevokedAt: null,
    createdAt: '2026-09-01T03:00:00.000Z',
    tier: null,
  },
  orders: { items: [], total: 0 },
  wallet: [
    { id: 'w1', delta: 220000, balanceAfter: 220000, type: 'ORDER_REFUND', refType: 'ORDER', refId: 'o1', reason: 'Hoàn tiền trả hàng đơn TUBU2026101538731', createdAt: '2026-10-15T03:00:00.000Z' },
    { id: 'w2', delta: -50000, balanceAfter: 170000, type: 'WITHDRAW', refType: null, refId: null, reason: null, createdAt: '2026-10-15T04:00:00.000Z' },
  ],
  points: [
    { id: 'p1', delta: -22, reason: 'RETURN_REVERSED:TUBU2026101538731', refType: 'ORDER', refId: 'o1', lot: 'STANDARD', expiresAt: null, createdAt: '2026-10-15T03:00:00.000Z' },
    { id: 'p2', delta: 24, reason: 'ORDER_DELIVERED:TUBU2026101546241', refType: 'ORDER', refId: 'o2', lot: 'STANDARD', expiresAt: '2027-10-15T03:00:00.000Z', createdAt: '2026-10-14T03:00:00.000Z' },
    { id: 'p3', delta: 5, reason: 'MERGED:guest-1:STOREFRONT_QUEST:PROFILE', refType: 'QUEST', refId: null, lot: 'STANDARD', expiresAt: null, createdAt: '2026-10-13T03:00:00.000Z' },
    { id: 'p4', delta: 1, reason: 'MAI_MOI_LA:abc', refType: null, refId: null, lot: 'STANDARD', expiresAt: null, createdAt: '2026-10-12T03:00:00.000Z' },
  ],
  roleHistory: [],
  blockHistory: [],
  grants: [],
};

async function open(
  detail: AdminUserDetail = DETAIL,
  flags: WasteUserFlagsDTO = NO_FLAGS,
  isAdmin = true,
  nav: { onOpenOrder?: (code: string) => void; onOpenUserOrders?: (id: string, label: string) => void } = {},
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(url.includes('/admin/waste/users/') ? flags : detail), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  const r = render(<UserDetailDrawer userId="u1" isAdmin={isAdmin} onClose={() => undefined} {...nav} />);
  mounted.push(r);
  await flush();
  return document.body;
}

describe('UserDetailDrawer — dấu thu hồi quyền CTV (A2)', () => {
  it('có dấu: hiện câu cố định, ngày theo giờ Việt Nam (17h UTC đã sang ngày hôm sau)', async () => {
    const body = await open({ ...DETAIL, user: { ...DETAIL.user, affiliateRevokedAt: '2026-10-20T18:00:00.000Z' } });
    expect(section(body, 'Hồ sơ').textContent).toContain(
      'Đã thu hồi quyền CTV ngày 21/10/2026. Hoa hồng cũ bị giữ; đổi vai trò sang CTV hoặc Đại lý để cấp lại.',
    );
  });
  it('không dấu: không hiện', async () => {
    const body = await open();
    expect(body.textContent).not.toContain('Đã thu hồi quyền CTV');
  });
});

describe('UserDetailDrawer — huỷ hoa hồng chờ rút của CTV bị thu hồi (A3)', () => {
  const REVOKED = { ...DETAIL, user: { ...DETAIL.user, affiliateRevokedAt: '2026-10-20T18:00:00.000Z' }, forfeitableCommission: { count: 2, amount: 100000 } };
  const forfeitCall = () => calls.find((c) => c.url.includes('/admin/users/u1/forfeit-commissions'));

  it('admin thấy nút khi có dấu và còn hoa hồng; không có dấu, không còn khoản, hoặc không phải admin thì không thấy', async () => {
    expect(byText(await open(REVOKED), 'button', 'Huỷ hoa hồng chờ rút')).not.toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    expect(byText(await open({ ...REVOKED, forfeitableCommission: null }), 'button', 'Huỷ hoa hồng chờ rút')).toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    expect(byText(await open(DETAIL), 'button', 'Huỷ hoa hồng chờ rút')).toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    expect(byText(await open(REVOKED, NO_FLAGS, false), 'button', 'Huỷ hoa hồng chờ rút')).toBeNull();
  });

  it('bấm nút nêu số khoản và số tiền, bắt buộc lý do rồi gửi POST kèm lý do', async () => {
    const body = await open(REVOKED);
    click(byText(body, 'button', 'Huỷ hoa hồng chờ rút'));
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('2 khoản');
    expect(dialog.textContent).toContain('100.000');
    answerConfirm(true);
    await flush();
    expect(forfeitCall()).toBeUndefined();
    typeInto(document.querySelector('[role="alertdialog"] textarea'), 'Quyết định của quản lý');
    answerConfirm(true);
    await flush();
    expect(forfeitCall()!.init!.method).toBe('POST');
    expect(JSON.parse(String(forfeitCall()!.init!.body))).toEqual({ reason: 'Quyết định của quản lý' });
  });
});

const section = (root: HTMLElement, title: string) => root.querySelector(`section[aria-label="${title}"]`)!;

describe('UserDetailDrawer — sổ Điểm Xanh và sổ ví đọc được bằng tiếng Việt (R5-ADMIN-4)', () => {
  it('Điểm Xanh: nhãn tiếng Việt kèm mã đơn, không còn mã kỹ thuật ORDER_DELIVERED:… / RETURN_REVERSED:…', async () => {
    const body = await open();
    const text = section(body, 'Điểm Xanh').textContent ?? '';
    expect(text).toContain('Thu hồi điểm của đơn trả hàng · TUBU2026101538731');
    expect(text).toContain('Tích điểm từ đơn hàng · TUBU2026101546241');
    expect(text).toContain('Thưởng nhiệm vụ gian hàng');
    expect(text).not.toMatch(/ORDER_DELIVERED|RETURN_REVERSED|STOREFRONT_QUEST|MERGED/);
  });

  it('mã chưa biết hiện nhãn chung, không lộ mã; số điểm và hạn vẫn đúng', async () => {
    const body = await open();
    const text = section(body, 'Điểm Xanh').textContent ?? '';
    expect(text).toContain('Điều chỉnh Điểm Xanh');
    expect(text).not.toContain('MAI_MOI_LA');
    expect(text).toContain('-22');
    expect(text).toContain('+24');
    expect(text).toContain('hết hạn');
  });

  it('Sổ ví: lý do tiếng Việt giữ nguyên; dòng không có lý do hiện nhãn theo loại thay vì mã WITHDRAW', async () => {
    const body = await open();
    const text = section(body, 'Sổ ví').textContent ?? '';
    expect(text).toContain('Hoàn tiền trả hàng đơn TUBU2026101538731');
    expect(text).toContain('Rút về ngân hàng');
    expect(text).not.toContain('WITHDRAW');
  });

  it('Ví âm sau khi thu hồi hoa hồng đơn trả: số dư có dấu trừ, dòng sổ hiện nhãn tiếng Việt thay vì mã COMMISSION_REVERSAL', async () => {
    const body = await open({
      ...DETAIL,
      user: { ...DETAIL.user, walletBalance: -50000 },
      wallet: [
        { id: 'w3', delta: -50000, balanceAfter: -50000, type: 'COMMISSION_REVERSAL', refType: 'COMMISSION', refId: 'c1', reason: 'Thu hồi hoa hồng đơn TUBU2026101538731 (trả hàng)', createdAt: '2026-10-29T03:00:00.000Z' },
      ],
    });
    expect(section(body, 'Hồ sơ').textContent).toContain('-50.000đ');
    const text = section(body, 'Sổ ví').textContent ?? '';
    expect(text).toContain('Thu hồi hoa hồng đơn TUBU2026101538731');
    expect(text).not.toContain('COMMISSION_REVERSAL');
  });

  it('nhãn dài kèm mã đơn ngắt dòng trong ô của nó, số điểm/số tiền luôn nằm bên phải (không rớt xuống dòng dưới)', async () => {
    const body = await open();
    for (const title of ['Điểm Xanh', 'Sổ ví']) {
      const rows = [...section(body, title).querySelectorAll('li')];
      expect(rows.length).toBeGreaterThan(0);
      for (const li of rows) {
        expect(li.className).not.toContain('flex-wrap');
        expect(li.children[0]!.className).toContain('min-w-0 flex-1 break-words');
        expect(li.children[1]!.className).toContain('shrink-0');
      }
    }
  });
});

describe('UserDetailDrawer — lịch sử xuất file (L1-07)', () => {
  const X = [{ id: 'x1', route: 'exports/tax', filters: { from: '2026-10-01', to: '2026-10-31' }, rowCount: 1234, createdAt: '2026-11-02T03:00:00.000Z' }];

  it('có dữ liệu thì hiện "20 lần xuất gần nhất" với tên file, số dòng, bộ lọc', async () => {
    const text = section(await open({ ...DETAIL, recentExports: X }), '20 lần xuất gần nhất').textContent ?? '';
    expect(text).toContain('Xuất thuế TNCN CTV');
    expect(text).toContain('1234 dòng');
    expect(text).toContain('from: 2026-10-01');
  });

  it('không có dữ liệu (CSKH nhận null) thì không hiện mục', async () => {
    const body = await open({ ...DETAIL, recentExports: null });
    expect(body.textContent).not.toContain('lần xuất gần nhất');
  });
});

describe('UserDetailDrawer — lịch sử gian hàng đối tác', () => {
  const ev = (id: string, from: string, to: string, createdAt: string) => ({
    id, kind: 'STOREFRONT_PARTNER' as const, fromValue: from, toValue: to, reason: 'sf-9', actorId: 'a1', actorName: 'Quản trị An', createdAt,
  });

  it('hiện "Gian hàng đối tác: Bật → Tắt" kèm người làm, giờ và gian hàng; không lộ true/false', async () => {
    const body = await open({ ...DETAIL, partnerHistory: [ev('e2', 'true', 'false', '2026-10-16T03:00:00.000Z'), ev('e1', 'false', 'true', '2026-10-15T03:00:00.000Z')] });
    const sec = section(body, 'Gian hàng đối tác');
    const text = sec.textContent ?? '';
    expect(text).toContain('Gian hàng đối tác: Tắt → Bật');
    expect(text).toContain('Gian hàng đối tác: Bật → Tắt');
    expect(text).toContain('Quản trị An');
    expect(text).toContain('gian hàng sf-9');
    expect(text).not.toMatch(/true|false/);
  });

  it('dòng admin bật tay không lộ dấu nội bộ ADMIN_TOGGLE', async () => {
    const marked = { ...ev('e1', 'false', 'true', '2026-10-15T03:00:00.000Z'), reason: 'sf-9:ADMIN_TOGGLE' };
    const body = await open({ ...DETAIL, partnerHistory: [marked] });
    const text = section(body, 'Gian hàng đối tác').textContent ?? '';
    expect(text).toContain('gian hàng sf-9 · admin bật tay');
    expect(text).not.toContain('ADMIN_TOGGLE');
  });

  it('không có dòng nào thì không hiện mục', async () => {
    const body = await open();
    expect(body.querySelector('section[aria-label^="Gian hàng đối tác"]')).toBeNull();
  });
});

describe('UserDetailDrawer — lời mời quyền theo SĐT hết hạn', () => {
  const grant = (over: Record<string, unknown>) => ({
    id: 'g1', role: 'STAFF', grantedBy: 'a1', grantedByName: 'Admin', note: null, revokedAt: null, expiresAt: null, createdAt: '2026-10-20T03:00:00.000Z', ...over,
  });
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();

  it('lời mời có hạn đã qua mà chưa thu hồi hiện "đã hết hạn"; chưa tới hạn, không hạn, hoặc đã thu hồi thì không', async () => {
    const text = async (g: Record<string, unknown>) => {
      const body = await open({ ...DETAIL, grants: [grant(g)] } as AdminUserDetail);
      return body.textContent ?? '';
    };
    expect(await text({ expiresAt: past })).toContain('đã hết hạn');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    expect(await text({ expiresAt: future })).not.toContain('đã hết hạn');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    expect(await text({ expiresAt: null })).not.toContain('đã hết hạn');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    const revoked = await text({ expiresAt: past, revokedAt: past });
    expect(revoked).toContain('đã thu hồi');
    expect(revoked).not.toContain('đã hết hạn');
  });
});

describe('UserDetailDrawer — nhóm việc nhân viên (D1-05)', () => {
  it('ADMIN chọn được cả 4 nhóm (CSKH, Kho, Marketing, Kế toán); lưu gửi đúng tập nhóm đã tick', async () => {
    const staff: AdminUserDetail = { ...DETAIL, user: { ...DETAIL.user, role: 'STAFF', staffPermissions: ['KE_TOAN'] } };
    const api = mockFetch({
      '/staff-permissions': { body: { id: 'u1', staffPermissions: ['MARKETING', 'KE_TOAN'], changed: true } },
      '/admin/users/u1/detail': { body: staff },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    mounted.push(render(<UserDetailDrawer userId="u1" isAdmin onClose={() => undefined} />));
    await flush();
    const form = section(document.body, 'Nhóm việc nhân viên');
    const boxes = Array.from(form.querySelectorAll<HTMLLabelElement>('label')).filter((l) => l.querySelector('input[type="checkbox"]'));
    expect(boxes.map((l) => l.textContent?.split(' — ')[0])).toEqual(['CSKH', 'Kho', 'Marketing', 'Kế toán']);
    const box = (name: string) => boxes.find((l) => l.textContent?.startsWith(name))!.querySelector('input')!;
    expect(box('Kế toán').checked).toBe(true);
    expect(box('Marketing').checked).toBe(false);
    click(box('Marketing'));
    click(byText(form, 'button', 'Lưu nhóm việc'));
    await flush();
    expect(api.calls.find((c) => c.url.includes('/staff-permissions'))).toBeUndefined();
    answerAsk('Chuyển sang marketing');
    await flush();
    const put = api.calls.find((c) => c.url.includes('/staff-permissions'))!;
    expect(put.init!.method).toBe('PUT');
    const sent = JSON.parse(String(put.init!.body));
    expect(sent.permissions.sort()).toEqual(['KE_TOAN', 'MARKETING']);
    expect(sent.reason).toBe('Chuyển sang marketing');
  });
});

describe('UserDetailDrawer — Đổi rác (15.4)', () => {
  const putBody = () => {
    const put = calls.find((c) => c.url.includes('/admin/waste/users/u1/flags') && c.init?.method === 'PUT')!;
    return JSON.parse(String(put.init!.body));
  };
  const answerWithReason = async (reason: string) => {
    typeInto(document.querySelector('[role="alertdialog"] textarea'), reason);
    answerConfirm(true);
    await flush();
  };

  it('câu nhóm việc nhân viên không còn nhắc đổi vỏ chai', async () => {
    const body = await open({ ...DETAIL, user: { ...DETAIL.user, role: 'STAFF' } });
    const text = body.textContent ?? '';
    expect(text).toContain('Không chọn nhóm nào: nhân viên chỉ dùng quầy thu ngân, tab Đổi rác (hàng đợi kho, quà chờ nhận) và chấm công.');
    expect(text).not.toMatch(/đổi vỏ chai/i);
  });

  it('admin có link xem yêu cầu đổi rác của khách', async () => {
    const body = await open();
    const a = body.querySelector<HTMLAnchorElement>('a[href="/admin?tab=waste&wasteUser=u1"]')!;
    expect(a.textContent).toBe('Xem yêu cầu đổi rác của khách');
  });

  it('khoá đổi rác hỏi lý do rồi gửi PUT flags', async () => {
    const body = await open();
    click(byText(section(body, 'Đổi rác'), 'button', 'Khoá đổi rác'));
    await answerWithReason('Gian lận số lượng');
    expect(putBody()).toEqual({ blocked: true, reason: 'Gian lận số lượng' });
  });

  it('đang khoá gửi kho: hiện thời điểm khoá và nút mở khoá', async () => {
    const body = await open(DETAIL, { ...NO_FLAGS, shipLockedAt: '2026-10-12T03:00:00.000Z', reason: 'Thiếu 3 lần liền' });
    const text = section(body, 'Đổi rác').textContent ?? '';
    expect(text).toContain('Đang khoá gửi kho và thu kèm đơn từ 10:00 12/10/2026');
    expect(text).toContain('Thiếu 3 lần liền');
    click(byText(section(body, 'Đổi rác'), 'button', 'Mở khoá gửi kho'));
    await answerWithReason('Đã xác minh');
    expect(putBody()).toEqual({ shipLocked: false, reason: 'Đã xác minh' });
  });

  it('đang khoá đổi rác: nút Mở khoá đổi rác', async () => {
    const body = await open(DETAIL, { ...NO_FLAGS, blockedAt: '2026-10-12T03:00:00.000Z' });
    expect(section(body, 'Đổi rác').textContent).toContain('Đang khoá đổi rác từ 10:00 12/10/2026');
    click(byText(section(body, 'Đổi rác'), 'button', 'Mở khoá đổi rác'));
    await answerWithReason('Đã làm rõ');
    expect(putBody()).toEqual({ blocked: false, reason: 'Đã làm rõ' });
  });

  it('khoá hoặc mở khoá làm mới cả danh sách yêu cầu đổi rác và hộp việc cần xử lý', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    try {
      const body = await open();
      click(byText(section(body, 'Đổi rác'), 'button', 'Khoá đổi rác'));
      await answerWithReason('Gian lận số lượng');
      const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(['admin-waste-user-flags', 'u1']));
      expect(keys).toContain(JSON.stringify(['admin-waste-requests']));
      expect(keys).toContain(JSON.stringify(['admin-ops-inbox']));
    } finally {
      spy.mockRestore();
    }
  });

  it('tải lại trạng thái khoá lỗi sau khi đã tải được: chỉ còn câu lỗi, không còn nhãn và nút khoá cũ', async () => {
    let failFlags = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.includes('/admin/waste/users/')) {
          if (failFlags && init?.method !== 'PUT') return new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          return new Response(JSON.stringify(NO_FLAGS), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(DETAIL), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const r = render(<UserDetailDrawer userId="u1" isAdmin onClose={() => undefined} />);
    mounted.push(r);
    await flush();
    const body = document.body;
    expect(byText(section(body, 'Đổi rác'), 'button', 'Khoá đổi rác')).not.toBeNull();
    failFlags = true;
    click(byText(section(body, 'Đổi rác'), 'button', 'Khoá đổi rác'));
    await answerWithReason('Gian lận số lượng');
    await flush();
    const text = section(body, 'Đổi rác').textContent ?? '';
    expect(text).toContain('Không tải được trạng thái khoá đổi rác.');
    expect(byText(section(body, 'Đổi rác'), 'button', 'Khoá đổi rác')).toBeNull();
    expect(byText(section(body, 'Đổi rác'), 'button', 'Khoá gửi kho')).toBeNull();
    expect(text).not.toContain('Đang khoá');
  });

  it('không phải admin: không có mục Đổi rác và không gọi flags', async () => {
    const body = await open(DETAIL, NO_FLAGS, false);
    expect(body.textContent).not.toContain('Xem yêu cầu đổi rác của khách');
    expect(calls.some((c) => c.url.includes('/admin/waste/users/'))).toBe(false);
  });
});

describe('UserDetailDrawer — nối sang tab Đơn hàng', () => {
  const WITH_ORDERS: AdminUserDetail = {
    ...DETAIL,
    orders: {
      items: [{ id: 'o1', code: 'TT1', status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'PAID', total: 120000, createdAt: '2026-10-01T00:00:00.000Z', fulfiller: 'TUBU' }],
      total: 25,
    },
  };

  it('mã đơn là nút mở đúng đơn; "Xem tất cả 25 đơn" mở danh sách đơn của khách kèm tên', async () => {
    const onOpenOrder = vi.fn();
    const onOpenUserOrders = vi.fn();
    const body = await open(WITH_ORDERS, NO_FLAGS, true, { onOpenOrder, onOpenUserOrders });
    click([...body.querySelectorAll('button')].find((b) => b.textContent === 'TT1')!);
    expect(onOpenOrder).toHaveBeenCalledWith('TT1');
    click([...body.querySelectorAll('button')].find((b) => b.textContent === 'Xem tất cả 25 đơn')!);
    expect(onOpenUserOrders).toHaveBeenCalledWith('u1', 'Nguyễn Văn An');
  });

  it('không truyền hàm nối: mã đơn chỉ là chữ và giữ câu hướng dẫn tìm theo SĐT', async () => {
    const body = await open(WITH_ORDERS);
    expect([...body.querySelectorAll('button')].some((b) => b.textContent === 'TT1')).toBe(false);
    expect(body.textContent).toContain('tìm theo SĐT ở tab Đơn hàng để xem hết');
  });
});

describe('UserDetailDrawer — Cắt phiên (L1-04)', () => {
  const answerWithReason = async (reason: string) => {
    typeInto(document.querySelector('[role="alertdialog"] textarea'), reason);
    answerConfirm(true);
    await flush();
  };

  it('admin bấm Cắt phiên: hỏi lý do rồi POST revoke-sessions kèm lý do', async () => {
    const body = await open();
    click(byText(section(body, 'Phiên đăng nhập'), 'button', 'Cắt phiên'));
    await answerWithReason('Khách báo mất điện thoại');
    const post = calls.find((c) => c.url.includes('/admin/users/u1/revoke-sessions'))!;
    expect(post.init!.method).toBe('POST');
    expect(JSON.parse(String(post.init!.body))).toEqual({ reason: 'Khách báo mất điện thoại' });
  });

  it('bỏ qua hộp hỏi thì không gọi máy chủ', async () => {
    const body = await open();
    click(byText(section(body, 'Phiên đăng nhập'), 'button', 'Cắt phiên'));
    answerConfirm(false);
    await flush();
    expect(calls.some((c) => c.url.includes('revoke-sessions'))).toBe(false);
  });

  it('không phải admin: không có mục Phiên đăng nhập', async () => {
    const body = await open(DETAIL, NO_FLAGS, false);
    expect(body.querySelector('section[aria-label="Phiên đăng nhập"]')).toBeNull();
  });

  it('nhãn huỷ hoa hồng và xoá tài khoản tách nhau', async () => {
    const body = await open({
      ...DETAIL,
      roleHistory: [{ id: 'e2', kind: 'COMMISSION_FORFEIT', fromValue: '150000', toValue: '0', reason: 'Huỷ 2 khoản hoa hồng chờ rút: x', actorId: 'a1', actorName: 'Admin', createdAt: '2026-11-05T03:00:00.000Z' }],
      blockHistory: [{ id: 'e3', kind: 'WALLET_FORFEIT', fromValue: '20000', toValue: '0', reason: null, actorId: 'a1', actorName: 'Admin', createdAt: '2026-11-05T02:00:00.000Z' }],
    });
    const text = body.textContent ?? '';
    expect(text).toContain('Huỷ hoa hồng chờ rút 150.000');
    expect(text).not.toContain('Xoá tài khoản: bỏ số dư Ví 150.000');
    expect(text).toContain('Xoá tài khoản: bỏ số dư Ví 20.000');
  });

  it('lịch sử ghi dòng cắt phiên kèm số phiên và lý do', async () => {
    const body = await open({
      ...DETAIL,
      blockHistory: [{ id: 'e1', kind: 'SESSIONS_REVOKED', fromValue: null, toValue: '2', reason: 'Nghi lộ phiên', actorId: 'a1', actorName: 'Admin', createdAt: '2026-11-05T03:00:00.000Z' }],
    });
    const text = section(body, 'Khoá và phiên đăng nhập').textContent ?? '';
    expect(text).toContain('Cắt mọi phiên đăng nhập (2 phiên)');
    expect(text).toContain('Nghi lộ phiên');
  });

  it.each([
    ['chính mình / khách tạm / dòng đã gộp (API trả sessionsRevocable=false)', false],
  ])('m5: ẩn nút Cắt phiên với %s', async (_label, flag) => {
    const body = await open({ ...DETAIL, user: { ...DETAIL.user, sessionsRevocable: flag } });
    expect(body.querySelector('section[aria-label="Phiên đăng nhập"]')).toBeNull();
    expect(byText(body, 'button', 'Cắt phiên')).toBeNull();
  });

  it('m5: tài khoản thường (sessionsRevocable=true) vẫn có nút', async () => {
    const body = await open({ ...DETAIL, user: { ...DETAIL.user, sessionsRevocable: true } });
    expect(byText(section(body, 'Phiên đăng nhập'), 'button', 'Cắt phiên')).not.toBeNull();
  });
});

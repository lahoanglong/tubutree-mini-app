// @vitest-environment jsdom
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, click, confirmDialog, flush, mockFetch, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { expectNoBannedCopy, wastePoint, wasteRequestRow } from '@/test-utils/fixtures/waste-admin';
import { listWastePoints } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { WastePointDetail } from './waste-point-detail';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const POINT_AFTER = wastePoint();
const REPORT = {
  pointId: 'p1', month: '2026-10', confirmations: 6, pointsAwarded: 40_000, quotaUsed: 40_000,
  units: [{ itemId: 'i1', itemName: 'Thùng carton cũ', unitLabel: 'thùng', qty: 40 }],
};
const CREDIT_ROW = wasteRequestRow({
  id: 'r7', code: 'TR-AAAA11', method: 'DROP_OFF', status: 'COMPLETED', pointId: 'p1', pointName: 'Tạp hoá Cô Ba',
  pointsAwarded: 8000, customerName: 'Lê Văn An', customerPhone: '0912345678',
  createdAt: '2026-10-10T02:00:00.000Z', completedAt: '2026-10-12T04:30:00.000Z',
});
const USERS = {
  data: [{ id: 'u7', fullName: 'Phạm Bảy', phone: '0907000777', role: 'CUSTOMER', pointsBalance: 0, createdAt: '2026-01-01T00:00:00.000Z' }],
  meta: { page: 1, limit: 8, total: 1 },
};

async function mount(point = wastePoint()) {
  const api = mockFetch({
    '/admin/waste/points/p1/staff/': { body: POINT_AFTER },
    '/admin/waste/points/p1/staff': { body: POINT_AFTER },
    '/admin/waste/points/p1/perk/approve': { body: POINT_AFTER },
    '/admin/waste/points/p1/perk/reject': { body: POINT_AFTER },
    '/admin/waste/points/p1/perk/clear': { body: POINT_AFTER },
    '/admin/waste/points/p1/report': { body: REPORT },
    '/admin/waste/requests': { body: { rows: [CREDIT_ROW], nextCursor: 'c2' } },
    '/admin/users': { body: USERS },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const r = render(<WastePointDetail point={point} onClose={() => undefined} searchDebounceMs={0} />);
  mounted.push(r);
  await flush();
  return { api, c: r.container };
}

const btn = (root: ParentNode, text: string) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text) ?? null;
const callsTo = (api: { calls: { url: string; init?: RequestInit }[] }, method: string, part: string) =>
  api.calls.filter((x) => x.url.includes(part) && (x.init?.method ?? 'GET') === method);

const FIVE_STAFF = [
  { userId: 'u-owner', role: 'OWNER' as const, isActive: true, fullName: 'Trần Thị Ba', phone: '0901000111' },
  ...[1, 2, 3, 4].map((n) => ({ userId: `u-s${n}`, role: 'STAFF' as const, isActive: true, fullName: `Nhân viên ${n}`, phone: `090200000${n}` })),
];

describe('WastePointDetail', () => {
  it('người ở điểm: thêm nhân viên gửi đúng body; đã có chủ điểm thì không chọn được vai Chủ điểm', async () => {
    const { c, api } = await mount();
    const role = c.querySelector<HTMLSelectElement>('select[name="staffRole"]')!;
    const owner = Array.from(role.options).find((o) => o.value === 'OWNER')!;
    expect(owner.disabled).toBe(true);
    expect(owner.textContent).toBe('Điểm đã có chủ điểm; gỡ chủ cũ trước');
    typeInto(c.querySelector('input[type="search"]'), '0907');
    await flush();
    click(c.querySelector('[role="option"]'));
    expect(role.value).toBe('STAFF');
    click(btn(c, 'Thêm người'));
    await flush();
    const posts = callsTo(api, 'POST', '/admin/waste/points/p1/staff');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url.endsWith('/admin/waste/points/p1/staff')).toBe(true);
    expect(JSON.parse(String(posts[0]!.init!.body))).toEqual({ userId: 'u7', role: 'STAFF' });
  });

  it('đổi sang điểm đã có chủ khi đang chọn vai Chủ điểm thì không thêm được', async () => {
    const noOwner = wastePoint({ staff: [] });
    const withOwner = wastePoint();
    function Switcher() {
      const [p, setP] = useState(noOwner);
      return (
        <>
          <button type="button" onClick={() => setP(withOwner)}>đổi điểm</button>
          <WastePointDetail point={p} onClose={() => undefined} searchDebounceMs={0} />
        </>
      );
    }
    const api = mockFetch({ '/admin/waste/points/p1/report': { body: REPORT }, '/admin/waste/requests': { body: { rows: [], nextCursor: null } }, '/admin/users': { body: USERS } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<Switcher />);
    mounted.push(r);
    await flush();
    const c = r.container;
    selectValue(c.querySelector('select[name="staffRole"]'), 'OWNER');
    typeInto(c.querySelector('input[type="search"]'), '0907');
    await flush();
    click(c.querySelector('[role="option"]'));
    expect(btn(c, 'Thêm người')!.disabled).toBe(false);
    click(btn(c, 'đổi điểm'));
    await flush();
    expect(c.querySelector<HTMLSelectElement>('select[name="staffRole"]')!.value).toBe('OWNER');
    expect(btn(c, 'Thêm người')!.disabled).toBe(true);
  });

  it('chủ cũ đã gỡ thì chọn được vai Chủ điểm mới', async () => {
    const { c } = await mount(wastePoint({ staff: [{ userId: 'u-owner', role: 'OWNER', isActive: false, fullName: 'Trần Thị Ba', phone: '0901000111' }] }));
    const owner = Array.from(c.querySelector<HTMLSelectElement>('select[name="staffRole"]')!.options).find((o) => o.value === 'OWNER')!;
    expect(owner.disabled).toBe(false);
    expect(owner.textContent).toBe('Chủ điểm');
  });

  it('chưa chọn người thì chưa thêm được', async () => {
    const { c } = await mount();
    expect(btn(c, 'Thêm người')!.disabled).toBe(true);
  });

  it('tối đa 5 người ở một điểm', async () => {
    const { c } = await mount(wastePoint({ staff: FIVE_STAFF }));
    expect(btn(c, 'Thêm người')!.disabled).toBe(true);
    expect(c.textContent).toContain('Tối đa 5 người ở một điểm');
  });

  it('người đã gỡ không tính vào mức tối đa 5', async () => {
    const staff = [...FIVE_STAFF.slice(0, 4), { userId: 'u-old', role: 'STAFF' as const, isActive: false, fullName: 'Người cũ', phone: '0903000000' }];
    const { c } = await mount(wastePoint({ staff }));
    expect(c.textContent).toContain('Người cũ');
    expect(c.textContent).not.toContain('Tối đa 5 người ở một điểm');
    expect(btn(c, 'Gỡ')).not.toBeNull();
    expect(Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === 'Gỡ')).toHaveLength(4);
  });

  it('gỡ người hỏi xác nhận rồi mới gửi DELETE', async () => {
    const { c, api } = await mount();
    click(btn(c, 'Gỡ'));
    await flush();
    answerConfirm(false);
    await flush();
    expect(callsTo(api, 'DELETE', '/admin/waste/points/p1/staff/')).toHaveLength(0);
    click(btn(c, 'Gỡ'));
    await flush();
    answerConfirm(true);
    await flush();
    const dels = callsTo(api, 'DELETE', '/admin/waste/points/p1/staff/');
    expect(dels).toHaveLength(1);
    expect(dels[0]!.url.endsWith('/admin/waste/points/p1/staff/u-owner')).toBe(true);
  });

  it('gỡ chủ điểm: cảnh báo dừng cả điểm (kèm câu ưu đãi khi có ưu đãi), gỡ nhân viên giữ câu cũ', async () => {
    const OWNER_MSG = 'Gỡ chủ điểm sẽ dừng cả điểm: khách không thấy điểm, người ở điểm không xác nhận được cho tới khi thêm chủ mới.';
    const a = await mount(wastePoint({ perkText: 'Tặng túi vải' }));
    click(btn(a.c, 'Gỡ'));
    await flush();
    expect(confirmDialog()!.textContent).toContain(`${OWNER_MSG} Ưu đãi của điểm cũng được gỡ.`);
    answerConfirm(false);
    await flush();

    const b = await mount(wastePoint({ perkText: null, perkPendingText: null }));
    click(btn(b.c, 'Gỡ'));
    await flush();
    expect(confirmDialog()!.textContent).toContain(OWNER_MSG);
    expect(confirmDialog()!.textContent).not.toContain('Ưu đãi của điểm');
    answerConfirm(false);
    await flush();

    const c = await mount(wastePoint({ staff: [{ userId: 'u-s1', role: 'STAFF', isActive: true, fullName: 'Nhân viên 1', phone: '0902000001' }] }));
    click(btn(c.c, 'Gỡ'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Nhân viên 1 không còn xác nhận được ở Tạp hoá Cô Ba.');
    expect(confirmDialog()!.textContent).not.toContain('dừng cả điểm');
    answerConfirm(false);
  });

  it('kho không có người ở điểm', async () => {
    const { c } = await mount(wastePoint({ id: 'wh', kind: 'WAREHOUSE', staff: [] }));
    expect(c.textContent).toContain('Kho phân quyền theo vai trò nhân viên, không gắn người ở điểm.');
    expect(btn(c, 'Thêm người')).toBeNull();
  });

  it('ghi chú điều kiện chủ điểm không nhắc cộng tác viên', async () => {
    const { c } = await mount();
    expect(c.textContent).toContain('Chủ điểm phải là chủ gian hàng đối tác.');
    expectNoBannedCopy(c.textContent);
  });

  it('duyệt / từ chối ưu đãi riêng', async () => {
    const { c, api } = await mount(wastePoint({ perkText: null, perkPendingText: 'Giảm 10% hoá đơn đầu' }));
    expect(c.textContent).toContain('Giảm 10% hoá đơn đầu');
    expect(c.textContent).toContain('Ưu đãi do cửa hàng tự chịu, không liên quan Điểm Xanh.');
    click(btn(c, 'Duyệt ưu đãi'));
    await flush();
    answerConfirm(true);
    await flush();
    const approve = callsTo(api, 'POST', '/admin/waste/points/p1/perk/approve');
    expect(approve).toHaveLength(1);
    expect(JSON.parse(String(approve[0]!.init!.body))).toEqual({ expectedPendingText: 'Giảm 10% hoá đơn đầu' });
    click(btn(c, 'Từ chối ưu đãi'));
    await flush();
    answerConfirm(true);
    await flush();
    const reject = callsTo(api, 'POST', '/admin/waste/points/p1/perk/reject');
    expect(reject).toHaveLength(1);
    expect(JSON.parse(String(reject[0]!.init!.body))).toEqual({ expectedPendingText: 'Giảm 10% hoá đơn đầu' });
  });

  it('ưu đãi đổi giữa lúc admin xem: gửi đúng chữ trong hộp thoại, bị 409 thì tải lại danh sách và hiện câu của máy chủ', async () => {
    function Switcher() {
      const [p, setP] = useState(wastePoint({ perkPendingText: 'Chữ cũ' }));
      useQuery({ queryKey: ['admin-waste-points', 'x'], queryFn: () => listWastePoints(), staleTime: Infinity });
      return (
        <>
          <button type="button" onClick={() => setP(wastePoint({ perkPendingText: 'Chữ mới' }))}>đổi chữ</button>
          <WastePointDetail point={p} onClose={() => undefined} searchDebounceMs={0} />
        </>
      );
    }
    const api = mockFetch({
      '/admin/waste/points/p1/perk/approve': { status: 409, body: { message: 'Nội dung ưu đãi vừa thay đổi, tải lại để xem' } },
      '/admin/waste/points/p1/report': { body: REPORT },
      '/admin/waste/points': { body: [] },
      '/admin/waste/requests': { body: { rows: [], nextCursor: null } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<Switcher />);
    mounted.push(r);
    await flush();
    const listGets = () => api.calls.filter((x) => /\/admin\/waste\/points$/.test(x.url) && (x.init?.method ?? 'GET') === 'GET').length;
    expect(listGets()).toBe(1);
    click(btn(r.container, 'Duyệt ưu đãi'));
    await flush();
    click(btn(r.container, 'đổi chữ'));
    await flush();
    answerConfirm(true);
    await flush();
    const posts = callsTo(api, 'POST', '/admin/waste/points/p1/perk/approve');
    expect(JSON.parse(String(posts[0]!.init!.body))).toEqual({ expectedPendingText: 'Chữ cũ' });
    expect(r.container.querySelector('[role="alert"]')?.textContent).toBe('Nội dung ưu đãi vừa thay đổi, tải lại để xem');
    expect(listGets()).toBe(2);
  });

  it('gỡ ưu đãi đang hiện: chỉ có nút khi đã có ưu đãi được duyệt, hỏi xác nhận có chữ ưu đãi rồi mới gửi', async () => {
    const none = await mount(wastePoint({ perkText: null, perkPendingText: 'Đang chờ' }));
    expect(btn(none.c, 'Gỡ ưu đãi đang hiện')).toBeNull();

    const { c, api } = await mount(wastePoint({ perkText: 'Tặng túi vải' }));
    click(btn(c, 'Gỡ ưu đãi đang hiện'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Tặng túi vải');
    answerConfirm(false);
    await flush();
    expect(callsTo(api, 'POST', '/admin/waste/points/p1/perk/clear')).toHaveLength(0);
    click(btn(c, 'Gỡ ưu đãi đang hiện'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(callsTo(api, 'POST', '/admin/waste/points/p1/perk/clear')).toHaveLength(1);
  });

  it('ưu đãi đã duyệt hiện chữ, chưa có thì ghi Chưa có và không có nút duyệt', async () => {
    const a = await mount(wastePoint({ perkText: 'Tặng túi vải' }));
    expect(a.c.textContent).toContain('Tặng túi vải');
    expect(btn(a.c, 'Duyệt ưu đãi')).toBeNull();
    const b = await mount();
    expect(b.c.textContent).toContain('Chưa có');
  });

  it('nhật ký cộng điểm lấy yêu cầu COMPLETED của điểm, tải thêm theo cursor', async () => {
    const { c, api } = await mount();
    const first = callsTo(api, 'GET', '/admin/waste/requests');
    expect(first[0]!.url.endsWith('/admin/waste/requests?status=COMPLETED&pointId=p1')).toBe(true);
    expect(c.textContent).toContain('TR-AAAA11');
    expect(c.textContent).toContain('Lê Văn An');
    expect(c.textContent).toContain('8.000 điểm');
    expect(c.textContent).toContain('Hoàn tất lúc');
    expect(c.textContent).not.toContain('Ngày tạo yêu cầu');
    const cells = Array.from(c.querySelectorAll('tbody tr')).find((tr) => tr.textContent!.includes('TR-AAAA11'))!.textContent!;
    expect(cells).toContain(formatDateTime('2026-10-12T04:30:00.000Z'));
    expect(cells).not.toContain(formatDateTime('2026-10-10T02:00:00.000Z'));
    click(btn(c, 'Xem thêm'));
    await flush();
    const next = callsTo(api, 'GET', '/admin/waste/requests');
    expect(next[next.length - 1]!.url.endsWith('&cursor=c2')).toBe(true);
  });

  it('nhật ký cộng điểm: điểm chưa có thì gạch ngang, điểm 0 thật vẫn hiện, không nhắc số mục của đặc tả', async () => {
    const api = mockFetch({
      '/admin/waste/points/p1/report': { body: REPORT },
      '/admin/waste/requests': {
        body: {
          rows: [
            { ...CREDIT_ROW, id: 'r8', code: 'TR-NULL01', pointsAwarded: null, completedAt: null },
            { ...CREDIT_ROW, id: 'r9', code: 'TR-ZERO01', pointsAwarded: 0 },
          ],
          nextCursor: null,
        },
      },
      '/admin/users': { body: USERS },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = render(<WastePointDetail point={wastePoint()} onClose={() => undefined} searchDebounceMs={0} />);
    mounted.push(r);
    await flush();
    const rows = Array.from(r.container.querySelectorAll('tbody tr')).filter((tr) => tr.textContent!.includes('TR-NULL01') || tr.textContent!.includes('TR-ZERO01'));
    expect(rows.find((tr) => tr.textContent!.includes('TR-NULL01'))!.textContent).toContain('—');
    expect(rows.find((tr) => tr.textContent!.includes('TR-NULL01'))!.textContent).not.toContain('điểm');
    expect(rows.find((tr) => tr.textContent!.includes('TR-NULL01'))!.querySelectorAll('td')[3]!.textContent).toBe('—');
    expect(rows.find((tr) => tr.textContent!.includes('TR-ZERO01'))!.textContent).toContain('0 điểm');
    expect(r.container.textContent).not.toContain('(15.1)');
  });

  it('số lượng đã nhận trong tháng', async () => {
    const { c, api } = await mount();
    typeInto(c.querySelector('input[type="month"]'), '2026-10');
    await flush();
    expect(callsTo(api, 'GET', '/admin/waste/points/p1/report').some((x) => x.url.endsWith('/admin/waste/points/p1/report?month=2026-10'))).toBe(true);
    expect(c.textContent).toContain('Thùng carton cũ: 40 thùng');
    expect(c.textContent).toContain('6 lượt xác nhận');
    expect(c.textContent).toContain('40.000 điểm đã cộng');
  });

  it('đổi tháng gọi lại báo cáo theo tháng mới', async () => {
    const { c, api } = await mount();
    typeInto(c.querySelector('input[type="month"]'), '2026-09');
    await flush();
    expect(callsTo(api, 'GET', '/admin/waste/points/p1/report').some((x) => x.url.endsWith('?month=2026-09'))).toBe(true);
  });

  it('không có chữ cấm trong toàn bộ chi tiết điểm', async () => {
    const { c } = await mount(wastePoint({ perkPendingText: 'Giảm 10% hoá đơn đầu' }));
    expectNoBannedCopy(c.textContent);
  });
});

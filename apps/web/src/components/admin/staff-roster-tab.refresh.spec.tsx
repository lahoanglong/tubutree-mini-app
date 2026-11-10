// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffRosterTab } from './staff-roster-tab';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Wave 96B: cấp/thu hồi quyền và lưu nhóm việc giữ khoá tới khi danh sách nhân sự mới về (tối đa 4 giây), bị từ chối 400/404/409 thì tải lại,
// lời báo không mất cùng dòng bị gỡ. fetch giả có cổng chặn từng đường để dựng đúng khoảnh khắc "lệnh xong nhưng danh sách chưa về".

const U1 = { id: 'u1', phone: '0911111111', fullName: 'Lan', avatarUrl: null, role: 'STAFF', staffPermissions: ['KHO'], createdAt: '2026-10-01T00:00:00Z' };
const U2 = { id: 'u2', phone: '0922222222', fullName: 'Mai', avatarUrl: null, role: 'STAFF', staffPermissions: [], createdAt: '2026-10-01T00:00:00Z' };
const INVITE = { phone: '0933333333', role: 'STAFF', staffPermissions: ['KE_TOAN'], createdAt: '2026-10-02T00:00:00Z', expiresAt: '2026-10-09T00:00:00Z' };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

type Route = () => Promise<Response> | Response;
const routes: Record<'list' | 'grant' | 'revoke' | 'perms', Route> = {
  list: () => json(200, { members: [U1, U2], pendingInvites: [INVITE] }),
  grant: () => json(200, { granted: 'STAFF', applied: false }),
  revoke: () => json(200, { revoked: 1, downgraded: true }),
  perms: () => json(200, { id: 'u1', staffPermissions: ['KHO', 'CSKH'], changed: true }),
};
const calls: { method: string; url: string }[] = [];
const count = (method: string, part: string) => calls.filter((c) => c.method === method && c.url.includes(part)).length;
const listGets = () => count('GET', '/admin/staff');
const grants = () => count('POST', '/admin/staff/grant');
const revokes = () => count('POST', '/admin/staff/revoke');
const permPuts = () => count('PUT', '/staff-permissions');

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  routes.list = () => json(200, { members: [U1, U2], pendingInvites: [INVITE] });
  routes.grant = () => json(200, { granted: 'STAFF', applied: false });
  routes.revoke = () => json(200, { revoked: 1, downgraded: true });
  routes.perms = () => json(200, { id: 'u1', staffPermissions: ['KHO', 'CSKH'], changed: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (url.includes('/admin/staff/grant')) return routes.grant();
      if (url.includes('/admin/staff/revoke')) return routes.revoke();
      if (url.includes('/staff-permissions')) return routes.perms();
      return routes.list();
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = async () => {
  mounted = render(<StaffRosterTab />);
  await flush();
  return mounted.container;
};
const tap = (...els: HTMLElement[]) =>
  act(async () => {
    for (const e of els) e.click();
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const holdList = (body: unknown = { members: [U1, U2], pendingInvites: [INVITE] }) => {
  const g = gate();
  routes.list = () => g.promise.then(() => json(200, body));
  return g;
};
const isBusy = (b: HTMLElement) => b.getAttribute('aria-busy') === 'true';
const alertText = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join(' | ');
const phoneInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type=tel]')!;
const saveBtn = (c: HTMLElement) => byText(c.querySelector('form')!, 'button', 'Lưu quyền') as HTMLButtonElement;
const revokeBtn = (c: HTMLElement, who: string) => c.querySelector<HTMLButtonElement>(`[aria-label="Thu hồi · ${who}"]`)!;
const memberCard = (c: HTMLElement, name: string) => Array.from(c.querySelectorAll<HTMLElement>('ul > li')).find((li) => li.textContent?.includes(name))!;
const pickerSave = (li: HTMLElement) => byText(li, 'button', /Lưu nhóm việc|Đang lưu/) as HTMLButtonElement;

const grant = async (c: HTMLElement) => {
  typeInto(phoneInput(c), '0944444444');
  click(saveBtn(c));
  await flush();
  answerAsk('Nhân viên mới');
  await flush(2);
};
const revoke = async (c: HTMLElement, who: string) => {
  click(revokeBtn(c, who));
  await flush();
  answerAsk('Đã nghỉ việc');
  await flush(2);
};
const editPerms = async (c: HTMLElement) => {
  const li = memberCard(c, 'Lan');
  click(li.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]')[0]!);
  click(pickerSave(li));
  await flush();
  answerAsk('Chuyển sang chăm sóc khách');
  await flush(2);
};

describe('Cấp quyền: khoá giữ tới khi danh sách làm mới về, có hạn 4 giây', () => {
  it('danh sách không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây và cấp lại được', async () => {
    useHangTimers();
    const c = await mount();
    routes.list = () => new Promise<Response>(() => {});
    await grant(c);
    expect(grants()).toBe(1);
    await advance(3_500);
    expect(isBusy(saveBtn(c))).toBe(true);
    await tap(saveBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    await advance(700);
    expect(isBusy(saveBtn(c))).toBe(false);
    typeInto(phoneInput(c), '0955555555');
    click(saveBtn(c));
    await flush();
    answerAsk('Lần hai');
    await flush(2);
    expect(grants()).toBe(2);
  });

  it('cấp bị từ chối 400/404/409: lời lỗi hiện ngay, tải lại danh sách và giữ khoá tới khi danh sách về', async () => {
    for (const status of [400, 404, 409]) {
      calls.length = 0;
      const c = await mount();
      routes.grant = () => json(status, { message: 'Số điện thoại này đã đổi trạng thái' });
      const g = holdList();
      const before = listGets();
      await grant(c);
      expect(grants()).toBe(1);
      expect(alertText(c)).toContain('Số điện thoại này đã đổi trạng thái');
      expect(listGets()).toBe(before + 1);
      expect(isBusy(saveBtn(c))).toBe(true);
      await tap(saveBtn(c));
      await flush();
      expect(confirmDialog()).toBeNull();
      g.resolve();
      await flush();
      expect(isBusy(saveBtn(c))).toBe(false);
      mounted!.unmount();
      mounted = null;
    }
  });

  it('cấp lỗi 500 hoặc mất mạng: hiện lỗi, KHÔNG tải lại danh sách, nhả khoá ngay', async () => {
    const c = await mount();
    routes.grant = () => json(500, { message: 'Máy chủ đang bận' });
    const before = listGets();
    await grant(c);
    expect(alertText(c)).toContain('Máy chủ đang bận');
    expect(listGets()).toBe(before);
    expect(isBusy(saveBtn(c))).toBe(false);
    routes.grant = () => Promise.reject(new TypeError('Failed to fetch'));
    click(saveBtn(c));
    await flush();
    answerAsk('Lần hai');
    await flush(2);
    expect(listGets()).toBe(before);
    expect(isBusy(saveBtn(c))).toBe(false);
  });

  it('bị từ chối mà tải lại treo: vẫn nhả khoá sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount();
    routes.grant = () => json(409, { message: 'Trùng' });
    routes.list = () => new Promise<Response>(() => {});
    await grant(c);
    await advance(3_500);
    expect(isBusy(saveBtn(c))).toBe(true);
    await advance(700);
    expect(isBusy(saveBtn(c))).toBe(false);
  });
});

describe('Thu hồi quyền: giữ khoá tới khi danh sách về, bị từ chối thì tải lại', () => {
  it('danh sách không bao giờ về: nút Thu hồi còn bận ở 3,5 giây, nhả sau 4 giây', async () => {
    useHangTimers();
    const c = await mount();
    routes.list = () => new Promise<Response>(() => {});
    await revoke(c, 'Lan');
    expect(revokes()).toBe(1);
    await advance(3_500);
    expect(isBusy(revokeBtn(c, 'Lan'))).toBe(true);
    await tap(revokeBtn(c, 'Lan'));
    await flush();
    expect(confirmDialog()).toBeNull();
    await advance(700);
    expect(isBusy(revokeBtn(c, 'Lan'))).toBe(false);
  });

  it('người đã bị thu hồi ở máy khác (404): hiện lỗi, tải lại danh sách, dòng biến mất mà lời lỗi vẫn còn', async () => {
    const c = await mount();
    routes.revoke = () => json(404, { message: 'Người này không còn quyền.' });
    const g = holdList({ members: [U2], pendingInvites: [INVITE] });
    const before = listGets();
    await revoke(c, 'Lan');
    expect(revokes()).toBe(1);
    expect(alertText(c)).toContain('Người này không còn quyền.');
    expect(listGets()).toBe(before + 1);
    expect(isBusy(revokeBtn(c, 'Lan'))).toBe(true);
    await tap(revokeBtn(c, 'Lan'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(revokes()).toBe(1);
    g.resolve();
    await flush();
    expect(c.querySelector('[aria-label="Thu hồi · Lan"]')).toBeNull();
    expect(alertText(c)).toContain('Người này không còn quyền.');
  });

  it('thu hồi lỗi 500: không tải lại, nhả khoá ngay', async () => {
    const c = await mount();
    routes.revoke = () => json(500, { message: 'Máy chủ đang bận' });
    const before = listGets();
    await revoke(c, 'Lan');
    expect(alertText(c)).toContain('Máy chủ đang bận');
    expect(listGets()).toBe(before);
    expect(isBusy(revokeBtn(c, 'Lan'))).toBe(false);
  });
});

describe('Lưu nhóm việc: khoá, hạn 4 giây, lời báo sống sót khi dòng đổi', () => {
  it('đang lưu: nút aria-busy/aria-disabled (không disabled), chạm lại không mở hộp xác nhận và chỉ một PUT; lệnh xong mà danh sách chưa về vẫn bận', async () => {
    const put = gate();
    routes.perms = () => put.promise.then(() => json(200, { id: 'u1', staffPermissions: ['KHO', 'CSKH'], changed: true }));
    const c = await mount();
    const list = holdList();
    await editPerms(c);
    const li = () => memberCard(c, 'Lan');
    expect(permPuts()).toBe(1);
    expect(isBusy(pickerSave(li()))).toBe(true);
    expect(pickerSave(li()).getAttribute('aria-disabled')).toBe('true');
    expect(pickerSave(li()).disabled).toBe(false);
    await tap(pickerSave(li()), pickerSave(li()));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(permPuts()).toBe(1);

    put.resolve();
    await flush();
    expect(isBusy(pickerSave(li()))).toBe(true);
    await tap(pickerSave(li()));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(permPuts()).toBe(1);

    list.resolve();
    await flush();
    expect(isBusy(pickerSave(li()))).toBe(false);
  });

  it('danh sách không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount();
    routes.list = () => new Promise<Response>(() => {});
    await editPerms(c);
    await advance(3_500);
    expect(isBusy(pickerSave(memberCard(c, 'Lan')))).toBe(true);
    await advance(700);
    expect(isBusy(pickerSave(memberCard(c, 'Lan')))).toBe(false);
  });

  it('lưu xong mà danh sách về nhóm việc mới (thẻ dựng lại theo key): lời "Đã lưu nhóm việc" vẫn còn', async () => {
    const c = await mount();
    routes.list = () => json(200, { members: [{ ...U1, staffPermissions: ['KHO', 'CSKH'] }, U2], pendingInvites: [INVITE] });
    await editPerms(c);
    await flush();
    const boxes = [...memberCard(c, 'Lan').querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]')];
    expect(boxes.map((b) => b.checked)).toEqual([true, true, false, false]);
    expect(memberCard(c, 'Lan').textContent).toContain('Đã lưu nhóm việc');
  });

  it('người đã mất quyền ở máy khác (404): lời lỗi hiện ngay, tải lại danh sách, dòng biến mất mà lời lỗi vẫn còn; giữ khoá tới khi danh sách về', async () => {
    const c = await mount();
    routes.perms = () => json(404, { message: 'Không tìm thấy người dùng.' });
    const g = holdList({ members: [U2], pendingInvites: [INVITE] });
    const before = listGets();
    await editPerms(c);
    expect(permPuts()).toBe(1);
    expect(alertText(c)).toContain('Không tìm thấy người dùng.');
    expect(listGets()).toBe(before + 1);
    expect(isBusy(pickerSave(memberCard(c, 'Lan')))).toBe(true);
    g.resolve();
    await flush();
    expect(c.textContent).not.toContain('Lan');
    expect(alertText(c)).toContain('Không tìm thấy người dùng.');
  });

  it('lưu lỗi 500: lời lỗi, không tải lại, nhả khoá ngay để lưu lại được', async () => {
    const c = await mount();
    routes.perms = () => json(500, { message: 'Máy chủ đang bận' });
    const before = listGets();
    await editPerms(c);
    expect(alertText(c)).toContain('Máy chủ đang bận');
    expect(listGets()).toBe(before);
    expect(isBusy(pickerSave(memberCard(c, 'Lan')))).toBe(false);
    click(pickerSave(memberCard(c, 'Lan')));
    await flush();
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
  });

  it('lời mời chờ mở app bị từ chối 404 khi lưu nhóm việc: tải lại danh sách', async () => {
    const c = await mount();
    routes.grant = () => json(404, { message: 'Lời mời đã hết hạn.' });
    const g = holdList({ members: [U1, U2], pendingInvites: [] });
    const before = listGets();
    const invites = c.querySelector<HTMLElement>('section[aria-label="Chờ mở app"]')!;
    click(invites.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]')[1]!);
    click(byText(invites, 'button', 'Lưu nhóm việc'));
    await flush();
    answerAsk('Đổi nhóm của lời mời');
    await flush(2);
    expect(grants()).toBe(1);
    expect(alertText(c)).toContain('Lời mời đã hết hạn.');
    expect(listGets()).toBe(before + 1);
    g.resolve();
    await flush();
    expect(c.querySelector('section[aria-label="Chờ mở app"]')).toBeNull();
    expect(alertText(c)).toContain('Lời mời đã hết hạn.');
  });

  it('lời "Đã lưu nhóm việc" của lần trước biến mất khi bắt đầu lần lưu kế tiếp', async () => {
    const c = await mount();
    await editPerms(c);
    await flush();
    expect(memberCard(c, 'Lan').textContent).toContain('Đã lưu nhóm việc');
    click(pickerSave(memberCard(c, 'Lan')));
    await flush();
    expect(confirmDialog()).not.toBeNull();
    expect(memberCard(c, 'Lan').textContent).not.toContain('Đã lưu nhóm việc');
    answerConfirm(false);
  });

  it('bấm "Lưu nhóm việc" lần hai cùng khung hình với xác nhận lần một: hộp thứ hai xác nhận sau khi lệnh đầu đã bay thì không gửi PUT thứ hai', async () => {
    const put = gate();
    routes.perms = () => put.promise.then(() => json(200, { id: 'u1', staffPermissions: ['KHO', 'CSKH'], changed: true }));
    const c = await mount();
    const li = memberCard(c, 'Lan');
    click(li.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]')[0]!);
    click(pickerSave(li));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), 'Chuyển sang chăm sóc khách');
    await act(async () => {
      confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!.click();
      pickerSave(li).click();
    });
    await flush(2);
    expect(permPuts()).toBe(1);
    expect(confirmDialog()).not.toBeNull();
    answerAsk('Lần hai');
    await flush();
    expect(permPuts()).toBe(1);
    put.resolve();
    await flush();
  });

  it('lý do quá ngắn: báo ở khung thông báo chung, không gửi lệnh', async () => {
    const c = await mount();
    const li = memberCard(c, 'Lan');
    click(li.querySelectorAll<HTMLInputElement>('fieldset input[type=checkbox]')[0]!);
    click(pickerSave(li));
    await flush();
    answerAsk('ab');
    await flush(2);
    expect(permPuts()).toBe(0);
    expect(alertText(c)).toContain('Lý do cần ít nhất 3 ký tự.');
  });
});

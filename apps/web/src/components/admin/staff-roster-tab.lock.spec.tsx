// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffRosterTab } from './staff-roster-tab';
import { answerAsk, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// W79B: cấp quyền, thu hồi quyền và huỷ lời mời loại trừ nhau, giữ khoá tới khi danh sách nhân sự mới về (Mini ↔ web, W79A).

let mounted: Rendered[] = [];
const mount = async (client?: QueryClient) => {
  const r = render(<StaffRosterTab />, client);
  mounted.push(r);
  await flush();
  return r.container;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const LIST = {
  members: [
    { id: 'u1', phone: '0911111111', fullName: 'Lan', avatarUrl: null, role: 'STAFF', staffPermissions: ['KHO'], createdAt: '2026-10-01T00:00:00Z' },
    { id: 'u2', phone: '0922222222', fullName: 'Mai', avatarUrl: null, role: 'STAFF', staffPermissions: [], createdAt: '2026-10-01T00:00:00Z' },
  ],
  pendingInvites: [{ phone: '0933333333', role: 'STAFF', staffPermissions: ['KE_TOAN'], createdAt: '2026-10-02T00:00:00Z', expiresAt: '2026-10-09T00:00:00Z' }],
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
type Gates = { write?: Promise<void>; list?: Promise<void>; failGrantOnce?: boolean };

function stub(gates: Gates = {}) {
  const calls: { url: string; method: string }[] = [];
  let listLoads = 0;
  let failed = false;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.includes('/admin/staff/grant')) {
        if (gates.failGrantOnce && !failed) {
          failed = true;
          return json({ message: 'Máy chủ đang bận' }, 500);
        }
        await gates.write;
        return json({ granted: 'STAFF', applied: false });
      }
      if (url.includes('/admin/staff/revoke')) {
        await gates.write;
        return json({ revoked: 1, downgraded: true });
      }
      listLoads += 1;
      if (listLoads > 1) await gates.list;
      return json(LIST);
    }),
  );
  return { posts: (p: string) => calls.filter((c) => c.url.includes(p) && c.method === 'POST') };
}

const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const q = (root: ParentNode, label: string) => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const saveBtn = (c: HTMLElement) => byText(c.querySelector('form')!, 'button', 'Lưu quyền') as HTMLButtonElement;
const phoneInput = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type=tel]')!;

describe('StaffRosterTab: Lưu quyền', () => {
  it('đang cấp: nút aria-busy/aria-disabled (không disabled); bấm lại không mở hộp xác nhận, không gửi lệnh thứ hai; khoá giữ tới khi danh sách mới về', async () => {
    const write = deferred();
    const list = deferred();
    const api = stub({ write: write.promise, list: list.promise });
    const c = await mount();
    typeInto(phoneInput(c), '0944444444');
    click(saveBtn(c));
    await flush();
    answerAsk('Nhân viên kho mới');
    await flush(2);
    expect(api.posts('/admin/staff/grant')).toHaveLength(1);
    expect(saveBtn(c).getAttribute('aria-busy')).toBe('true');
    expect(saveBtn(c).getAttribute('aria-disabled')).toBe('true');
    expect(saveBtn(c).disabled).toBe(false);
    await tap(saveBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();

    write.resolve();
    await flush();
    expect(c.textContent).toContain('Đã lưu quyền');
    expect(saveBtn(c).getAttribute('aria-busy')).toBe('true');

    list.resolve();
    await flush();
    expect(saveBtn(c).hasAttribute('aria-busy')).toBe(false);
    expect(phoneInput(c).value).toBe('');
  });

  it('bấm "Lưu quyền" lần hai cùng khung hình với xác nhận lần một: hộp thứ hai xác nhận sau khi lệnh đầu đã bay thì không gửi lệnh thứ hai', async () => {
    const write = deferred();
    const api = stub({ write: write.promise });
    const c = await mount();
    typeInto(phoneInput(c), '0944444444');
    click(saveBtn(c));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), 'Nhân viên kho mới');
    await act(async () => {
      confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!.click();
      saveBtn(c).click();
    });
    await flush(2);
    expect(api.posts('/admin/staff/grant')).toHaveLength(1);
    expect(confirmDialog()).not.toBeNull();
    answerAsk('Lần hai');
    await flush();
    expect(api.posts('/admin/staff/grant')).toHaveLength(1);
    write.resolve();
    await flush();
  });

  it('SĐT gõ thêm trong lúc chờ không bị xoá khi lệnh cũ xong; SĐT đã gửi nguyên vẹn thì xoá', async () => {
    const write = deferred();
    stub({ write: write.promise });
    const c = await mount();
    typeInto(phoneInput(c), '0944444444');
    click(saveBtn(c));
    await flush();
    answerAsk('Nhân viên kho mới');
    await flush(2);
    typeInto(phoneInput(c), '0955555555');
    write.resolve();
    await flush();
    expect(phoneInput(c).value).toBe('0955555555');
  });

  it('nhóm việc chọn thêm trong lúc chờ vẫn còn sau khi lệnh cũ xong', async () => {
    const write = deferred();
    stub({ write: write.promise });
    const c = await mount();
    const group = () => c.querySelector('[aria-label="Nhóm việc cho người mới"]') as HTMLElement;
    typeInto(phoneInput(c), '0944444444');
    click(saveBtn(c));
    await flush();
    answerAsk('Nhân viên kho mới');
    await flush(2);
    click(byText(group(), 'button', 'Kho'));
    write.resolve();
    await flush();
    expect(byText(group(), 'button', 'Kho')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('nhóm việc đã gửi nguyên vẹn thì xoá sau khi xong', async () => {
    stub();
    const c = await mount();
    const group = () => c.querySelector('[aria-label="Nhóm việc cho người mới"]') as HTMLElement;
    typeInto(phoneInput(c), '0944444444');
    click(byText(group(), 'button', 'Kho'));
    click(saveBtn(c));
    await flush();
    answerAsk('Nhân viên kho mới');
    await flush();
    expect(byText(group(), 'button', 'Kho')!.getAttribute('aria-pressed')).toBe('false');
    expect(phoneInput(c).value).toBe('');
  });

  it('cấp lỗi nhả khoá: báo alert, giữ SĐT, cấp lại gửi được', async () => {
    const api = stub({ failGrantOnce: true });
    const c = await mount();
    typeInto(phoneInput(c), '0944444444');
    click(saveBtn(c));
    await flush();
    answerAsk('Nhân viên kho mới');
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ đang bận');
    expect(phoneInput(c).value).toBe('0944444444');
    expect(saveBtn(c).hasAttribute('aria-busy')).toBe(false);
    click(saveBtn(c));
    await flush();
    answerAsk('Nhân viên kho mới');
    await flush();
    expect(api.posts('/admin/staff/grant')).toHaveLength(2);
    expect(c.textContent).toContain('Đã lưu quyền');
  });

  it('SĐT chưa hợp lệ vẫn disabled thật (lý do cứng)', async () => {
    stub();
    const c = await mount();
    expect(saveBtn(c).disabled).toBe(true);
  });
});

describe('StaffRosterTab: Thu hồi và huỷ lời mời loại trừ nhau', () => {
  it('đang thu hồi một người: nút của dòng đó aria-busy, mọi nút Thu hồi khác aria-disabled (không disabled); bấm nút khác không mở hộp; chỉ một lệnh', async () => {
    const write = deferred();
    const api = stub({ write: write.promise });
    const c = await mount();
    click(q(c, 'Thu hồi · Lan'));
    await flush();
    answerAsk('Nghỉ việc');
    await flush(2);
    expect(api.posts('/admin/staff/revoke')).toHaveLength(1);
    expect(q(c, 'Thu hồi · Lan').getAttribute('aria-busy')).toBe('true');
    for (const label of ['Thu hồi · Lan', 'Thu hồi · Mai', 'Thu hồi lời mời · 0933333333']) {
      expect(q(c, label).getAttribute('aria-disabled')).toBe('true');
      expect(q(c, label).disabled).toBe(false);
    }
    expect(q(c, 'Thu hồi · Mai').hasAttribute('aria-busy')).toBe(false);
    expect(q(c, 'Thu hồi lời mời · 0933333333').hasAttribute('aria-busy')).toBe(false);
    await tap(q(c, 'Thu hồi · Mai'));
    await flush();
    expect(confirmDialog()).toBeNull();
    await tap(q(c, 'Thu hồi lời mời · 0933333333'));
    await flush();
    expect(confirmDialog()).toBeNull();
    await tap(q(c, 'Thu hồi · Lan'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(api.posts('/admin/staff/revoke')).toHaveLength(1);
    write.resolve();
    await flush();
  });

  it('bấm "Thu hồi" dòng khác cùng khung hình với xác nhận lần một: hộp thứ hai xác nhận sau khi lệnh đầu đã bay thì không gửi lệnh thứ hai', async () => {
    const write = deferred();
    const api = stub({ write: write.promise });
    const c = await mount();
    click(q(c, 'Thu hồi · Lan'));
    await flush();
    typeInto(confirmDialog()!.querySelector('textarea'), 'Nghỉ việc');
    await act(async () => {
      confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!.click();
      q(c, 'Thu hồi · Mai').click();
    });
    await flush(2);
    expect(api.posts('/admin/staff/revoke')).toHaveLength(1);
    expect(confirmDialog()).not.toBeNull();
    answerAsk('Nghỉ việc nữa');
    await flush();
    expect(api.posts('/admin/staff/revoke')).toHaveLength(1);
    write.resolve();
    await flush();
  });

  it('đang huỷ lời mời: nút lời mời aria-busy, nút Thu hồi của người không mở hộp', async () => {
    const write = deferred();
    const api = stub({ write: write.promise });
    const c = await mount();
    click(q(c, 'Thu hồi lời mời · 0933333333'));
    await flush();
    answerAsk('Nhập nhầm số');
    await flush(2);
    expect(q(c, 'Thu hồi lời mời · 0933333333').getAttribute('aria-busy')).toBe('true');
    expect(q(c, 'Thu hồi · Lan').hasAttribute('aria-busy')).toBe(false);
    await tap(q(c, 'Thu hồi · Lan'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(api.posts('/admin/staff/revoke')).toHaveLength(1);
    write.resolve();
    await flush();
  });

  it('khoá giữ tới khi danh sách mới về: thu hồi xong mà danh sách chưa làm mới thì nút vẫn bận', async () => {
    const list = deferred();
    const api = stub({ list: list.promise });
    const c = await mount();
    click(q(c, 'Thu hồi · Lan'));
    await flush();
    answerAsk('Nghỉ việc');
    await flush();
    expect(api.posts('/admin/staff/revoke')).toHaveLength(1);
    expect(c.textContent).toContain('Đã thu hồi quyền.');
    expect(q(c, 'Thu hồi · Lan').getAttribute('aria-busy')).toBe('true');
    expect(q(c, 'Thu hồi · Mai').getAttribute('aria-disabled')).toBe('true');
    await tap(q(c, 'Thu hồi · Mai'));
    await flush();
    expect(confirmDialog()).toBeNull();
    list.resolve();
    await flush();
    expect(q(c, 'Thu hồi · Lan').hasAttribute('aria-busy')).toBe(false);
    expect(q(c, 'Thu hồi · Mai').hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('StaffRosterTab: Thử lại tải danh sách', () => {
  it('đã có dữ liệu cũ, lần tải lại lỗi: Thử lại aria-busy khi lần tải còn chạy, chạm đúp chỉ tải một lần', async () => {
    let mode: 'ok' | 'fail' | 'hold' = 'ok';
    let loads = 0;
    const gate = deferred();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        loads += 1;
        if (mode === 'fail') return new Response(JSON.stringify({ message: 'Hỏng' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        if (mode === 'hold') await gate.promise;
        return new Response(JSON.stringify(LIST), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const c = await mount(client);
    mode = 'fail';
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['admin-staff'] });
    });
    await flush();
    const retry = byText(c, 'button', 'Thử lại') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    mode = 'hold';
    const before = loads;
    await tap(retry, retry);
    await flush(2);
    expect(loads - before).toBe(1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    mode = 'ok';
    gate.resolve();
    await flush();
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
  });
});

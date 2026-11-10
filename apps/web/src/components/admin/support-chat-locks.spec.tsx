// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { SupportChatTab } from './support-chat-tab';

// Wave 96B: admin "Chat CSKH": cầu nối Zalo (Đăng nhập, Đăng xuất, Kết nối lại, Lưu nhóm, Gửi tin thử, công tắc Cho khách chat) và hội thoại (Gửi trả lời,
// Gửi lại, Chặn/Bỏ chặn). Tin trả lời gửi tới khách nên chạm đúp không được gửi hai tin. Giữ khoá tới khi dữ liệu làm mới về (tối đa 4 giây), bị từ chối
// vì dữ liệu cũ (400/404/409) thì tải lại, nút giữ focus dùng aria-busy/aria-disabled.

const BRIDGE = { state: 'CONNECTED', since: '2026-10-23T03:05:00.000Z', lastError: null, zaloUid: 'z1', displayName: 'CSKH Tubu', avatar: null, checkedAt: '2026-10-23T03:06:00.000Z', groupId: 'G1', enabled: false, deaf: false };
const GROUPS = { groups: [{ id: 'G1', name: 'Nhóm CSKH', memberCount: 5 }, { id: 'G2', name: 'Nhóm thử', memberCount: 2 }] };
const ROW = { id: 'c1', code: 'K7Q2', blocked: false, lastMessageAt: '2026-10-23T09:00:00.000Z', user: { id: 'u1', fullName: 'Lan', phone: '0901234234' }, lastMessage: { sender: 'CUSTOMER', body: 'cho mình hỏi đơn', hasImage: false }, needsAttention: true };
const msg = (o: Record<string, unknown>) => ({ id: 'm1', sender: 'CUSTOMER', source: 'MINIAPP', body: 'xin chào', imageUrl: null, context: null, staffName: null, adminUserId: null, recalledAt: null, createdAt: '2026-10-23T09:00:00.000Z', forward: null, ...o });
const FWD = { id: 'f1', status: 'FAILED', lastError: 'x', attempts: 1, resendable: true };
const DETAIL = {
  id: 'c1', code: 'K7Q2', blocked: false, blockedAt: null, blockedByUserId: null, user: { id: 'u1', fullName: 'Lan', phone: '0901234234' }, truncated: false,
  messages: [msg({ id: 'm1', forward: FWD }), msg({ id: 'm4', body: 'treo lâu', forward: { ...FWD, id: 'f4', status: 'PENDING' } })],
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

type Route = () => Promise<Response> | Response;
let calls: { method: string; path: string }[] = [];
let routes: Record<string, Route> = {};
let mounted: Rendered | null = null;

beforeEach(() => {
  calls = [];
  routes = {
    'GET bridge': () => json(200, BRIDGE),
    'GET bridge/groups': () => json(200, GROUPS),
    'GET conversations': () => json(200, { items: [ROW], nextCursor: null }),
    'GET conversations/c1': () => json(200, DETAIL),
    'PUT settings': () => json(200, { enabled: true, groupId: 'G2', bridgeSynced: true }),
    'POST bridge/test': () => json(200, { ok: true }),
    'POST bridge/qr': () => json(200, { status: 'WAITING_SCAN', image: 'data:image/png;base64,AAA' }),
    'GET bridge/qr': () => json(200, { status: 'WAITING_SCAN', image: 'data:image/png;base64,AAA' }),
    'POST bridge/logout': () => json(200, { ok: true }),
    'POST bridge/reconnect': () => json(200, { ok: true }),
    'POST conversations/c1/reply': () => json(200, msg({ id: 'm9', sender: 'STAFF', source: 'ADMIN' })),
    'POST conversations/c1/block': () => json(200, { ok: true }),
    'DELETE conversations/c1/block': () => json(200, { ok: true }),
    'POST forwards/f1/resend': () => json(200, { id: 'f1', status: 'SENT', lastError: null, attempts: 2 }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, 'http://x');
      const path = u.pathname.replace(/^.*\/admin\/support-chat\//, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const route = routes[`${method} ${path}`];
      if (!route) return json(500, { message: `no mock for ${method} ${path}` });
      return route();
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const count = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path).length;
const buttons = (root: ParentNode, text: string | RegExp) => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')));
const btn = (root: ParentNode, text: string | RegExp) => buttons(root, text)[0]!;
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const aria = (b: HTMLElement) => ({ busy: b.getAttribute('aria-busy'), disabled: b.getAttribute('aria-disabled'), dom: (b as HTMLButtonElement).disabled });
const alerts = (root: ParentNode) => Array.from(root.querySelectorAll('[role="alert"]')).map((a) => a.textContent ?? '');
const hold = (key: string, g: { promise: Promise<unknown> }, body: unknown, status = 200) => {
  let loads = 0;
  routes[key] = async () => {
    if (++loads > 1) await g.promise;
    return json(status, body);
  };
};
const hang = new Promise<void>(() => {});

async function mountTab(isAdmin: boolean) {
  mounted = render(<SupportChatTab isAdmin={isAdmin} />);
  await flush();
  return mounted.container;
}
async function openDetail(c: HTMLElement) {
  click(c.querySelector('[data-conv="c1"]'));
  await flush();
}
const switchEl = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[role="switch"]')!;

describe('Cầu nối Zalo', () => {
  it('Gửi tin thử: chạm đúp chỉ gửi một tin; nút aria-busy/aria-disabled, không disabled', async () => {
    const g = gate();
    routes['POST bridge/test'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mountTab(true);
    const test = btn(c, 'Gửi tin thử');
    test.focus();
    await tap(test, test);
    await flush(1);
    expect(count('POST', 'bridge/test')).toBe(1);
    expect(aria(btn(c, 'Đang gửi…'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(btn(c, 'Đang gửi…'));
    g.resolve();
    await flush();
    expect(aria(btn(c, 'Gửi tin thử')).disabled).toBeNull();
  });

  it('Đăng nhập Zalo: chạm đúp chỉ lấy một mã QR', async () => {
    const g = gate();
    routes['POST bridge/qr'] = async () => {
      await g.promise;
      return json(200, { status: 'WAITING_SCAN', image: 'data:image/png;base64,AAA' });
    };
    const c = await mountTab(true);
    const login = btn(c, 'Đăng nhập Zalo');
    await tap(login, login);
    await flush(1);
    expect(count('POST', 'bridge/qr')).toBe(1);
    expect(aria(btn(c, /Đang lấy mã/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });

  it('Kết nối lại: chạm đúp chỉ gửi một lệnh; giữ khoá tới khi trạng thái làm mới về', async () => {
    routes['GET bridge'] = () => json(200, { ...BRIDGE, state: 'UNREACHABLE' });
    const g = gate();
    hold('GET bridge', g, { ...BRIDGE, state: 'UNREACHABLE' });
    const c = await mountTab(true);
    const reconnect = btn(c, 'Kết nối lại');
    await tap(reconnect, reconnect);
    await flush();
    expect(count('POST', 'bridge/reconnect')).toBe(1);
    expect(aria(btn(c, /Đang kết nối…|Kết nối lại/))).toMatchObject({ disabled: 'true', dom: false });
    await tap(btn(c, /Đang kết nối…|Kết nối lại/));
    expect(count('POST', 'bridge/reconnect')).toBe(1);
    g.resolve();
    await flush();
    expect(aria(btn(c, 'Kết nối lại')).disabled).toBeNull();
  });

  it('Lưu nhóm: chạm đúp chỉ lưu một lần; khoá giữ tới khi trạng thái làm mới về, hạn 4 giây', async () => {
    useHangTimers();
    let loads = 0;
    routes['GET bridge'] = () => {
      if (++loads > 1) return hang.then(() => json(200, BRIDGE));
      return json(200, BRIDGE);
    };
    const c = await mountTab(true);
    const select = c.querySelector<HTMLSelectElement>('select[name="groupId"]')!;
    act(() => {
      select.value = 'G2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const save = btn(c, 'Lưu nhóm');
    await tap(save, save);
    await flush(1);
    expect(count('PUT', 'settings')).toBe(1);
    await advance(3_500);
    expect(aria(btn(c, /Đang lưu…/))).toMatchObject({ busy: 'true', disabled: 'true', dom: false });
    await advance(700);
    expect(byText(c, 'button', /Đang lưu…/)).toBeNull();
    expect(aria(btn(c, /Lưu nhóm/)).busy).toBeNull();
  });

  it('Đăng xuất: một lệnh; trong lúc ghi sổ bấm lại không mở hộp xác nhận, không gửi lệnh thứ hai', async () => {
    const g = gate();
    routes['POST bridge/logout'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mountTab(true);
    click(btn(c, 'Đăng xuất'));
    await flush();
    answerConfirm(true);
    await flush(3);
    expect(count('POST', 'bridge/logout')).toBe(1);
    expect(aria(btn(c, /Đang đăng xuất/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    click(btn(c, /Đang đăng xuất/));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('POST', 'bridge/logout')).toBe(1);
    g.resolve();
    await flush();
  });

  it('Đăng xuất xong mà trạng thái chưa làm mới về: nút vẫn bận, bấm lại không mở hộp xác nhận; về rồi mới nhả', async () => {
    const g = gate();
    hold('GET bridge', g, BRIDGE);
    const c = await mountTab(true);
    click(btn(c, 'Đăng xuất'));
    await flush();
    answerConfirm(true);
    await flush(3);
    expect(count('POST', 'bridge/logout')).toBe(1);
    expect(count('GET', 'bridge')).toBe(2);
    expect(aria(btn(c, /Đang đăng xuất|Đăng xuất/))).toMatchObject({ disabled: 'true', dom: false });
    click(btn(c, /Đang đăng xuất|Đăng xuất/));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    g.resolve();
    await flush();
    expect(aria(btn(c, 'Đăng xuất')).disabled).toBeNull();
  });

  it('công tắc Cho khách chat: trong lúc ghi sổ aria-disabled (không disabled, giữ focus); bấm lại không mở hộp xác nhận', async () => {
    const g = gate();
    routes['PUT settings'] = async () => {
      await g.promise;
      return json(200, { enabled: true, groupId: 'G1', bridgeSynced: true });
    };
    const c = await mountTab(true);
    switchEl(c).focus();
    click(switchEl(c));
    await flush();
    answerConfirm(true);
    await flush(3);
    expect(count('PUT', 'settings')).toBe(1);
    expect(aria(switchEl(c))).toMatchObject({ disabled: 'true', dom: false });
    expect(document.activeElement).toBe(switchEl(c));
    click(switchEl(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('PUT', 'settings')).toBe(1);
    g.resolve();
    await flush();
  });

  it('bị từ chối vì dữ liệu cũ (409): lời lỗi hiện ngay khi trạng thái còn đang tải lại, và tải lại trạng thái; 500 thì không tải lại', async () => {
    const g = gate();
    hold('GET bridge', g, BRIDGE);
    routes['PUT settings'] = () => json(409, { statusCode: 409, message: 'Nhóm đã đổi.' });
    const c = await mountTab(true);
    click(switchEl(c));
    await flush();
    answerConfirm(true);
    await flush();
    expect(count('GET', 'bridge')).toBe(2);
    expect(alerts(c).join('|')).toContain('Nhóm đã đổi.');
    expect(aria(switchEl(c)).disabled).toBe('true');
    g.resolve();
    await flush();
    expect(aria(switchEl(c)).disabled).toBeNull();

    routes['PUT settings'] = () => json(500, { statusCode: 500, message: 'Lỗi máy chủ.' });
    const before = count('GET', 'bridge');
    click(switchEl(c));
    await flush();
    answerConfirm(true);
    await flush();
    expect(count('GET', 'bridge')).toBe(before);
    expect(alerts(c).join('|')).toContain('Lỗi máy chủ.');
    expect(aria(switchEl(c)).disabled).toBeNull();
  });
});

describe('Hội thoại với khách', () => {
  it('Gửi trả lời: chạm đúp chỉ gửi một tin; nút aria-busy/aria-disabled, không disabled', async () => {
    const g = gate();
    routes['POST conversations/c1/reply'] = async () => {
      await g.promise;
      return json(200, msg({ id: 'm9', sender: 'STAFF', source: 'ADMIN' }));
    };
    const c = await mountTab(false);
    await openDetail(c);
    typeInto(c.querySelector('textarea[name="reply"]'), ' Dạ em chào chị ');
    const send = btn(c, 'Gửi trả lời');
    send.focus();
    await tap(send, send);
    await flush(1);
    expect(count('POST', 'conversations/c1/reply')).toBe(1);
    expect(aria(btn(c, 'Đang gửi…'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(btn(c, 'Đang gửi…'));
    g.resolve();
    await flush();
  });

  it('giữ khoá tới khi hội thoại làm mới về: gửi tiếp trong lúc chờ không gửi tin thứ hai; hạn 4 giây', async () => {
    useHangTimers();
    let loads = 0;
    routes['GET conversations/c1'] = () => {
      if (++loads > 1) return hang.then(() => json(200, DETAIL));
      return json(200, DETAIL);
    };
    const c = await mountTab(false);
    await openDetail(c);
    typeInto(c.querySelector('textarea[name="reply"]'), 'Dạ em chào chị');
    await tap(btn(c, 'Gửi trả lời'));
    await flush();
    expect(count('POST', 'conversations/c1/reply')).toBe(1);
    typeInto(c.querySelector('textarea[name="reply"]'), 'Tin thứ hai');
    await advance(3_500);
    await tap(btn(c, /Đang gửi…|Gửi trả lời/));
    expect(count('POST', 'conversations/c1/reply')).toBe(1);
    await advance(700);
    expect(byText(c, 'button', 'Đang gửi…')).toBeNull();
  });

  it('trả lời bị từ chối (409): giữ nguyên chữ đã gõ, lời lỗi hiện ngay, tải lại hội thoại và danh sách; 500 thì không tải lại', async () => {
    const g = gate();
    hold('GET conversations/c1', g, DETAIL);
    routes['POST conversations/c1/reply'] = () => json(409, { statusCode: 409, message: 'Hội thoại đã đóng.' });
    const c = await mountTab(false);
    await openDetail(c);
    typeInto(c.querySelector('textarea[name="reply"]'), 'Dạ em chào chị');
    const listBefore = count('GET', 'conversations');
    await tap(btn(c, 'Gửi trả lời'));
    await flush();
    expect(count('GET', 'conversations/c1')).toBe(2);
    expect(count('GET', 'conversations')).toBeGreaterThan(listBefore);
    expect(alerts(c).join('|')).toContain('Hội thoại đã đóng.');
    expect(c.querySelector<HTMLTextAreaElement>('textarea[name="reply"]')!.value).toBe('Dạ em chào chị');
    g.resolve();
    await flush();

    routes['POST conversations/c1/reply'] = () => json(500, { statusCode: 500, message: 'Lỗi máy chủ.' });
    const detailBefore = count('GET', 'conversations/c1');
    await tap(btn(c, 'Gửi trả lời'));
    await flush();
    expect(count('GET', 'conversations/c1')).toBe(detailBefore);
    expect(aria(btn(c, 'Gửi trả lời')).busy).toBeNull();
  });

  it('Gửi lại: chạm đúp chỉ gửi một lần; mọi nút Gửi lại aria-disabled, không disabled', async () => {
    const g = gate();
    routes['POST forwards/f1/resend'] = async () => {
      await g.promise;
      return json(200, { id: 'f1', status: 'SENT', lastError: null, attempts: 2 });
    };
    const c = await mountTab(false);
    await openDetail(c);
    const [first, second] = buttons(c, 'Gửi lại');
    first!.focus();
    await tap(first!, first!);
    await flush(1);
    expect(count('POST', 'forwards/f1/resend')).toBe(1);
    expect(aria(btn(c, 'Đang gửi…'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(aria(second!)).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });

  it('Gửi lại bị từ chối: hiện lời lỗi nguyên văn và vẫn tải lại hội thoại, khoá giữ tới khi xong', async () => {
    const g = gate();
    hold('GET conversations/c1', g, DETAIL);
    routes['POST forwards/f1/resend'] = () => json(409, { statusCode: 409, message: 'Tin đã bị xoá' });
    const c = await mountTab(false);
    await openDetail(c);
    await tap(btn(c, 'Gửi lại'));
    await flush();
    expect(c.querySelector('[data-detail-error]')!.textContent).toContain('Tin đã bị xoá');
    expect(count('GET', 'conversations/c1')).toBe(2);
    await tap(btn(c, 'Gửi lại'));
    expect(count('POST', 'forwards/f1/resend')).toBe(1);
    g.resolve();
    await flush();
  });

  it('Chặn chat: một lệnh; trong lúc ghi sổ bấm lại không mở hộp xác nhận; nút aria, không disabled', async () => {
    const g = gate();
    routes['POST conversations/c1/block'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mountTab(false);
    await openDetail(c);
    btn(c, 'Chặn chat').focus();
    click(btn(c, 'Chặn chat'));
    await flush();
    answerConfirm(true);
    await flush(3);
    expect(count('POST', 'conversations/c1/block')).toBe(1);
    expect(aria(btn(c, 'Chặn chat'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(btn(c, 'Chặn chat'));
    click(btn(c, 'Chặn chat'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('POST', 'conversations/c1/block')).toBe(1);
    g.resolve();
    await flush();
  });

  it('Bỏ chặn: chạm đúp chỉ gửi một lệnh', async () => {
    routes['GET conversations/c1'] = () => json(200, { ...DETAIL, blocked: true, blockedAt: '2026-10-23T09:30:00.000Z' });
    const g = gate();
    routes['DELETE conversations/c1/block'] = async () => {
      await g.promise;
      return json(200, { ok: true });
    };
    const c = await mountTab(false);
    await openDetail(c);
    const unblock = btn(c, 'Bỏ chặn');
    await tap(unblock, unblock);
    await flush(1);
    expect(count('DELETE', 'conversations/c1/block')).toBe(1);
    expect(aria(btn(c, 'Bỏ chặn'))).toMatchObject({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });

  it('Chặn chat bị từ chối vì hội thoại không còn (404): lời lỗi hiện ngay và tải lại; 500 thì không tải lại', async () => {
    routes['POST conversations/c1/block'] = () => json(404, { statusCode: 404, message: 'Không tìm thấy hội thoại.' });
    const c = await mountTab(false);
    await openDetail(c);
    const before = count('GET', 'conversations/c1');
    click(btn(c, 'Chặn chat'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(alerts(c).join('|')).toContain('Không tìm thấy hội thoại.');
    expect(count('GET', 'conversations/c1')).toBeGreaterThan(before);

    routes['POST conversations/c1/block'] = () => json(500, { statusCode: 500, message: 'Lỗi máy chủ.' });
    const mid = count('GET', 'conversations/c1');
    click(btn(c, 'Chặn chat'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(count('GET', 'conversations/c1')).toBe(mid);
  });
});

describe('Danh sách hội thoại', () => {
  it('Xem thêm: chạm đúp cùng khung hình chỉ tải một trang; nút aria-busy, không disabled', async () => {
    const g = gate();
    let loads = 0;
    routes['GET conversations'] = async () => {
      loads += 1;
      if (loads > 1) await g.promise;
      return json(200, { items: [ROW], nextCursor: 'next' });
    };
    const c = await mountTab(false);
    const more = btn(c, 'Xem thêm');
    more.focus();
    await tap(more, more);
    await flush(1);
    expect(loads).toBe(2);
    expect(aria(btn(c, 'Đang tải…'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    g.resolve();
    await flush();
  });
});

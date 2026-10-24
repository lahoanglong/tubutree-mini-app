// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { SupportChatTab } from './support-chat-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}
type Handler = (call: Call) => { status?: number; body: unknown };

const BRIDGE = {
  state: 'CONNECTED',
  since: '2026-10-23T03:05:00.000Z',
  lastError: null,
  zaloUid: 'z1',
  displayName: 'CSKH Tubu',
  avatar: null,
  checkedAt: '2026-10-23T03:06:00.000Z',
  groupId: 'G1',
  enabled: false,
};
const GROUPS = { groups: [{ id: 'G1', name: 'Nhóm CSKH', memberCount: 5 }, { id: 'G2', name: 'Nhóm thử', memberCount: 2 }] };
const ROW = {
  id: 'c1',
  code: 'K7Q2',
  blocked: false,
  lastMessageAt: '2026-10-23T09:00:00.000Z',
  user: { id: 'u1', fullName: 'Lan', phone: '0901234234' },
  lastMessage: { sender: 'CUSTOMER', body: 'cho mình hỏi đơn', hasImage: false },
  needsAttention: true,
};
const fwd = (o: Record<string, unknown>) => ({ id: 'f1', status: 'FAILED', lastError: 'x', attempts: 1, resendable: true, ...o });
const msg = (o: Record<string, unknown>) => ({
  id: 'm1',
  sender: 'CUSTOMER',
  source: 'MINIAPP',
  body: 'xin chào',
  imageUrl: null,
  context: null,
  staffName: null,
  adminUserId: null,
  recalledAt: null,
  createdAt: '2026-10-23T09:00:00.000Z',
  forward: null,
  ...o,
});
const DETAIL = {
  id: 'c1',
  code: 'K7Q2',
  blocked: false,
  blockedAt: null,
  blockedByUserId: null,
  user: { id: 'u1', fullName: 'Lan', phone: '0901234234' },
  truncated: false,
  messages: [
    msg({ id: 'm1', forward: fwd({ id: 'f1', status: 'FAILED', resendable: true }) }),
    msg({ id: 'm2', body: 'đã gửi', forward: fwd({ id: 'f2', status: 'SENT', resendable: false }) }),
    msg({ id: 'm3', body: 'đang chờ', forward: fwd({ id: 'f3', status: 'PENDING', resendable: false }) }),
    msg({ id: 'm4', body: 'treo lâu', forward: fwd({ id: 'f4', status: 'PENDING', resendable: true }) }),
    msg({ id: 'm5', body: 'dạ em chào chị', sender: 'STAFF', source: 'ZALO', staffName: 'Hoa' }),
    msg({ id: 'm6', body: 'trả lời từ admin', sender: 'STAFF', source: 'ADMIN', adminUserId: 'a1' }),
    msg({ id: 'm7', body: 'chưa có forward' }),
  ],
};

let calls: Call[] = [];
let overrides: Record<string, Handler> = {};

function stub(extra: Record<string, Handler> = {}) {
  overrides = extra;
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^.*\/admin\/support-chat\//, '') + new URL(url, 'http://x').search;
      const method = init?.method ?? 'GET';
      const call: Call = { method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const key = `${method} ${path.split('?')[0]}`;
      const defaults: Record<string, Handler> = {
        'GET bridge': () => ({ body: BRIDGE }),
        'GET bridge/groups': () => ({ body: GROUPS }),
        'GET conversations': () => ({ body: { items: [ROW], nextCursor: null } }),
        'GET conversations/c1': () => ({ body: DETAIL }),
        'PUT settings': (c) => ({ body: { enabled: true, groupId: 'G1', bridgeSynced: true, ...(c.body as object) } }),
        'POST bridge/test': () => ({ body: { ok: true } }),
        'POST bridge/qr': () => ({ body: { status: 'WAITING_SCAN', image: 'data:image/png;base64,AAA' } }),
        'GET bridge/qr': () => ({ body: { status: 'WAITING_SCAN', image: 'data:image/png;base64,AAA' } }),
        'POST bridge/logout': () => ({ body: { ok: true } }),
        'POST conversations/c1/reply': () => ({ body: msg({ id: 'm9', sender: 'STAFF', source: 'ADMIN' }) }),
        'POST conversations/c1/block': () => ({ body: { ok: true } }),
        'DELETE conversations/c1/block': () => ({ body: { ok: true } }),
        'POST forwards/f1/resend': () => ({ body: { id: 'f1', status: 'SENT', lastError: null, attempts: 2 } }),
      };
      const h = overrides[key] ?? defaults[key];
      const res = h ? h(call) : { status: 500, body: { message: `no mock for ${key}` } };
      return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}
const made = (method: string, path: string) => calls.filter((c) => c.method === method && c.path.split('?')[0] === path);

afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SupportChatTab — thẻ trạng thái cầu nối', () => {
  it.each([
    ['CONNECTED', 'Đang kết nối'],
    ['NEED_QR', 'Cần quét QR'],
    ['KICKED', 'Đăng nhập nơi khác'],
    ['UNREACHABLE', 'Mất kết nối từ 10:05'],
    ['ERROR', 'Mất kết nối từ 10:05'],
  ])('%s hiện "%s"', async (state, copy) => {
    stub({ 'GET bridge': () => ({ body: { ...BRIDGE, state } }) });
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    expect(container.querySelector('[data-bridge-state]')!.textContent).toContain(copy);
    expect(container.querySelector('[data-bridge-state]')!.getAttribute('data-bridge-state')).toBe(state);
  });

  it('hiện tên tài khoản cầu nối', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    expect(container.textContent).toContain('CSKH Tubu');
  });

  it('không tải được trạng thái: báo lỗi có nút thử lại', async () => {
    stub({ 'GET bridge': () => ({ status: 500, body: { message: 'hỏng' } }) });
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    expect(container.textContent).toContain('Không tải được trạng thái cầu nối Zalo.');
    expect(byText(container, 'button', 'Thử lại')).not.toBeNull();
  });
});

describe('SupportChatTab — quyền', () => {
  it('nhân viên CSKH thấy thẻ trạng thái và hội thoại, không thấy đăng nhập, đăng xuất, kết nối lại, chọn nhóm, công tắc, gửi thử', async () => {
    stub({ 'GET bridge': () => ({ body: { ...BRIDGE, state: 'KICKED' } }) });
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    expect(container.querySelector('[data-bridge-state]')).not.toBeNull();
    expect(container.querySelector('[data-conv="c1"]')).not.toBeNull();
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    for (const l of ['Đăng nhập Zalo', 'Đăng xuất', 'Kết nối lại', 'Lưu nhóm', 'Gửi tin thử']) expect(labels).not.toContain(l);
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelector('select[name="groupId"]')).toBeNull();
    expect(made('GET', 'bridge/groups')).toHaveLength(0);
  });

  it('ADMIN thấy đủ nút điều khiển', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    for (const l of ['Đăng nhập Zalo', 'Đăng xuất', 'Lưu nhóm', 'Gửi tin thử']) expect(labels).toContain(l);
    expect(container.querySelector('[role="switch"]')).not.toBeNull();
    expect(container.querySelector('select[name="groupId"]')).not.toBeNull();
  });
});

describe('SupportChatTab — đăng nhập QR', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  });
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const open = async (c: HTMLElement) => {
    click(byText(c, 'button', 'Đăng nhập Zalo'));
    await flush();
  };

  it('hỏi GET bridge/qr mỗi 2 giây, hiện ảnh QR, dừng khi SUCCESS rồi nạp lại trạng thái cầu nối', async () => {
    let n = 0;
    stub({ 'GET bridge/qr': () => ({ body: ++n >= 3 ? { status: 'SUCCESS', displayName: 'CSKH Tubu' } : { status: 'WAITING_SCAN', image: 'data:image/png;base64,AAA' } }) });
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    await open(container);
    expect(made('POST', 'bridge/qr')).toHaveLength(1);
    expect(document.querySelector<HTMLImageElement>('[role="dialog"] img')!.getAttribute('src')).toBe('data:image/png;base64,AAA');
    expect(made('GET', 'bridge/qr')).toHaveLength(0);
    const bridgeBefore = made('GET', 'bridge').length;
    await tick(2000);
    await flush();
    expect(made('GET', 'bridge/qr')).toHaveLength(1);
    await tick(2000);
    await flush();
    expect(made('GET', 'bridge/qr')).toHaveLength(2);
    await tick(2000);
    await flush();
    expect(made('GET', 'bridge/qr')).toHaveLength(3);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Đã đăng nhập');
    await tick(10_000);
    await flush();
    expect(made('GET', 'bridge/qr')).toHaveLength(3);
    expect(made('GET', 'bridge').length).toBeGreaterThan(bridgeBefore);
  });

  it.each(['EXPIRED', 'FAILED'])('dừng hỏi khi %s và cho lấy mã mới', async (status) => {
    stub({ 'GET bridge/qr': () => ({ body: { status } }) });
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    await open(container);
    await tick(2000);
    await flush();
    expect(made('GET', 'bridge/qr')).toHaveLength(1);
    await tick(8000);
    await flush();
    expect(made('GET', 'bridge/qr')).toHaveLength(1);
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]')!;
    click(byText(dlg, 'button', 'Lấy mã mới'));
    await flush();
    expect(made('POST', 'bridge/qr')).toHaveLength(2);
  });

  it('đóng hộp thì ngừng hỏi', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    await open(container);
    await tick(2000);
    await flush();
    expect(made('GET', 'bridge/qr')).toHaveLength(1);
    click(byText(document.querySelector<HTMLElement>('[role="dialog"]')!, 'button', 'Đóng'));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await tick(10_000);
    expect(made('GET', 'bridge/qr')).toHaveLength(1);
  });

  it('gỡ cả tab thì ngừng hỏi', async () => {
    stub();
    const r = mount(<SupportChatTab isAdmin />);
    await flush();
    await open(r.container);
    r.unmount();
    mounted = mounted.filter((m) => m !== r);
    await tick(10_000);
    expect(made('GET', 'bridge/qr')).toHaveLength(0);
  });

  it('không ghi ảnh QR ra console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    stub();
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    await open(container);
    await tick(2000);
    await flush();
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain('AAA');
    spies.forEach((s) => s.mockRestore());
  });
});

describe('SupportChatTab — công tắc chat', () => {
  const sw = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[role="switch"]')!;

  it('bật chat hỏi xác nhận có nhắc rủi ro; Huỷ thì không gọi API', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    click(sw(container));
    const text = confirmDialog()!.textContent ?? '';
    expect(text).toContain('khoá');
    expect(text).toContain('SIM riêng');
    expect(text).toContain('Zalo PC/Web');
    answerConfirm(false);
    await flush();
    expect(made('PUT', 'settings')).toHaveLength(0);
    expect(sw(container).getAttribute('aria-checked')).toBe('false');
  });

  it('xác nhận thì PUT settings {enabled:true} và công tắc bật', async () => {
    let enabled = false;
    stub({
      'GET bridge': () => ({ body: { ...BRIDGE, enabled } }),
      'PUT settings': (c) => {
        enabled = (c.body as { enabled: boolean }).enabled;
        return { body: { enabled, groupId: 'G1', bridgeSynced: true } };
      },
    });
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    click(sw(container));
    answerConfirm(true);
    await flush();
    expect(made('PUT', 'settings')[0]!.body).toEqual({ enabled: true });
    expect(sw(container).getAttribute('aria-checked')).toBe('true');
  });

  it('tắt chat cũng hỏi xác nhận', async () => {
    stub({ 'GET bridge': () => ({ body: { ...BRIDGE, enabled: true } }) });
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    click(sw(container));
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(true);
    await flush();
    expect(made('PUT', 'settings')[0]!.body).toEqual({ enabled: false });
  });

  it.each([
    ['cầu nối chưa CONNECTED', { state: 'NEED_QR' }],
    ['chưa chọn nhóm', { groupId: '' }],
  ])('chặn bật khi %s: có thông báo, không hộp xác nhận, không gọi API', async (_n, patch) => {
    stub({ 'GET bridge': () => ({ body: { ...BRIDGE, ...patch } }) });
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    click(sw(container));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(made('PUT', 'settings')).toHaveLength(0);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('cầu nối đang kết nối và đã chọn nhóm');
  });
});

describe('SupportChatTab — nhóm nhận tin', () => {
  it('chọn nhóm rồi Lưu nhóm gọi PUT settings {groupId}', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    const select = container.querySelector<HTMLSelectElement>('select[name="groupId"]')!;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'G1', 'G2']);
    const save = byText(container, 'button', 'Lưu nhóm') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    act(() => {
      select.value = 'G2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(save.disabled).toBe(false);
    click(save);
    await flush();
    expect(made('PUT', 'settings')[0]!.body).toEqual({ groupId: 'G2' });
  });

  it('poll trạng thái (cùng groupId, checkedAt mới) không làm mất lựa chọn nhóm chưa lưu', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let checkedAt = '2026-10-23T03:06:00.000Z';
    stub({ 'GET bridge': () => ({ body: { ...BRIDGE, checkedAt } }) });
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    const select = container.querySelector<HTMLSelectElement>('select[name="groupId"]')!;
    act(() => {
      select.value = 'G2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    checkedAt = '2026-10-23T03:07:00.000Z';
    const before = made('GET', 'bridge').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await flush();
    expect(made('GET', 'bridge').length).toBeGreaterThan(before);
    expect(container.querySelector<HTMLSelectElement>('select[name="groupId"]')!.value).toBe('G2');
  });

  it('Gửi tin thử gọi POST bridge/test và hiện kết quả; lỗi hiện nguyên văn', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    click(byText(container, 'button', 'Gửi tin thử'));
    await flush();
    expect(made('POST', 'bridge/test')).toHaveLength(1);
    expect(container.querySelector('[data-test-result]')!.textContent).toContain('Đã gửi tin thử');
    overrides['POST bridge/test'] = () => ({ status: 502, body: { code: 'SEND_FAILED', message: 'Zalo từ chối' } });
    click(byText(container, 'button', 'Gửi tin thử'));
    await flush();
    expect(container.querySelector('[data-test-result]')!.textContent).toContain('Zalo từ chối');
  });

  it('nút bấm khoá trong lúc yêu cầu đang chạy', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    stub();
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'POST' && String(url).includes('bridge/test')) await gate;
        return base(url, init);
      }),
    );
    const { container } = mount(<SupportChatTab isAdmin />);
    await flush();
    const btn = byText(container, 'button', 'Gửi tin thử') as HTMLButtonElement;
    click(btn);
    await flush(2);
    expect((byText(container, 'button', 'Đang gửi') as HTMLButtonElement).disabled).toBe(true);
    release();
    await flush();
    expect((byText(container, 'button', 'Gửi tin thử') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('SupportChatTab — hội thoại', () => {
  it('liệt kê hội thoại có mã, tên, SĐT, tin cuối và cờ chưa chuyển được', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    const row = container.querySelector<HTMLElement>('[data-conv="c1"]')!;
    expect(row.textContent).toContain('#K7Q2');
    expect(row.textContent).toContain('Lan');
    expect(row.textContent).toContain('0901234234');
    expect(row.textContent).toContain('cho mình hỏi đơn');
    expect(row.textContent).toContain('Chưa chuyển được');
  });

  it('tìm theo SĐT hoặc mã và lọc "Có tin chưa chuyển được" gửi đúng tham số', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    typeInto(container.querySelector('input[name="q"]'), ' 0901 ');
    click(byText(container, 'button', 'Tìm'));
    await flush();
    expect(calls.some((c) => c.method === 'GET' && c.path === 'conversations?q=0901')).toBe(true);
    click(byText(container, 'button', 'Có tin chưa chuyển được'));
    await flush();
    expect(calls.some((c) => c.method === 'GET' && c.path === 'conversations?q=0901&filter=unforwarded')).toBe(true);
  });

  it('tìm hoặc lọc mà không có kết quả: "Không có hội thoại khớp."', async () => {
    stub({ 'GET conversations': () => ({ body: { items: [], nextCursor: null } }) });
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    expect(container.textContent).toContain('Chưa có hội thoại nào.');
    click(byText(container, 'button', 'Có tin chưa chuyển được'));
    await flush();
    expect(container.textContent).toContain('Không có hội thoại khớp.');
    expect(container.textContent).not.toContain('Chưa có hội thoại nào.');
  });

  it('danh sách trống và lỗi tải', async () => {
    stub({ 'GET conversations': () => ({ body: { items: [], nextCursor: null } }) });
    const a = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    expect(a.container.textContent).toContain('Chưa có hội thoại nào.');
    stub({ 'GET conversations': () => ({ status: 500, body: { message: 'x' } }) });
    const b = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    expect(b.container.textContent).toContain('Không tải được danh sách hội thoại.');
  });

  async function openDetail(c: HTMLElement) {
    click(c.querySelector('[data-conv="c1"]'));
    await flush();
  }

  it('mở chi tiết: staffName, nguồn, SĐT, trạng thái chuyển từng tin; tin không có forward thì không có trạng thái', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    const m = (id: string) => container.querySelector<HTMLElement>(`[data-msg="${id}"]`)!;
    expect(container.querySelector('[data-detail-head]')!.textContent).toContain('0901234234');
    expect(m('m5').textContent).toContain('Hoa');
    expect(m('m5').textContent).toContain('Zalo');
    expect(m('m6').textContent).toContain('Admin');
    expect(m('m1').textContent).toContain('Chuyển lỗi');
    expect(m('m2').textContent).toContain('Đã chuyển vào Zalo');
    expect(m('m3').textContent).toContain('Đang chuyển');
    expect(m('m7').querySelector('[data-forward]')).toBeNull();
    expect(m('m5').querySelector('[data-forward]')).toBeNull();
  });

  it('"Gửi lại" chỉ hiện khi forward.resendable (FAILED/UNKNOWN, PENDING bỏ dở), gọi POST forwards/:id/resend', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    const has = (id: string) => byText(container.querySelector<HTMLElement>(`[data-msg="${id}"]`)!, 'button', 'Gửi lại') !== null;
    expect(['m1', 'm2', 'm3', 'm4', 'm5', 'm7'].map(has)).toEqual([true, false, false, true, false, false]);
    click(byText(container.querySelector<HTMLElement>('[data-msg="m1"]')!, 'button', 'Gửi lại'));
    await flush();
    expect(made('POST', 'forwards/f1/resend')).toHaveLength(1);
  });

  it('gửi lại lỗi hiện thông báo nguyên văn', async () => {
    stub({ 'POST forwards/f1/resend': () => ({ status: 409, body: { message: 'Tin đã bị xoá' } }) });
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    click(byText(container.querySelector<HTMLElement>('[data-msg="m1"]')!, 'button', 'Gửi lại'));
    await flush();
    expect(container.querySelector('[data-detail-error]')!.textContent).toContain('Tin đã bị xoá');
  });

  it('truncated hiện ghi chú 500 tin gần nhất', async () => {
    stub({ 'GET conversations/c1': () => ({ body: { ...DETAIL, truncated: true } }) });
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    expect(container.textContent).toContain('Chỉ hiện 500 tin gần nhất.');
  });

  it('không truncated thì không có ghi chú', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    expect(container.textContent).not.toContain('Chỉ hiện 500 tin gần nhất.');
  });

  it('ảnh chỉ hiện khi URL http(s); javascript: thì không có img; alt theo người gửi', async () => {
    stub({
      'GET conversations/c1': () => ({
        body: {
          ...DETAIL,
          messages: [
            msg({ id: 'i1', body: '', imageUrl: 'https://cdn.test/a.png' }),
            msg({ id: 'i2', body: '', imageUrl: 'javascript:alert(1)' }),
            msg({ id: 'i3', body: '', sender: 'STAFF', source: 'ZALO', staffName: 'Hoa', imageUrl: 'https://cdn.test/b.png' }),
          ],
        },
      }),
    });
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    const m = (id: string) => container.querySelector<HTMLElement>(`[data-msg="${id}"]`)!;
    expect(m('i1').querySelector('img')!.getAttribute('alt')).toBe('Ảnh khách gửi');
    expect(m('i2').querySelector('img')).toBeNull();
    expect(m('i2').textContent).toContain('Ảnh không hiển thị được');
    expect(m('i3').querySelector('img')!.getAttribute('alt')).toBe('Ảnh nhân viên gửi');
  });

  it('một lần làm mới nền lỗi vẫn giữ thread đã tải, chỉ hiện dòng lỗi nhỏ', async () => {
    let fail = false;
    stub({ 'GET conversations/c1': () => (fail ? { status: 500, body: { message: 'hỏng' } } : { body: DETAIL }) });
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    fail = true;
    click(byText(container, 'button', 'Chặn chat'));
    answerConfirm(true);
    await flush();
    expect(container.querySelector('[data-msg="m1"]')).not.toBeNull();
    expect(container.querySelector('[data-refresh-error]')!.textContent).toContain('Không làm mới được hội thoại.');
  });

  it('tin STAFF nguồn ADMIN không có tên: chỉ hiện "Admin" một lần', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    const head = container.querySelector<HTMLElement>('[data-msg="m6"] p')!.textContent ?? '';
    expect(head.match(/Admin/g)).toHaveLength(1);
    const zalo = container.querySelector<HTMLElement>('[data-msg="m5"] p')!.textContent ?? '';
    expect(zalo).toContain('Hoa · Zalo');
  });

  it('trả lời gọi POST conversations/:id/reply, xoá ô nhập; nút khoá khi ô trống', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    const send = byText(container, 'button', 'Gửi trả lời') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    typeInto(container.querySelector('textarea[name="reply"]'), '  Dạ em chào chị  ');
    expect(send.disabled).toBe(false);
    click(send);
    await flush();
    expect(made('POST', 'conversations/c1/reply')[0]!.body).toEqual({ body: 'Dạ em chào chị' });
    expect(container.querySelector<HTMLTextAreaElement>('textarea[name="reply"]')!.value).toBe('');
  });

  it('chặn chat có xác nhận: Huỷ không gọi API, xác nhận thì POST block', async () => {
    stub();
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    click(byText(container, 'button', 'Chặn chat'));
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush();
    expect(made('POST', 'conversations/c1/block')).toHaveLength(0);
    click(byText(container, 'button', 'Chặn chat'));
    answerConfirm(true);
    await flush();
    expect(made('POST', 'conversations/c1/block')).toHaveLength(1);
  });

  it('hội thoại đã chặn: nút Bỏ chặn gọi DELETE block', async () => {
    stub({ 'GET conversations/c1': () => ({ body: { ...DETAIL, blocked: true, blockedAt: '2026-10-23T09:30:00.000Z' } }) });
    const { container } = mount(<SupportChatTab isAdmin={false} />);
    await flush();
    await openDetail(container);
    expect(container.textContent).toContain('Đã chặn');
    click(byText(container, 'button', 'Bỏ chặn'));
    await flush();
    expect(made('DELETE', 'conversations/c1/block')).toHaveLength(1);
  });
});

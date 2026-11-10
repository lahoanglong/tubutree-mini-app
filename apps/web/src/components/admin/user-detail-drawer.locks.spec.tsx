// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDetailDrawer } from './user-detail-drawer';
import { answerAsk, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';
import type { AdminUserDetail } from '@/lib/admin-client';

// W96B: bốn lệnh ghi QUYỀN/TIỀN của ngăn kéo người dùng (huỷ hoa hồng chờ rút, nhóm việc nhân viên, cắt phiên, khoá đổi rác) giữ khoá tới khi dữ
// liệu làm mới về (tối đa 4 giây); bị từ chối vì trạng thái đã đổi (400/404/409) thì tải lại, lỗi khác không tải lại. Mỗi ca chạm lại TRONG khoá.

const USER = {
  id: 'u1',
  fullName: 'Nguyễn Văn An',
  phone: '0944444444',
  email: null,
  role: 'CUSTOMER',
  staffPermissions: [] as string[],
  referralCode: null,
  pointsBalance: 55,
  pointsConvertedBalance: 0,
  walletBalance: 220000,
  isBlocked: false,
  blockedAt: null,
  blockedReason: null,
  affiliateRevokedAt: null as string | null,
  createdAt: '2026-09-01T03:00:00.000Z',
  tier: null,
};
const detail = (over: Partial<typeof USER> = {}, extra: Record<string, unknown> = {}) =>
  ({ user: { ...USER, ...over }, orders: { items: [], total: 0 }, wallet: [], points: [], roleHistory: [], blockHistory: [], grants: [], ...extra }) as unknown as AdminUserDetail;
const NO_FLAGS = { userId: 'u1', shipLockedAt: null, shipUnlockedAt: null, blockedAt: null, reason: null, setByUserId: null, updatedAt: null };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let currentDetail: AdminUserDetail;
let detailGate: Promise<void> | undefined;
let flagsGate: Promise<void> | undefined;
let detailLoads = 0;
let flagsLoads = 0;
let writeStatus = 200;
let currentFlags: Record<string, unknown> = NO_FLAGS;
const calls: { method: string; url: string }[] = [];
const detailGets = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/users/u1/detail')).length;
const flagsGets = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/waste/users/u1/flags')).length;
const writes = (part: string) => calls.filter((c) => c.method !== 'GET' && c.url.includes(part)).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  detailGate = undefined;
  flagsGate = undefined;
  detailLoads = 0;
  flagsLoads = 0;
  writeStatus = 200;
  currentFlags = NO_FLAGS;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'GET' && url.includes('/admin/waste/users/u1/flags')) {
        flagsLoads += 1;
        if (flagsLoads > 1) await flagsGate;
        return json(200, currentFlags);
      }
      if (method === 'GET' && url.includes('/admin/users/u1/detail')) {
        detailLoads += 1;
        if (detailLoads > 1) await detailGate;
        return json(200, currentDetail);
      }
      if (writeStatus !== 200) return json(writeStatus, { statusCode: writeStatus, message: `Lỗi ${writeStatus} từ máy chủ` });
      if (url.includes('/forfeit-commissions')) return json(200, { cancelled: 2, amount: 100000 });
      if (url.includes('/staff-permissions')) return json(200, { id: 'u1', staffPermissions: ['KHO'], changed: true });
      if (url.includes('/revoke-sessions')) return json(200, { id: 'u1', revokedSessions: 2 });
      return json(200, NO_FLAGS);
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = async (d: AdminUserDetail) => {
  currentDetail = d;
  mounted = render(<UserDetailDrawer userId="u1" isAdmin onClose={() => undefined} />);
  await flush();
  return document.body;
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const tap = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};

type Scenario = {
  name: string;
  open: () => Promise<HTMLElement>;
  button: string;
  /** Dẫn tới hộp hỏi lý do đã mở (đã chọn nhóm việc nếu cần). */
  prepare?: (body: HTMLElement) => void;
  writePart: string;
  gets: () => number;
  hold: (p: Promise<void> | undefined) => void;
};
const scenarios: Scenario[] = [
  {
    name: 'Huỷ hoa hồng chờ rút',
    open: () => mount(detail({ affiliateRevokedAt: '2026-10-20T18:00:00.000Z' }, { forfeitableCommission: { count: 2, amount: 100000 } })),
    button: 'Huỷ hoa hồng chờ rút',
    writePart: '/forfeit-commissions',
    gets: detailGets,
    hold: (p) => (detailGate = p),
  },
  {
    name: 'Lưu nhóm việc nhân viên',
    open: () => mount(detail({ role: 'STAFF' })),
    button: 'Lưu nhóm việc',
    prepare: (body) => click(body.querySelector('section[aria-label="Nhóm việc nhân viên"] input[type="checkbox"]')),
    writePart: '/staff-permissions',
    gets: detailGets,
    hold: (p) => (detailGate = p),
  },
  {
    name: 'Cắt phiên',
    open: () => mount(detail()),
    button: 'Cắt phiên',
    writePart: '/revoke-sessions',
    gets: detailGets,
    hold: (p) => (detailGate = p),
  },
  {
    name: 'Khoá đổi rác',
    open: () => mount(detail()),
    button: 'Khoá đổi rác',
    writePart: '/admin/waste/users/u1/flags',
    gets: flagsGets,
    hold: (p) => (flagsGate = p),
  },
];

describe.each(scenarios)('$name', (sc) => {
  const btn = (body: HTMLElement) => byText(body, 'button', new RegExp(`^${sc.button}$|^Đang lưu`)) as HTMLButtonElement;
  const run = async (body: HTMLElement) => {
    sc.prepare?.(body);
    await flush(1);
    click(btn(body));
    await flush(1);
    answerAsk('Lý do hợp lệ của quản trị');
    await flush(4);
  };

  it('xong mà dữ liệu chưa về: nút aria-busy/aria-disabled (không disabled); chạm lại không mở hộp hỏi và không gửi lệnh thứ hai; về rồi mới nhả', async () => {
    const body = await sc.open();
    const list = gate();
    sc.hold(list.promise);
    const before = sc.gets();
    await run(body);
    expect(writes(sc.writePart)).toBe(1);
    expect(sc.gets()).toBe(before + 1);
    const b = btn(body);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes(sc.writePart)).toBe(1);
    list.resolve();
    await flush();
    const after = btn(body) as HTMLButtonElement | null;
    if (after) {
      expect(after.getAttribute('aria-busy')).toBeNull();
      expect(after.getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('dữ liệu không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const body = await sc.open();
    sc.hold(new Promise<void>(() => {}));
    await run(body);
    await advance(3_500);
    expect(btn(body).getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    const after = btn(body) as HTMLButtonElement | null;
    if (after) expect(after.getAttribute('aria-disabled')).toBeNull();
  });

  it('bị từ chối vì trạng thái đã đổi (409): hiện lỗi ngay, tải lại rồi mới nhả khoá', async () => {
    const body = await sc.open();
    const list = gate();
    sc.hold(list.promise);
    writeStatus = 409;
    const before = sc.gets();
    await run(body);
    expect(sc.gets()).toBe(before + 1);
    expect(body.querySelector('[role="alert"]')?.textContent).toContain('Lỗi 409');
    expect(btn(body).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn(body).getAttribute('aria-disabled')).toBeNull();
  });

  it('lỗi 500: hiện lỗi, KHÔNG tải lại, nhả khoá ngay', async () => {
    const body = await sc.open();
    writeStatus = 500;
    const before = sc.gets();
    await run(body);
    expect(sc.gets()).toBe(before);
    expect(body.querySelector('[role="alert"]')).not.toBeNull();
    expect(btn(body).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('Huỷ hoa hồng chờ rút: câu báo không mất khi dữ liệu mới làm mục biến mất', () => {
  it('xong rồi mà khoản chờ về 0 (mục bị gỡ): câu "Đã huỷ 2 khoản" vẫn còn', async () => {
    const body = await mount(detail({ affiliateRevokedAt: '2026-10-20T18:00:00.000Z' }, { forfeitableCommission: { count: 2, amount: 100000 } }));
    const next = detail({ affiliateRevokedAt: '2026-10-20T18:00:00.000Z' }, { forfeitableCommission: null });
    const list = gate();
    detailGate = list.promise.then(() => {
      currentDetail = next;
    });
    await flush(1);
    click(byText(body, 'button', 'Huỷ hoa hồng chờ rút'));
    await flush(1);
    answerAsk('Lý do hợp lệ của quản trị');
    await flush(4);
    list.resolve();
    await flush();
    expect(byText(body, 'button', 'Huỷ hoa hồng chờ rút')).toBeNull();
    expect(body.textContent).toContain('Đã huỷ 2 khoản hoa hồng');
  });
});

describe('Khoá đổi rác: chỉ nút của cờ đang đổi báo bận', () => {
  it('khoá đổi rác đang chạy: "Khoá đổi rác" aria-busy, "Khoá gửi kho" chỉ aria-disabled', async () => {
    const body = await mount(detail());
    const list = gate();
    flagsGate = list.promise;
    click(byText(body, 'button', /^Khoá đổi rác$/));
    await flush(1);
    answerAsk('Lý do hợp lệ của quản trị');
    await flush(4);
    expect(byText(body, 'button', /^Khoá đổi rác$/)!.getAttribute('aria-busy')).toBe('true');
    const ship = byText(body, 'button', /^Khoá gửi kho$/)!;
    expect(ship.getAttribute('aria-busy')).toBeNull();
    expect(ship.getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
  });

  it('đã khoá đổi rác, đang khoá gửi kho: "Khoá gửi kho" aria-busy, "Mở khoá đổi rác" chỉ aria-disabled', async () => {
    currentFlags = { ...NO_FLAGS, blockedAt: '2026-10-20T18:00:00.000Z', reason: 'Gian lận' };
    const body = await mount(detail());
    const list = gate();
    flagsGate = list.promise;
    click(byText(body, 'button', /^Khoá gửi kho$/));
    await flush(1);
    answerAsk('Lý do hợp lệ của quản trị');
    await flush(4);
    expect(byText(body, 'button', /^Khoá gửi kho$/)!.getAttribute('aria-busy')).toBe('true');
    const unlock = byText(body, 'button', /^Mở khoá đổi rác$/)!;
    expect(unlock.getAttribute('aria-busy')).toBeNull();
    expect(unlock.getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
  });

  it('đã khoá gửi kho, đang khoá đổi rác: "Khoá đổi rác" aria-busy, "Mở khoá gửi kho" chỉ aria-disabled', async () => {
    currentFlags = { ...NO_FLAGS, shipLockedAt: '2026-10-20T18:00:00.000Z', reason: 'Gian lận' };
    const body = await mount(detail());
    const list = gate();
    flagsGate = list.promise;
    click(byText(body, 'button', /^Khoá đổi rác$/));
    await flush(1);
    answerAsk('Lý do hợp lệ của quản trị');
    await flush(4);
    expect(byText(body, 'button', /^Khoá đổi rác$/)!.getAttribute('aria-busy')).toBe('true');
    const unlock = byText(body, 'button', /^Mở khoá gửi kho$/)!;
    expect(unlock.getAttribute('aria-busy')).toBeNull();
    expect(unlock.getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
  });

  it('khoá gửi kho đang chạy: "Khoá gửi kho" aria-busy, "Khoá đổi rác" chỉ aria-disabled', async () => {
    const body = await mount(detail());
    const list = gate();
    flagsGate = list.promise;
    click(byText(body, 'button', /^Khoá gửi kho$/));
    await flush(1);
    answerAsk('Lý do hợp lệ của quản trị');
    await flush(4);
    expect(byText(body, 'button', /^Khoá gửi kho$/)!.getAttribute('aria-busy')).toBe('true');
    const blocked = byText(body, 'button', /^Khoá đổi rác$/)!;
    expect(blocked.getAttribute('aria-busy')).toBeNull();
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
  });
});

describe('số dùng tabular-nums', () => {
  it('dòng "Còn N khoản, X đang chờ" của hoa hồng chờ rút', async () => {
    const body = await mount(detail({ affiliateRevokedAt: '2026-10-20T18:00:00.000Z' }, { forfeitableCommission: { count: 2, amount: 100000 } }));
    const line = byText(body, 'p', /^Còn 2 khoản/);
    expect(line?.classList.contains('tabular-nums')).toBe(true);
  });
});

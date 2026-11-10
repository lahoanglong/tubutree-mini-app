// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// Khoá chạm đúp của /nhan-vien/bang-luong (Mini ↔ web): lưu thông tin nhận lương và "Thử lại" trả refetch(). Ca "cùng tick" gọi click
// hai lần trong MỘT act: state chưa kịp vẽ lại giữa hai cú bấm.

type Call = { method: string; path: string; body?: unknown };
type Deferred = { promise: Promise<unknown>; resolve: (v?: unknown) => void; reject: (e: unknown) => void };
type Gate = { path: string; promise: Promise<unknown> };

const m = vi.hoisted(() => ({
  calls: [] as Call[],
  gates: [] as Array<{ path: string; promise: Promise<unknown> }>,
  failOnce: new Set<string>(),
  put: null as null | (() => unknown),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: 'STAFF' } }) }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ label, onChange }: { label: string; onChange: (v: string[]) => void }) => (
    <button type="button" onClick={() => onChange(['data:image/jpeg;base64,QR'])}>
      {label}
    </button>
  ),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      m.calls.push({ method: 'GET', path });
      for (const g of m.gates.filter((x) => x.path === path)) await g.promise;
      if (m.failOnce.has(path)) {
        m.failOnce.delete(path);
        throw new Error('Mất kết nối');
      }
      if (path === '/staff/payroll') return PAYROLL;
      if (path === '/staff/attendance/history') return [];
      throw new Error(`chưa mock ${path}`);
    },
    put: async (path: string, body?: unknown) => {
      m.calls.push({ method: 'PUT', path, body });
      return m.put!();
    },
  },
}));

import MyPayrollPage from './page';

const PROFILE = { hourlyRate: 30000, bankBin: '970407', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A', qrImageUrl: null, active: true };
const PAYROLL = {
  month: { year: 2026, month: 3, totalMinutes: 270, gross: 135000, totalFines: 0, net: 135000, status: 'FINALIZED', paidAt: null, proofImageUrl: null, note: null },
  days: [{ id: 'd1', workDate: '2026-03-02T00:00:00.000Z', workedMinutes: 270, hourlyRate: 30000, gross: 135000, fines: 0, net: 135000 }],
  profile: PROFILE,
};
const BIN_LABEL = 'Mã số ngân hàng (6 chữ số, VD 970407; chưa biết thì tải ảnh QR ở dưới)';

const defer = (): Deferred => {
  let resolve!: (v?: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const holdGet = (path: string) => {
  const d = defer();
  const gate: Gate = { path, promise: d.promise };
  m.gates.push(gate);
  return {
    release: () => {
      m.gates.splice(m.gates.indexOf(gate), 1);
      d.resolve();
    },
  };
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<MyPayrollPage />);
  mounted.push(r);
  await flush(8);
  return r;
};
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
const nameOf = (b: Element) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim();
const btn = (name: string | RegExp) => buttons().find((b) => (typeof name === 'string' ? nameOf(b) === name : name.test(nameOf(b))))!;
const save = () => btn(/^(Lưu|Đang lưu…)$/);
const puts = () => m.calls.filter((c) => c.method === 'PUT');
const gets = (path: string) => m.calls.filter((c) => c.method === 'GET' && c.path === path);
const sameTick = (...els: HTMLElement[]) =>
  act(() => {
    for (const el of els) el.click();
  });
const busy = (el: HTMLElement) => el.getAttribute('aria-busy') === 'true';
const text = () => document.body.textContent ?? '';
const sheetOpen = () => Array.from(document.querySelectorAll('h2')).some((h) => h.textContent === 'Thông tin nhận lương');
const closeBtn = () => document.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]');
const escape = () => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
const field = (t: string) => {
  const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent === t);
  return document.getElementById(label?.getAttribute('for') ?? '__none__') as HTMLInputElement;
};
const openBank = async () => {
  click(btn('Thông tin nhận lương'));
  await flush(6);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-15T05:00:00Z'));
  m.calls = [];
  m.gates = [];
  m.failOnce.clear();
  m.put = () => PROFILE;
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('/nhan-vien/bang-luong — Thông tin nhận lương', () => {
  it('hai cú bấm cùng tick chỉ gửi một lần; nút aria-busy + aria-disabled, KHÔNG disabled; sheet không đóng được khi đang lưu', async () => {
    const put = defer();
    m.put = () => put.promise;
    await mount();
    await openBank();
    sameTick(save(), save());
    await flush();
    expect(puts()).toHaveLength(1);
    expect(busy(save())).toBe(true);
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(save().disabled).toBe(false);
    expect(closeBtn()).toBeNull();
    escape();
    expect(sheetOpen()).toBe(true);
    put.resolve(PROFILE);
    await flush();
    expect(sheetOpen()).toBe(false);
    expect(text()).toContain('Đã lưu thông tin nhận lương.');
  });

  it('khoá giữ tới khi bảng lương mới về: mở lại tấm trong lúc tải lại thì nút còn bận và cú bấm bị bỏ', async () => {
    await mount();
    await openBank();
    const hold = holdGet('/staff/payroll');
    click(save());
    await flush();
    expect(puts()).toHaveLength(1);
    expect(sheetOpen()).toBe(false);
    await openBank();
    expect(busy(save())).toBe(true);
    click(save());
    await flush();
    expect(puts()).toHaveLength(1);
    hold.release();
    await flush();
    expect(busy(save())).toBe(false);
    click(save());
    await flush();
    expect(puts()).toHaveLength(2);
  });

  it('lưu lỗi: nhả khoá, giữ ô đã nhập, báo role=alert, sheet đóng lại được và lưu lại được', async () => {
    m.put = () => {
      throw new Error('Máy chủ bận');
    };
    await mount();
    await openBank();
    typeInto(field(BIN_LABEL), '970436');
    click(save());
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ bận');
    expect(sheetOpen()).toBe(true);
    expect(field(BIN_LABEL).value).toBe('970436');
    expect(busy(save())).toBe(false);
    expect(closeBtn()).not.toBeNull();
    click(save());
    await flush();
    expect(puts()).toHaveLength(2);
  });

  it('lệnh gửi bản chụp lúc bấm: ô gõ thêm sau đó không đổi nội dung đã gửi', async () => {
    const put = defer();
    m.put = () => put.promise;
    await mount();
    await openBank();
    typeInto(field(BIN_LABEL), '970436');
    click(save());
    await flush();
    typeInto(field(BIN_LABEL), '999999');
    put.resolve(PROFILE);
    await flush();
    expect(puts()[0]!.body).toEqual({ bankBin: '970436', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN VAN A' });
  });
});

describe('/nhan-vien/bang-luong — "Thử lại" trả refetch()', () => {
  // Truy vấn chưa có data thì lúc refetch bắt đầu nó về 'pending' và thẻ lỗi biến mất: chỉ thấy aria-busy ở lần vẽ ngay sau cú bấm.
  it('"Thử lại" của ErrorState aria-busy ngay sau cú bấm và bảng lương hiện ra khi tải xong', async () => {
    m.failOnce.add('/staff/payroll');
    await mount();
    const hold = holdGet('/staff/payroll');
    const retry = btn('Thử lại');
    click(retry);
    expect(busy(retry)).toBe(true);
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    expect(retry.disabled).toBe(false);
    hold.release();
    await flush();
    expect(text()).toContain('Thực nhận tháng 3/2026');
    expect(gets('/staff/payroll')).toHaveLength(2);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

// Wave 96B (Mini ↔ web, Wave 76A): "Thông tin nhận lương" giữ khoá tới khi bảng lương mới về, có hạn 4 giây; bị từ chối 400/404/409 thì tải lại.
// Mini chỉ `invalidate` không chờ, web chặt hơn có chủ ý.

type Call = { method: string; path: string; body?: unknown };
type Gate = { path: string; promise: Promise<unknown> };

const m = vi.hoisted(() => ({
  calls: [] as Call[],
  gates: [] as Array<{ path: string; promise: Promise<unknown> }>,
  put: null as null | ((body: unknown) => unknown),
  fines: 0,
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn(), user: { role: 'STAFF' } }) }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      m.calls.push({ method: 'GET', path });
      for (const g of m.gates.filter((x) => x.path === path)) await g.promise;
      if (path === '/staff/payroll') {
        const day = { ...PAYROLL.days[0]!, fines: m.fines };
        return { ...PAYROLL, days: [day], month: { ...PAYROLL.month, totalFines: m.fines } };
      }
      if (path === '/staff/attendance/history') return [];
      throw new Error(`chưa mock ${path}`);
    },
    put: async (path: string, body?: unknown) => {
      m.calls.push({ method: 'PUT', path, body });
      return m.put!(body);
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
const NOW = '2026-03-15T05:00:00Z';
const ACC_LABEL = 'Số tài khoản';

const holdGet = (path: string) => {
  let resolve!: () => void;
  const gate: Gate = { path, promise: new Promise<void>((r) => (resolve = r)) };
  m.gates.push(gate);
  return {
    release: () => {
      m.gates.splice(m.gates.indexOf(gate), 1);
      resolve();
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
const opener = () => btn('Thông tin nhận lương');
const puts = () => m.calls.filter((c) => c.method === 'PUT');
const payrollGets = () => m.calls.filter((c) => c.method === 'GET' && c.path === '/staff/payroll');
const busy = (el: HTMLElement) => el.getAttribute('aria-busy') === 'true';
const sheetOpen = () => Array.from(document.querySelectorAll('h2')).some((h) => h.textContent === 'Thông tin nhận lương');
const alerts = () => Array.from(document.querySelectorAll('[role="alert"]')).map((a) => a.textContent ?? '').join(' | ');
const field = (t: string) => {
  const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent === t);
  return document.getElementById(label?.getAttribute('for') ?? '__none__') as HTMLInputElement;
};
const openBank = async () => {
  click(opener());
  await flush(6);
};
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const useHangTimers = () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(NOW));
};
const reject = (status: number, message: string) => () => {
  throw new ApiError(message, status);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  m.calls = [];
  m.gates = [];
  m.put = () => PROFILE;
  m.fines = 0;
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('/nhan-vien/bang-luong — Thông tin nhận lương: khoá giữ tới khi bảng lương về, có hạn 4 giây', () => {
  it('bảng lương không bao giờ về: nút mở còn bận ở 3,5 giây và bấm không mở tấm; nhả sau hạn 4 giây và mở lại được', async () => {
    useHangTimers();
    await mount();
    await openBank();
    typeInto(field(ACC_LABEL), '9999999999');
    holdGet('/staff/payroll');
    click(save());
    await flush();
    expect(puts()).toHaveLength(1);
    await advance(3_500);
    expect(busy(opener())).toBe(true);
    click(opener());
    await flush();
    expect(sheetOpen()).toBe(false);
    await advance(700);
    expect(busy(opener())).toBe(false);
    await openBank();
    expect(sheetOpen()).toBe(true);
  });

  it('bị từ chối 400/404/409: hiện lỗi, tải lại bảng lương, giữ khoá (tấm mở lại không được, Lưu không gửi thêm) tới khi bảng lương về', async () => {
    for (const status of [400, 404, 409]) {
      m.calls = [];
      m.put = reject(status, 'Mã ngân hàng không hợp lệ.');
      const r = await mount();
      await openBank();
      const before = payrollGets().length;
      const gate = holdGet('/staff/payroll');
      click(save());
      await flush();
      expect(puts()).toHaveLength(1);
      expect(alerts()).toContain('Mã ngân hàng không hợp lệ.');
      expect(payrollGets()).toHaveLength(before + 1);
      expect(sheetOpen()).toBe(true);
      expect(busy(save())).toBe(true);
      click(save());
      await flush();
      expect(puts()).toHaveLength(1);
      gate.release();
      await flush();
      expect(busy(save())).toBe(false);
      click(save());
      await flush();
      expect(puts()).toHaveLength(2);
      r.unmount();
      mounted = [];
      document.body.innerHTML = '';
    }
  });

  it('bị từ chối mà tải lại treo: vẫn nhả khoá sau hạn 4 giây', async () => {
    useHangTimers();
    m.put = reject(409, 'Hồ sơ đã đổi.');
    await mount();
    await openBank();
    holdGet('/staff/payroll');
    click(save());
    await flush();
    await advance(3_500);
    expect(busy(save())).toBe(true);
    await advance(700);
    expect(busy(save())).toBe(false);
  });

  it('lỗi 500: hiện lỗi, KHÔNG tải lại bảng lương, nhả khoá ngay', async () => {
    m.put = reject(500, 'Máy chủ lỗi');
    await mount();
    await openBank();
    const before = payrollGets().length;
    click(save());
    await flush();
    expect(alerts()).toContain('Máy chủ đang bận');
    expect(payrollGets()).toHaveLength(before);
    expect(busy(save())).toBe(false);
  });
});

describe('/nhan-vien/bang-luong — số dùng tabular-nums', () => {
  const has = (el: Element | null | undefined) => el?.classList.contains('tabular-nums') === true;

  it('dòng tổng kết (giờ công, đơn giá, lương gộp, phạt), tổng tuần, ngày và tiền phạt của ngày', async () => {
    m.fines = 15_000;
    await mount();
    const stat = Array.from(document.querySelectorAll('span')).find((e) => e.textContent?.startsWith('Giờ công:'));
    expect(stat).toBeDefined();
    expect(has(stat!.parentElement)).toBe(true);
    const weekTotal = document.querySelector('section h2')!.nextElementSibling;
    expect(weekTotal?.textContent).toContain('4h30');
    expect(has(weekTotal)).toBe(true);
    const dayLabel = document.querySelector('button[aria-expanded] > span');
    expect(dayLabel?.textContent).toContain('4h30');
    expect(has(dayLabel)).toBe(true);
    const fines = Array.from(document.querySelectorAll('span')).find((e) => /phạt$/.test(e.textContent ?? '') && e.textContent!.startsWith('−'));
    expect(fines).toBeDefined();
    expect(has(fines)).toBe(true);
  });
});

// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/export-csv', () => ({ downloadCsvFile: () => undefined }));
vi.mock('@/components/evidence-upload', () => ({
  EvidenceUpload: ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" data-testid="proof" onClick={() => onChange(['data:image/jpeg;base64,AAAA'])}>
      Ảnh ({value.length})
    </button>
  ),
}));

import { PayrollAdminTab } from './payroll-admin-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { currentVnYearMonth } from '@/lib/week';

// W79B: khoá đồng bộ cho đơn giá, chốt, mở lại, đã trả lương và sửa giờ phiên (Mini ↔ web, W79A).

let mounted: Rendered[] = [];
const mount = async (client?: QueryClient) => {
  const r = render(<PayrollAdminTab />, client);
  mounted.push(r);
  await flush();
  return r.container;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const { year, month } = currentVnYearMonth();
const mon = (status: string) => ({ year, month, totalMinutes: 125, gross: 500_000, totalFines: 0, net: 480_000, status, paidAt: null, proofImageUrl: null, note: null });
const row = (id: string, name: string, status: string) => ({
  staff: { id, fullName: name, phone: `09${id}00000` },
  month: mon(status),
  profile: { hourlyRate: 40_000, bankBin: null, bankAccountNo: '123', bankAccountName: 'LAN', qrImageUrl: null, active: true },
  qrImageUrl: null,
});
const DETAIL = {
  month: mon('OPEN'),
  days: [{ id: 'd1', workDate: '2026-10-19T00:00:00.000Z', workedMinutes: 480, hourlyRate: 40_000, gross: 320_000, fines: 0, net: 320_000 }],
  profile: null,
  sessions: [{ id: 'ss1', shiftId: 'sh1', checkinAt: '2026-10-19T01:00:00.000Z', checkoutAt: '2026-10-19T09:00:00.000Z', isLate: false, closeReason: null }],
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
type Gates = {
  write?: Promise<void>;
  list?: Promise<void>;
  detail?: Promise<void>;
  failOnce?: boolean;
  /** Bảng lương trả về sau khi một lệnh ghi đã xong (như máy chủ thật sau khi chốt). */
  after?: unknown[];
};

function stub(rows: unknown[], gates: Gates = {}) {
  const calls: { url: string; method: string }[] = [];
  let listLoads = 0;
  let failed = false;
  let written = false;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (method !== 'GET') {
        if (gates.failOnce && !failed) {
          failed = true;
          return json({ message: 'Máy chủ đang bận' }, 500);
        }
        await gates.write;
        written = true;
        return json({ ok: true, hourlyRate: 50_000 });
      }
      if (url.includes('/detail')) {
        await gates.detail;
        return json(DETAIL);
      }
      listLoads += 1;
      if (listLoads > 1) await gates.list;
      return json(written && gates.after ? gates.after : rows);
    }),
  );
  return { calls, writes: () => calls.filter((c) => c.method !== 'GET'), lists: () => calls.filter((c) => c.method === 'GET' && /\/admin\/payroll\?/.test(c.url)).map((c) => c.url) };
}

const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const q = <T extends HTMLElement = HTMLButtonElement>(root: ParentNode, label: string) => root.querySelector<T>(`[aria-label="${label}"]`)!;
const accept = () => confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;

describe('PayrollAdminTab: chốt / mở lại / đã trả loại trừ nhau', () => {
  it('chạm đúp xác nhận "Chốt lương" chỉ gửi một lệnh; dòng aria-busy, mọi dòng aria-disabled, không disabled', async () => {
    const gate = deferred();
    const api = stub([row('1', 'Lan', 'OPEN'), row('2', 'Mai', 'OPEN')], { write: gate.promise });
    const c = await mount();
    click(q(c, 'Chốt · Lan'));
    await flush();
    await act(async () => {
      accept().click();
      accept().click();
    });
    await flush(1);
    expect(api.writes()).toHaveLength(1);
    expect(q(c, 'Chốt · Lan').getAttribute('aria-busy')).toBe('true');
    expect(q(c, 'Chốt · Lan').getAttribute('aria-disabled')).toBe('true');
    expect(q(c, 'Chốt · Lan').disabled).toBe(false);
    expect(q(c, 'Chốt · Mai').hasAttribute('aria-busy')).toBe(false);
    expect(q(c, 'Chốt · Mai').getAttribute('aria-disabled')).toBe('true');
    expect(q(c, 'Chốt · Mai').disabled).toBe(false);
    gate.resolve();
    await flush();
    expect(c.textContent).toContain('Đã chốt lương.');
  });

  it('một dòng đang chốt: bấm "Chốt" của dòng khác không mở hộp xác nhận', async () => {
    const gate = deferred();
    stub([row('1', 'Lan', 'OPEN'), row('2', 'Mai', 'OPEN')], { write: gate.promise });
    const c = await mount();
    click(q(c, 'Chốt · Lan'));
    await flush();
    answerConfirm(true);
    await flush(1);
    click(q(c, 'Chốt · Mai'));
    await flush();
    expect(confirmDialog()).toBeNull();
    gate.resolve();
    await flush();
  });

  it('hộp "Mở lại" đã mở rồi mà dòng khác bắt đầu chốt: xác nhận bị bỏ, không gửi lệnh thứ hai', async () => {
    const gate = deferred();
    const api = stub([row('1', 'Lan', 'OPEN'), row('2', 'Mai', 'FINALIZED')], { write: gate.promise });
    const c = await mount();
    click(q(c, 'Mở lại · Mai'));
    await flush();
    click(q(c, 'Chốt · Lan'));
    await flush(1);
    // Hộp của Chốt thay hộp Mở lại (useConfirm chỉ giữ một hộp); xác nhận Chốt.
    answerConfirm(true);
    await flush(1);
    expect(api.writes()).toHaveLength(1);
    click(q(c, 'Mở lại · Mai'));
    await flush();
    expect(confirmDialog()).toBeNull();
    gate.resolve();
    await flush();
  });

  it('khoá giữ tới khi bảng lương mới về: chốt xong mà danh sách chưa làm mới thì nút vẫn bận', async () => {
    const list = deferred();
    const api = stub([row('1', 'Lan', 'OPEN')], { list: list.promise });
    const c = await mount();
    click(q(c, 'Chốt · Lan'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.writes()).toHaveLength(1);
    expect(q(c, 'Chốt · Lan').getAttribute('aria-busy')).toBe('true');
    click(q(c, 'Chốt · Lan'));
    await flush();
    expect(confirmDialog()).toBeNull();
    list.resolve();
    await flush();
    expect(q(c, 'Chốt · Lan').hasAttribute('aria-busy')).toBe(false);
  });

  it('chốt lỗi nhả khoá: báo alert, chốt lại gửi được', async () => {
    const api = stub([row('1', 'Lan', 'OPEN')], { failOnce: true });
    const c = await mount();
    click(q(c, 'Chốt · Lan'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    click(q(c, 'Chốt · Lan'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.writes()).toHaveLength(2);
    expect(c.textContent).toContain('Đã chốt lương.');
  });

  it('"Mở lại" chạm đúp xác nhận gửi một lệnh', async () => {
    const gate = deferred();
    const api = stub([row('2', 'Mai', 'FINALIZED')], { write: gate.promise });
    const c = await mount();
    click(q(c, 'Mở lại · Mai'));
    await flush();
    await act(async () => {
      accept().click();
      accept().click();
    });
    await flush(1);
    expect(api.writes()).toHaveLength(1);
    expect(q(c, 'Mở lại · Mai').getAttribute('aria-busy')).toBe('true');
    expect(q(c, 'Mở lại · Mai').disabled).toBe(false);
    gate.resolve();
    await flush();
  });
});

describe('PayrollAdminTab: tờ "Đánh dấu đã trả" và "Lưu đơn giá"', () => {
  const dialog = () => document.querySelector<HTMLElement>('[role=dialog]');
  const esc = () =>
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

  it('"Đánh dấu đã trả": chạm đúp gửi một lệnh, nút aria-busy (không disabled), Esc không đóng khi đang gửi; xong thì tờ đóng', async () => {
    const gate = deferred();
    const api = stub([row('1', 'Lan', 'FINALIZED')], { write: gate.promise });
    const c = await mount();
    click(q(c, 'Ghi đã trả lương · Lan'));
    await flush();
    click(document.querySelector('[data-testid="proof"]'));
    const save = () => byText(document.body, 'button', 'Đánh dấu đã trả') as HTMLButtonElement;
    await tap(save(), save());
    await flush(1);
    expect(api.writes()).toHaveLength(1);
    expect(save().getAttribute('aria-busy')).toBe('true');
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(save().disabled).toBe(false);
    esc();
    expect(dialog()).not.toBeNull();
    gate.resolve();
    await flush();
    expect(dialog()).toBeNull();
  });

  it('chưa có ảnh xác nhận vẫn disabled thật (lý do cứng)', async () => {
    stub([row('1', 'Lan', 'FINALIZED')]);
    const c = await mount();
    click(q(c, 'Ghi đã trả lương · Lan'));
    await flush();
    expect((byText(document.body, 'button', 'Đánh dấu đã trả') as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Lưu đơn giá": chạm đúp gửi một lệnh, nút aria-busy (không disabled), Esc không đóng khi đang gửi', async () => {
    const gate = deferred();
    const api = stub([row('1', 'Lan', 'OPEN')], { write: gate.promise });
    const c = await mount();
    click(q(c, 'Đơn giá · Lan'));
    await flush();
    typeInto(document.querySelector('[role=dialog] input[type=number]'), '50000');
    const save = () => byText(document.body, 'button', 'Lưu đơn giá') as HTMLButtonElement;
    await tap(save(), save());
    await flush(1);
    expect(api.writes()).toHaveLength(1);
    expect(save().getAttribute('aria-busy')).toBe('true');
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(save().disabled).toBe(false);
    esc();
    expect(dialog()).not.toBeNull();
    gate.resolve();
    await flush();
    expect(dialog()).toBeNull();
    expect(c.textContent).toContain('Đã lưu đơn giá.');
  });

  it('"Lưu đơn giá" xong mà bảng lương chưa làm mới: nút "Đơn giá" báo bận và không mở lại tờ (tờ sẽ điền sẵn đơn giá cũ), không gửi lệnh thứ hai; bảng về thì mở lại được', async () => {
    const list = deferred();
    const api = stub([row('1', 'Lan', 'OPEN')], { list: list.promise });
    const c = await mount();
    click(q(c, 'Đơn giá · Lan'));
    await flush();
    typeInto(document.querySelector('[role=dialog] input[type=number]'), '50000');
    click(byText(document.body, 'button', 'Lưu đơn giá'));
    await flush();
    expect(api.writes()).toHaveLength(1);
    expect(dialog()).toBeNull();
    const open = q(c, 'Đơn giá · Lan') as HTMLButtonElement;
    expect(open.getAttribute('aria-busy')).toBe('true');
    expect(open.getAttribute('aria-disabled')).toBe('true');
    expect(open.disabled).toBe(false);
    await tap(open);
    expect(dialog()).toBeNull();
    expect(api.writes()).toHaveLength(1);
    list.resolve();
    await flush();
    expect(open.hasAttribute('aria-busy')).toBe(false);
    click(open);
    await flush();
    expect(dialog()).not.toBeNull();
    expect((byText(document.body, 'button', 'Lưu đơn giá') as HTMLButtonElement).hasAttribute('aria-busy')).toBe(false);
  });
});

describe('PayrollAdminTab: khoá giữ tới khi bảng lương mới về và loại trừ chéo', () => {
  it('"Mở lại" xong mà bảng lương chưa làm mới thì nút vẫn bận, rồi nhả', async () => {
    const list = deferred();
    const api = stub([row('2', 'Mai', 'FINALIZED')], { list: list.promise });
    const c = await mount();
    click(q(c, 'Mở lại · Mai'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.writes()).toHaveLength(1);
    expect(c.textContent).toContain('Đã mở lại bảng lương');
    expect(q(c, 'Mở lại · Mai').getAttribute('aria-busy')).toBe('true');
    list.resolve();
    await flush();
    expect(q(c, 'Mở lại · Mai').hasAttribute('aria-busy')).toBe(false);
  });

  it('"Đánh dấu đã trả" xong mà bảng lương chưa làm mới thì các nút Chốt vẫn aria-disabled và không mở hộp', async () => {
    const list = deferred();
    const api = stub([row('1', 'Lan', 'OPEN'), row('2', 'Mai', 'FINALIZED')], { list: list.promise });
    const c = await mount();
    click(q(c, 'Ghi đã trả lương · Mai'));
    await flush();
    click(document.querySelector('[data-testid="proof"]'));
    click(byText(document.body, 'button', 'Đánh dấu đã trả'));
    await flush();
    expect(api.writes()).toHaveLength(1);
    expect(q(c, 'Chốt · Lan').getAttribute('aria-disabled')).toBe('true');
    click(q(c, 'Chốt · Lan'));
    await flush();
    expect(confirmDialog()).toBeNull();
    list.resolve();
    await flush();
    expect(q(c, 'Chốt · Lan').hasAttribute('aria-disabled')).toBe(false);
  });

  it('đang chốt một dòng: "Mở lại" của dòng khác aria-disabled (không disabled) và không mở hộp', async () => {
    const gate = deferred();
    stub([row('1', 'Lan', 'OPEN'), row('2', 'Mai', 'FINALIZED')], { write: gate.promise });
    const c = await mount();
    click(q(c, 'Chốt · Lan'));
    await flush();
    answerConfirm(true);
    await flush(2);
    expect(q(c, 'Mở lại · Mai').getAttribute('aria-disabled')).toBe('true');
    expect(q(c, 'Mở lại · Mai').disabled).toBe(false);
    expect(q(c, 'Mở lại · Mai').hasAttribute('aria-busy')).toBe(false);
    click(q(c, 'Mở lại · Mai'));
    await flush();
    expect(confirmDialog()).toBeNull();
    gate.resolve();
    await flush();
  });

  it('đang chốt một dòng mà mở tờ "Đã trả" của dòng khác: bấm "Đánh dấu đã trả" không gửi lệnh thứ hai', async () => {
    const gate = deferred();
    const api = stub([row('1', 'Lan', 'OPEN'), row('2', 'Mai', 'FINALIZED')], { write: gate.promise });
    const c = await mount();
    click(q(c, 'Chốt · Lan'));
    await flush();
    answerConfirm(true);
    await flush(2);
    click(q(c, 'Ghi đã trả lương · Mai'));
    await flush();
    click(document.querySelector('[data-testid="proof"]'));
    const save = byText(document.body, 'button', 'Đánh dấu đã trả') as HTMLButtonElement;
    expect(save.getAttribute('aria-disabled')).toBe('true');
    await tap(save);
    await flush();
    expect(api.writes()).toHaveLength(1);
    gate.resolve();
    await flush();
  });
});

describe('PayrollAdminTab: làm mới đúng tháng của lệnh', () => {
  it('chốt lương tháng này rồi sang tháng trước khi lệnh còn bay: lệnh xong thì tháng CŨ được tải lại; quay lại không còn nút "Chốt" trên dữ liệu cũ', async () => {
    const gate = deferred();
    const api = stub([row('1', 'Lan', 'OPEN')], { write: gate.promise, after: [row('1', 'Lan', 'FINALIZED')] });
    const c = await mount();
    const monthUrl = api.lists()[0]!;
    click(q(c, 'Chốt · Lan'));
    await flush();
    answerConfirm(true);
    await flush(2);
    click(c.querySelector('[aria-label="Tháng trước"]'));
    await flush();
    const loads = (url: string) => api.lists().filter((u) => u === url).length;
    const prevUrl = api.lists().find((u) => u !== monthUrl)!;
    expect([loads(monthUrl), loads(prevUrl)]).toEqual([1, 1]);
    gate.resolve();
    await flush();
    expect(c.textContent).toContain('Đã chốt lương.');
    expect(loads(monthUrl)).toBe(2);
    expect(loads(prevUrl)).toBe(1);
    click(c.querySelector('[aria-label="Tháng sau"]'));
    expect(q(c, 'Chốt · Lan')).toBeNull();
    expect(q(c, 'Mở lại · Lan')).not.toBeNull();
  });

  it('"Mở lại" đổi tháng giữa chừng cũng làm mới tháng của lệnh', async () => {
    const gate = deferred();
    const api = stub([row('2', 'Mai', 'FINALIZED')], { write: gate.promise });
    const c = await mount();
    const monthUrl = api.lists()[0]!;
    click(q(c, 'Mở lại · Mai'));
    await flush();
    answerConfirm(true);
    await flush(2);
    click(c.querySelector('[aria-label="Tháng trước"]'));
    await flush();
    gate.resolve();
    await flush();
    expect(api.lists().filter((u) => u === monthUrl)).toHaveLength(2);
  });
});

describe('PayrollAdminTab: tính lại tháng đổi tháng giữa chừng', () => {
  it('làm mới và báo đúng tháng của lệnh, không theo tháng đang xem lúc xong', async () => {
    const gate = deferred();
    const api = stub([row('1', 'Lan', 'OPEN')], { write: gate.promise });
    const c = await mount();
    const monthUrl = api.lists()[0]!;
    click(q(c, 'Tính lại tháng · Lan'));
    await flush();
    answerConfirm(true);
    await flush(2);
    click(c.querySelector('[aria-label="Tháng trước"]'));
    await flush();
    gate.resolve();
    await flush();
    expect(c.textContent).toContain(`Đã tính lại bảng lương T${month}/${year}`);
    expect(api.lists().filter((u) => u === monthUrl)).toHaveLength(2);
  });
});

describe('PayrollAdminTab: sửa giờ phiên và Thử lại', () => {
  it('"Lưu giờ" chạm đúp gửi một lệnh; nút aria-busy, không disabled; Esc không đóng khi đang gửi', async () => {
    const gate = deferred();
    const api = stub([row('1', 'Lan', 'OPEN')], { write: gate.promise });
    const c = await mount();
    click(q(c, 'Xem giờ · Lan'));
    await flush();
    click(document.querySelector('[aria-label="Sửa giờ phiên 08:00"]'));
    const times = () => document.querySelectorAll<HTMLInputElement>('[role=dialog] input[type=time]');
    typeInto(times()[0]!, '08:30');
    typeInto(times()[1]!, '17:00');
    const save = () => byText(document.body, 'button', 'Lưu giờ') as HTMLButtonElement;
    await tap(save(), save());
    await flush(1);
    expect(api.writes()).toHaveLength(1);
    expect(save().getAttribute('aria-busy')).toBe('true');
    expect(save().getAttribute('aria-disabled')).toBe('true');
    expect(save().disabled).toBe(false);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    gate.resolve();
    await flush();
  });

  it('Thử lại tải bảng lương (đã có dữ liệu cũ): bấm khi lần tải lại còn chạy thì nút aria-busy, chạm đúp chỉ tải một lần', async () => {
    let mode: 'ok' | 'fail' | 'hold' = 'ok';
    let loads = 0;
    const gate = deferred();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        loads += 1;
        if (mode === 'fail') return new Response(JSON.stringify({ message: 'Hỏng' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        if (mode === 'hold') await gate.promise;
        return new Response(JSON.stringify([row('1', 'Lan', 'OPEN')]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const c = await mount(client);
    mode = 'fail';
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['admin-payroll'] });
    });
    await flush();
    const retry = byText(c, 'button', 'Thử lại') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    mode = 'hold';
    const before = loads;
    await tap(retry, retry);
    await flush(1);
    expect(loads - before).toBe(1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    expect(retry.getAttribute('aria-disabled')).toBe('true');
    mode = 'ok';
    gate.resolve();
    await flush();
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
  });
});

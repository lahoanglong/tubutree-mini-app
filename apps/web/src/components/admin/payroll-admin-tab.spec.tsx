// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const downloads: { csv: string; name: string }[] = [];
vi.mock('@/lib/export-csv', () => ({ downloadCsvFile: (csv: string, name: string) => downloads.push({ csv, name }) }));

import { PayrollAdminTab } from './payroll-admin-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { currentVnYearMonth } from '@/lib/week';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  downloads.length = 0;
  vi.unstubAllGlobals();
});

const { year, month } = currentVnYearMonth();
const mon = (status: string, over: Record<string, unknown> = {}) => ({
  year, month, totalMinutes: 125, gross: 500_000, totalFines: 20_000, net: 480_000, status, paidAt: null, proofImageUrl: null, note: null, ...over,
});
const row = (id: string, name: string | null, status: string, qr: string | null = null) => ({
  staff: { id, fullName: name, phone: `09${id}00000` },
  month: mon(status),
  profile: { hourlyRate: 40_000, bankBin: null, bankAccountNo: '123', bankAccountName: 'LAN', qrImageUrl: qr, active: true },
  qrImageUrl: qr,
});

const DETAIL = {
  month: mon('OPEN'),
  days: [{ id: 'd1', workDate: '2026-10-19T00:00:00.000Z', workedMinutes: 480, hourlyRate: 40_000, gross: 320_000, fines: 0, net: 320_000 }],
  profile: null,
  sessions: [
    { id: 'ss1', shiftId: 'sh1', checkinAt: '2026-10-19T01:00:00.000Z', checkoutAt: '2026-10-19T09:00:00.000Z', isLate: true, closeReason: null },
    { id: 'ss2', shiftId: 'sh1', checkinAt: '2026-10-19T10:00:00.000Z', checkoutAt: null, isLate: false, closeReason: null },
  ],
};

function stub(rows: unknown[], status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
      if (init?.method === 'PUT') return json({ hourlyRate: 50_000 });
      if (init?.method === 'POST') return json({ ok: true, paid: true, finalized: true, status: 'OPEN', updated: true });
      if (url.includes('/detail')) return json(DETAIL);
      return json(rows, status);
    }),
  );
  return { to: (p: string, m = 'POST') => calls.filter((c) => c.url.includes(p) && c.init?.method === m) };
}

describe('PayrollAdminTab (Lương)', () => {
  it('mỗi nhân viên một dòng: giờ, đơn giá, trạng thái, thực nhận, tiền phạt; nút theo trạng thái', async () => {
    stub([row('1', 'Lan', 'OPEN'), row('2', 'Mai', 'FINALIZED', 'https://x/qr.png'), row('3', null, 'PAID')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    const t = container.textContent ?? '';
    expect(t).toContain('2h05');
    expect(t).toContain('Đang tính');
    expect(t).toContain('Đã chốt');
    expect(t).toContain('Đã trả');
    expect(t).toContain('−');
    expect(container.querySelector('[aria-label="Chốt · Lan"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Chốt · Mai"]')).toBeNull();
    expect(container.querySelector('[aria-label="Mở lại · Lan"]')).toBeNull();
    expect(container.querySelector('[aria-label="Mở lại · Mai"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Đã chuyển · 0930000000"]')).toBeNull();
    expect(container.querySelector('[aria-label="QR chuyển · Mai"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="QR chuyển · Lan"]')).toBeNull();
  });

  it('chốt lương gọi POST finalize với năm/tháng đang xem', async () => {
    const api = stub([row('1', 'Lan', 'OPEN')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    // D7-15: chốt lương khoá sổ tháng của nhân viên; mở lại thì có hỏi nên chốt cũng phải hỏi.
    click(container.querySelector('[aria-label="Chốt · Lan"]'));
    await flush();
    expect(confirmDialog()?.textContent).toContain('Lan');
    answerConfirm(false);
    await flush();
    expect(api.to('/admin/payroll/1/finalize')).toHaveLength(0);
    click(container.querySelector('[aria-label="Chốt · Lan"]'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(JSON.parse(api.to('/admin/payroll/1/finalize')[0]!.init!.body as string)).toEqual({ year, month });
    expect(container.textContent).toContain('Đã chốt lương.');
  });

  it('mở lại có xác nhận: huỷ thì không gọi API; đồng ý thì POST reopen kèm year/month trên query', async () => {
    const api = stub([row('2', 'Mai', 'FINALIZED')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    click(container.querySelector('[aria-label="Mở lại · Mai"]'));
    await flush();
    answerConfirm(false);
    await flush();
    expect(api.to('/reopen')).toHaveLength(0);
    click(container.querySelector('[aria-label="Mở lại · Mai"]'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.to(`/admin/payroll/2/reopen?year=${year}&month=${month}`)).toHaveLength(1);
  });

  it('đặt đơn giá: ô điền sẵn đơn giá hiện tại, chỉ nhận số nguyên, PUT hourlyRate', async () => {
    const api = stub([row('1', 'Lan', 'OPEN')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    click(container.querySelector('[aria-label="Đơn giá · Lan"]'));
    await flush();
    const input = document.querySelector<HTMLInputElement>('[role=dialog] input[type=number]')!;
    expect(input.value).toBe('40000');
    const save = byText(document.body, 'button', 'Lưu đơn giá') as HTMLButtonElement;
    typeInto(input, '45.5');
    expect(save.disabled).toBe(true);
    typeInto(input, '50000');
    click(save);
    await flush();
    expect(JSON.parse(api.to('/admin/staff/1/rate', 'PUT')[0]!.init!.body as string)).toEqual({ hourlyRate: 50_000 });
  });

  it('đã chuyển: nút khoá khi chưa có ảnh xác nhận', async () => {
    const api = stub([row('1', 'Lan', 'FINALIZED')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    click(container.querySelector('[aria-label="Đã chuyển · Lan"]'));
    await flush();
    const save = byText(document.body, 'button', 'Đánh dấu đã trả') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(api.to('/mark-paid')).toHaveLength(0);
  });

  it('xem giờ: liệt kê phiên; sửa phiên đủ giờ ra gửi checkin/checkout giờ VN; ca qua đêm đẩy giờ ra sang hôm sau', async () => {
    const api = stub([row('1', 'Lan', 'OPEN')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    click(container.querySelector('[aria-label="Xem giờ · Lan"]'));
    await flush();
    expect(document.body.textContent).toContain('08:00 → 16:00 · trễ');
    expect(document.body.textContent).toContain('17:00 → đang mở');
    click(document.querySelector('[aria-label="Sửa giờ phiên 08:00"]'));
    const times = () => document.querySelectorAll<HTMLInputElement>('[role=dialog] input[type=time]');
    typeInto(times()[0]!, '08:30');
    typeInto(times()[1]!, '17:00');
    click(byText(document.body, 'button', 'Lưu giờ'));
    await flush();
    expect(JSON.parse(api.to('/admin/attendance/session/ss1/edit')[0]!.init!.body as string)).toEqual({
      checkinAt: '2026-10-19T01:30:00.000Z',
      checkoutAt: '2026-10-19T10:00:00.000Z',
    });
    click(document.querySelector('[aria-label="Sửa giờ phiên 17:00"]'));
    const save = byText(document.body, 'button', 'Lưu giờ') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(document.body.textContent).toContain('Nhập giờ ra khác giờ vào để lưu.');
    typeInto(times()[0]!, '22:00');
    typeInto(times()[1]!, '02:00');
    click(save);
    await flush();
    expect(JSON.parse(api.to('/admin/attendance/session/ss2/edit')[0]!.init!.body as string)).toEqual({
      checkinAt: '2026-10-19T15:00:00.000Z',
      checkoutAt: '2026-10-19T19:00:00.000Z',
    });
  });

  it('xuất CSV đúng tên file theo tháng; không có dòng thì nút khoá', async () => {
    stub([row('1', '=Lan', 'OPEN')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    click(byText(container, 'button', 'Xuất CSV'));
    expect(downloads[0]!.name).toBe(`bang-luong-${year}-${String(month).padStart(2, '0')}.csv`);
    expect(downloads[0]!.csv).toContain("'=Lan");
    stub([]);
    const b = mount(<PayrollAdminTab />);
    await flush();
    expect((byText(b.container, 'button', 'Xuất CSV') as HTMLButtonElement).disabled).toBe(true);
    expect(b.container.textContent).toContain('Chưa có nhân sự');
  });

  it('lỗi tải hiện lời báo và nút Thử lại', async () => {
    stub({ message: 'Hỏng' } as never, 500);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    expect(container.textContent).toContain('Thử lại');
  });
});

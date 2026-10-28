// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const downloads: { csv: string; name: string }[] = [];
vi.mock('@/lib/export-csv', () => ({ downloadCsvFile: (csv: string, name: string) => downloads.push({ csv, name }) }));

import { PayrollAdminTab } from './payroll-admin-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, selectValue, typeInto, type Rendered } from '@/test-utils/dom';
import { currentVnYearMonth, vnDateKey } from '@/lib/week';

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
    expect(container.querySelector('[aria-label="Ghi đã trả lương · 0930000000"]')).toBeNull();
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
    click(container.querySelector('[aria-label="Ghi đã trả lương · Lan"]'));
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

describe('PayrollAdminTab: thưởng/phạt và tính lại tháng', () => {
  type Reply = { status?: number; body: unknown };
  function stubAdjust(rows: unknown[], onPost: (url: string, body: Record<string, unknown> | undefined) => Reply = () => ({ body: { adjusted: true } })) {
    const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
        calls.push({ url, method, body });
        const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
        if (method === 'POST') {
          const r = onPost(url, body);
          return json(r.body, r.status ?? 200);
        }
        return json(rows);
      }),
    );
    return { posts: (part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)) };
  }
  const today = vnDateKey(new Date());
  const sheet = () => document.querySelector<HTMLElement>('[role=dialog]')!;
  // Khung thưởng/phạt nạp lười: lần mở đầu tiên đợi mô-đun về.
  const openAdjust = async (container: HTMLElement) => {
    click(container.querySelector('[aria-label="Thưởng/phạt · Lan"]'));
    for (let i = 0; i < 20 && !document.querySelector('[role=dialog]'); i++) await flush(1);
    await flush();
  };
  const adjustBtn = () => sheet().querySelector<HTMLButtonElement>('[data-adjust-submit]')!;
  const fill = (kind: 'Phạt' | 'Thưởng' | null, amount: string, reason: string) => {
    if (kind) click(byText(sheet(), 'button[aria-pressed]', kind));
    typeInto(sheet().querySelector('input[inputmode=numeric]'), amount);
    typeInto(sheet().querySelector('textarea'), reason);
  };

  it('chỉ dòng đang tính (OPEN) có "Thưởng/phạt" và "Tính lại tháng"; tháng đã chốt/đã trả thì ẩn và chỉ đường mở lại', async () => {
    stubAdjust([row('1', 'Lan', 'OPEN'), row('2', 'Mai', 'FINALIZED'), row('3', 'Hoa', 'PAID')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    expect(container.querySelector('[aria-label="Thưởng/phạt · Lan"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Tính lại tháng · Lan"]')).not.toBeNull();
    for (const n of ['Mai', 'Hoa']) {
      expect(container.querySelector(`[aria-label="Thưởng/phạt · ${n}"]`)).toBeNull();
      expect(container.querySelector(`[aria-label="Tính lại tháng · ${n}"]`)).toBeNull();
    }
    expect(container.querySelector('section[aria-label="Mai"]')!.textContent).toContain('Mở lại bảng lương trước khi thưởng/phạt');
  });

  it('chưa chọn loại, số tiền không hợp lệ hoặc thiếu lý do thì nút ghi bị khoá và không gọi API', async () => {
    const api = stubAdjust([row('1', 'Lan', 'OPEN')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    await openAdjust(container);
    expect(adjustBtn().disabled).toBe(true);
    fill(null, '50000', 'Đi trễ');
    expect(adjustBtn().disabled).toBe(true);
    click(byText(sheet(), 'button[aria-pressed]', 'Phạt'));
    expect(adjustBtn().disabled).toBe(false);
    for (const bad of ['0', '-5', '1000.5', '50000001', '']) {
      typeInto(sheet().querySelector('input[inputmode=numeric]'), bad);
      expect(adjustBtn().disabled).toBe(true);
    }
    typeInto(sheet().querySelector('input[inputmode=numeric]'), '50000');
    typeInto(sheet().querySelector('textarea'), '  ab ');
    expect(adjustBtn().disabled).toBe(true);
    typeInto(sheet().querySelector('textarea'), '   ');
    expect(adjustBtn().disabled).toBe(true);
    expect(api.posts('/admin/payroll/adjust')).toHaveLength(0);
  });

  it('phạt: hộp xác nhận nhắc số tiền, người nhận, ngày; huỷ thì không gọi; đồng ý gửi số dương (trừ lương) kèm ngày hôm nay', async () => {
    const api = stubAdjust([row('1', 'Lan', 'OPEN')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    await openAdjust(container);
    fill('Phạt', '50000', 'Đi trễ');
    click(adjustBtn());
    await flush();
    const text = confirmDialog()!.textContent ?? '';
    expect(text).toContain('Phạt');
    expect(text).toContain('50.000đ');
    expect(text).toContain('Lan');
    expect(text).toContain('Đi trễ');
    answerConfirm(false);
    await flush();
    expect(api.posts('/admin/payroll/adjust')).toHaveLength(0);

    click(adjustBtn());
    await flush();
    answerConfirm(true);
    await flush();
    const posts = api.posts('/admin/payroll/adjust');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ staffId: '1', workDate: today, amount: 50_000, reason: 'Đi trễ' });
    expect(container.textContent).toContain('Đã ghi khoản phạt 50.000đ');
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });

  it('thưởng gửi số âm; đổi ngày công trong tháng được; lý do được cắt khoảng trắng đầu cuối', async () => {
    const api = stubAdjust([row('1', 'Lan', 'OPEN')]);
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    await openAdjust(container);
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    selectValue(sheet().querySelector('select'), first);
    fill('Thưởng', '100000', '  Ca tối đông khách  ');
    click(adjustBtn());
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.posts('/admin/payroll/adjust')[0]!.body).toEqual({ staffId: '1', workDate: first, amount: -100_000, reason: 'Ca tối đông khách' });
    expect(container.textContent).toContain('Đã ghi khoản thưởng 100.000đ');
  });

  it('máy chủ báo khoản giống hệt vừa ghi (409): hỏi lại, chỉ gửi allowDuplicate khi admin xác nhận đây là khoản thứ hai', async () => {
    const api = stubAdjust([row('1', 'Lan', 'OPEN')], (_url, body) =>
      body?.allowDuplicate
        ? { body: { adjusted: true } }
        : { status: 409, body: { statusCode: 409, code: 'PAYROLL_ADJUST_DUPLICATE', message: 'Đã có khoản trừ 50.000đ giống hệt vừa ghi lúc 10:00 — lần gửi này CHƯA được ghi.' } },
    );
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    await openAdjust(container);
    fill('Phạt', '50000', 'Đi trễ');
    click(adjustBtn());
    await flush();
    answerConfirm(true);
    await flush();
    expect(api.posts('/admin/payroll/adjust')).toHaveLength(1);
    expect(confirmDialog()!.textContent).toContain('CHƯA được ghi');
    answerConfirm(false);
    await flush();
    expect(api.posts('/admin/payroll/adjust')).toHaveLength(1);

    click(adjustBtn());
    await flush();
    answerConfirm(true);
    await flush();
    answerConfirm(true);
    await flush();
    const posts = api.posts('/admin/payroll/adjust');
    expect(posts).toHaveLength(3);
    expect(posts[2]!.body).toEqual({ staffId: '1', workDate: today, amount: 50_000, reason: 'Đi trễ', allowDuplicate: true });
  });

  it('lỗi khác từ máy chủ hiện ngay trong hộp, không đóng hộp và không tự gửi lại', async () => {
    const api = stubAdjust([row('1', 'Lan', 'OPEN')], () => ({ status: 400, body: { message: 'Tháng lương đã chốt/đã trả — mở lại tháng trước khi điều chỉnh.' } }));
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    await openAdjust(container);
    fill('Phạt', '50000', 'Đi trễ');
    click(adjustBtn());
    await flush();
    answerConfirm(true);
    await flush();
    expect(sheet().querySelector('[role=alert]')!.textContent).toContain('mở lại tháng trước');
    expect(api.posts('/admin/payroll/adjust')).toHaveLength(1);
    expect(confirmDialog()).toBeNull();
  });

  it('tính lại tháng: huỷ hộp xác nhận thì không gọi API; đồng ý thì POST recompute kèm năm/tháng, không áp lại đơn giá', async () => {
    const api = stubAdjust([row('1', 'Lan', 'OPEN')], () => ({ body: mon('OPEN') }));
    const { container } = mount(<PayrollAdminTab />);
    await flush();
    click(container.querySelector('[aria-label="Tính lại tháng · Lan"]'));
    await flush();
    expect(confirmDialog()!.textContent).toContain('Lan');
    answerConfirm(false);
    await flush();
    expect(api.posts('/recompute')).toHaveLength(0);

    click(container.querySelector('[aria-label="Tính lại tháng · Lan"]'));
    await flush();
    answerConfirm(true);
    await flush();
    const posts = api.posts('/recompute');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toContain(`/admin/payroll/1/recompute?year=${year}&month=${month}`);
    expect(posts[0]!.url).not.toContain('reprice');
    expect(container.textContent).toContain('Đã tính lại');
  });
});

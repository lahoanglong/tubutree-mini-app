// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DealerTiersSection } from './dealer-tiers-section';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { DealerTierHistoryRow, DealerTiersView } from '@/lib/dealer-accounts-client';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

const TIER = { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 5_000_000, paymentTerms: 'NET 15', dealerCount: 2 };
const view = (tiers = [TIER]): DealerTiersView => ({ tiers, maxDiscountPct: 45, dealersWithoutTier: 1 });
const HISTORY: DealerTierHistoryRow[] = [
  {
    id: 'h2',
    tierId: 'DEALER_2',
    action: 'UPDATE',
    oldValue: { name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 25, creditLimit: 5_000_000, paymentTerms: 'NET 15' },
    newValue: { name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 5_000_000, paymentTerms: 'NET 15' },
    changedAt: '2026-10-10T03:00:00.000Z',
    changedBy: { id: 'a1', fullName: 'Chủ shop', phone: '0900000001' },
  },
  {
    id: 'h1',
    tierId: 'DEALER_2',
    action: 'CREATE',
    oldValue: null,
    newValue: { name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 25, creditLimit: 5_000_000, paymentTerms: 'NET 15' },
    changedAt: '2026-10-01T03:00:00.000Z',
    changedBy: { id: 'a1', fullName: null, phone: '0900000001' },
  },
];

function stub(opts: { tiers?: DealerTiersView; history?: DealerTierHistoryRow[]; write?: { status?: number; body: unknown } } = {}) {
  let current = opts.tiers ?? view();
  const api = mockFetch({
    '/admin/dealer-tiers/manage': () => ({ body: current }),
    '/admin/dealer-tiers/history': { body: opts.history ?? HISTORY },
    '/admin/dealer-tiers/DEALER_2': () => {
      current = view([{ ...TIER, discountPct: 35 }]);
      return opts.write ?? { body: { id: 'DEALER_2' } };
    },
    '/admin/dealer-tiers': () => {
      current = view([TIER]);
      return opts.write ?? { body: { id: 'DEALER_2' } };
    },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  return api;
}
const writes = (api: ReturnType<typeof stub>) => api.calls.filter((c) => c.init?.method === 'POST' || c.init?.method === 'PUT');
const field = (c: ParentNode, label: string) => c.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
const alertText = (c: ParentNode) => Array.from(c.querySelectorAll('[role="alert"]')).map((e) => e.textContent).join('\n');

describe('DealerTiersSection — quản lý bậc đại lý (D1-06)', () => {
  it('liệt kê bậc: chiết khấu, hạn mức, điều kiện, số đại lý; ghi rõ trần chiết khấu và đại lý chưa có bậc', async () => {
    stub();
    const { container } = mount(<DealerTiersSection />);
    expect(container.textContent).toContain('Đang tải bậc đại lý…');
    await flush();
    const row = container.querySelector<HTMLElement>('[data-dealer-tier]')!.textContent!;
    expect(row).toContain('Đại lý Cấp 2');
    expect(row).toContain('DEALER_2');
    expect(row).toContain('30%');
    expect(row).toContain('30.000.000');
    expect(row).toContain('5.000.000');
    expect(row).toContain('Công nợ 15 ngày');
    expect(row).toContain('2 đại lý');
    expect(container.textContent).toContain('Chiết khấu tối đa 45%');
    expect(container.textContent).toContain('1 đại lý chưa được gán bậc');
  });

  it('chưa có bậc nào: hiện trạng thái trống và cho TẠO bậc đầu tiên (POST đúng nội dung, tải lại danh sách)', async () => {
    const api = stub({ tiers: view([]) });
    const { container } = mount(<DealerTiersSection />);
    await flush();
    expect(container.querySelector('[data-dealer-tiers-empty]')?.textContent).toContain('Chưa có bậc đại lý nào');
    click(byText(container, 'button', 'Tạo bậc đầu tiên'));
    typeInto(field(container, 'Mã bậc'), 'DEALER_2');
    typeInto(field(container, 'Tên bậc'), 'Đại lý Cấp 2');
    typeInto(field(container, 'Doanh số tối thiểu (đ)'), '30000000');
    typeInto(field(container, 'Chiết khấu (%)'), '30');
    typeInto(field(container, 'Hạn mức công nợ (đ)'), '5000000');
    typeInto(field(container, 'Điều kiện thanh toán'), 'NET 15');
    click(byText(container, 'button', 'Lưu bậc'));
    await flush();
    const [w] = writes(api);
    expect(w!.init!.method).toBe('POST');
    expect(w!.url).toMatch(/\/admin\/dealer-tiers$/);
    expect(JSON.parse(String(w!.init!.body))).toEqual({
      id: 'DEALER_2',
      name: 'Đại lý Cấp 2',
      minOrderVolume: 30_000_000,
      discountPct: 30,
      creditLimit: 5_000_000,
      paymentTerms: 'NET 15',
    });
    expect(container.querySelector('[data-dealer-tiers-empty]')).toBeNull();
    expect(container.querySelector('[data-dealer-tier]')).not.toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });

  it('nhập sai: báo từng lỗi ngay trên form, không gửi gì lên API (chiết khấu vượt trần, mã bậc sai, thiếu tên)', async () => {
    const api = stub({ tiers: view([]) });
    const { container } = mount(<DealerTiersSection />);
    await flush();
    click(byText(container, 'button', 'Tạo bậc đầu tiên'));
    typeInto(field(container, 'Mã bậc'), 'dealer 2');
    typeInto(field(container, 'Chiết khấu (%)'), '60');
    click(byText(container, 'button', 'Lưu bậc'));
    await flush();
    const t = alertText(container);
    expect(t).toContain('Mã bậc gồm chữ in hoa');
    expect(t).toContain('Nhập tên bậc');
    expect(t).toContain('Chiết khấu tối đa 45%');
    expect(writes(api)).toHaveLength(0);
  });

  it('sửa bậc: form điền sẵn, mã bậc không đổi được; hộp xác nhận nêu từng thay đổi; huỷ thì không gửi, đồng ý mới PUT', async () => {
    const api = stub();
    const { container } = mount(<DealerTiersSection />);
    await flush();
    click(byText(container.querySelector('[data-dealer-tier]')!, 'button', 'Sửa'));
    expect(field(container, 'Mã bậc')!.value).toBe('DEALER_2');
    expect(field(container, 'Mã bậc')!.readOnly).toBe(true);
    expect(field(container, 'Chiết khấu (%)')!.value).toBe('30');
    typeInto(field(container, 'Chiết khấu (%)'), '35');
    typeInto(field(container, 'Hạn mức công nợ (đ)'), '8000000');
    click(byText(container, 'button', 'Lưu bậc'));
    await flush();
    const msg = confirmDialog()!.textContent!;
    expect(msg).toContain('Chiết khấu 30% → 35%');
    expect(msg).toContain('Hạn mức công nợ 5.000.000đ → 8.000.000đ');
    expect(msg).not.toContain('Tên Đại lý');
    answerConfirm(false);
    await flush();
    expect(writes(api)).toHaveLength(0);
    click(byText(container, 'button', 'Lưu bậc'));
    await flush();
    answerConfirm(true);
    await flush();
    const [w] = writes(api);
    expect(w!.init!.method).toBe('PUT');
    expect(w!.url).toMatch(/\/admin\/dealer-tiers\/DEALER_2$/);
    expect(JSON.parse(String(w!.init!.body))).toEqual({
      name: 'Đại lý Cấp 2',
      minOrderVolume: 30_000_000,
      discountPct: 35,
      creditLimit: 8_000_000,
      paymentTerms: 'NET 15',
      expected: { name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, creditLimit: 5_000_000, paymentTerms: 'NET 15' },
    });
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('[data-dealer-tier]')!.textContent).toContain('35%');
  });

  it('sửa mà không đổi gì: báo "Không có thay đổi", không hiện hộp xác nhận, không gọi API', async () => {
    const api = stub();
    const { container } = mount(<DealerTiersSection />);
    await flush();
    click(byText(container, 'button', 'Sửa'));
    click(byText(container, 'button', 'Lưu bậc'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(alertText(container)).toContain('Không có thay đổi nào');
    expect(writes(api)).toHaveLength(0);
  });

  it('API từ chối (400): hiện NGUYÊN VĂN lý do, form giữ nguyên để sửa lại', async () => {
    stub({ write: { status: 400, body: { message: 'Chiết khấu vượt trần 45% (dealer.max_discount_pct).' } } });
    const { container } = mount(<DealerTiersSection />);
    await flush();
    click(byText(container, 'button', 'Sửa'));
    typeInto(field(container, 'Chiết khấu (%)'), '40');
    click(byText(container, 'button', 'Lưu bậc'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(alertText(container)).toContain('Chiết khấu vượt trần 45% (dealer.max_discount_pct).');
    expect(field(container, 'Chiết khấu (%)')!.value).toBe('40');
  });

  it('người khác vừa sửa bậc (409): báo "tải lại", không mất form; "Tải lại giá trị mới" nạp giá trị hiện tại và lần lưu sau gửi đúng phiên bản mới', async () => {
    let current = view();
    const putBodies: Record<string, unknown>[] = [];
    const api = mockFetch({
      '/admin/dealer-tiers/manage': () => ({ body: current }),
      '/admin/dealer-tiers/history': { body: [] },
      '/admin/dealer-tiers/DEALER_2': (init) => {
        putBodies.push(JSON.parse(String(init!.body)) as Record<string, unknown>);
        if (putBodies.length === 1) {
          current = view([{ ...TIER, creditLimit: 8_000_000 }]);
          return { status: 409, body: { message: 'Bậc này vừa được người khác sửa. Tải lại để xem giá trị mới rồi sửa lại.' } };
        }
        return { body: { id: 'DEALER_2' } };
      },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerTiersSection />);
    await flush();
    click(byText(container, 'button', 'Sửa'));
    typeInto(field(container, 'Tên bậc'), 'Đại lý Vàng');
    click(byText(container, 'button', 'Lưu bậc'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(alertText(container)).toContain('Bậc này vừa được người khác sửa — tải lại.');
    expect(field(container, 'Tên bậc')!.value).toBe('Đại lý Vàng');
    expect(putBodies[0]!.expected).toMatchObject({ creditLimit: 5_000_000 });

    click(byText(container, 'button', 'Tải lại giá trị mới'));
    await flush();
    expect(field(container, 'Tên bậc')!.value).toBe('Đại lý Cấp 2');
    expect(field(container, 'Hạn mức công nợ (đ)')!.value).toBe('8000000');
    expect(alertText(container)).toBe('');

    typeInto(field(container, 'Tên bậc'), 'Đại lý Vàng');
    click(byText(container, 'button', 'Lưu bậc'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(putBodies[1]).toMatchObject({ name: 'Đại lý Vàng', creditLimit: 8_000_000, expected: { name: 'Đại lý Cấp 2', creditLimit: 8_000_000 } });
    expect(container.querySelector('form')).toBeNull();
  });

  it('"Thêm bậc" khi đã có bậc mở form tạo trống; Huỷ đóng form', async () => {
    stub();
    const { container } = mount(<DealerTiersSection />);
    await flush();
    click(byText(container, 'button', 'Thêm bậc'));
    expect(field(container, 'Mã bậc')!.readOnly).toBe(false);
    expect(field(container, 'Mã bậc')!.value).toBe('');
    click(byText(container, 'button', 'Huỷ'));
    expect(container.querySelector('form')).toBeNull();
  });

  it('lịch sử thay đổi: mở ra mới tải, mỗi dòng nêu ai đổi, lúc nào, đổi gì', async () => {
    const api = stub();
    const { container } = mount(<DealerTiersSection />);
    await flush();
    expect(api.calls.some((c) => c.url.includes('/history'))).toBe(false);
    click(byText(container, 'button', 'Lịch sử thay đổi bậc'));
    await flush();
    const rows = container.querySelectorAll<HTMLElement>('[data-dealer-tier-history]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Sửa bậc DEALER_2');
    expect(rows[0]!.textContent).toContain('Chủ shop');
    expect(rows[0]!.textContent).toContain('Chiết khấu 25% → 30%');
    expect(rows[1]!.textContent).toContain('Tạo bậc DEALER_2');
    expect(rows[1]!.textContent).toContain('0900000001');
  });

  it('lịch sử trống có câu riêng', async () => {
    stub({ history: [] });
    const { container } = mount(<DealerTiersSection />);
    await flush();
    click(byText(container, 'button', 'Lịch sử thay đổi bậc'));
    await flush();
    expect(container.textContent).toContain('Chưa có thay đổi nào');
  });

  it('lỗi tải: báo lỗi và có nút Thử lại', async () => {
    let fail = true;
    const api = mockFetch({ '/admin/dealer-tiers/manage': () => (fail ? { status: 500, body: { message: 'x' } } : { body: view() }) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerTiersSection />);
    await flush();
    expect(alertText(container)).toContain('Không tải được bậc đại lý');
    fail = false;
    click(byText(container, 'button', 'Thử lại'));
    await flush();
    expect(container.querySelector('[data-dealer-tier]')).not.toBeNull();
  });

  it('vùng chạm ≥ 44px cho nút và ô nhập (danh sách + form)', async () => {
    stub();
    const { container } = mount(<DealerTiersSection />);
    await flush();
    click(byText(container, 'button', 'Sửa'));
    container.querySelectorAll('button, select, input').forEach((el) => {
      expect(el.className, el.outerHTML.slice(0, 80)).toContain('min-h-[44px]');
    });
  });
});

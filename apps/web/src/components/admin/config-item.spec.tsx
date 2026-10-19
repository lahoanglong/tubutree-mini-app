// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConfigItem } from './config-item';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { ConfigRow } from '@/lib/admin-client';

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
  vi.restoreAllMocks();
});

const row = (over: Partial<ConfigRow> = {}): ConfigRow => ({
  key: 'shipping.free_threshold',
  value: 200000,
  description: 'Đơn ≥ 200k được freeship',
  category: 'shipping',
  ...over,
});

function setup(r: ConfigRow) {
  const puts: { key: string; value: unknown }[] = [];
  const api = mockFetch({
    '/admin/config': (init) => {
      if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
      return { body: { ok: true } };
    },
  });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const onSaved = vi.fn();
  return { puts, onSaved, ...mount(<ConfigItem row={r} onSaved={onSaved} />) };
}

describe('ConfigItem (tab Cấu hình)', () => {
  it('khoá đang dùng: sửa JSON rồi Lưu → gửi PUT đúng giá trị đã parse', async () => {
    const { container, puts, onSaved } = setup(row({ key: 'game.max_plots', value: 5, category: 'game' }));
    typeInto(container.querySelector('input'), '6');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(puts).toEqual([{ key: 'game.max_plots', value: 6 }]);
    expect(onSaved).toHaveBeenCalled();
  });

  it('JSON sai → báo lỗi, không gửi PUT', async () => {
    const { container, puts } = setup(row());
    typeInto(container.querySelector('input'), '{oops');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(puts).toHaveLength(0);
    expect(container.textContent).toContain('JSON không hợp lệ');
  });

  // C-054 (A1-032): admin tưởng đã tắt COD / đặt trần COD mà không code nào đọc khoá.
  it('khoá chết (deprecated): nhãn "Không dùng", ô nhập khoá, không có nút Lưu', async () => {
    const { container, puts } = setup(row({ key: 'payment.cod_max_amount', value: 5000000, description: 'Max đơn cho COD', deprecated: true }));
    expect(container.textContent).toContain('Không dùng');
    expect(container.textContent).toMatch(/sửa sẽ không có tác dụng/i);
    expect(container.querySelector('input')?.disabled).toBe(true);
    expect(byText(container, 'button', 'Lưu')).toBeNull();
    await flush();
    expect(puts).toHaveLength(0);
  });

  it('khoá null (chưa đặt, vd ETA giao hàng) hiện "null" và đặt được số đầu tiên', async () => {
    const { container, puts } = setup(row({ key: 'shipping.eta_min_days', value: null, description: 'Giao dự kiến: số ngày tối thiểu' }));
    expect(container.querySelector('input')?.value).toBe('null');
    typeInto(container.querySelector('input'), '2');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(puts).toEqual([{ key: 'shipping.eta_min_days', value: 2 }]);
  });

  describe('ADMINOPS-3: khoá tiền/điểm/thanh toán hỏi xác nhận "trước → sau" trước khi ghi', () => {
    it('shipping.free_threshold: hộp xác nhận nêu giá trị cũ và mới; Huỷ thì không gửi', async () => {
      const { container, puts } = setup(row());
      typeInto(container.querySelector('input'), '150000');
      click(byText(container, 'button', 'Lưu'));
      await flush();
      const d = confirmDialog();
      expect(d?.textContent).toContain('shipping.free_threshold');
      expect(d?.textContent).toContain('200000 → 150000');
      answerConfirm(false);
      await flush();
      expect(puts).toHaveLength(0);
    });

    it('payment.bank_account_no: xác nhận rồi mới gửi PUT', async () => {
      const { container, puts } = setup(row({ key: 'payment.bank_account_no', value: '9984606774', category: 'payment' }));
      typeInto(container.querySelector('input'), '"1234567890"');
      click(byText(container, 'button', 'Lưu'));
      await flush();
      expect(puts).toHaveLength(0);
      answerConfirm(true);
      await flush();
      expect(puts).toEqual([{ key: 'payment.bank_account_no', value: '1234567890' }]);
    });

    it('waste.customer_monthly_cap_points: khoá đổi rác cũng hỏi xác nhận (15.4)', async () => {
      const { container, puts } = setup(row({ key: 'waste.customer_monthly_cap_points', value: 60_000, category: 'waste' }));
      typeInto(container.querySelector('input'), '80000');
      click(byText(container, 'button', 'Lưu'));
      await flush();
      expect(confirmDialog()?.textContent).toContain('60000 → 80000');
      expect(puts).toHaveLength(0);
      answerConfirm(true);
      await flush();
      expect(puts).toEqual([{ key: 'waste.customer_monthly_cap_points', value: 80_000 }]);
    });
  });
});

// D5-01: nội dung điều khoản/chính sách là văn bản dài nhiều dòng; bắt admin gõ JSON một dòng (\n, \") thì không ai dán nổi.
describe('ConfigItem — khoá văn bản legal.* (D5-01)', () => {
  const LEGAL = { key: 'legal.doi-tra', value: '', category: 'legal', description: 'Nội dung trang Chính sách đổi trả' };

  it('hiện ô nhiều dòng với chữ thô (không ngoặc kép), nhãn là tên khoá', () => {
    const { container } = setup(row({ ...LEGAL, value: '## 1. Đổi trả\n\nTrong 7 ngày.' }));
    const area = container.querySelector('textarea')!;
    expect(container.querySelector('input')).toBeNull();
    expect(area.value).toBe('## 1. Đổi trả\n\nTrong 7 ngày.');
    expect(area.getAttribute('aria-label')).toBe('legal.doi-tra');
    expect(area.className).toContain('min-h-');
  });

  it('Lưu gửi nguyên chuỗi nhiều dòng, có dấu ngoặc kép và xuống dòng, không qua JSON.parse', async () => {
    const { container, puts, onSaved } = setup(row(LEGAL));
    const text = '# Đổi trả\n\nKhách nói "ổn" thì {đổi} được.\n- Mục 1';
    typeInto(container.querySelector('textarea'), text);
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(puts).toEqual([{ key: 'legal.doi-tra', value: text }]);
    expect(onSaved).toHaveBeenCalled();
    expect(container.textContent).not.toContain('JSON không hợp lệ');
  });

  it('xoá hết chữ rồi Lưu gửi chuỗi rỗng (quay về bản nháp mặc định), không hỏi xác nhận tiền/điểm', async () => {
    const { container, puts } = setup(row({ ...LEGAL, value: 'Nội dung cũ' }));
    typeInto(container.querySelector('textarea'), '');
    click(byText(container, 'button', 'Lưu'));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(puts).toEqual([{ key: 'legal.doi-tra', value: '' }]);
  });

  it('khoá không phải legal.* vẫn là ô JSON một dòng như cũ', () => {
    const { container } = setup(row({ key: 'payment.bank_name', value: 'Techcombank', category: 'payment' }));
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('input')!.value).toBe('"Techcombank"');
  });

  it('máy chủ từ chối (quá 50.000 ký tự): hiện lỗi, giữ chữ đã gõ', async () => {
    const api = mockFetch({ '/admin/config': () => ({ status: 400, body: { message: '"legal.doi-tra" không hợp lệ: tối đa 50.000 ký tự.' } }) });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const r = mount(<ConfigItem row={row(LEGAL)} onSaved={vi.fn()} />);
    typeInto(r.container.querySelector('textarea'), 'abc');
    click(byText(r.container, 'button', 'Lưu'));
    await flush();
    expect(r.container.textContent).toContain('tối đa 50.000 ký tự');
    expect(r.container.querySelector('textarea')!.value).toBe('abc');
  });
});

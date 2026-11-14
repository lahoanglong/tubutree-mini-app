// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DealerCreditPanel } from './dealer-credit-panel';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

const field = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll('label'))
    .find((l) => l.querySelector('span')?.textContent === label)
    ?.querySelector('input') ?? null;

const CASH = 'input[aria-label="Số tiền đã nhận (đ)"]';
const DISCOUNT = 'input[aria-label="CK thanh toán (đ, tuỳ chọn)"]';

let mounted: Rendered[] = [];
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  window.sessionStorage.clear();
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dealerOrder = (): AdminOrder => ({
  id: 'o1',
  code: 'TB-300',
  type: 'DEALER',
  status: 'CONFIRMED',
  total: 100_000,
  paymentMethod: 'BANK_TRANSFER',
  createdAt: '2026-11-10T00:00:00.000Z',
  user: { id: 'u-dealer-1', phone: '0900000000', fullName: 'Đại lý A' },
});

// Hoá đơn 100.000đ vẫn đủ 100% trong sổ: dư nợ 100.000đ.
const LEDGER = {
  balance: 100_000,
  entries: [{ id: 'e1', delta: 100_000, refType: 'ORDER', refId: 'o1', note: 'Đơn TB-300 ghi công nợ', createdAt: '2026-11-10T00:00:00.000Z' }],
};

async function open(extra: Record<string, { status?: number; body: unknown }> = {}) {
  const api = mockFetch({ '/credit-ledger': { body: LEDGER }, '/credit-payment': { body: { balance: 0, paymentDiscount: 20_000 } }, ...extra });
  vi.stubGlobal('fetch', vi.fn(api.fn));
  const view = mount(<DealerCreditPanel order={dealerOrder()} />);
  click(byText(view.container, 'button', 'Công nợ đại lý'));
  await flush();
  return { api, ...view };
}
const posts = (calls: { url: string; init?: RequestInit }[]) => calls.filter((c) => c.init?.method === 'POST');
const settlement = (root: ParentNode) => root.querySelector<HTMLElement>('[data-payment-settlement]');

describe('DealerCreditPanel: chiết khấu thanh toán (TK 635) khi thu tiền', () => {
  it('thu 80.000đ + CK thanh toán 20.000đ trên dư nợ 100.000đ → bảng đối chiếu: phải thu 100.000đ = thực thu 80.000đ + CK 20.000đ, còn lại 0đ', async () => {
    const { container } = await open();
    typeInto(container.querySelector(CASH), '80000');
    typeInto(container.querySelector(DISCOUNT), '20000');
    const t = settlement(container)!.textContent ?? '';
    expect(t).toContain('Phải thu hoá đơn100.000đ');
    expect(t).toContain('Thực thu tiền80.000đ');
    expect(t).toContain('CK thanh toán (Chi phí tài chính (TK 635))20.000đ');
    expect(t).toContain('Công nợ còn lại0đ');
    expect(t).toContain('Hoá đơn bán hàng vẫn đủ 100%');
  });

  it('chưa nhập CK: bảng cho thấy công nợ còn lại và gợi ý xoá phần còn lại; bấm gợi ý điền đúng số', async () => {
    const { container } = await open();
    typeInto(container.querySelector(CASH), '80000');
    expect(settlement(container)!.textContent).toContain('Công nợ còn lại20.000đ');
    click(byText(container, 'button', /Xoá nợ phần còn lại 20\.000đ/));
    expect((container.querySelector(DISCOUNT) as HTMLInputElement).value).toBe('20000');
    expect(settlement(container)!.textContent).toContain('Công nợ còn lại0đ');
    expect(byText(container, 'button', /Xoá nợ phần còn lại/)).toBeNull();
  });

  it('gợi ý "Xoá nợ phần còn lại" bị ẩn khi số gợi ý vượt trần 20%, tránh bấm xong mới báo lỗi', async () => {
    const { container } = await open();
    typeInto(container.querySelector(CASH), '50000');
    expect(settlement(container)!.textContent).toContain('Công nợ còn lại50.000đ');
    expect(byText(container, 'button', /Xoá nợ phần còn lại/)).toBeNull();
    typeInto(container.querySelector(CASH), '80000');
    expect(byText(container, 'button', /Xoá nợ phần còn lại 20\.000đ/)).not.toBeNull();
  });

  it('có CK mà thiếu lý do → báo lỗi tại chỗ, không hỏi xác nhận, không gọi API ghi', async () => {
    const { api, container } = await open();
    typeInto(container.querySelector(CASH), '80000');
    typeInto(container.querySelector(DISCOUNT), '20000');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/Ghi lý do chiết khấu thanh toán/);
    expect(confirmDialog()).toBeNull();
    expect(posts(api.calls)).toHaveLength(0);
  });

  it('nhãn ô ghi chú đổi thành "Lý do ... (bắt buộc)" khi có CK, về "Ghi chú (tuỳ chọn)" khi bỏ CK', async () => {
    const { container } = await open();
    expect(field(container, 'Ghi chú (tuỳ chọn)')).not.toBeNull();
    typeInto(container.querySelector(DISCOUNT), '5000');
    expect(field(container, 'Lý do chiết khấu thanh toán (bắt buộc)')).not.toBeNull();
    typeInto(container.querySelector(DISCOUNT), '');
    expect(field(container, 'Ghi chú (tuỳ chọn)')).not.toBeNull();
  });

  it('CK vượt trần 20% khoản xoá nợ → chặn bằng đúng câu của luật dùng chung, không gọi API', async () => {
    const { api, container } = await open();
    typeInto(container.querySelector(CASH), '50000');
    typeInto(container.querySelector(DISCOUNT), '50000');
    expect(settlement(container)!.textContent).toMatch(/tối đa 20%/);
    typeInto(field(container, 'Lý do chiết khấu thanh toán (bắt buộc)'), 'Trả sớm 10 ngày');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/tối đa 20%/);
    expect(posts(api.calls)).toHaveLength(0);
  });

  it('thực thu + CK vượt dư nợ → chặn, nêu số phải thu', async () => {
    const { api, container } = await open();
    typeInto(container.querySelector(CASH), '95000');
    typeInto(container.querySelector(DISCOUNT), '10000');
    typeInto(field(container, 'Lý do chiết khấu thanh toán (bắt buộc)'), 'Trả đúng hạn');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/vượt phải thu 100\.000đ/);
    expect(posts(api.calls)).toHaveLength(0);
  });

  it('CK âm hoặc lẻ → chặn tại chỗ', async () => {
    const { api, container } = await open();
    typeInto(container.querySelector(CASH), '80000');
    typeInto(container.querySelector(DISCOUNT), '-1');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/số nguyên không âm/);
    typeInto(container.querySelector(DISCOUNT), '1000.5');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/số nguyên không âm/);
    expect(posts(api.calls)).toHaveLength(0);
  });

  it('xác nhận → hộp thoại nêu thực thu, CK, TK 635 và công nợ còn lại; POST mang paymentDiscount + note; báo thành công đủ hai phần', async () => {
    const { api, container } = await open();
    typeInto(container.querySelector(CASH), '80000');
    typeInto(container.querySelector(DISCOUNT), '20000');
    typeInto(field(container, 'Lý do chiết khấu thanh toán (bắt buộc)'), 'Trả sớm 10 ngày theo hợp đồng');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    const dialog = confirmDialog()?.textContent ?? '';
    expect(dialog).toContain('80.000đ');
    expect(dialog).toContain('20.000đ');
    expect(dialog).toContain('Chi phí tài chính (TK 635)');
    expect(dialog).toContain('Hoá đơn của các đơn không đổi');
    expect(dialog).toContain('còn lại 0đ');
    answerConfirm(true);
    await flush();

    const [post] = posts(api.calls);
    expect(JSON.parse(String(post!.init!.body))).toEqual({ amount: 80_000, note: 'Trả sớm 10 ngày theo hợp đồng', paymentDiscount: 20_000 });
    const status = container.querySelector('[role="status"]')?.textContent ?? '';
    expect(status).toContain('thực thu 80.000đ');
    expect(status).toContain('chiết khấu thanh toán 20.000đ');
    expect(status).toContain('Chi phí tài chính (TK 635)');
    expect(status).toContain('Dư nợ còn lại: 0đ');
    expect((container.querySelector(DISCOUNT) as HTMLInputElement).value).toBe('');
  });

  it('không nhập CK → body không có paymentDiscount, thông báo thành công giữ câu cũ', async () => {
    const { api, container } = await open({ '/credit-payment': { body: { balance: 20_000 } } });
    typeInto(container.querySelector(CASH), '80000');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    answerConfirm(true);
    await flush();
    const [post] = posts(api.calls);
    expect(JSON.parse(String(post!.init!.body))).toEqual({ amount: 80_000 });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Đã ghi giảm công nợ. Dư nợ còn lại: 20.000đ');
  });

  it('dòng sổ của CK thanh toán được đánh dấu để kế toán nhìn ra', async () => {
    const ledger = {
      balance: 0,
      entries: [
        { id: 'e3', delta: -20_000, refType: 'PAYMENT_DISCOUNT', refId: 'k:ck', note: 'Chiết khấu thanh toán 20.000đ', createdAt: '2026-11-11T00:00:00.000Z' },
        { id: 'e2', delta: -80_000, refType: 'PAYMENT', refId: 'k', note: 'Thu tiền', createdAt: '2026-11-11T00:00:00.000Z' },
        ...LEDGER.entries,
      ],
    };
    const { container } = await open({ '/credit-ledger': { body: ledger } });
    const marked = container.querySelectorAll('[data-ledger-ref="PAYMENT_DISCOUNT"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain('Chiết khấu thanh toán 20.000đ');
  });

  it('thử lại sau lỗi mạng: cùng số tiền + cùng CK → cùng Idempotency-Key; đổi CK → khoá mới', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER }, '/credit-payment': { body: { balance: 0, paymentDiscount: 20_000 } } });
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && (n += 1) <= 2) {
          api.calls.push({ url, init });
          throw new TypeError('Failed to fetch');
        }
        return api.fn(url, init);
      }),
    );
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    const pay = async () => {
      click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
      await flush();
      answerConfirm(true);
      await flush();
    };
    typeInto(container.querySelector(CASH), '80000');
    typeInto(container.querySelector(DISCOUNT), '20000');
    typeInto(field(container, 'Lý do chiết khấu thanh toán (bắt buộc)'), 'Trả sớm');
    await pay();
    await pay();
    typeInto(container.querySelector(DISCOUNT), '10000');
    await pay();
    const keys = posts(api.calls).map((c) => (c.init!.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});

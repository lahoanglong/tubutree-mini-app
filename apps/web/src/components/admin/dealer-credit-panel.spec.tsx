// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DealerCreditPanel } from './dealer-credit-panel';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

/** Ô nhập theo chữ nhãn hiện của Field (tên truy cập lấy từ nhãn, không còn aria-label riêng). */
const field = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll('label'))
    .find((l) => l.querySelector('span')?.textContent === label)
    ?.querySelector('input') ?? null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

const dealerOrder = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-200',
  type: 'DEALER',
  status: 'CONFIRMED',
  total: 12_500_000,
  paymentMethod: 'BANK_TRANSFER',
  createdAt: '2026-09-27T00:00:00.000Z',
  user: { id: 'u-dealer-1', phone: '0900000000', fullName: 'Đại lý A' },
  ...over,
});

// Quy ước của API (DealerService.creditLedger): tổng delta DƯƠNG = đang nợ; đơn ghi công nợ cộng, khoản đã trả trừ.
const LEDGER_BODY = {
  balance: 3_000_000, // đang nợ 3tr
  entries: [
    { id: 'e3', delta: -1_000_000, refType: 'PAYMENT', refId: null, note: 'Admin xác nhận đã nhận chuyển khoản', createdAt: '2026-09-21T00:00:00.000Z' },
    { id: 'e2', delta: 4_000_000, refType: 'ORDER', refId: 'o2', note: 'Đơn TB-199 ghi công nợ', createdAt: '2026-09-20T00:00:00.000Z' },
  ],
};

describe('DealerCreditPanel (chi tiết đơn admin) — A5-09', () => {
  it('đơn không phải ĐẠI LÝ → không render gì', () => {
    const { container } = mount(<DealerCreditPanel order={dealerOrder({ type: 'RETAIL' })} />);
    expect(container.textContent).toBe('');
  });

  it('bấm mở → tải sổ công nợ, hiện dư nợ + lịch sử; xác nhận trả nợ → POST đúng endpoint, hỏi xác nhận trước', async () => {
    const api = mockFetch({
      '/credit-ledger': { body: LEDGER_BODY },
      '/credit-payment': { body: { balance: 1_000_000 } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const native = vi.spyOn(window, 'confirm');

    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();

    expect(api.calls[0]!.url).toContain('/admin/dealers/u-dealer-1/credit-ledger');
    expect(container.textContent).toContain('Dư nợ hiện tại: 3.000.000');
    expect(container.textContent).not.toContain('-3.000.000');
    expect(container.textContent).toContain('Đơn TB-199 ghi công nợ');

    typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '2000000');
    typeInto(field(container, 'Mã giao dịch (tuỳ chọn)'), 'FT999');
    const btn = byText(container, 'button', 'Xác nhận đã nhận, giảm nợ') as HTMLButtonElement;

    click(btn);
    await flush();
    expect(confirmDialog()?.textContent).toMatch(/2\.000\.000/);
    answerConfirm(false);
    await flush();
    expect(api.calls).toHaveLength(1); // huỷ hộp thoại → chưa gọi POST

    click(btn);
    await flush();
    answerConfirm(true);
    await flush();
    expect(native).not.toHaveBeenCalled();
    // Sau khi POST thành công, panel invalidate query nên sổ công nợ được tải lại (thêm 1 GET) —
    // tìm đúng lượt POST theo URL/method thay vì đoán số thứ tự.
    const postCall = api.calls.find((c) => c.init?.method === 'POST');
    expect(postCall?.url).toContain('/admin/dealers/u-dealer-1/credit-payment');
    expect(JSON.parse(String(postCall?.init?.body))).toEqual({ amount: 2_000_000, bankRef: 'FT999' });
    expect((postCall?.init?.headers as Record<string, string>)['Idempotency-Key']).toMatch(UUID);
    expect((postCall?.init?.headers as Record<string, string>)['Idempotency-Key']).not.toBe('FT999');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('1.000.000');
  });

  it('không nhập số tiền → báo lỗi tại chỗ, không gọi API', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/số tiền hợp lệ/i);
    expect(api.calls).toHaveLength(1); // chỉ có lượt tải ledger, không có POST
  });

  it('400 (vượt dư nợ) → hiện NGUYÊN VĂN message của API', async () => {
    const msg = 'Số tiền vượt quá dư nợ hiện tại (3.000.000đ).';
    const api = mockFetch({
      '/credit-ledger': { body: LEDGER_BODY },
      '/credit-payment': { status: 400, body: { statusCode: 400, message: msg } },
    });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '99000000');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(msg);
  });
});

describe('DealerCreditPanel — ERR-01 chống trừ nợ hai lần khi thử lại', () => {
  const postKeys = (calls: { url: string; init?: RequestInit }[]) =>
    calls.filter((c) => c.init?.method === 'POST').map((c) => (c.init?.headers as Record<string, string>)['Idempotency-Key']);

  async function pay(container: HTMLElement) {
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    answerConfirm(true);
    await flush();
  }

  it('lỗi mạng rồi bấm lại (không nhập mã GD) → cùng Idempotency-Key; báo "chưa rõ đã xong chưa" và tải lại sổ', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY }, '/credit-payment': { body: { balance: 1_000_000 } } });
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && (posts += 1) === 1) {
          api.calls.push({ url, init });
          throw new TypeError('Failed to fetch');
        }
        return api.fn(url, init);
      }),
    );
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '2000000');

    await pay(container);
    const ledgerGetsAfterFail = api.calls.filter((c) => c.url.includes('/credit-ledger')).length;
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(ledgerGetsAfterFail).toBeGreaterThanOrEqual(2);

    await pay(container);
    const keys = postKeys(api.calls);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(UUID);
    expect(keys[1]).toBe(keys[0]);
  });

  it('hết giờ (20s) → câu "chưa rõ đã xong chưa", không phải "thử lại sau ít phút"', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Promise<Response>((_, reject) =>
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          );
        }
        return api.fn(url, init);
      }),
    );
    // Rút hạn 20s của apiFetch về 0 để chạy hết giờ thật mà không chờ.
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) =>
      realSetTimeout(fn, ms === 20_000 ? 0 : ms, ...rest)) as typeof setTimeout);
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '2000000');
    await pay(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/chưa rõ đã xong chưa/);
  });

  it('thành công rồi nhập khoản mới → Idempotency-Key khác; đổi số tiền trước khi thử lại cũng đổi khoá', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY }, '/credit-payment': { body: { balance: 1_000_000 } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    const amountInput = () => container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]');
    typeInto(amountInput(), '1000000');
    await pay(container);
    typeInto(amountInput(), '1000000');
    await pay(container);
    typeInto(amountInput(), '1500000');
    typeInto(amountInput(), '1200000');
    await pay(container);
    const keys = postKeys(api.calls);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
  });

  it('lỗi mạng, xoá rồi gõ lại đúng số cũ → cùng khoá; đổi số → khoá mới; gập dòng (unmount/mount lại) sau lỗi → cùng khoá', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY }, '/credit-payment': { body: { balance: 1_000_000 } } });
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST' && (posts += 1) <= 2) {
          api.calls.push({ url, init });
          throw new TypeError('Failed to fetch');
        }
        return api.fn(url, init);
      }),
    );
    const first = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(first.container, 'button', 'Công nợ đại lý'));
    await flush();
    const amountInput = (c: HTMLElement) => c.querySelector('input[aria-label="Số tiền đã nhận (đ)"]');
    typeInto(amountInput(first.container), '2000000');
    await pay(first.container);
    typeInto(amountInput(first.container), '');
    typeInto(amountInput(first.container), '2000000');
    await pay(first.container);
    first.unmount();
    mounted = mounted.filter((m) => m !== first);

    const second = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(second.container, 'button', 'Công nợ đại lý'));
    await flush();
    typeInto(amountInput(second.container), '2000000');
    await pay(second.container);
    typeInto(amountInput(second.container), '2500000');
    await pay(second.container);

    const keys = postKeys(api.calls);
    expect(keys).toHaveLength(4);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
  });

  describe('khoá đã lưu cũ hoặc của báo cáo khác', () => {
    const seed = (over: Record<string, unknown>) =>
      window.sessionStorage.setItem(
        'dealer-credit-idem:u-dealer-1',
        JSON.stringify({ key: 'OLD-KEY', amount: 2_000_000, bankRef: '', reportId: null, sentAt: Date.now(), ...over }),
      );
    const run = async (props: { reportId?: string } = {}) => {
      const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY }, '/credit-payment': { body: { balance: 1_000_000 } } });
      vi.stubGlobal('fetch', vi.fn(api.fn));
      const { container } = mount(<DealerCreditPanel order={dealerOrder()} {...props} />);
      click(byText(container, 'button', 'Công nợ đại lý'));
      await flush();
      typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '2000000');
      await pay(container);
      return postKeys(api.calls);
    };

    it('bộ còn trong 15 phút, cùng số tiền, mã, báo cáo: dùng lại khoá cũ', async () => {
      seed({ sentAt: Date.now() - 14 * 60_000 });
      expect(await run()).toEqual(['OLD-KEY']);
    });

    it('bộ đã quá 15 phút: khoá mới', async () => {
      seed({ sentAt: Date.now() - 16 * 60_000 });
      const keys = await run();
      expect(keys).toHaveLength(1);
      expect(keys[0]).not.toBe('OLD-KEY');
    });

    it('bộ của báo cáo khác (hoặc ghi tay): khoá mới', async () => {
      seed({ reportId: 'rp-other' });
      const keys = await run({ reportId: 'rp1' });
      expect(keys[0]).not.toBe('OLD-KEY');
    });
  });

  it('máy chủ trả replayed: báo "đã được ghi ở lần bấm trước", không nói "đã ghi giảm", xoá bộ đã lưu', async () => {
    window.sessionStorage.setItem(
      'dealer-credit-idem:u-dealer-1',
      JSON.stringify({ key: 'OLD-KEY', amount: 2_000_000, bankRef: '', reportId: null, sentAt: Date.now() }),
    );
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY }, '/credit-payment': { body: { balance: 3_000_000, replayed: true } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '2000000');
    await pay(container);
    expect(container.textContent).toContain('Khoản này đã được ghi ở lần bấm trước, sổ không đổi.');
    expect(container.textContent).not.toContain('Đã ghi giảm công nợ');
    expect(window.sessionStorage.getItem('dealer-credit-idem:u-dealer-1')).toBeNull();
  });

  it('có mã GD vẫn gửi khoá riêng (không dùng mã GD làm khoá)', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY }, '/credit-payment': { body: { balance: 1_000_000 } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '1000000');
    typeInto(field(container, 'Mã giao dịch (tuỳ chọn)'), 'FT1');
    await pay(container);
    const post = api.calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ bankRef: 'FT1' });
    expect(postKeys(api.calls)[0]).toMatch(UUID);
  });
});

// C-097 (Q-29): khối công nợ có thao tác tiền nên nút/ô nhập chạm được ở 390px; dư nợ tô theo token trạng thái.
describe('DealerCreditPanel — trạng thái dư nợ', () => {
  it('hết nợ (balance 0) tô xanh, không hiện số âm', async () => {
    const api = mockFetch({ '/credit-ledger': { body: { balance: 0, entries: [] } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    expect(container.querySelector('p span.text-success-fg')?.textContent).toContain('0');
    expect(container.textContent).toContain('Chưa có phát sinh.');
  });

  it('onPaid được gọi sau khi ghi giảm nợ thành công (để màn danh sách đại lý tải lại dư nợ)', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY }, '/credit-payment': { body: { balance: 1_000_000 } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onPaid = vi.fn();
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} defaultOpen onPaid={onPaid} />);
    await flush();
    typeInto(container.querySelector('input[aria-label="Số tiền đã nhận (đ)"]'), '2000000');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(onPaid).not.toHaveBeenCalled();
    answerConfirm(true);
    await flush();
    expect(onPaid).toHaveBeenCalledTimes(1);
    // Số tiền kế toán thực nhập (không phải số điền sẵn) và dư nợ còn lại đi kèm, để nơi chứa panel báo đúng.
    expect(onPaid).toHaveBeenCalledWith({ amount: 2_000_000, balance: 1_000_000, reportClosed: undefined });
  });

  it('kèm reportId mà API báo reportClosed: false (mã GD đã ghi từ lần khác): khối không nói "đã ghi giảm công nợ" và báo lại cho nơi chứa', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY }, '/credit-payment': { body: { balance: 3_000_000, reportClosed: false } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onPaid = vi.fn();
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} defaultOpen defaultAmount={1_500_000} reportId="rp1" onPaid={onPaid} />);
    await flush();
    typeInto(container.querySelector('input[type="text"]'), 'FT777');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(onPaid).toHaveBeenCalledWith({ amount: 1_500_000, balance: 3_000_000, reportClosed: false });
    expect(container.textContent).toContain('Mã giao dịch này đã có trong sổ');
    expect(container.textContent).not.toContain('Đã ghi giảm công nợ');
  });

  it('kèm reportId mà báo cáo đã được ghi nhận từ lần khác (alreadyRecorded): khối nói sổ không đổi lần này, không nói "đã ghi giảm", và báo lại cho nơi chứa', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY }, '/credit-payment': { body: { balance: 3_000_000, reportClosed: true, alreadyRecorded: true } } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const onPaid = vi.fn();
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} defaultOpen defaultAmount={1_500_000} reportId="rp1" onPaid={onPaid} />);
    await flush();
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    answerConfirm(true);
    await flush();
    expect(onPaid).toHaveBeenCalledWith({ amount: 1_500_000, balance: 3_000_000, reportClosed: true, alreadyRecorded: true });
    expect(container.textContent).toContain('đã được ghi nhận trước đó');
    expect(container.textContent).not.toContain('Đã ghi giảm công nợ');
  });

  it('defaultOpen: mở sẵn và tải sổ ngay (dùng trong tab Đại lý, nút "Ghi nhận thanh toán" đã là thao tác mở)', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={{ type: 'DEALER', user: { id: 'u-dealer-1', phone: null, fullName: 'Đại lý A' } }} defaultOpen />);
    await flush();
    expect(api.calls[0]!.url).toContain('/admin/dealers/u-dealer-1/credit-ledger');
    expect(container.textContent).toContain('Dư nợ hiện tại: 3.000.000');
  });
});

describe('DealerCreditPanel — DS v2', () => {
  it('nút mở/đóng, ô nhập và nút xác nhận cao 44px ở điện thoại; ô nhập chịu xuống dòng (basis-40)', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    expect(byText(container, 'button', 'Công nợ đại lý')?.className).toContain('min-h-[44px]');
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    for (const input of Array.from(container.querySelectorAll('input'))) expect(input.className).toContain('min-h-[44px]');
    expect(field(container, 'Ghi chú (tuỳ chọn)')?.closest('label')?.className).toContain('basis-40');
    expect(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ')?.className).toContain('min-h-[44px]');
    expect(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ')?.className).toContain('bg-warning-fg');
  });

  it('dư nợ dương/âm tô danger-fg, lỗi nhập tô danger-fg', async () => {
    const api = mockFetch({ '/credit-ledger': { body: LEDGER_BODY } });
    vi.stubGlobal('fetch', vi.fn(api.fn));
    const { container } = mount(<DealerCreditPanel order={dealerOrder()} />);
    click(byText(container, 'button', 'Công nợ đại lý'));
    await flush();
    expect(container.querySelector('p span.text-danger-fg')?.textContent).toContain('3.000.000');
    // Dòng nợ thêm (delta dương) tô đỏ, khoản đã trả (delta âm) tô xanh.
    const rows = Array.from(container.querySelectorAll('ul li'));
    expect(rows.find((li) => li.textContent?.includes('Đơn TB-199'))?.querySelector('span:last-child')?.className).toContain('text-danger-fg');
    expect(rows.find((li) => li.textContent?.includes('xác nhận đã nhận'))?.querySelector('span:last-child')?.className).toContain('text-success-fg');
    click(byText(container, 'button', 'Xác nhận đã nhận, giảm nợ'));
    await flush();
    expect(container.querySelector('[role="alert"]')?.className).toContain('text-danger-fg');
  });
});

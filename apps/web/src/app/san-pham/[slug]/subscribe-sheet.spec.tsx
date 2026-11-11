// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';
import { loadErrorText } from '@/lib/error-text';
import { QueryClient } from '@tanstack/react-query';
import { ApiError, NetworkError } from '@/lib/client-api';

// Cùng ý nghĩa subscribe-sheet.spec.tsx của Mini App: ngày bắt đầu + cách trả + địa chỉ, cùng endpoint và body tạo subscription.

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getAddresses: vi.fn(),
  getWallet: vi.fn(),
  http: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: mocks.http }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getAddresses: mocks.getAddresses,
  getWallet: mocks.getWallet,
}));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.12, isLoaded: true }) }));

// Bọc Sheet để đọc props mới nhất (open/dismissible/onClose): guard `onClose` không có đường bấm nào chạm tới khi
// `dismissible=false` đã ẩn nút X, Esc và nền, nên chỉ gọi thẳng onClose mới chứng minh được nó.
const sheetSpy = vi.hoisted(() => ({
  calls: [] as Array<{ open: boolean; dismissible?: boolean; title?: string; onClose: () => void }>,
}));
vi.mock('@/components/ui/sheet', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui/sheet')>();
  return {
    ...orig,
    Sheet: (p: Parameters<typeof orig.Sheet>[0]) => {
      sheetSpy.calls.push(p);
      return <orig.Sheet {...p} />;
    },
  };
});

import { SubscribeSheet } from './subscribe-sheet';

const ADDR = (id: string, isDefault: boolean, street: string) => ({
  id, recipient: 'Lan', phone: '0900000000', province: 'HCM', district: 'Q.1', ward: 'P.1', street,
  provinceCode: '79', districtCode: '760', wardCode: '1', isDefault,
});
const SUB = { id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-11-07T00:00:00.000Z', productName: 'Nước xả vải' };

let mounted: Rendered[] = [];
const onClose = vi.fn();
const onNotice = vi.fn();
const mount = () => {
  const r = render(<SubscribeSheet visible onClose={onClose} onNotice={onNotice} variationId="v1" quantity={2} />);
  mounted.push(r);
  return r;
};
const body = () => document.body;
const radio = (re: RegExp) => Array.from(document.querySelectorAll<HTMLElement>('[role="radio"]')).find((e) => re.test(e.textContent ?? ''))!;
const create = () => byText(body(), 'button', 'Bắt đầu đặt định kỳ') as HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
  onClose.mockReset();
  onNotice.mockReset();
  mocks.push.mockReset();
  mocks.http.post.mockReset();
  mocks.getAddresses.mockReset().mockResolvedValue([ADDR('a1', false, '1 Lê Lợi'), ADDR('a2', true, '9 Hai Bà Trưng')]);
  mocks.getWallet.mockReset().mockResolvedValue({ walletBalance: 300000 });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('SubscribeSheet (ngày bắt đầu, cách trả, địa chỉ)', () => {
  it('tiêu đề có mức giảm lấy từ config, các nút có tên', async () => {
    mount();
    await flush();
    expect(body().textContent).toContain('Đặt định kỳ — tiết kiệm 12%');
    expect(unnamedControls(body())).toEqual([]);
  });

  it('mặc định giao ngay, COD, địa chỉ mặc định: POST /me/subscriptions không có startDate; báo mã đơn đầu', async () => {
    mocks.http.post.mockResolvedValue({ ...SUB, firstOrder: { id: 'o1', code: 'TB-1', status: 'PENDING', paymentMethod: 'COD', total: 160000 } });
    mount();
    await flush();
    expect(radio(/9 Hai Bà Trưng/).getAttribute('aria-checked')).toBe('true');
    expect(byText(body(), 'button', 'Giao ngay')!.getAttribute('aria-pressed')).toBe('true');
    click(create());
    await flush();
    expect(mocks.http.post).toHaveBeenCalledWith('/me/subscriptions', { variationId: 'v1', quantity: 2, intervalWeeks: 4, addressId: 'a2', paymentMethod: 'COD' });
    expect(onClose).toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('TB-1'));
  });

  it('giao ngay mà API trả lại gói đã có (không kèm đơn đầu) thì báo đã có gói, không in ngày rỗng', async () => {
    mocks.http.post.mockResolvedValue({ ...SUB, firstOrder: null });
    mount();
    await flush();
    click(create());
    await flush();
    const text = onNotice.mock.calls[0]![0] as string;
    expect(text).toContain('đã có');
    expect(text).not.toMatch(/undefined|đơn đầu giao từ/);
  });

  it('chọn ngày bắt đầu + Ví Tubu + địa chỉ khác + chu kỳ 6 tuần thì gửi đúng startDate/paymentMethod/addressId', async () => {
    mocks.http.post.mockResolvedValue({ ...SUB, firstOrder: null });
    mount();
    await flush();
    click(byText(body(), 'button', '6 tuần'));
    click(byText(body(), 'button', 'Chọn ngày'));
    const date = body().querySelector('input[type="date"]') as HTMLInputElement;
    expect(date.min).toBe('2026-10-11');
    expect(date.max).toBe('2026-12-09');
    expect(date.labels?.[0]?.textContent).toBe('Ngày bắt đầu giao');
    typeInto(date, '2026-10-20');
    click(radio(/Ví Tubu \(300\.000đ\)/));
    click(radio(/1 Lê Lợi/));
    click(create());
    await flush();
    expect(mocks.http.post).toHaveBeenCalledWith('/me/subscriptions', {
      variationId: 'v1', quantity: 2, intervalWeeks: 6, addressId: 'a1', paymentMethod: 'WALLET', startDate: '2026-10-20',
    });
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('20/10/2026'));
  });

  it('Ví đang âm thì hàng Ví Tubu bị khoá kèm lý do như màn thanh toán, gói tạo bằng COD', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: -50000 });
    mocks.http.post.mockResolvedValue({ ...SUB, firstOrder: null });
    mount();
    await flush();
    const wallet = radio(/Ví Tubu/) as HTMLButtonElement;
    expect(wallet.disabled).toBe(true);
    expect(wallet.textContent).toContain('Số dư Ví Tubu đang âm 50.000đ do thu hồi hoa hồng đơn trả hàng.');
    click(wallet);
    expect(wallet.getAttribute('aria-checked')).toBe('false');
    click(create());
    await flush();
    expect(mocks.http.post).toHaveBeenCalledWith('/me/subscriptions', expect.objectContaining({ paymentMethod: 'COD' }));
  });

  it('đã chọn Ví rồi số dư tải về âm thì khoá nút tạo, không gửi gói trả bằng Ví', async () => {
    let resolveWallet!: (w: { walletBalance: number }) => void;
    mocks.getWallet.mockReturnValue(new Promise((r) => (resolveWallet = r)));
    mount();
    await flush();
    click(radio(/^Ví Tubu/));
    expect(radio(/^Ví Tubu/).getAttribute('aria-checked')).toBe('true');
    resolveWallet({ walletBalance: -50000 });
    await flush();
    expect(radio(/Số dư Ví Tubu đang âm 50\.000đ/)).toBeTruthy();
    expect(create().disabled).toBe(true);
    expect(mocks.http.post).not.toHaveBeenCalled();
  });

  it('ngày ngoài khoảng (hôm nay) thì báo lỗi và khoá nút tạo', async () => {
    mount();
    await flush();
    click(byText(body(), 'button', 'Chọn ngày'));
    typeInto(body().querySelector('input[type="date"]'), '2026-10-10');
    expect(body().textContent).toMatch(/Ngày bắt đầu phải từ ngày mai/);
    expect(create().disabled).toBe(true);
    expect(mocks.http.post).not.toHaveBeenCalled();
  });

  it('chỉ có COD, Ví Tubu, chuyển khoản; không có ZaloPay/VNPAY', async () => {
    mount();
    await flush();
    const labels = Array.from(document.querySelectorAll('[role="radiogroup"][aria-label="Thanh toán mỗi kỳ"] [role="radio"]'));
    expect(labels).toHaveLength(3);
    expect(body().textContent).not.toMatch(/ZaloPay|VNPAY/i);
  });

  it('chuyển khoản mà đơn đầu chờ thanh toán thì mở trang chuyển khoản của đơn đó như Mini App', async () => {
    mocks.http.post.mockResolvedValue({ ...SUB, firstOrder: { id: 'o2', code: 'TB-2', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', total: 160000 } });
    mount();
    await flush();
    click(radio(/Chuyển khoản ngân hàng/));
    click(create());
    await flush();
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan/chuyen-khoan/TB-2');
    expect(mocks.http.post).toHaveBeenCalledWith('/me/subscriptions', expect.objectContaining({ paymentMethod: 'BANK_TRANSFER' }));
  });

  it('API từ chối (Ví thiếu) thì hiện lỗi trong sheet, sheet vẫn mở', async () => {
    mocks.http.post.mockRejectedValue(new Error('Số dư Ví Tubu không đủ'));
    mount();
    await flush();
    click(create());
    await flush();
    expect(body().querySelector('[role="alert"]')!.textContent).toContain('Số dư Ví Tubu không đủ');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lỗi cũ không còn khi đóng rồi mở lại sheet (đã nạp Ví xong mở lại, chưa bấm gì)', async () => {
    mocks.http.post.mockRejectedValue(new Error('Số dư Ví Tubu không đủ'));
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)}>đổi</button>
          <SubscribeSheet visible={open} onClose={() => setOpen(false)} onNotice={onNotice} variationId="v1" quantity={2} />
        </>
      );
    }
    mounted.push(render(<Harness />));
    await flush();
    click(create());
    await flush();
    expect(body().querySelector('[role="alert"]')).not.toBeNull();
    click(byText(body(), 'button', 'đổi')!);
    await flush();
    click(byText(body(), 'button', 'đổi')!);
    await flush();
    expect(body().querySelector('[role="alert"]')).toBeNull();
  });

  it('đang tạo mà đóng rồi mở lại sheet: nút vẫn khoá "Đang tạo…", không bắn POST thứ hai', async () => {
    mocks.http.post.mockReturnValue(new Promise(() => undefined));
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)}>đổi</button>
          <SubscribeSheet visible={open} onClose={() => setOpen(false)} onNotice={onNotice} variationId="v1" quantity={2} />
        </>
      );
    }
    mounted.push(render(<Harness />));
    await flush();
    click(create());
    await flush();
    click(byText(body(), 'button', 'đổi')!);
    await flush();
    click(byText(body(), 'button', 'đổi')!);
    await flush();
    const pending = byText(body(), 'button', 'Đang tạo…') as HTMLButtonElement;
    // Nút đang gửi giữ aria-busy/aria-disabled (không `disabled` DOM để khỏi mất focus); bấm lại bị guard chặn.
    expect(pending.getAttribute('aria-busy')).toBe('true');
    expect(pending.getAttribute('aria-disabled')).toBe('true');
    click(pending);
    await flush();
    expect(mocks.http.post).toHaveBeenCalledTimes(1);
  });

  it('chưa có địa chỉ thì nút Thêm địa chỉ sang /tai-khoan/dia-chi, không có nút tạo', async () => {
    mocks.getAddresses.mockResolvedValue([]);
    mount();
    await flush();
    expect(byText(body(), 'button', 'Bắt đầu đặt định kỳ')).toBeNull();
    click(byText(body(), 'button', 'Thêm địa chỉ'));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/tai-khoan/dia-chi');
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const skeletons = () => document.querySelectorAll('[data-skeleton]').length;
const alertEl = () => body().querySelector('[role="alert"]') as HTMLElement | null;
const lastSheet = () => sheetSpy.calls.at(-1)!;
/** Gọi thẳng onClose đang treo ở sheet (nút X/Esc/nền đã bị `dismissible` chặn trước khi tới đây). */
const tryClose = () => act(() => lastSheet().onClose());
const escape = () => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
const group = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(`[aria-label="${label}"] button`));
const radiosOf = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${label}"] [role="radio"]`));
const ADDRS = [ADDR('a1', false, '1 Lê Lợi'), ADDR('a2', true, '9 Hai Bà Trưng')];
const retryBtn = () => byText(alertEl()!, 'button', 'Thử lại') as HTMLButtonElement;

describe('SubscribeSheet: tải địa chỉ (skeleton, lỗi + Thử lại)', () => {
  beforeEach(() => sheetSpy.calls.splice(0));

  it('địa chỉ đang tải: hiện skeleton, chưa dựng danh sách địa chỉ; tải xong thì thay bằng danh sách', async () => {
    const addr = deferred<typeof ADDRS>();
    mocks.getAddresses.mockReturnValue(addr.promise);
    mount();
    await flush();
    expect(skeletons()).toBeGreaterThan(0);
    expect(document.querySelector('[role="radiogroup"][aria-label="Giao tới"]')).toBeNull();
    expect(alertEl()).toBeNull();

    addr.resolve(ADDRS);
    await flush();
    expect(radio(/9 Hai Bà Trưng/).getAttribute('aria-checked')).toBe('true');
    expect(skeletons()).toBe(0);
  });

  it('tải địa chỉ lỗi: role="alert" có lời lỗi + "Thử lại"; không có nút tạo, không có danh sách địa chỉ', async () => {
    const err = new Error('boom');
    mocks.getAddresses.mockRejectedValue(err);
    mount();
    await flush();
    expect(loadErrorText(err)).not.toBe('');
    expect(alertEl()!.textContent).toContain(loadErrorText(err));
    expect(retryBtn().disabled).toBe(false);
    expect(byText(body(), 'button', 'Bắt đầu đặt định kỳ')).toBeNull();
    expect(document.querySelector('[role="radiogroup"][aria-label="Giao tới"]')).toBeNull();
    expect(skeletons()).toBe(0);
  });

  it('"Thử lại": gọi lại địa chỉ; đang tải nút báo bận, vùng lỗi + focus đứng yên, chưa có nút tạo; xong thì hiện danh sách + nút tạo', async () => {
    const err = new Error('Không tải được địa chỉ giao hàng');
    expect(loadErrorText(err)).toBe('Không tải được địa chỉ giao hàng');
    expect(loadErrorText(null)).not.toBe(loadErrorText(err));
    const retry = deferred<typeof ADDRS>();
    mocks.getAddresses.mockReset().mockRejectedValueOnce(err).mockReturnValueOnce(retry.promise);
    mount();
    await flush();
    const alert = alertEl()!;
    const btn = retryBtn();
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    btn.focus();
    click(btn);
    await flush();
    expect(mocks.getAddresses).toHaveBeenCalledTimes(2);

    // react-query xoá lỗi lúc tải lại: vùng lỗi vẫn là CÙNG phần tử, còn lời cũ, focus không rơi về body
    expect(alertEl()).toBe(alert);
    expect(alert.textContent).toContain(loadErrorText(err));
    expect(retryBtn()).toBe(btn);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(btn);
    expect(skeletons()).toBe(0);
    expect(byText(body(), 'button', 'Bắt đầu đặt định kỳ')).toBeNull();

    // Bấm lần nữa lúc đang chờ: không đổi lời cũ thành câu chung (lỗi của truy vấn đang null), không gọi thêm.
    click(btn);
    await flush();
    expect(mocks.getAddresses).toHaveBeenCalledTimes(2);
    expect(alert.textContent).toContain(loadErrorText(err));

    retry.resolve(ADDRS);
    await flush();
    expect(radio(/9 Hai Bà Trưng/).getAttribute('aria-checked')).toBe('true');
    expect(alertEl()).toBeNull();
    expect((byText(body(), 'button', 'Bắt đầu đặt định kỳ') as HTMLButtonElement).disabled).toBe(false);
  });

  it('đã có danh sách địa chỉ mà lần tải lại sau đó lỗi: danh sách ở lại, không hiện vùng lỗi, vẫn có nút tạo', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)}>đổi</button>
          <SubscribeSheet visible={open} onClose={() => setOpen(false)} onNotice={onNotice} variationId="v1" quantity={2} />
        </>
      );
    }
    mounted.push(render(<Harness />));
    await flush();
    expect(radio(/9 Hai Bà Trưng/).getAttribute('aria-checked')).toBe('true');
    mocks.getAddresses.mockReset().mockRejectedValue(new Error('boom'));
    click(byText(body(), 'button', 'đổi')!);
    await flush();
    click(byText(body(), 'button', 'đổi')!);
    await flush(3);
    expect(mocks.getAddresses).toHaveBeenCalledTimes(1);
    expect(alertEl()).toBeNull();
    expect(radiosOf('Giao tới')).toHaveLength(2);
    expect(create().disabled).toBe(false);
  });

  it('"Thử lại" lỗi tiếp: vùng lỗi vẫn đó, nút hết bận, thử lại được lần nữa', async () => {
    const err = new Error('boom');
    mocks.getAddresses.mockReset().mockRejectedValueOnce(err).mockRejectedValueOnce(err).mockResolvedValueOnce(ADDRS);
    mount();
    await flush();
    click(retryBtn());
    await flush();
    expect(mocks.getAddresses).toHaveBeenCalledTimes(2);
    expect(alertEl()!.textContent).toContain(loadErrorText(err));
    expect(retryBtn().hasAttribute('aria-busy')).toBe(false);
    expect(byText(body(), 'button', 'Bắt đầu đặt định kỳ')).toBeNull();

    click(retryBtn());
    await flush();
    expect(mocks.getAddresses).toHaveBeenCalledTimes(3);
    expect(alertEl()).toBeNull();
    expect(radio(/9 Hai Bà Trưng/).getAttribute('aria-checked')).toBe('true');
  });
});

describe('SubscribeSheet: khoá form + chặn đóng khi đang tạo lịch', () => {
  beforeEach(() => sheetSpy.calls.splice(0));

  /** Chọn "Chọn ngày" + một ngày hợp lệ (để ô ngày hiện ra), bấm tạo, đợi nút báo bận. */
  async function startPending() {
    const created = deferred<Record<string, unknown>>();
    mocks.http.post.mockReturnValue(created.promise);
    mount();
    await flush();
    click(byText(body(), 'button', 'Chọn ngày'));
    typeInto(body().querySelector('input[type="date"]'), '2026-10-20');
    click(byText(body(), 'button', 'Bắt đầu đặt định kỳ'));
    await flush(3);
    return created;
  }
  const dateInput = () => body().querySelector('input[type="date"]') as HTMLInputElement;
  const pressed = (label: string) => byText(body(), 'button', label)!.getAttribute('aria-pressed');

  it('đang tạo: khoá chu kỳ, "Giao ngay"/"Chọn ngày", ô ngày, 3 cách trả, các địa chỉ; nút tạo báo bận nhưng giữ focus (không disabled DOM)', async () => {
    await startPending();
    const weeks = group('Chu kỳ giao');
    expect(weeks).toHaveLength(4);
    for (const w of weeks) expect(w.disabled, w.textContent ?? '').toBe(true);
    for (const w of group('Đơn đầu tiên')) expect(w.disabled, w.textContent ?? '').toBe(true);
    expect(group('Đơn đầu tiên')).toHaveLength(2);
    expect(dateInput().disabled).toBe(true);
    const pay = radiosOf('Thanh toán mỗi kỳ');
    expect(pay).toHaveLength(3);
    for (const r of pay) expect(r.disabled).toBe(true);
    const addr = radiosOf('Giao tới');
    expect(addr).toHaveLength(2);
    for (const r of addr) expect(r.disabled).toBe(true);
    for (const r of [...pay, ...addr]) expect(r.classList.contains('cursor-not-allowed')).toBe(true);

    const cta = byText(body(), 'button', 'Đang tạo…') as HTMLButtonElement;
    expect(cta.getAttribute('aria-busy')).toBe('true');
    expect(cta.getAttribute('aria-disabled')).toBe('true');
    expect(cta.disabled).toBe(false);
  });

  it('đang tạo: bấm các điều khiển bị khoá không đổi lựa chọn; bấm nút tạo lần nữa không bắn POST thứ hai', async () => {
    await startPending();
    click(byText(body(), 'button', '6 tuần'));
    expect(pressed('4 tuần')).toBe('true');
    click(byText(body(), 'button', 'Giao ngay'));
    expect(pressed('Chọn ngày')).toBe('true');
    click(radio(/1 Lê Lợi/));
    expect(radio(/1 Lê Lợi/).getAttribute('aria-checked')).toBe('false');
    click(radio(/Chuyển khoản ngân hàng/));
    expect(radio(/Chuyển khoản ngân hàng/).getAttribute('aria-checked')).toBe('false');
    click(byText(body(), 'button', 'Đang tạo…'));
    await flush();
    expect(mocks.http.post).toHaveBeenCalledTimes(1);
  });

  it('đang tạo: sheet không đóng được (không nút X, Esc, nền, onClose đều bị chặn); tạo xong mở khoá lại', async () => {
    const created = await startPending();
    expect(lastSheet().dismissible).toBe(false);
    expect(body().querySelector('[aria-label="Đóng"]')).toBeNull();
    tryClose();
    escape();
    click(body().querySelector('[data-sheet-backdrop]'));
    await flush(2);
    expect(onClose).not.toHaveBeenCalled();

    created.resolve({ ...SUB, firstOrder: null });
    await flush(4);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(lastSheet().dismissible).toBe(true);
    for (const w of group('Chu kỳ giao')) expect(w.disabled).toBe(false);
    expect(dateInput().disabled).toBe(false);
  });

  it('tạo lỗi: báo lỗi trong sheet, mở khoá lại form, đóng sheet được', async () => {
    const created = await startPending();
    created.reject(new Error('Số dư Ví Tubu không đủ'));
    await flush(4);
    expect(alertEl()!.textContent).toContain('Số dư Ví Tubu không đủ');
    expect(lastSheet().dismissible).toBe(true);
    const cta = byText(body(), 'button', 'Bắt đầu đặt định kỳ') as HTMLButtonElement;
    expect(cta.hasAttribute('aria-busy')).toBe(false);
    expect(cta.hasAttribute('aria-disabled')).toBe(false);
    for (const w of group('Chu kỳ giao')) expect(w.disabled).toBe(false);
    for (const r of radiosOf('Giao tới')) expect(r.disabled).toBe(false);
    tryClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('request lỗi lúc sheet đang đóng: mở lại không còn lỗi cũ (lỗi chỉ xoá khi đóng, không xoá lúc đang mở)', async () => {
    const created = deferred<Record<string, unknown>>();
    mocks.http.post.mockReturnValue(created.promise);
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)}>đổi</button>
          <SubscribeSheet visible={open} onClose={() => setOpen(false)} onNotice={onNotice} variationId="v1" quantity={2} />
        </>
      );
    }
    mounted.push(render(<Harness />));
    await flush();
    click(byText(body(), 'button', 'Bắt đầu đặt định kỳ'));
    await flush(3);
    click(byText(body(), 'button', 'đổi')!);
    await flush();
    created.reject(new Error('Số dư Ví Tubu không đủ'));
    await flush(4);
    click(byText(body(), 'button', 'đổi')!);
    await flush();
    expect(alertEl()).toBeNull();
    expect((byText(body(), 'button', 'Bắt đầu đặt định kỳ') as HTMLButtonElement).hasAttribute('aria-busy')).toBe(false);
  });

  it('ngày bắt đầu sai: nút tạo vẫn `disabled` DOM thật (không chỉ aria khi đang gửi) và bấm không gửi gì', async () => {
    mount();
    await flush();
    click(byText(body(), 'button', 'Chọn ngày'));
    typeInto(dateInput(), '2026-10-10');
    expect((byText(body(), 'button', 'Bắt đầu đặt định kỳ') as HTMLButtonElement).disabled).toBe(true);
    click(byText(body(), 'button', 'Bắt đầu đặt định kỳ'));
    await flush();
    expect(mocks.http.post).not.toHaveBeenCalled();
  });
});

describe('SubscribeSheet: khoá đồng bộ chạm đúp (W78B)', () => {
  it('chạm đúp "Bắt đầu đặt định kỳ" trong một khung hình: một POST, một lần báo, đóng một lần', async () => {
    const created = deferred<Record<string, unknown>>();
    mocks.http.post.mockReturnValue(created.promise);
    mount();
    await flush();
    const cta = create();
    act(() => {
      cta.click();
      cta.click();
    });
    await flush(3);
    expect(mocks.http.post).toHaveBeenCalledTimes(1);
    await act(async () => created.resolve({ ...SUB, firstOrder: null }));
    await flush(4);
    expect(mocks.http.post).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tạo lỗi nhả khoá: bấm lại gửi POST lần hai', async () => {
    mocks.http.post.mockRejectedValueOnce(new Error('mạng')).mockResolvedValue({ ...SUB, firstOrder: null });
    mount();
    await flush();
    click(create());
    await flush(4);
    expect(body().querySelector('[role="alert"]')).not.toBeNull();
    click(create());
    await flush(4);
    expect(mocks.http.post).toHaveBeenCalledTimes(2);
  });
});

describe('SubscribeSheet: số đều (tabular-nums)', () => {
  it('tiêu đề có % tiết kiệm, số tuần, gợi ý số ngày tối đa, số dư Ví Tubu đều có tabular-nums', async () => {
    mount();
    await flush();
    click(byText(body(), 'button', 'Chọn ngày'));
    const hint = byText(body(), 'p', /Chọn một ngày trong vòng \d+ ngày tới/)!;
    const wallet = radio(/Ví Tubu \(300\.000đ\)/);
    const spots: HTMLElement[] = [
      byText(body(), 'h2', 'tiết kiệm 12%')!,
      ...group('Chu kỳ giao'),
      hint,
      wallet.querySelector('span.flex-1') as HTMLElement,
    ];
    expect(spots).toHaveLength(7);
    for (const el of spots) {
      expect(el, 'phần tử').toBeTruthy();
      expect(el.classList.contains('tabular-nums'), el.textContent ?? '').toBe(true);
    }
  });
});

describe('SubscribeSheet: bị từ chối thì tải lại rồi mới nhả khoá (như apps/miniapp/src/components/subscribe-sheet.tsx:102-110)', () => {
  const REJECTIONS = [400, 404, 409, 422] as const;
  let client: QueryClient;
  const mountWith = () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } } });
    client.setQueryData(['subscriptions'], []);
    const r = render(<SubscribeSheet visible onClose={onClose} onNotice={onNotice} variationId="v1" quantity={2} />, client);
    mounted.push(r);
    return r;
  };
  const submit = () => byText(body(), 'button', /^(Bắt đầu đặt định kỳ|Đang tạo…)$/) as HTMLButtonElement;
  const busy = () => submit().getAttribute('aria-busy') === 'true';
  /** Mọi lần tải địa chỉ/Ví kể từ lúc gọi bị giữ tới khi `release()`. */
  const holdReload = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.getAddresses.mockImplementation(async () => {
      await gate;
      return [ADDR('a2', true, '9 Hai Bà Trưng')];
    });
    mocks.getWallet.mockImplementation(async () => {
      await gate;
      return { walletBalance: 300000 };
    });
    return { release: () => release() };
  };
  const alertText = () => body().querySelector('[role="alert"]')?.textContent ?? '';

  it.each(REJECTIONS)('%i: lời lỗi hiện ngay, tải lại gói, địa chỉ và Ví; nút giữ bận tới khi về; chạm lần hai không gửi', async (status) => {
    mocks.http.post.mockRejectedValue(new ApiError('Địa chỉ không hợp lệ.', status));
    mountWith();
    await flush();
    const addrs = mocks.getAddresses.mock.calls.length;
    const wallets = mocks.getWallet.mock.calls.length;
    const gate = holdReload();
    click(submit());
    await flush();
    expect(alertText()).toBe('Địa chỉ không hợp lệ.');
    expect(mocks.getAddresses.mock.calls.length).toBe(addrs + 1);
    expect(mocks.getWallet.mock.calls.length).toBe(wallets + 1);
    expect(client.getQueryState(['subscriptions'])?.isInvalidated).toBe(true);
    expect(busy()).toBe(true);
    expect(submit().disabled).toBe(false);
    await act(async () => {
      click(submit());
      click(submit());
    });
    expect(mocks.http.post).toHaveBeenCalledTimes(1);
    gate.release();
    await flush();
    expect(busy()).toBe(false);
    expect(alertText()).toBe('Địa chỉ không hợp lệ.');
    click(submit());
    await flush();
    expect(mocks.http.post).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 500, 503])('%i: không tải lại, nhả nút ngay', async (status) => {
    mocks.http.post.mockRejectedValue(new ApiError('Máy chủ bận.', status));
    mountWith();
    await flush();
    const addrs = mocks.getAddresses.mock.calls.length;
    const wallets = mocks.getWallet.mock.calls.length;
    click(submit());
    await flush();
    expect(mocks.getAddresses.mock.calls.length).toBe(addrs);
    expect(mocks.getWallet.mock.calls.length).toBe(wallets);
    expect(client.getQueryState(['subscriptions'])?.isInvalidated).toBe(false);
    expect(busy()).toBe(false);
    expect(alertText()).not.toBe('');
  });

  it('mất mạng: không tải lại, nhả ngay', async () => {
    mocks.http.post.mockRejectedValue(new NetworkError(false));
    mountWith();
    await flush();
    const addrs = mocks.getAddresses.mock.calls.length;
    click(submit());
    await flush();
    expect(mocks.getAddresses.mock.calls.length).toBe(addrs);
    expect(busy()).toBe(false);
  });

  it('tải lại treo quá 4 giây thì nhả nút', async () => {
    mocks.http.post.mockRejectedValue(new ApiError('Gói đã có.', 409));
    mountWith();
    await flush();
    holdReload();
    // beforeEach đã giả Date: gọi useFakeTimers lần nữa khi đang giả thì không đổi gì, phải trả đồng hồ thật trước.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(submit());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(busy()).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(busy()).toBe(false);
  });

  it('lỗi cũ biến mất ngay khi bấm lại (lúc lệnh mới còn bay)', async () => {
    let second!: (v: unknown) => void;
    mocks.http.post
      .mockRejectedValueOnce(new ApiError('Máy chủ bận.', 503))
      .mockImplementationOnce(() => new Promise((resolve) => { second = resolve; }));
    mountWith();
    await flush();
    click(submit());
    await flush();
    expect(alertText()).toContain('Máy chủ đang bận');
    click(submit());
    await flush();
    expect(mocks.http.post).toHaveBeenCalledTimes(2);
    expect(body().querySelector('[role="alert"]')).toBeNull();
    second({ ...SUB, firstOrder: null });
    await flush();
  });
});

describe('SubscribeSheet: địa chỉ đang chọn không còn sau khi tải lại (như apps/miniapp/src/components/subscribe-sheet.tsx:66-70)', () => {
  const submit = () => byText(body(), 'button', /^(Bắt đầu đặt định kỳ|Đang tạo…)$/) as HTMLButtonElement | undefined;
  const mountClient = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } } });
    const r = render(<SubscribeSheet visible onClose={onClose} onNotice={onNotice} variationId="v1" quantity={2} />, client);
    mounted.push(r);
    return client;
  };

  it('địa chỉ mặc định bị xoá ở tab khác rồi bị từ chối: danh sách tải lại, địa chỉ mặc định mới được chọn và lần bấm sau gửi id mới', async () => {
    mocks.http.post.mockRejectedValueOnce(new ApiError('Địa chỉ không hợp lệ.', 400)).mockResolvedValue({ ...SUB, firstOrder: null });
    mountClient();
    await flush();
    expect(radio(/9 Hai Bà Trưng/).getAttribute('aria-checked')).toBe('true');
    mocks.getAddresses.mockResolvedValue([ADDR('a1', true, '1 Lê Lợi')]);
    click(submit()!);
    await flush(8);
    expect(mocks.http.post.mock.calls[0]![1]).toMatchObject({ addressId: 'a2' });
    expect(radio(/1 Lê Lợi/).getAttribute('aria-checked')).toBe('true');
    expect(document.body.textContent).not.toContain('9 Hai Bà Trưng');
    click(submit()!);
    await flush(8);
    expect(mocks.http.post).toHaveBeenCalledTimes(2);
    expect(mocks.http.post.mock.calls[1]![1]).toMatchObject({ addressId: 'a1' });
  });

  it('tải lại mà không còn địa chỉ nào: không còn nút tạo nên không gửi lại id cũ', async () => {
    mocks.http.post.mockRejectedValueOnce(new ApiError('Địa chỉ không hợp lệ.', 404));
    mountClient();
    await flush();
    mocks.getAddresses.mockResolvedValue([]);
    click(submit()!);
    await flush(8);
    expect(mocks.http.post).toHaveBeenCalledTimes(1);
    expect(submit()).toBeNull();
    expect(byText(body(), 'button', /Thêm địa chỉ/)).toBeTruthy();
  });

  it('không còn địa chỉ nào rồi khách thêm địa chỉ mới: lần tải lại sau chọn địa chỉ mới, không quay về id đã xoá', async () => {
    mocks.http.post.mockRejectedValueOnce(new ApiError('Địa chỉ không hợp lệ.', 404)).mockResolvedValue({ ...SUB, firstOrder: null });
    const client = mountClient();
    await flush();
    mocks.getAddresses.mockResolvedValue([]);
    click(submit()!);
    await flush(8);
    mocks.getAddresses.mockResolvedValue([ADDR('a3', true, '5 Nguyễn Huệ')]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['addresses'] });
    });
    await flush(6);
    expect(radio(/5 Nguyễn Huệ/).getAttribute('aria-checked')).toBe('true');
    click(submit()!);
    await flush(8);
    expect(mocks.http.post.mock.calls[1]![1]).toMatchObject({ addressId: 'a3' });
  });

  it('khách chọn tay địa chỉ không mặc định rồi nó bị xoá ở tab khác: lần tải lại chuyển về địa chỉ mặc định còn lại (địa chỉ mặc định không đổi tham chiếu)', async () => {
    mocks.getAddresses.mockResolvedValue([ADDR('a2', true, '9 Hai Bà Trưng'), ADDR('a1', false, '1 Lê Lợi')]);
    mocks.http.post.mockRejectedValueOnce(new ApiError('Địa chỉ không hợp lệ.', 404));
    mountClient();
    await flush();
    click(radio(/1 Lê Lợi/));
    await flush();
    mocks.getAddresses.mockResolvedValue([ADDR('a2', true, '9 Hai Bà Trưng')]);
    click(submit()!);
    await flush(8);
    expect(mocks.http.post.mock.calls[0]![1]).toMatchObject({ addressId: 'a1' });
    expect(radio(/9 Hai Bà Trưng/).getAttribute('aria-checked')).toBe('true');
  });

  it('danh sách địa chỉ được nạp lại từ đầu (chưa có dữ liệu): lựa chọn của khách không bị đặt lại trong lúc chờ', async () => {
    const client = mountClient();
    await flush();
    click(radio(/1 Lê Lợi/));
    await flush();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    mocks.getAddresses.mockImplementation(async () => {
      await gate;
      return [ADDR('a1', false, '1 Lê Lợi'), ADDR('a2', true, '9 Hai Bà Trưng')];
    });
    act(() => {
      void client.resetQueries({ queryKey: ['addresses'] });
    });
    await flush(6);
    open();
    await flush(8);
    expect(radio(/1 Lê Lợi/).getAttribute('aria-checked')).toBe('true');
  });

  it('địa chỉ đang chọn vẫn còn trong danh sách tải lại: giữ nguyên lựa chọn của khách (không nhảy về mặc định)', async () => {
    mocks.http.post.mockRejectedValueOnce(new ApiError('Gói đã có.', 409));
    mountClient();
    await flush();
    click(radio(/1 Lê Lợi/));
    await flush();
    expect(radio(/1 Lê Lợi/).getAttribute('aria-checked')).toBe('true');
    click(submit()!);
    await flush(8);
    expect(radio(/1 Lê Lợi/).getAttribute('aria-checked')).toBe('true');
  });
});


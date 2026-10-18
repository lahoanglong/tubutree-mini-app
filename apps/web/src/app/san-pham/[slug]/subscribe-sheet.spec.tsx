// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';

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

  it('chuyển khoản mà đơn đầu chờ thanh toán thì mở trang chi tiết đơn đó để lấy mã chuyển khoản', async () => {
    mocks.http.post.mockResolvedValue({ ...SUB, firstOrder: { id: 'o2', code: 'TB-2', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', total: 160000 } });
    mount();
    await flush();
    click(radio(/Chuyển khoản ngân hàng/));
    click(create());
    await flush();
    expect(mocks.push).toHaveBeenCalledWith('/tai-khoan/don-hang/TB-2');
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
    expect(pending.disabled).toBe(true);
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

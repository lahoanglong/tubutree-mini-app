// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosScreen } from './pos-screen';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

// W96B: nút "Tích điểm" (cộng Điểm Xanh theo hoá đơn) khi đang gửi báo bận bằng aria-busy/aria-disabled thay disabled (Enter ở ô nhập đang giữ focus),
// các ô nhập chỉ đọc chứ không disabled trong lúc gửi và sau khi tích xong; số điểm dùng tabular-nums.

const MEMBER = { id: 'm1', memberCode: 'TUBUABCD1234', name: 'Trần B', phone: '090****567', tier: 'Mầm Xanh', pointsBalance: 120 };
const RESULT = {
  replayed: false,
  member: { ...MEMBER, pointsBalance: 145 },
  posTransaction: { receiptId: 'HD-001', orderTotal: 250_000, pointsEarned: 25, creditedAt: '2026-10-01T03:00:00.000Z' },
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let creditGate: Promise<void> | undefined;
let creditStatus = 200;
const calls: { method: string; url: string }[] = [];
const credits = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/pos-credit')).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  creditGate = undefined;
  creditStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url });
      if (url.includes('/me/loyalty/member-card')) return json(200, { posCreditEnabled: true });
      if (url.includes('/scan-member')) return json(200, { member: MEMBER });
      if (url.includes('/pos-credit')) {
        await creditGate;
        return creditStatus === 200 ? json(200, RESULT) : json(creditStatus, { statusCode: creditStatus, message: 'Không tích được điểm.' });
      }
      return json(200, {});
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const scanned = async () => {
  mounted = render(<PosScreen />);
  const c = mounted.container;
  await flush();
  typeInto(c.querySelector('input[aria-label="Mã thành viên"]'), 'TUBUABCD1234');
  click(byText(c, 'button', 'Tra cứu'));
  await flush();
  typeInto(c.querySelector('input[aria-label="Tổng tiền hoá đơn"]'), '250000');
  typeInto(c.querySelector('input[aria-label="Mã hoá đơn POS"]'), 'HD-001');
  return c;
};
const creditBtn = (c: HTMLElement) => byText(c, 'button', /^Tích điểm$|^Đang tích điểm…$/) as HTMLButtonElement;
const inputs = (c: HTMLElement) =>
  ['Tổng tiền hoá đơn', 'Mã hoá đơn POS', 'Ghi chú'].map((l) => c.querySelector<HTMLInputElement>(`input[aria-label="${l}"]`)!);

describe('PosScreen: Tích điểm khi đang gửi', () => {
  it('nút báo bận bằng aria-busy/aria-disabled (không disabled), chạm đúp cùng khung hình và chạm lại trong lúc gửi chỉ một POST', async () => {
    const c = await scanned();
    let release!: () => void;
    creditGate = new Promise<void>((r) => (release = r));
    await act(async () => {
      const b = creditBtn(c);
      b.click();
      b.click();
    });
    await flush(3);
    expect(credits()).toBe(1);
    const b = creditBtn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await act(async () => {
      b.click();
    });
    await flush(2);
    expect(credits()).toBe(1);
    release();
    await flush();
  });

  it('trong lúc gửi các ô nhập chỉ đọc chứ không disabled (Enter ở ô đang giữ focus không làm rơi focus); tích xong thì khoá hẳn', async () => {
    const c = await scanned();
    let release!: () => void;
    creditGate = new Promise<void>((r) => (release = r));
    click(creditBtn(c));
    await flush(3);
    for (const el of inputs(c)) {
      expect(el.readOnly).toBe(true);
      expect(el.disabled).toBe(false);
    }
    release();
    await flush();
    expect(c.textContent).toContain('Đã cộng');
    for (const el of inputs(c)) expect(el.disabled).toBe(true);
  });

  it('gửi lỗi: nút và các ô nhập mở lại, gửi lại được', async () => {
    const c = await scanned();
    creditStatus = 400;
    click(creditBtn(c));
    await flush(3);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không tích được điểm.');
    expect(creditBtn(c).getAttribute('aria-disabled')).toBeNull();
    for (const el of inputs(c)) expect(el.readOnly).toBe(false);
    creditStatus = 200;
    click(creditBtn(c));
    await flush(3);
    expect(credits()).toBe(2);
  });
});

describe('số dùng tabular-nums', () => {
  it('số điểm trên thẻ thành viên và số dư mới sau khi tích', async () => {
    const c = await scanned();
    const points = () => Array.from(c.querySelectorAll<HTMLElement>('.text-lg')).find((e) => e.textContent === '120')!;
    expect(points().className).toContain('tabular-nums');
    click(creditBtn(c));
    await flush(3);
    const done = Array.from(c.querySelectorAll<HTMLElement>('[role="status"]')).find((e) => e.textContent?.includes('Đã cộng'))!;
    expect(done.className).toContain('tabular-nums');
  });
});

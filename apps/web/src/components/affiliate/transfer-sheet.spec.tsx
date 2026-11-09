// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets } from '@/test-utils/a11y';

type Call = { path: string; body?: unknown; headers?: Record<string, string> };

const state = vi.hoisted(() => ({
  calls: [] as { path: string; body?: unknown; headers?: Record<string, string> }[],
  config: {} as Record<string, unknown>,
  configGate: null as null | Promise<unknown>,
  configFail: false,
  configGets: 0,
  payout: (() => ({ ok: true })) as () => unknown,
}));

vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path === '/config/public') {
        state.configGets += 1;
        await state.configGate;
        if (state.configFail) throw new Error('config lỗi');
        return state.config;
      }
      throw new Error(`GET lạ ${path}`);
    },
    post: async (path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
      state.calls.push({ path, body, headers: opts?.headers });
      return state.payout();
    },
  },
}));

import { TransferSheet } from './transfer-sheet';

let mounted: Rendered[] = [];
const done = vi.fn();
const mount = (props: Partial<Parameters<typeof TransferSheet>[0]> = {}) => {
  const r = render(<TransferSheet open onClose={() => {}} max={80_000} knownMax taxIdOnFile={null} onDone={done} {...props} />);
  mounted.push(r);
  return r;
};
const dialog = () => document.querySelector('[role="dialog"]')!;
const submitBtn = () => Array.from(dialog().querySelectorAll('button')).find((b) => /^Nhận /.test(b.textContent ?? '')) as HTMLButtonElement;
const posts = (): Call[] => state.calls;

beforeEach(() => {
  state.calls = [];
  state.config = {};
  state.configGate = null;
  state.configFail = false;
  state.configGets = 0;
  state.payout = () => ({ ok: true });
  done.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('TransferSheet — chuyển hoa hồng vào Ví', () => {
  it('chỉ có đường vào Ví Tubu: số tiền cố định bằng toàn bộ phần chuyển được, không có ô nhập, không có lựa chọn ngân hàng', async () => {
    mount();
    await flush();
    expect(dialog().textContent).toContain('80.000đ');
    expect(dialog().textContent).toContain('Mỗi lần chuyển là toàn bộ hoa hồng có thể chuyển.');
    expect(dialog().textContent).not.toMatch(/Ngân hàng|ZaloPay|tài khoản/);
    expect(dialog().querySelector('input')).toBeNull();
    expect(submitBtn().textContent).toBe('Nhận 80.000đ vào Ví');
  });

  it('gửi POST /affiliate/payouts đúng body Mini App kèm Idempotency-Key; không gửi bankInfo/taxId', async () => {
    mount();
    await flush();
    click(submitBtn());
    await flush();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.path).toBe('/affiliate/payouts');
    expect(posts()[0]!.body).toEqual({ amount: 80_000, method: 'WALLET_BALANCE' });
    expect(posts()[0]!.headers?.['Idempotency-Key']).toMatch(/\S{8,}/);
    expect(done).toHaveBeenCalledWith('Đã chuyển hoa hồng vào Ví Tubu.');
  });

  it('dùng lại đúng Idempotency-Key khi gửi lại sau lỗi', async () => {
    let n = 0;
    state.payout = () => {
      if (n++ === 0) throw new Error('mất mạng');
      return { ok: true };
    };
    mount();
    await flush();
    click(submitBtn());
    await flush();
    expect(dialog().textContent).toContain('mất mạng');
    click(submitBtn());
    await flush();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]!.headers?.['Idempotency-Key']).toBe(posts()[0]!.headers?.['Idempotency-Key']);
  });

  it('có khấu trừ thuế TNCN và chưa khai MST: hỏi MST, chặn tới khi đúng mẫu, gửi kèm taxId', async () => {
    state.config = { affiliatePitWithhold: { pct: 0.1, threshold: 50_000 } };
    mount();
    await flush();
    expect(dialog().textContent).toContain('Khấu trừ thuế TNCN 8.000đ · thực nhận 72.000đ');
    expect(submitBtn().textContent).toBe('Nhận 72.000đ vào Ví');
    expect(submitBtn().disabled).toBe(true);
    const tax = dialog().querySelector('input')!;
    typeInto(tax, '123');
    expect(dialog().textContent).toContain('Mã số thuế cá nhân gồm 10 chữ số, hoặc số CCCD 12 chữ số.');
    expect(submitBtn().disabled).toBe(true);
    typeInto(tax, ' 0123456789 ');
    click(submitBtn());
    await flush();
    expect(posts()[0]!.body).toEqual({ amount: 80_000, method: 'WALLET_BALANCE', taxId: '0123456789' });
  });

  it('thuế cộng dồn tháng: số thực nhận theo taxPreview của máy chủ, không tính riêng lần chuyển này', async () => {
    // Lần này 1.000.000đ dưới ngưỡng 2.000.000đ nếu tính riêng, nhưng tháng đã chuyển 1.500.000đ nên máy chủ báo thuế 250.000đ.
    state.config = { affiliatePitWithhold: { pct: 0.1, threshold: 2_000_000 } };
    mount({ max: 1_000_000, taxPreview: 250_000, taxIdOnFile: '0123456789' });
    await flush();
    expect(dialog().textContent).toContain('Khấu trừ thuế TNCN 250.000đ · thực nhận 750.000đ');
    expect(submitBtn().textContent).toBe('Nhận 750.000đ vào Ví');
  });

  it('taxPreview 0 (tháng chưa tới ngưỡng cộng dồn): không hiện khấu trừ dù tính riêng lần này sẽ bị trừ', async () => {
    state.config = { affiliatePitWithhold: { pct: 0.1, threshold: 50_000 } };
    mount({ taxPreview: 0 });
    await flush();
    expect(dialog().textContent).not.toContain('Khấu trừ thuế TNCN');
    expect(submitBtn().textContent).toBe('Nhận 80.000đ vào Ví');
  });

  it('đã khai MST: không hỏi lại, nói đang kê khai theo MST đó, không gửi taxId', async () => {
    state.config = { affiliatePitWithhold: { pct: 0.1, threshold: 50_000 } };
    mount({ taxIdOnFile: '0123456789' });
    await flush();
    expect(dialog().querySelector('input')).toBeNull();
    expect(dialog().textContent).toContain('Kê khai khấu trừ theo MST/CCCD 0123456789');
    click(submitBtn());
    await flush();
    expect(posts()[0]!.body).not.toHaveProperty('taxId');
  });

  it('config chưa về thì nút khoá và ghi Đang tải…', async () => {
    let release!: (v?: unknown) => void;
    state.configGate = new Promise((r) => (release = r));
    mount();
    await flush();
    const btn = Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent === 'Đang tải…') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    click(btn);
    await flush();
    expect(posts()).toHaveLength(0);
    release();
    await flush();
    expect(submitBtn().disabled).toBe(false);
  });

  it('config lỗi: báo lỗi và nút Thử lại, không gửi lệnh tới khi config về', async () => {
    state.configFail = true;
    mount();
    await flush();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('Chưa tải được cấu hình thuế.');
    expect(dialog().textContent).not.toContain('Đang tải…');
    const gate = Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent === 'Thử lại sau') as HTMLButtonElement;
    expect(gate.disabled).toBe(true);
    state.configFail = false;
    click(Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent === 'Thử lại') ?? null);
    await flush();
    expect(posts()).toHaveLength(0);
    click(submitBtn());
    await flush();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.path).toBe('/affiliate/payouts');
  });

  it('dashboard lỗi (knownMax=false): báo chưa tải được số chuyển và khoá nút gửi', async () => {
    mount({ max: 0, knownMax: false });
    await flush();
    expect(dialog().textContent).toContain('Chưa tải được số hoa hồng có thể chuyển.');
    expect(submitBtn().disabled).toBe(true);
  });

  it('chạm đúp trong cùng khung hình chỉ gửi một lệnh', async () => {
    mount();
    await flush();
    const b = submitBtn();
    click(b);
    click(b);
    await flush();
    expect(posts()).toHaveLength(1);
  });
});

// Khoá gửi lệnh rút hoa hồng: hai cú chạm trong CÙNG một act (không có lần vẽ lại xen giữa) phải chỉ ra một lệnh, nút đang gửi
// không `disabled` thật (Chromium thả focus về body) mà báo aria-busy/aria-disabled, sheet không đóng được khi lệnh còn bay.
const twice = (el: Element) =>
  act(() => {
    (el as HTMLElement).click();
    (el as HTMLElement).click();
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
const buttonByText = (text: string) => Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const pressEscape = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

describe('TransferSheet: khoá chống gửi hai lệnh rút', () => {
  it('chạm đúp trong cùng một act chỉ gửi một lệnh, onDone chỉ một lần', async () => {
    const gate = deferred<unknown>();
    state.payout = () => gate.promise;
    mount();
    await flush();
    await twice(submitBtn());
    await flush();
    expect(posts()).toHaveLength(1);
    gate.resolve({ ok: true });
    await flush();
    expect(posts()).toHaveLength(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('đang gửi: nút giữ nguyên, không disabled, aria-busy + aria-disabled, focus không rời nút; lỗi thì nhả khoá và gỡ aria-busy', async () => {
    const gate = deferred<unknown>();
    state.payout = () => gate.promise;
    mount();
    await flush();
    const b = submitBtn();
    b.focus();
    click(b);
    await flush();
    expect(buttonByText('Đang gửi…')).toBe(b);
    expect(b.disabled).toBe(false);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(b);
    click(b);
    await flush();
    expect(posts()).toHaveLength(1);
    gate.reject(new Error('mất mạng'));
    await flush();
    expect(b.hasAttribute('aria-busy')).toBe(false);
    expect(b.hasAttribute('aria-disabled')).toBe(false);
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('mất mạng');
    state.payout = () => ({ ok: true });
    click(b);
    await flush();
    expect(posts()).toHaveLength(2);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('lệnh còn bay thì sheet không đóng được (Esc, bấm nền, nút X); lỗi rồi thì đóng được', async () => {
    const gate = deferred<unknown>();
    state.payout = () => gate.promise;
    const onClose = vi.fn();
    mount({ onClose });
    await flush();
    expect(dialog().querySelector('button[aria-label]')).not.toBeNull();
    click(submitBtn());
    await flush();
    pressEscape();
    click(document.querySelector('[data-sheet-backdrop]'));
    expect(Array.from(dialog().querySelectorAll('button')).filter((b) => /Đóng/.test(b.getAttribute('aria-label') ?? ''))).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
    gate.reject(new Error('mất mạng'));
    await flush();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc ngay trong cùng khung với cú bấm Nhận (chưa kịp vẽ lại) cũng không đóng sheet', async () => {
    const gate = deferred<unknown>();
    state.payout = () => gate.promise;
    const onClose = vi.fn();
    mount({ onClose });
    await flush();
    act(() => {
      submitBtn().click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    gate.resolve({ ok: true });
    await flush();
  });

  it('Thử lại cấu hình thuế đủ 44px; bấm thì tải lại và nút nhường chỗ cho trạng thái Đang tải…', async () => {
    state.configFail = true;
    mount();
    await flush();
    const retry = buttonByText('Thử lại')!;
    expect(retry.className).toContain('min-h-11');
    expect(smallTouchTargets(dialog())).toEqual([]);
    let release!: () => void;
    state.configGate = new Promise<void>((r) => (release = r));
    state.configFail = false;
    click(retry);
    await flush();
    expect(buttonByText('Thử lại')).toBeUndefined();
    expect(buttonByText('Đang tải…')).toBeDefined();
    release();
    await flush();
    expect(submitBtn().disabled).toBe(false);
  });

  it('số tiền, thuế, thực nhận và nút Nhận dùng số đều', async () => {
    state.config = { affiliatePitWithhold: { pct: 0.1, threshold: 50_000 } };
    mount({ taxIdOnFile: '0123456789' });
    await flush();
    const taxLine = Array.from(dialog().querySelectorAll('div')).find((d) => d.textContent?.startsWith('Khấu trừ thuế TNCN'))!;
    expect(taxLine.closest('.tabular-nums')).not.toBeNull();
    expect(submitBtn().className).toContain('tabular-nums');
  });
});

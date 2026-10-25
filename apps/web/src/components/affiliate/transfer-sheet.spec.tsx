// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

type Call = { path: string; body?: unknown; headers?: Record<string, string> };

const state = vi.hoisted(() => ({
  calls: [] as { path: string; body?: unknown; headers?: Record<string, string> }[],
  config: {} as Record<string, unknown>,
  configGate: null as null | Promise<unknown>,
  configFail: false,
  payout: (() => ({ ok: true })) as () => unknown,
}));

vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      if (path === '/config/public') {
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

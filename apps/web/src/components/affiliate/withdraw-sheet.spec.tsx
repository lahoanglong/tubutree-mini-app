// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';

type Call = { path: string; body?: unknown; headers?: Record<string, string> };

const state = vi.hoisted(() => ({
  calls: [] as { path: string; body?: unknown; headers?: Record<string, string> }[],
  config: { affiliateMinWithdrawBank: 70_000 } as Record<string, unknown>,
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

import { WithdrawSheet } from './withdraw-sheet';

let mounted: Rendered[] = [];
const done = vi.fn();
const mount = (props: Partial<Parameters<typeof WithdrawSheet>[0]> = {}) => {
  const r = render(<WithdrawSheet open onClose={() => {}} max={80_000} knownMax taxIdOnFile={null} onDone={done} {...props} />);
  mounted.push(r);
  return r;
};
const dialog = () => document.querySelector('[role="dialog"]')!;
const submitBtn = () => Array.from(dialog().querySelectorAll('button')).find((b) => /^(Nhận|Rút) /.test(b.textContent ?? '')) as HTMLButtonElement;
const choose = (name: string) => click(Array.from(dialog().querySelectorAll('button')).find((b) => b.textContent?.startsWith(name)) ?? null);
const posts = (): Call[] => state.calls;

beforeEach(() => {
  state.calls = [];
  state.config = { affiliateMinWithdrawBank: 70_000 };
  state.configGate = null;
  state.configFail = false;
  state.payout = () => ({ ok: true });
  done.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('WithdrawSheet — rút hoa hồng', () => {
  it('mặc định rút về Ví Tubu: số tiền cố định bằng toàn bộ phần rút được, không có ô nhập số tiền', async () => {
    mount();
    await flush();
    expect(dialog().textContent).toContain('80.000đ');
    expect(dialog().textContent).toContain('Mỗi lần rút là toàn bộ hoa hồng có thể rút.');
    expect(dialog().querySelector('input')).toBeNull();
    expect(submitBtn().textContent).toBe('Nhận 80.000đ vào Ví');
  });

  it('gửi POST /affiliate/payouts đúng body Mini App kèm Idempotency-Key; ví không gửi bankInfo/taxId', async () => {
    mount();
    await flush();
    click(submitBtn());
    await flush();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.path).toBe('/affiliate/payouts');
    expect(posts()[0]!.body).toEqual({ amount: 80_000, method: 'WALLET_BALANCE', bankInfo: undefined });
    expect(posts()[0]!.headers?.['Idempotency-Key']).toMatch(/\S{8,}/);
    expect(done).toHaveBeenCalledWith('Đã gửi yêu cầu rút.');
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

  it('ngân hàng: chờ config rồi mới cho rút, mức tối thiểu lấy từ config, gửi bankInfo', async () => {
    let release!: (v?: unknown) => void;
    state.configGate = new Promise((r) => (release = r));
    mount();
    await flush();
    choose('Ngân hàng');
    expect(dialog().textContent).toContain('Đang tải mốc tối thiểu…');
    release();
    await flush();
    expect(dialog().textContent).toContain('Tối thiểu 70k');
    const inputs = Array.from(dialog().querySelectorAll('input'));
    expect(inputs).toHaveLength(3);
    expect(submitBtn().disabled).toBe(true);
    typeInto(inputs[0]!, 'VCB');
    typeInto(inputs[1]!, '0123456789');
    typeInto(inputs[2]!, 'NGUYEN VAN A');
    expect(submitBtn().disabled).toBe(false);
    click(submitBtn());
    await flush();
    expect(posts()[0]!.body).toEqual({
      amount: 80_000,
      method: 'BANK',
      bankInfo: { bankName: 'VCB', accountNumber: '0123456789', accountName: 'NGUYEN VAN A' },
    });
    expect(done).toHaveBeenCalledWith('Đã gửi lệnh rút. Theo dõi trạng thái ở mục Lệnh rút.');
  });

  it('ngân hàng dưới mức tối thiểu của config: nút khoá', async () => {
    mount({ max: 60_000 });
    await flush();
    choose('Ngân hàng');
    const inputs = Array.from(dialog().querySelectorAll('input'));
    typeInto(inputs[0]!, 'VCB');
    typeInto(inputs[1]!, '0123456789');
    typeInto(inputs[2]!, 'A');
    expect(submitBtn().disabled).toBe(true);
  });

  it('có khấu trừ thuế TNCN và chưa khai MST: hỏi MST, chặn tới khi đúng mẫu, gửi kèm taxId', async () => {
    state.config = { affiliateMinWithdrawBank: 50_000, affiliatePitWithhold: { pct: 0.1, threshold: 50_000 } };
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
    expect(posts()[0]!.body).toEqual({ amount: 80_000, method: 'WALLET_BALANCE', bankInfo: undefined, taxId: '0123456789' });
  });

  it('đã khai MST: không hỏi lại, nói đang kê khai theo MST đó, không gửi taxId', async () => {
    state.config = { affiliateMinWithdrawBank: 50_000, affiliatePitWithhold: { pct: 0.1, threshold: 50_000 } };
    mount({ taxIdOnFile: '0123456789' });
    await flush();
    expect(dialog().querySelector('input')).toBeNull();
    expect(dialog().textContent).toContain('Kê khai khấu trừ theo MST/CCCD 0123456789');
    click(submitBtn());
    await flush();
    expect(posts()[0]!.body).not.toHaveProperty('taxId');
  });

  it('ví: config chưa về thì nút khoá và ghi Đang tải…', async () => {
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

  it('config lỗi: báo lỗi và nút Thử lại, không gửi lệnh rút tới khi config về', async () => {
    state.configFail = true;
    mount();
    await flush();
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('Chưa tải được cấu hình rút tiền.');
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

  it('dashboard lỗi (knownMax=false): báo chưa tải được số rút và khoá nút gửi', async () => {
    mount({ max: 0, knownMax: false });
    await flush();
    expect(dialog().textContent).toContain('Chưa tải được số hoa hồng có thể rút.');
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

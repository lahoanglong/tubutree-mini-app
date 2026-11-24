// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Khối tải lười của Thanh toán: chưa tải thì giữ chỗ, đã tải sẵn thì dựng ngay, tải hỏng thì có Thử lại; màn đặt xong hỏng vẫn báo mã đơn.

const state = vi.hoisted(() => ({ failures: 0, imports: 0 }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
// Mỗi test nạp lại `checkout-panels-load` từ đầu (`resetModules`) và đăng ký lại module giả bằng `doMock` (vi.mock giữ kết quả qua resetModules).
async function fakePanels() {
  state.imports += 1;
  if (state.failures > 0) {
    state.failures -= 1;
    throw new Error('Loading chunk 1234 failed.');
  }
  const { createElement: h } = await import('react');
  return {
    InvoiceFields: ({ className }: { className?: string }) => h('div', { 'data-panel': 'vat', className }),
    TransferPreview: () => h('div', { 'data-panel': 'transfer' }),
    AddressForm: () => h('div', { 'data-panel': 'address' }),
    OrderSuccess: ({ order }: { order: { code: string } }) => h('div', { 'data-panel': 'success' }, order.code),
  };
}

type Lazy = typeof import('./checkout-panels-lazy');
type Order = ComponentProps<Lazy['OrderSuccessLazy']>['order'];
const order = (code: string, split: string[] = []) => ({ code, splitOrders: split.map((c) => ({ code: c })) }) as unknown as Order;

let lazy: Lazy;
let load: typeof import('./checkout-panels-load');
let mounted: Rendered[] = [];
const show = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r.container;
};
const panel = (c: HTMLElement) => c.querySelector('[data-panel]')?.getAttribute('data-panel') ?? null;
const retryButton = (c: HTMLElement) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Thử lại') ?? null;

beforeEach(async () => {
  state.failures = 0;
  state.imports = 0;
  vi.resetModules();
  vi.doMock('@/components/checkout/checkout-panels', fakePanels);
  load = await import('./checkout-panels-load');
  lazy = await import('./checkout-panels-lazy');
});
afterEach(() => {
  mounted.forEach((r) => r.unmount());
  mounted = [];
});

describe('checkout-panels-lazy', () => {
  it('chưa tải: form địa chỉ giữ chỗ có chữ cho trình đọc màn hình, tải xong thì dựng form', async () => {
    const c = show(<lazy.AddressFormLazy {...({} as ComponentProps<Lazy['AddressFormLazy']>)} />);
    expect(panel(c)).toBeNull();
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đang tải…');
    await flush(2);
    expect(panel(c)).toBe('address');
    expect(c.querySelector('[role="status"]')).toBeNull();
  });

  it('đã tải sẵn (lúc rảnh hoặc từ giỏ): ô VAT dựng ngay ở lần vẽ đầu, không qua chỗ chờ, chunk chỉ tải một lần', async () => {
    await Promise.all([load.loadCheckoutPanels(), load.loadCheckoutPanels()]);
    const c = show(<lazy.InvoiceFieldsLazy {...({ className: 'mt-2' } as ComponentProps<Lazy['InvoiceFieldsLazy']>)} />);
    expect(panel(c)).toBe('vat');
    expect(c.querySelector('[data-panel]')?.className).toBe('mt-2');
    expect(state.imports).toBe(1);
  });

  it('chunk hỏng một lần (vừa deploy, mạng chập): tự thử lại ngay, khách không thấy lỗi', async () => {
    state.failures = 1;
    const c = show(<lazy.TransferPreviewLazy {...({ total: 100_000, dim: false } as ComponentProps<Lazy['TransferPreviewLazy']>)} />);
    await flush(2);
    expect(panel(c)).toBe('transfer');
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('chunk hỏng cả hai lần: ô VAT báo chưa tải được kèm nút Thử lại, bấm thì tải lại và dựng', async () => {
    state.failures = 2;
    const c = show(<lazy.InvoiceFieldsLazy {...({} as ComponentProps<Lazy['InvoiceFieldsLazy']>)} />);
    await flush(2);
    expect(panel(c)).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Chưa tải được phần này');
    click(retryButton(c));
    await flush(2);
    expect(panel(c)).toBe('vat');
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('đơn đã tạo mà màn đặt xong tải hỏng: vẫn báo đã ghi nhận, đủ mã đơn tách và lối Theo dõi đơn; Thử lại dựng màn đầy đủ', async () => {
    state.failures = 2;
    const c = show(<lazy.OrderSuccessLazy order={order('TB-AB12', ['TB-AB12', 'TS-CD34'])} etaLabel={null} continueHref="/" />);
    await flush(2);
    const alert = c.querySelector('[role="alert"]');
    expect(alert?.querySelector('h1')?.textContent).toBe('Đơn hàng của bạn đã được ghi nhận');
    expect(alert?.textContent).toContain('TB-AB12, TS-CD34');
    expect(alert?.querySelector('a')?.getAttribute('href')).toBe('/tai-khoan/don-hang/TB-AB12');
    click(retryButton(c));
    await flush(2);
    expect(panel(c)).toBe('success');
  });

  it('loadCheckoutPanels không bao giờ ném lỗi (gọi trong lệnh Đặt hàng và lúc rảnh)', async () => {
    state.failures = 2;
    await expect(load.loadCheckoutPanels()).resolves.toBeUndefined();
    expect(load.loadedCheckoutPanels()).toBeUndefined();
    await load.loadCheckoutPanels();
    expect(load.loadedCheckoutPanels()?.InvoiceFields).toBeTypeOf('function');
  });
});

describe('checkout-panels chỉ nạp qua checkout-panels-load', () => {
  const SRC = resolve(process.cwd(), 'src');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.(spec|test)\.|\.d\.ts$/.test(name) ? [path] : [];
    });
  const IMPORT = /(?:from\s*|import\(\s*)['"][^'"]*\/checkout-panels['"]/;

  it('không tệp nào khác nhập `checkout-panels` (nhập tĩnh kéo cả bốn khối về JS tải lần đầu của /thanh-toan)', () => {
    const offenders = sources(SRC)
      .filter((path) => IMPORT.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path).split(sep).join('/'));
    expect(offenders).toEqual(['components/checkout/checkout-panels-load.ts']);
  });
});

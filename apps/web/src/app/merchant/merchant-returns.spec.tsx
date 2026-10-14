// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import type { MerchantReturn } from '@/lib/merchant-client';

const mocks = vi.hoisted(() => ({ list: vi.fn(), received: vi.fn() }));
vi.mock('@/lib/merchant-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/merchant-client')>()),
  listMerchantReturns: mocks.list,
  markMerchantReturnReceived: mocks.received,
}));

import { MerchantReturnsSection } from './merchant-returns';
import { isPartialReturnLine } from './settlement-tab';

const ret = (o: Partial<MerchantReturn> = {}): MerchantReturn => ({
  id: 'r1',
  status: 'APPROVED',
  createdAt: '2026-10-13T03:00:00Z',
  reviewedAt: '2026-10-13T05:00:00Z',
  receivedAt: null,
  reasonLabel: 'Sản phẩm lỗi, hỏng',
  reason: 'Hũ mật ong bị nứt',
  fullReturn: false,
  shopFault: true,
  orderCode: 'TB-9',
  lines: [{ productName: 'Mật ong rừng', variationName: 'Hũ 500ml', quantity: 1 }],
  ...o,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <MerchantReturnsSection />
    </QueryClientProvider>,
  );
  mounted.push(r);
  await flush();
  return r.container;
};

beforeEach(() => {
  mocks.list.mockReset();
  mocks.received.mockReset().mockResolvedValue({});
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('MerchantReturnsSection — gian hàng tự giao nhận hàng khách trả (D3 × D4)', () => {
  it('đã duyệt, chưa nhận: hiện dòng trả và nút "Đã nhận hàng trả" gọi API', async () => {
    mocks.list.mockResolvedValue([ret(), ret({ id: 'r2', status: 'REQUESTED', reviewedAt: null, orderCode: 'TB-10' })]);
    const c = await mount();
    expect(c.textContent).toContain('Hàng khách trả về (1 chờ nhận)');
    expect(c.textContent).toContain('Mật ong rừng · Hũ 500ml ×1');
    expect(c.textContent).toContain('Tubu đang xét');
    const buttons = Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === 'Đã nhận hàng trả');
    expect(buttons).toHaveLength(1);
    click(byText(c, 'button', 'Đã nhận hàng trả'));
    await flush();
    expect(mocks.received).toHaveBeenCalledWith('r1');
  });

  it('đã nhận rồi: không còn nút; không có yêu cầu nào thì ẩn cả mục', async () => {
    mocks.list.mockResolvedValue([ret({ receivedAt: '2026-10-14T01:00:00Z' })]);
    const c = await mount();
    expect(c.textContent).toContain('Đã nhận, đã cộng kho');
    expect(c.querySelector('button')).toBeNull();
    mocks.list.mockResolvedValue([]);
    const empty = await mount();
    expect(empty.textContent).toBe('');
  });
});

describe('isPartialReturnLine', () => {
  it('dòng đảo một lần trả một phần khác dòng đảo cả đơn', () => {
    expect(isPartialReturnLine({ kind: 'REVERSAL', refKey: 'RETURN:r1' })).toBe(true);
    expect(isPartialReturnLine({ kind: 'REVERSAL', refKey: '' })).toBe(false);
    expect(isPartialReturnLine({ kind: 'SALE', refKey: '' })).toBe(false);
  });
});

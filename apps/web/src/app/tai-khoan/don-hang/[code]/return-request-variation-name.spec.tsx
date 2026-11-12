// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import type { OrderDetailDTO } from '@/lib/shop-client';

// Phân loại không đặt tên (86/154 phân loại trên PROD): dòng chọn món để đổi/trả không mở đầu bằng " · ".

vi.mock('@/lib/core-http', () => ({ coreHttp: { post: vi.fn() } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null] }));
vi.mock('@/lib/balances', () => ({ invalidateBalances: vi.fn() }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  estimateReturn: async () => ({ refundAmount: 0, lines: [] }),
}));

import { ReturnRequestForm } from './return-request-form';

const orderWith = (names: (string | null)[]) =>
  ({
    id: 'o9', code: 'TB-9', status: 'DELIVERED', subtotal: 300000, discount: 0, shippingFee: 0, total: 300000, paymentMethod: 'COD', paymentStatus: 'PAID',
    createdAt: '2026-10-01T03:00:00Z', deliveredAt: new Date(Date.now() - 864e5).toISOString(),
    items: names.map((variationName, i) => ({ id: `i${i}`, productName: `Dầu gội ${i + 1}`, variationName, unitPrice: 150000, quantity: 3, total: 450000, thumbnail: null })),
    shippingAddress: null, shippingPartner: null, shippingCode: null, trackingLink: null, shippingHistory: null,
  }) as unknown as OrderDetailDTO;

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = async (names: (string | null)[]) => {
  const r = render(<ReturnRequestForm order={orderWith(names)} returns={[]} onDone={() => undefined} onClose={() => undefined} />);
  mounted.push(r);
  await flush(4);
  return r.container;
};
/** Dòng chữ phụ dưới tên của từng món: "phân loại · còn trả được n". */
const captions = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).map((box) => box.closest('label')!.querySelector<HTMLElement>('span.block.text-xs')!.textContent);

describe('form đổi/trả — phân loại không có tên', () => {
  it('có tên: "phân loại · còn trả được n" như trước', async () => {
    expect(captions(await mount(['500ml']))).toEqual(['500ml · còn trả được 3']);
  });

  it('tên trống, toàn khoảng trắng hay null: chỉ "còn trả được n", không " · " mở đầu', async () => {
    expect(captions(await mount(['', '   ', null, '500ml']))).toEqual(['còn trả được 3', 'còn trả được 3', 'còn trả được 3', '500ml · còn trả được 3']);
  });
});

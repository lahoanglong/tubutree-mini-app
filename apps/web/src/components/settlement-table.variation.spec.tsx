import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConsignmentExcluded, ConsignmentExcludedLine } from '@/lib/merchant-client';
import { ConsignmentExcludedList } from './settlement-table';

/** Danh sách hàng chưa vào đối soát: tên phân loại hỏng từ sàn không được hiện ra chữ rác hay cặp ngoặc rỗng. */
const line = (variationName: string | null): ConsignmentExcludedLine => ({
  orderId: 'o1',
  orderCode: 'TUBU-1',
  orderItemId: 'i1',
  productName: 'Trà Shan',
  variationName,
  quantity: 2,
  goodsAmount: 100_000,
  createdAt: '2026-11-01T00:00:00.000Z',
  deliveredAt: null,
  reason: 'BEFORE_SETTLE_FROM',
} as ConsignmentExcludedLine);

const html = (variationName: string | null): string => {
  const data = { total: 1, lines: [line(variationName)] } as unknown as ConsignmentExcluded;
  return renderToStaticMarkup(<ConsignmentExcludedList data={data} />);
};

describe('ConsignmentExcludedList: nhãn phân loại', () => {
  it('tên thật hiện trong ngoặc sau tên sản phẩm', () => {
    expect(html('500ml')).toContain('Trà Shan (500ml)');
  });

  it('"[object Object]" và tên trống không để lại chữ rác hay ngoặc rỗng', () => {
    for (const bad of ['[object Object]', '   ', null]) {
      const out = html(bad);
      expect(out, String(bad)).not.toContain('object Object');
      expect(out, String(bad)).not.toContain('()');
      expect(out, String(bad)).not.toMatch(/\(\s+\)/);
      expect(out, String(bad)).toContain('Trà Shan');
    }
  });
});

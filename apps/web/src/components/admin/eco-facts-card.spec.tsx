// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import { EcoFactsCard } from './eco-facts-card';
import type { AdminEcoFact } from './eco-facts-api';

const row = (over: Partial<AdminEcoFact> = {}): AdminEcoFact => ({
  id: 'f1',
  productId: 'p1',
  productName: 'Nước giặt Refill 10L',
  productSlug: 'nuoc-giat-refill',
  variationId: null,
  variationName: null,
  variationSku: null,
  kind: 'PLASTIC_AVOIDED',
  valueGrams: 1200,
  baselineText: 'so với 20 chai 500ml',
  label: null,
  co2Grams: null,
  sourceUrl: 'https://pannature.org/a',
  sourceNote: 'Bảng 2',
  status: 'DRAFT',
  approvedById: null,
  approvedAt: null,
  updatedAt: '2026-11-18T01:00:00.000Z',
  blockers: [],
  ...over,
});

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const mount = async (items: AdminEcoFact[]) => {
  const m = mockFetch({
    '/admin/eco-facts/f2/approve': { body: row({ id: 'f2', status: 'APPROVED' }) },
    '/admin/eco-facts/f2/retire': { body: row({ id: 'f2', status: 'RETIRED' }) },
    '/admin/eco-facts': { body: { items } },
  });
  vi.stubGlobal('fetch', m.fn);
  const r = render(<EcoFactsCard />);
  mounted.push(r);
  await flush(8);
  return { c: r.container, calls: m.calls };
};

describe('EcoFactsCard', () => {
  it('mở mặc định ở mục Nháp; dòng thiếu điều kiện có lý do và nút Duyệt khoá', async () => {
    const { c, calls } = await mount([
      row({ id: 'f1', valueGrams: null, blockers: [{ code: 'value_grams', message: 'Giảm nhựa cần số gam lớn hơn 0.' }] }),
      row({ id: 'f2', productName: 'Sữa tắm can 5L' }),
    ]);
    expect(calls[0]!.url).toContain('/admin/eco-facts?status=DRAFT');
    const rows = c.querySelectorAll('[data-testid="eco-fact-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Chưa duyệt được: Giảm nhựa cần số gam lớn hơn 0.');
    expect(byText(rows[0] as HTMLElement, 'button', 'Duyệt')?.hasAttribute('disabled')).toBe(true);
    expect(byText(rows[1] as HTMLElement, 'button', 'Duyệt')?.hasAttribute('disabled')).toBe(false);
    const a = rows[1]!.querySelector('a');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('Duyệt gửi đúng bản đang xem (expectedUpdatedAt) và báo thành công', async () => {
    const { c, calls } = await mount([row({ id: 'f2' })]);
    click(byText(c, 'button', 'Duyệt'));
    await flush(8);
    const call = calls.find((x) => x.url.includes('/f2/approve'));
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ expectedUpdatedAt: '2026-11-18T01:00:00.000Z' });
    expect(c.textContent).toContain('Đã duyệt.');
  });

  it('Ngừng dùng hỏi xác nhận; huỷ thì không gọi API', async () => {
    const { c, calls } = await mount([row({ id: 'f2', status: 'APPROVED' })]);
    expect(byText(c, 'button', 'Duyệt')).toBeNull();
    click(byText(c.querySelector('[data-testid="eco-fact-row"]')!, 'button', 'Ngừng dùng'));
    await flush(4);
    expect(confirmDialog()?.textContent).toContain('Ngừng dùng sự thật này?');
    answerConfirm(false);
    await flush(4);
    expect(calls.some((x) => x.url.includes('/retire'))).toBe(false);
    click(byText(c.querySelector('[data-testid="eco-fact-row"]')!, 'button', 'Ngừng dùng'));
    await flush(4);
    answerConfirm(true);
    await flush(8);
    expect(calls.some((x) => x.url.includes('/f2/retire'))).toBe(true);
  });

  it('Sửa: sản phẩm, phân loại và loại khoá (không đổi được)', async () => {
    const { c } = await mount([row({ id: 'f2' })]);
    click(byText(c, 'button', 'Sửa'));
    await flush(4);
    const form = c.querySelector('[data-testid="eco-fact-form"]')!;
    expect(form).not.toBeNull();
    const locked = [...form.querySelectorAll('input, select')].filter((el) => (el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly);
    expect(locked.length).toBeGreaterThanOrEqual(3);
  });

  it('mục trống: một câu báo', async () => {
    const { c } = await mount([]);
    expect(c.textContent).toContain('Chưa có dòng nào ở mục này.');
  });
});

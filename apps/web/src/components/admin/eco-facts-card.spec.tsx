// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
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
  sourceKind: 'external',
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

const PRODUCTS = [
  {
    id: 'p1',
    name: 'Refill nước giặt Fuwa3e 10L',
    slug: 'refill-nuoc-giat-fuwa3e-10l-aa',
    brand: 'Fuwa3e',
    thumbnail: null,
    isActive: true,
    variations: [
      { id: 'v5', name: 'Can 5L', sku: 'RF-5L', price: 500_000, stock: 3, isActive: true },
      { id: 'v10', name: 'Can 10L', sku: 'RF-10L', price: 900_000, stock: 0, isActive: false },
    ],
  },
];
const sleep = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const mount = async (items: AdminEcoFact[], extra: Parameters<typeof mockFetch>[0] = {}) => {
  const m = mockFetch({
    '/admin/products/search': { body: PRODUCTS },
    '/admin/eco-facts/approve-batch': { body: { approved: [], skipped: [] } },
    '/admin/eco-facts/refill-drafts': { body: { refillProducts: 0, created: 0, skippedExisting: 0 } },
    '/admin/eco-facts/f2/approve': { body: row({ id: 'f2', status: 'APPROVED' }) },
    '/admin/eco-facts/f2/retire': { body: row({ id: 'f2', status: 'RETIRED' }) },
    '/admin/eco-facts': { body: { items } },
    ...extra,
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
    click(byText(c.querySelector('[data-testid="eco-fact-row"]')!, 'button', 'Duyệt'));
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

describe('EcoFactsCard: form chọn sản phẩm và phân loại', () => {
  const openNew = async (extra: Parameters<typeof mockFetch>[0] = {}) => {
    const out = await mount([], extra);
    click(byText(out.c, 'button', 'Thêm sự thật'));
    await flush(4);
    const form = out.c.querySelector('[data-testid="eco-fact-form"]') as HTMLElement;
    return { ...out, form };
  };
  const find = async (form: HTMLElement, q: string) => {
    typeInto(form.querySelector('input[type="search"]'), q);
    await sleep(320);
    await flush(4);
  };

  it('không còn ô gõ slug/SKU: có ô tìm sản phẩm và ô chọn phân loại (khoá tới khi chọn sản phẩm)', async () => {
    const { form } = await openNew();
    expect(form.textContent).not.toContain('Slug sản phẩm');
    expect(form.textContent).not.toContain('SKU phân loại');
    expect(form.querySelector('input[type="search"]')).not.toBeNull();
    const variation = [...form.querySelectorAll('select')].find((el) => el.textContent?.includes('Cả sản phẩm')) as HTMLSelectElement;
    expect(variation.disabled).toBe(true);
  });

  it('chọn sản phẩm → liệt kê phân loại; lưu gửi đúng slug và SKU (ô nhập đổi sang chọn, API giữ nguyên)', async () => {
    const { c, form, calls } = await openNew();
    await find(form, 'refill');
    expect(calls.find((x) => x.url.includes('/admin/products/search?q=refill'))).toBeTruthy();
    click(form.querySelector('[role="option"]'));
    await flush(4);
    expect(form.textContent).toContain('Refill nước giặt Fuwa3e 10L');
    const variation = [...form.querySelectorAll('select')].find((el) => el.textContent?.includes('Cả sản phẩm')) as HTMLSelectElement;
    expect(variation.disabled).toBe(false);
    expect([...variation.options].map((o) => o.textContent)).toEqual(['Cả sản phẩm', 'Can 5L · RF-5L', 'Can 10L · RF-10L · đang ẩn']);
    typeInto(variation, 'RF-5L');
    typeInto(form.querySelector('input[type="url"]'), 'https://tubutree.com/phieu-can/refill-5l');
    const note = [...form.querySelectorAll('input')].find((el) => (el as HTMLInputElement).maxLength === 300)!;
    typeInto(note, 'Dòng 3');
    click(byText(form, 'button', 'Lưu nháp'));
    await flush(8);
    const post = calls.find((x) => x.init?.method === 'POST' && x.url.endsWith('/admin/eco-facts'));
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post!.init!.body))).toMatchObject({ productSlug: 'refill-nuoc-giat-fuwa3e-10l-aa', variationSku: 'RF-5L', kind: 'REFILL_PACK' });
    expect(c.textContent).toContain('Đã lưu bản nháp.');
  });

  it('lưu khi chưa chọn sản phẩm: báo "Chọn sản phẩm", không gọi API tạo', async () => {
    const { form, calls } = await openNew();
    typeInto(form.querySelector('input[type="url"]'), 'https://tubutree.com/phieu-can/a');
    const note = [...form.querySelectorAll('input')].find((el) => (el as HTMLInputElement).maxLength === 300)!;
    typeInto(note, 'x');
    click(byText(form, 'button', 'Lưu nháp'));
    await flush(4);
    expect(form.textContent).toContain('Chọn sản phẩm trước khi lưu.');
    expect(calls.some((x) => x.init?.method === 'POST')).toBe(false);
  });

  it('bấm Đổi rồi chọn lại: phân loại cũ bị xoá, không gửi SKU của sản phẩm trước', async () => {
    const { form } = await openNew();
    await find(form, 'refill');
    click(form.querySelector('[role="option"]'));
    await flush(4);
    const variation = () => [...form.querySelectorAll('select')].find((el) => el.textContent?.includes('Cả sản phẩm')) as HTMLSelectElement;
    typeInto(variation(), 'RF-10L');
    expect(variation().value).toBe('RF-10L');
    click(byText(form, 'button', 'Đổi'));
    await flush(4);
    expect(variation().value).toBe('');
    expect(variation().disabled).toBe(true);
  });

  it('Sửa: sản phẩm và phân loại hiện đúng tên nhưng khoá, không có ô tìm', async () => {
    const { c } = await mount([row({ id: 'f2', variationId: 'v5', variationName: 'Can 5L', variationSku: 'RF-5L' })]);
    click(byText(c, 'button', 'Sửa'));
    await flush(4);
    const form = c.querySelector('[data-testid="eco-fact-form"]') as HTMLElement;
    expect(form.querySelector('input[type="search"]')).toBeNull();
    const product = form.querySelector('input[aria-label="Sản phẩm"]') as HTMLInputElement;
    expect(product.value).toBe('Nước giặt Refill 10L');
    expect(product.disabled).toBe(true);
    const variation = [...form.querySelectorAll('select')].find((el) => el.textContent?.includes('Can 5L')) as HTMLSelectElement;
    expect(variation.disabled).toBe(true);
    expect(variation.options[0]!.textContent).toBe('Can 5L · RF-5L');
  });
});

describe('EcoFactsCard: duyệt hàng loạt', () => {
  const rows = () => [
    row({ id: 'a', productName: 'Gói A', updatedAt: '2026-11-18T01:00:00.000Z' }),
    row({ id: 'b', productName: 'Gói B', kind: 'REFILL_PACK', valueGrams: null, updatedAt: '2026-11-18T02:00:00.000Z' }),
    row({ id: 'c', productName: 'Gói C', valueGrams: null, sourceUrl: '', sourceKind: null, blockers: [{ code: 'value_grams', message: 'Giảm nhựa cần số gam lớn hơn 0.' }] }),
    row({ id: 'd', productName: 'Gói D', status: 'APPROVED' }),
  ];
  const checkbox = (c: HTMLElement, id: string) => c.querySelector<HTMLInputElement>(`[data-testid="eco-fact-row"]:nth-child(${'abcd'.indexOf(id) + 1}) input[type="checkbox"]`);

  it('chỉ dòng Nháp đủ điều kiện có ô chọn; dòng còn blocker hay đã duyệt thì không', async () => {
    const { c } = await mount(rows());
    expect(checkbox(c, 'a')).not.toBeNull();
    expect(checkbox(c, 'b')).not.toBeNull();
    expect(checkbox(c, 'c')).toBeNull();
    expect(checkbox(c, 'd')).toBeNull();
    expect(c.querySelector('[data-testid="eco-batch-bar"]')!.textContent).toContain('Chọn tất cả đủ điều kiện (2)');
  });

  it('chưa chọn dòng nào: nút khoá; Chọn tất cả → "Duyệt 2 dòng đã chọn" → hỏi xác nhận (nêu cờ) → gửi đúng id + updatedAt', async () => {
    const { c, calls } = await mount(rows(), { '/admin/eco-facts/approve-batch': { body: { approved: ['a', 'b'], skipped: [] } } });
    const bar = c.querySelector('[data-testid="eco-batch-bar"]') as HTMLElement;
    expect(byText(bar, 'button', 'Duyệt 0 dòng đã chọn')?.hasAttribute('disabled')).toBe(true);
    click(bar.querySelector('input[type="checkbox"]'));
    await flush(2);
    const go = byText(bar, 'button', 'Duyệt 2 dòng đã chọn')!;
    expect(go.hasAttribute('disabled')).toBe(false);
    click(go);
    await flush(4);
    expect(confirmDialog()?.textContent).toContain('Duyệt 2 sự thật?');
    expect(confirmDialog()?.textContent).toContain('eco.product_badges_enabled');
    expect(confirmDialog()?.textContent).toContain('eco.passport_enabled');
    answerConfirm(true);
    await flush(8);
    const call = calls.find((x) => x.url.includes('/approve-batch'));
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      items: [
        { id: 'a', expectedUpdatedAt: '2026-11-18T01:00:00.000Z' },
        { id: 'b', expectedUpdatedAt: '2026-11-18T02:00:00.000Z' },
      ],
    });
    expect(c.textContent).toContain('Đã duyệt 2 dòng.');
  });

  it('huỷ xác nhận thì không gọi API; chọn từng dòng chỉ gửi dòng đó', async () => {
    const { c, calls } = await mount(rows(), { '/admin/eco-facts/approve-batch': { body: { approved: ['b'], skipped: [] } } });
    click(checkbox(c, 'b'));
    await flush(2);
    click(byText(c, 'button', 'Duyệt 1 dòng đã chọn'));
    await flush(4);
    answerConfirm(false);
    await flush(4);
    expect(calls.some((x) => x.url.includes('/approve-batch'))).toBe(false);
    click(byText(c, 'button', 'Duyệt 1 dòng đã chọn'));
    await flush(4);
    answerConfirm(true);
    await flush(8);
    expect(JSON.parse(String(calls.find((x) => x.url.includes('/approve-batch'))?.init?.body)).items).toEqual([{ id: 'b', expectedUpdatedAt: '2026-11-18T02:00:00.000Z' }]);
  });

  it('máy chủ bỏ qua một dòng: báo số duyệt, số bỏ qua và lý do dòng đầu', async () => {
    const skipped = [{ id: 'b', reason: 'conflict', message: 'Dòng này vừa đổi. Tải lại, xem lại rồi duyệt.' }];
    const { c } = await mount(rows(), { '/admin/eco-facts/approve-batch': { body: { approved: ['a'], skipped } } });
    click(c.querySelector('[data-testid="eco-batch-bar"] input[type="checkbox"]'));
    await flush(2);
    click(byText(c, 'button', 'Duyệt 2 dòng đã chọn'));
    await flush(4);
    answerConfirm(true);
    await flush(8);
    expect(c.textContent).toContain('Đã duyệt 1 dòng, bỏ qua 1 (vừa đổi hoặc chưa đủ điều kiện): Dòng này vừa đổi.');
  });

  it('dòng được chọn rồi bị người khác sửa (updatedAt đổi sau khi tải lại): tự rơi khỏi lô, không gửi bản admin chưa xem', async () => {
    let reads = 0;
    const first = [row({ id: 'a', productName: 'Gói A' }), row({ id: 'f2', productName: 'Gói B', updatedAt: '2026-11-18T02:00:00.000Z' })];
    const second = [row({ id: 'a', productName: 'Gói A', updatedAt: '2026-11-18T03:00:00.000Z' })];
    const { c } = await mount([], { '/admin/eco-facts': () => ({ body: { items: reads++ === 0 ? first : second } }) });
    const rowsEl = () => [...c.querySelectorAll<HTMLElement>('[data-testid="eco-fact-row"]')];
    click(rowsEl()[0]!.querySelector('input[type="checkbox"]'));
    await flush(2);
    expect(byText(c, 'button', 'Duyệt 1 dòng đã chọn')).not.toBeNull();
    click(byText(rowsEl()[1]!, 'button', 'Duyệt'));
    await flush(8);
    expect(rowsEl()).toHaveLength(1);
    expect(byText(c, 'button', 'Duyệt 0 dòng đã chọn')?.hasAttribute('disabled')).toBe(true);
    expect(rowsEl()[0]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  });

  it('chọn đủ 50 rồi một dòng đã chọn biến mất khỏi danh sách: ô còn lại mở khoá, số đếm theo dòng thật', async () => {
    let reads = 0;
    const all = [row({ id: 'f2', productName: 'SP 0' }), ...Array.from({ length: 52 }, (_, i) => row({ id: `r${i + 1}`, productName: `SP ${i + 1}` }))];
    const { c } = await mount([], { '/admin/eco-facts': () => ({ body: { items: reads++ === 0 ? all : all.slice(1) } }) });
    click(c.querySelector('[data-testid="eco-batch-bar"] input[type="checkbox"]'));
    await flush(2);
    expect(c.querySelector('[data-testid="eco-batch-bar"]')!.textContent).toContain('Duyệt 50 dòng đã chọn');
    click(byText(c.querySelector('[data-testid="eco-fact-row"]') as HTMLElement, 'button', 'Duyệt'));
    await flush(8);
    const boxes = [...c.querySelectorAll<HTMLInputElement>('[data-testid="eco-fact-row"] input[type="checkbox"]')];
    expect(boxes).toHaveLength(52);
    expect(c.querySelector('[data-testid="eco-batch-bar"]')!.textContent).toContain('Duyệt 49 dòng đã chọn');
    expect(boxes.filter((b) => !b.checked)).toHaveLength(3);
    expect(boxes.filter((b) => !b.checked && b.disabled)).toHaveLength(0);
  });

  it('không dòng nào đủ điều kiện: không có thanh duyệt hàng loạt', async () => {
    const { c } = await mount([rows()[2]!, rows()[3]!]);
    expect(c.querySelector('[data-testid="eco-batch-bar"]')).toBeNull();
  });

  it('hơn 50 dòng đủ điều kiện: "Chọn 50 dòng đầu", chọn tối đa 50', async () => {
    const many = Array.from({ length: 53 }, (_, i) => row({ id: `r${i}`, productName: `SP ${i}` }));
    const { c } = await mount(many);
    const bar = c.querySelector('[data-testid="eco-batch-bar"]') as HTMLElement;
    expect(bar.textContent).toContain('Chọn 50 dòng đầu đủ điều kiện');
    click(bar.querySelector('input[type="checkbox"]'));
    await flush(2);
    expect(bar.textContent).toContain('Duyệt 50 dòng đã chọn');
    const boxes = [...c.querySelectorAll<HTMLInputElement>('[data-testid="eco-fact-row"] input[type="checkbox"]')];
    expect(boxes.filter((b) => b.checked)).toHaveLength(50);
    expect(boxes.filter((b) => !b.checked && b.disabled)).toHaveLength(3);
  });
});

describe('EcoFactsCard: nháp từ danh sách Refill và nguồn nội bộ', () => {
  it('hộp "Tạo nháp từ danh sách Refill" gập sẵn; gửi link phiếu cân + ghi chú rồi báo kết quả và về mục Nháp', async () => {
    const { c, calls } = await mount([], { '/admin/eco-facts/refill-drafts': { body: { refillProducts: 11, created: 22, skippedExisting: 0 } } });
    const panel = c.querySelector('[data-testid="eco-refill-drafts"]') as HTMLDetailsElement;
    expect(panel.open).toBe(false);
    expect(panel.querySelector('summary')!.textContent).toBe('Tạo nháp từ danh sách Refill');
    typeInto(panel.querySelector('input[type="url"]'), ' https://tubutree.com/phieu-can/refill-10l ');
    typeInto(panel.querySelector('input:not([type="url"])'), 'Dòng 3');
    click(byText(panel, 'button', 'Tạo nháp'));
    await flush(8);
    const call = calls.find((x) => x.url.includes('/refill-drafts'));
    expect(call?.init?.method).toBe('POST');
    expect(JSON.parse(String(call?.init?.body))).toEqual({ sheetUrl: 'https://tubutree.com/phieu-can/refill-10l', sourceNote: 'Dòng 3' });
    expect(panel.textContent).toContain('Tạo 22 nháp từ 11 gói Refill, bỏ qua 0 dòng đã có. Giảm nhựa cần số gam trước khi duyệt.');
  });

  it('để trống link: gửi null (máy chủ để dòng thiếu nguồn); lỗi 400 hiện lời tiếng Việt của máy chủ', async () => {
    const { c, calls } = await mount([], { '/admin/eco-facts/refill-drafts': { status: 400, body: { message: 'Link phiếu cân phải là một trang https://tubutree.com/… (phiếu cân nội bộ).' } } });
    const panel = c.querySelector('[data-testid="eco-refill-drafts"]') as HTMLElement;
    click(byText(panel, 'button', 'Tạo nháp'));
    await flush(8);
    expect(JSON.parse(String(calls.find((x) => x.url.includes('/refill-drafts'))?.init?.body))).toEqual({ sheetUrl: null, sourceNote: null });
    expect(panel.textContent).toContain('Link phiếu cân phải là một trang https://tubutree.com/');
  });

  it('danh mục chưa có gói Refill: nói thẳng, không báo "Tạo 0 nháp"', async () => {
    const { c } = await mount([]);
    const panel = c.querySelector('[data-testid="eco-refill-drafts"]') as HTMLElement;
    click(byText(panel, 'button', 'Tạo nháp'));
    await flush(8);
    expect(panel.textContent).toContain('Danh mục chưa có gói Refill nào.');
  });

  it('dòng nháp sinh từ danh sách: "Chờ cân" + "—" cho nguồn trống + lý do chưa duyệt; Can refill không có "Chờ cân"', async () => {
    const blockers = [
      { code: 'source_url', message: 'Thiếu link nguồn https.' },
      { code: 'source_note', message: 'Thiếu ghi chú nguồn (trang, bảng số).' },
    ];
    const { c } = await mount([
      row({ id: 'g1', valueGrams: null, sourceUrl: '', sourceKind: null, sourceNote: '', blockers: [{ code: 'value_grams', message: 'Giảm nhựa cần số gam lớn hơn 0.' }, ...blockers] }),
      row({ id: 'g2', kind: 'REFILL_PACK', valueGrams: null, sourceUrl: '', sourceKind: null, sourceNote: '', blockers }),
    ]);
    const [plastic, pack] = [...c.querySelectorAll('[data-testid="eco-fact-row"]')] as HTMLElement[];
    expect(plastic!.textContent).toContain('Chờ cân');
    expect(pack!.textContent).not.toContain('Chờ cân');
    expect(plastic!.querySelector('a')).toBeNull();
    expect(plastic!.textContent).toContain('Nguồn: —');
    expect(byText(plastic!, 'button', 'Duyệt')?.hasAttribute('disabled')).toBe(true);
  });

  it('nguồn là phiếu cân nội bộ thì dán nhãn; nguồn ngoài thì không', async () => {
    const { c } = await mount([
      row({ id: 'n1', sourceUrl: 'https://tubutree.com/phieu-can/refill-10l', sourceKind: 'internal_sheet' }),
      row({ id: 'n2', sourceUrl: 'https://pannature.org/a', sourceKind: 'external' }),
    ]);
    const [internal, external] = [...c.querySelectorAll('[data-testid="eco-fact-row"]')] as HTMLElement[];
    expect(internal!.textContent).toContain('Phiếu cân nội bộ');
    expect(internal!.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(external!.textContent).not.toContain('Phiếu cân nội bộ');
  });
});

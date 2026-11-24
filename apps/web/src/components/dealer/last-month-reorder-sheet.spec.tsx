// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PriceTab } from './price-tab';
import { byText, click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import { formatVnd } from '@/lib/format-vnd';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

let mounted: Rendered | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const ROWS = [
  { variationId: 'v1', sku: 'SKU-1', product: 'Nước rửa', brand: 'Tubu', variation: '1L', retailPrice: 100_000, dealerPrice: 80_000, discountPct: 20, stock: 50 },
  { variationId: 'v2', sku: 'SKU-2', product: 'Bột giặt', brand: 'Tubu', variation: '3kg', retailPrice: 250_000, dealerPrice: 180_000, discountPct: 28, stock: 0 },
];
const QUOTE = 'a'.repeat(32);
const PREVIEW = {
  month: '10/2026',
  orderCodes: ['DL-2', 'DL-1'],
  lines: [
    { variationId: 'v1', sku: 'SKU-1', name: 'Nước rửa – 1L', quantity: 15, unitPrice: 80_000, lineTotal: 1_200_000, stock: 50 },
    { variationId: 'v2', sku: 'SKU-2', name: 'Bột giặt – 3kg', quantity: 4, unitPrice: 180_000, lineTotal: 720_000, stock: 0 },
  ],
  skipped: ['Nước rửa cũ – 5L'],
  goodsTotal: 1_920_000,
  shippingFee: 0,
  total: 1_920_000,
  credit: { limit: 10_000_000, debt: 2_000_000, available: 8_000_000, after: 6_080_000 },
  quote: QUOTE,
  block: null as null | { code: string; message: string },
};

type Route = { status?: number; body: unknown };

function mount(opts: { preview?: () => Route; place?: (init?: RequestInit) => Route } = {}) {
  let gets = 0;
  const { fn, calls } = mockFetch({
    '/dealer/pricelist': { body: ROWS },
    '/dealer/templates': { body: [] },
    '/dealer/reorder-last-month': (init) => {
      if ((init?.method ?? 'GET') === 'POST') return opts.place?.(init) ?? { body: { code: 'DL-NEW', total: 1_920_000, items: [] } };
      gets += 1;
      return opts.preview?.() ?? { body: PREVIEW };
    },
  });
  vi.stubGlobal('fetch', fn);
  mounted = render(<PriceTab creditLimit={10_000_000} debt={2_000_000} />);
  return { calls, gets: () => gets };
}

const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]');
const posts = (calls: { url: string; init?: RequestInit }[]) => calls.filter((c) => c.url.includes('/dealer/reorder-last-month') && c.init?.method === 'POST');
const headerOf = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name);

describe('PriceTab: Đặt lại đơn tháng trước', () => {
  it('tháng trước không có đơn: không có nút đặt lại', async () => {
    mount({ preview: () => ({ body: { ...PREVIEW, orderCodes: [], lines: [], skipped: [], block: { code: 'NO_ORDERS', message: 'x' } } }) });
    await flush();
    expect(byText(mounted!.container, 'button', /Đặt lại đơn tháng/)).toBeNull();
  });

  it('một chạm mở sheet: đọc lại bản xem trước, nêu món bị bỏ, hạn mức còn lại trước và sau đơn; Ghi công nợ gửi đúng dấu kèm Idempotency-Key', async () => {
    const m = mount();
    await flush();
    const chip = byText(mounted!.container, 'button', 'Đặt lại đơn tháng 10');
    expect(chip).not.toBeNull();
    const before = m.gets();
    click(chip);
    await flush();
    expect(m.gets()).toBe(before + 1);

    const s = sheet()!;
    const text = s.textContent ?? '';
    expect(text).toContain('Đặt lại đơn tháng 10/2026');
    expect(text).toContain('Gộp 2 đơn đã nhận (#DL-2, #DL-1)');
    expect(s.querySelector('[role="alert"]')?.textContent).toBe('Bỏ 1 mặt hàng không còn bán sỉ: Nước rửa cũ – 5L.');
    expect(text).toContain('15 × 80.000đ');
    expect(text).toContain('4 × 180.000đ · đặt trước 4');
    expect(text).toContain(`Hạn mức còn lại${formatVnd(8_000_000)}`);
    expect(text).toContain(`Sau đơn này${formatVnd(6_080_000)}`);

    const cta = byText(s, 'button', `Ghi công nợ ${formatVnd(1_920_000)}`) as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    click(cta);
    await flush();
    const [post] = posts(m.calls);
    expect(JSON.parse(String(post!.init!.body))).toEqual({ quote: QUOTE });
    expect(headerOf(post!.init, 'Idempotency-Key')).toBeTruthy();
    expect(sheet()).toBeNull();
    expect(mounted!.container.textContent).toContain(`Đã tạo đơn DL-NEW ghi công nợ ${formatVnd(1_920_000)}.`);
  });

  it('vượt hạn mức: nút Ghi công nợ tắt, lời chặn của máy chủ hiện rõ; Sửa trong giỏ nạp các dòng và nêu cả món máy chủ đã bỏ', async () => {
    const over = {
      ...PREVIEW,
      credit: { limit: 10_000_000, debt: 9_000_000, available: 1_000_000, after: -920_000 },
      block: { code: 'OVER_LIMIT', message: 'Đơn 1.920.000đ vượt hạn mức công nợ còn lại 1.000.000đ.' },
    };
    const m = mount({ preview: () => ({ body: over }) });
    await flush();
    click(byText(mounted!.container, 'button', 'Đặt lại đơn tháng 10'));
    await flush();
    const s = sheet()!;
    expect(s.textContent).toContain(`Sau đơn này${`Vượt ${formatVnd(920_000)}`}`);
    expect(Array.from(s.querySelectorAll('[role="alert"]')).map((a) => a.textContent)).toContain(over.block.message);
    expect((byText(s, 'button', /^Ghi công nợ/) as HTMLButtonElement).disabled).toBe(true);

    click(byText(s, 'button', 'Sửa trong giỏ'));
    await flush();
    expect(sheet()).toBeNull();
    expect(posts(m.calls)).toHaveLength(0);
    const page = mounted!.container.textContent ?? '';
    expect(page).toContain('Đã nạp 2 mặt hàng của đơn tháng 10/2026 theo giá hôm nay, kiểm tra số lượng rồi đặt. Bỏ qua 1 mặt hàng không còn bán sỉ: Nước rửa cũ – 5L.');
    const shown = Array.from(mounted!.container.querySelectorAll('[aria-live="polite"]')).map((n) => n.textContent);
    expect(shown).toEqual(expect.arrayContaining(['15', '4']));
    // Giỏ của bảng giá đã có đủ hai dòng: tổng tiền hàng 15 × 80.000 + 4 × 180.000.
    expect(page).toContain(formatVnd(1_920_000));
  });

  it('409 giá vừa đổi: báo lời máy chủ trong sheet, đọc lại bản xem trước, lần bấm sau gửi dấu mới và giữ nguyên Idempotency-Key', async () => {
    let attempt = 0;
    const NEW_QUOTE = 'b'.repeat(32);
    const m = mount({
      preview: () =>
        attempt === 0
          ? { body: PREVIEW }
          : {
              body: {
                ...PREVIEW,
                lines: [{ ...PREVIEW.lines[0]!, unitPrice: 82_000, lineTotal: 1_230_000 }, PREVIEW.lines[1]!],
                goodsTotal: 1_950_000,
                total: 1_950_000,
                credit: { ...PREVIEW.credit, after: 6_050_000 },
                quote: NEW_QUOTE,
              },
            },
      place: () => {
        attempt += 1;
        return attempt === 1
          ? { status: 409, body: { statusCode: 409, code: 'DEALER_REORDER_CHANGED', message: 'Giá hoặc phí giao của đơn tháng 10/2026 vừa đổi, tổng mới là 1.950.000đ.' } }
          : { body: { code: 'DL-NEW', total: 1_950_000, items: [] } };
      },
    });
    await flush();
    click(byText(mounted!.container, 'button', 'Đặt lại đơn tháng 10'));
    await flush();
    const getsBefore = m.gets();
    click(byText(sheet()!, 'button', /^Ghi công nợ/));
    await flush(10);
    expect(sheet()?.textContent).toContain('vừa đổi, tổng mới là 1.950.000đ');
    expect(m.gets()).toBeGreaterThan(getsBefore);
    expect(sheet()?.textContent).toContain('15 × 82.000đ');
    const retry = byText(sheet()!, 'button', `Ghi công nợ ${formatVnd(1_950_000)}`) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);

    click(retry);
    await flush(10);
    const sent = posts(m.calls);
    expect(sent).toHaveLength(2);
    expect(JSON.parse(String(sent[0]!.init!.body))).toEqual({ quote: QUOTE });
    expect(JSON.parse(String(sent[1]!.init!.body))).toEqual({ quote: NEW_QUOTE });
    expect(headerOf(sent[1]!.init, 'Idempotency-Key')).toBe(headerOf(sent[0]!.init, 'Idempotency-Key'));
    expect(mounted!.container.textContent).toContain('Đã tạo đơn DL-NEW');
  });
});

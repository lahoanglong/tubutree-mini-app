// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalInsertQrCard } from './external-insert-qr-card';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { SITE_URL } from '@/lib/site';
import { BATCH_ERROR_TEXT, printInsertQrBatch } from '@/lib/insert-qr-batch';
import { printInsertQrCard } from '@/lib/insert-qr-card';

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/admin-client')>()),
  getConfig: getConfigMock,
}));
vi.mock('@/lib/insert-qr-card', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/insert-qr-card')>()),
  printInsertQrCard: vi.fn(),
}));
vi.mock('@/lib/insert-qr-batch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/insert-qr-batch')>()),
  printInsertQrBatch: vi.fn(),
}));

let mounted: Rendered[] = [];
beforeEach(() => {
  getConfigMock.mockReset();
  getConfigMock.mockResolvedValue([{ key: 'loyalty.marketplace_earn_pct', value: 5, description: null, category: 'loyalty' }]);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.mocked(printInsertQrBatch).mockReset();
  vi.mocked(printInsertQrCard).mockReset();
});

const mount = () => {
  const r = render(<ExternalInsertQrCard />);
  mounted.push(r);
  return r;
};
const bulk = (r: Rendered) => r.container.querySelector<HTMLElement>('[data-insert-qr-bulk]')!;
const inputs = (r: Rendered) => Array.from(bulk(r).querySelectorAll<HTMLInputElement>('input')) as [HTMLInputElement, HTMLInputElement];
const ctaOf = (r: Rendered) => bulk(r).querySelector<HTMLButtonElement>('button')!;

describe('ExternalInsertQrCard: in hàng loạt', () => {
  it('khối nằm sau ô đợt thẻ (ô nhập đầu tiên của thẻ vẫn là đợt thẻ), hai ô số có nhãn nhìn thấy, chặn 4 ký tự, bàn phím số', () => {
    const r = mount();
    expect(r.container.querySelector<HTMLInputElement>('[data-external-insert-qr] input')!.maxLength).toBe(35);
    const [count, start] = inputs(r);
    expect(count.closest('label')!.textContent).toContain('Số thẻ (1 tới 200)');
    expect(start.closest('label')!.textContent).toContain('Bắt đầu từ số');
    for (const el of [count, start]) {
      expect(el.maxLength).toBe(4);
      expect(el.getAttribute('inputmode')).toBe('numeric');
      expect(el.className).toContain('tabular-nums');
    }
    expect(count.value).toBe('20');
    expect(start.value).toBe('1');
  });

  it('một nút duy nhất trong khối; chưa có đợt thẻ thì nút khoá và chỉ có gợi ý, không có báo lỗi', () => {
    const r = mount();
    expect(bulk(r).querySelectorAll('button')).toHaveLength(1);
    expect(ctaOf(r).disabled).toBe(true);
    expect(ctaOf(r).textContent).toBe('In hàng loạt');
    expect(bulk(r).querySelector('[data-bulk-hint]')!.textContent).toBe('Điền tên đợt thẻ ở trên để in hàng loạt.');
    expect(bulk(r).querySelector('[role="alert"]')).toBeNull();
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('có đợt thẻ: tóm tắt số thẻ, khoảng số và số tờ A4; nhãn nút nêu số thẻ và số tờ', () => {
    const r = mount();
    typeInto(r.container.querySelector('input'), 'Box-2026-11');
    expect(bulk(r).querySelector('[data-bulk-summary]')!.textContent).toBe('20 thẻ, số 001 tới 020, 5 tờ A4 (4 thẻ mỗi tờ).');
    expect(ctaOf(r).textContent).toBe('In 20 thẻ (5 tờ A4)');
    expect(ctaOf(r).disabled).toBe(false);
    typeInto(inputs(r)[0], '7');
    typeInto(inputs(r)[1], '51');
    expect(bulk(r).querySelector('[data-bulk-summary]')!.textContent).toBe('7 thẻ, số 051 tới 057, 2 tờ A4 (4 thẻ mỗi tờ).');
    expect(ctaOf(r).textContent).toBe('In 7 thẻ (2 tờ A4)');
  });

  it('số thẻ ngoài 1 tới 200, số bắt đầu sai hoặc vượt 999: báo lỗi đúng chỗ, khoá nút', () => {
    const r = mount();
    typeInto(r.container.querySelector('input'), 'box-2026-11');
    const [count, start] = inputs(r);
    typeInto(count, '201');
    expect(bulk(r).querySelector('[role="alert"]')!.textContent).toBe(BATCH_ERROR_TEXT.count);
    expect(count.getAttribute('aria-invalid')).toBe('true');
    expect(ctaOf(r).disabled).toBe(true);
    typeInto(count, '0');
    expect(bulk(r).querySelector('[role="alert"]')!.textContent).toBe(BATCH_ERROR_TEXT.count);
    typeInto(count, '');
    expect(bulk(r).querySelector('[role="alert"]')!.textContent).toBe(BATCH_ERROR_TEXT.count);

    typeInto(count, '200');
    typeInto(start, '0');
    expect(bulk(r).querySelector('[role="alert"]')!.textContent).toBe(BATCH_ERROR_TEXT.start);
    expect(start.getAttribute('aria-invalid')).toBe('true');
    typeInto(start, '801');
    expect(bulk(r).querySelector('[role="alert"]')!.textContent).toBe(BATCH_ERROR_TEXT.range);
    expect(count.getAttribute('aria-invalid')).toBe('true');
    expect(start.getAttribute('aria-invalid')).toBe('true');
    expect(ctaOf(r).disabled).toBe(true);
    typeInto(start, '800');
    expect(bulk(r).querySelector('[role="alert"]')).toBeNull();
    expect(ctaOf(r).disabled).toBe(false);
  });

  it('đợt thẻ có dấu: khối hàng loạt cũng báo lỗi đợt thẻ và khoá nút', () => {
    const r = mount();
    typeInto(r.container.querySelector('input'), 'có dấu');
    expect(bulk(r).querySelector('[role="alert"]')!.textContent).toBe(BATCH_ERROR_TEXT.tag);
    expect(ctaOf(r).disabled).toBe(true);
  });

  it('bấm nút: gửi đúng lượt thẻ (sàn, đợt, host của bản build, tỉ lệ điểm) tới hộp thoại in', async () => {
    vi.mocked(printInsertQrBatch).mockResolvedValue(undefined);
    const r = mount();
    await flush();
    click(byText(r.container, 'button', 'Lazada'));
    typeInto(r.container.querySelector('input'), 'box-2026-11');
    typeInto(inputs(r)[0], '6');
    click(ctaOf(r));
    await flush();
    expect(vi.mocked(printInsertQrBatch)).toHaveBeenCalledTimes(1);
    const [plan, opts] = vi.mocked(printInsertQrBatch).mock.calls[0]!;
    expect(opts).toEqual({ earnPct: 5 });
    expect(plan.channel).toBe('lazada');
    expect(plan.tag).toBe('box-2026-11');
    expect(plan.sheets).toBe(2);
    expect(plan.cards.map((c) => c.serial)).toEqual(['001', '002', '003', '004', '005', '006']);
    expect(plan.cards[0]!.url).toBe(`${SITE_URL}/quet-ma?utm_source=lazada&card=box-2026-11&n=001`);
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    expect(ctaOf(r).disabled).toBe(false);
  });

  it('lỗi mở hộp thoại in: báo lỗi trong khối, nút mở lại; đang in thì các nút in/tải thẻ lẻ cùng khoá', async () => {
    let rejectPrint!: (e: Error) => void;
    vi.mocked(printInsertQrBatch).mockReturnValue(new Promise<void>((_, reject) => (rejectPrint = reject)));
    const r = mount();
    await flush();
    typeInto(r.container.querySelector('input'), 'box-2026-11');
    click(ctaOf(r));
    await flush();
    expect(ctaOf(r).disabled).toBe(true);
    expect(ctaOf(r).getAttribute('aria-busy')).toBe('true');
    const single = Array.from(r.container.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.startsWith('In / Lưu PDF thẻ A6'))!;
    expect(single.disabled).toBe(true);
    click(single);
    await flush();
    expect(vi.mocked(printInsertQrCard)).not.toHaveBeenCalled();

    rejectPrint(new Error('Trình duyệt không mở được trang in.'));
    await flush();
    expect(bulk(r).querySelector('[role="alert"]')!.textContent).toBe('Trình duyệt không mở được trang in.');
    expect(ctaOf(r).disabled).toBe(false);
    expect(ctaOf(r).getAttribute('aria-busy')).toBeNull();
    expect(single.disabled).toBe(false);
  });

  it('nút bị khoá thì bấm không in gì', async () => {
    const r = mount();
    await flush();
    click(ctaOf(r));
    await flush();
    expect(vi.mocked(printInsertQrBatch)).not.toHaveBeenCalled();
  });
});

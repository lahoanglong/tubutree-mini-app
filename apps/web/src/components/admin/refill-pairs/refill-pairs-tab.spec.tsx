// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, selectValue, type Rendered } from '@/test-utils/dom';
import { unlabeledFields, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';
import type { AdminRefillPairRow, AdminRefillPairs, AdminRefillProduct } from './api';
import { RefillPairsTab } from './refill-pairs-tab';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('./api', () => ({ getRefillPairs: api.get, saveRefillPairs: api.save }));

const prod = (slug: string, name: string, sizeLabel: string | null = null): AdminRefillProduct => ({ id: slug, slug, name, sizeLabel });
const B38 = prod('nrc-3-8l', 'Nước rửa chén Fuwa3e 3,8L', '3,8L');
const B500 = prod('nrc-500ml', 'Nước rửa chén Fuwa3e 500ml', '500ml');
const BGEL = prod('gel-300ml', 'Nước rửa tay dạng Gel Fuwa3e 300ml', '300ml');
const BOFF = prod('lau-2l', 'Lau đa năng Fuwa3e 2L', '2L');
const R10 = prod('refill-nrc-10l', 'Refill Nước rửa chén Fuwa3e 10L', '10L');
const RGEL = prod('refill-gel-10l', 'Refill Nước rửa tay dạng Gel Fuwa3e 10L', '10L');

const row = (bottle: AdminRefillProduct, refill: AdminRefillProduct | null, status: AdminRefillPairRow['status'], ratio: number | null): AdminRefillPairRow => ({
  bottle,
  refill,
  status,
  candidates: refill ? 1 : 2,
  ratio,
});

const DATA = (): AdminRefillPairs => ({
  enabled: false,
  maxRatio: 3,
  rows: [row(B38, R10, 'auto', 2.6), row(B500, R10, 'size', 20), row(BGEL, RGEL, 'manual', 33.3), row(BOFF, null, 'blocked', null)],
  overrides: [{ bottleSlug: 'gel-300ml', refillSlug: 'refill-gel-10l' }],
  block: [
    { slug: 'lau-2l', name: 'Lau đa năng Fuwa3e 2L' },
    { slug: 'refill-cu', name: 'Refill cũ 5L' },
  ],
  choices: { bottles: [B38, B500, BGEL, BOFF], refills: [R10, RGEL] },
});

let mounted: Rendered | null = null;
beforeEach(() => {
  api.get.mockResolvedValue(DATA());
  api.save.mockImplementation(async () => ({ ...DATA(), enabled: true }));
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
});

async function mount() {
  mounted = render(<RefillPairsTab />);
  await flush();
  return mounted.container;
}
const rowEl = (c: ParentNode, name: string) => Array.from(c.querySelectorAll('[data-testid="refill-pair-row"]')).find((e) => e.textContent?.includes(name)) as HTMLElement;
const btn = (c: ParentNode, text: string | RegExp) => byText(c, 'button', text) as HTMLButtonElement | null;

describe('RefillPairsTab (tubu-w6-01 P1-a)', () => {
  it('bảng cặp: tự ghép, chờ ghép tay vì lệch lượng (×20), ghép tay, đã tắt; ghi rõ luật 3 lần', async () => {
    const c = await mount();
    expect(c.textContent).toContain('không quá 3 lần chai');
    expect(rowEl(c, B38.name).textContent).toContain('Tự ghép');
    expect(rowEl(c, B38.name).textContent).toContain('(×2,6 chai)');
    expect(rowEl(c, B500.name).textContent).toContain('Gói lớn hơn 3 lần chai: chờ ghép tay');
    expect(rowEl(c, BGEL.name).textContent).toContain('Ghép tay');
    expect(rowEl(c, BOFF.name).textContent).toContain('Đã tắt');
    expect(c.textContent).toContain('Gợi ý Refill đang tắt');
    expect(unnamedControls(c)).toEqual([]);
    expect(unlabeledFields(c)).toEqual([]);
  });

  it('lọc: Chờ ghép tay chỉ còn dòng lệch lượng; mỗi chip đếm đúng', async () => {
    const c = await mount();
    expect(btn(c, 'Chờ ghép tay (1)')).not.toBeNull();
    expect(btn(c, 'Đang mời đổi (2)')).not.toBeNull();
    click(btn(c, 'Chờ ghép tay (1)'));
    await flush();
    expect(Array.from(c.querySelectorAll('[data-testid="refill-pair-row"]')).map((e) => e.getAttribute('data-status'))).toEqual(['size']);
  });

  it('tên gần giống (tubu-w9-03): dòng chờ ghép tay, một chạm "Ghép tay cặp này" lưu đúng cặp gợi ý', async () => {
    const BLAU = prod('nuoc-lau-500ml', 'Nước lau đa năng FUWA3E 500ml', '500ml');
    const RLAU = prod('refill-lau-10l', 'Refill Lau đa năng Fuwa3e 10L', '10L');
    api.get.mockResolvedValue({ ...DATA(), rows: [...DATA().rows, row(BLAU, RLAU, 'near', null)] });
    const c = await mount();
    expect(btn(c, 'Chờ ghép tay (2)')).not.toBeNull();
    expect(rowEl(c, BLAU.name).textContent).toContain('Tên gần giống gói Refill: xác nhận ghép tay');
    click(btn(rowEl(c, BLAU.name), 'Ghép tay cặp này'));
    await flush();
    expect(api.save).toHaveBeenCalledWith({ add: { bottleSlug: 'nuoc-lau-500ml', refillSlug: 'refill-lau-10l' } });
  });

  it('tắt cặp tự ghép: thêm chai vào danh sách chặn, giữ món đã chặn', async () => {
    const c = await mount();
    click(btn(c, 'Tắt cặp'));
    await flush();
    expect(api.save).toHaveBeenCalledWith({ block: ['lau-2l', 'refill-cu', 'nrc-3-8l'] });
    expect(c.textContent).toContain('Đã tắt cặp: Nước rửa chén Fuwa3e 3,8L. Khách thấy thay đổi trong vài phút.');
  });

  it('ghép tay cặp đang chờ; bỏ ghép tay; bật lại chai đã tắt (ghép và bỏ ghép gửi thao tác, máy chủ gộp vào danh sách đang lưu)', async () => {
    const c = await mount();
    click(btn(c, 'Ghép tay cặp này'));
    await flush();
    expect(api.save).toHaveBeenLastCalledWith({ add: { bottleSlug: 'nrc-500ml', refillSlug: 'refill-nrc-10l' } });
    click(btn(c, 'Bỏ ghép tay'));
    await flush();
    expect(api.save).toHaveBeenLastCalledWith({ remove: 'gel-300ml' });
    click(btn(c, 'Bật lại'));
    await flush();
    expect(api.save).toHaveBeenLastCalledWith({ block: ['refill-cu'] });
  });

  it('ô Ghép tay: chọn chai và gói Refill rồi lưu; cặp cũ của cùng chai được thay', async () => {
    const c = await mount();
    const [bottle, refill] = Array.from(c.querySelectorAll('select'));
    expect(btn(c, /^Ghép tay$/)!.disabled).toBe(true);
    selectValue(bottle!, 'gel-300ml');
    selectValue(refill!, 'refill-nrc-10l');
    await flush();
    click(btn(c, /^Ghép tay$/));
    await flush();
    expect(api.save).toHaveBeenCalledWith({ add: { bottleSlug: 'gel-300ml', refillSlug: 'refill-nrc-10l' } });
    expect((bottle as HTMLSelectElement).value).toBe('');
  });

  it('gói Refill bị chặn hiện ở Món đang chặn để bỏ chặn', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Món đang chặn');
    click(c.querySelector('button[aria-label="Bỏ chặn: Refill cũ 5L"]'));
    await flush();
    expect(api.save).toHaveBeenCalledWith({ block: ['lau-2l'] });
  });

  it('bật cả tính năng; máy chủ từ chối (nhân viên không phải ADMIN) thì báo lỗi', async () => {
    const c = await mount();
    click(btn(c, 'Bật gợi ý Refill'));
    await flush();
    expect(api.save).toHaveBeenCalledWith({ enabled: true });
    expect(c.textContent).toContain('Gợi ý Refill đang bật');
    api.save.mockRejectedValueOnce(new ApiError('Chỉ quản trị viên bật hay tắt gợi ý gói Refill.', 403));
    click(btn(c, 'Tắt gợi ý Refill'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Chỉ quản trị viên');
  });
});

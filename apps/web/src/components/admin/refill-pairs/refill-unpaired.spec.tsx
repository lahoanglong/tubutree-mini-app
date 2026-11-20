// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, selectValue, type Rendered } from '@/test-utils/dom';
import { unlabeledFields, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';
import type { AdminRefillPairRow, AdminRefillPairs, AdminRefillProduct } from './api';
import { RefillUnpairedChip, RefillUnpairedPanel } from './refill-unpaired';

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('./api', () => ({ getRefillPairs: api.get, saveRefillPairs: api.save }));

const prod = (slug: string, name: string): AdminRefillProduct => ({ id: slug, slug, name, sizeLabel: null });
const B38 = prod('nrc-3-8l', 'Nước rửa chén Fuwa3e 3,8L');
const B500 = prod('nrc-500ml', 'Nước rửa chén Fuwa3e 500ml');
const BLAU = prod('nuoc-lau-500ml', 'Nước lau đa năng FUWA3E 500ml');
const BXA = prod('xa-bong', 'Xà bông Fuwa3e 1L');
const BGEL = prod('gel-300ml', 'Nước rửa tay dạng Gel Fuwa3e 300ml');
const R10 = prod('refill-nrc-10l', 'Refill Nước rửa chén Fuwa3e 10L');
const RLAU = prod('refill-lau-10l', 'Refill Lau đa năng Fuwa3e 10L');
const RXA1 = prod('refill-xa-5l', 'Refill Xà bông Fuwa3e 5L');
const RXA2 = prod('refill-xa-10l', 'Refill Xà bông Fuwa3e 10L');
const RGEL = prod('refill-gel-10l', 'Refill Nước rửa tay dạng Gel Fuwa3e 10L');

const row = (bottle: AdminRefillProduct, refill: AdminRefillProduct | null, status: AdminRefillPairRow['status'], ratio: number | null = null): AdminRefillPairRow => ({
  bottle,
  refill,
  status,
  candidates: status === 'ambiguous' ? 2 : refill ? 1 : 0,
  ratio,
});

const DATA = (): AdminRefillPairs => ({
  enabled: true,
  maxRatio: 3,
  rows: [row(B38, R10, 'auto', 2.6), row(B500, R10, 'size', 20), row(BLAU, RLAU, 'near'), row(BXA, null, 'ambiguous'), row(BGEL, RGEL, 'manual', 33.3)],
  overrides: [{ bottleSlug: 'gel-300ml', refillSlug: 'refill-gel-10l' }],
  block: [],
  choices: { bottles: [B38, B500, BLAU, BXA, BGEL], refills: [R10, RLAU, RXA1, RXA2, RGEL] },
});

let mounted: Rendered | null = null;
beforeEach(() => {
  api.get.mockResolvedValue(DATA());
  api.save.mockImplementation(async (input: { add: AdminRefillPairs['overrides'][number] }) => {
    const d = DATA();
    return { ...d, overrides: [...d.overrides, input.add], rows: d.rows.map((r) => (r.bottle.slug === input.add.bottleSlug ? { ...r, status: 'manual' as const } : r)) };
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
});

function Harness() {
  const [on, setOn] = useState(false);
  return (
    <div>
      <RefillUnpairedChip on={on} onToggle={() => setOn((v) => !v)} />
      {on && <RefillUnpairedPanel />}
    </div>
  );
}

async function mount() {
  mounted = render(<Harness />);
  await flush();
  return mounted.container;
}
const chip = (c: ParentNode) => byText(c, 'button', 'Chưa ghép Refill') as HTMLButtonElement | null;
const rowEl = (c: ParentNode, name: string) => Array.from(c.querySelectorAll('[data-testid="refill-unpaired-row"]')).find((e) => e.textContent?.includes(name)) as HTMLElement | undefined;
const pairBtn = (r: HTMLElement | undefined) => byText(r!, 'button', 'Ghép') as HTMLButtonElement;

describe('Chưa ghép Refill ở thẻ Sản phẩm (tubu-w9-03)', () => {
  it('chip đếm chai chờ ghép (lệch lượng, tên gần giống, nhiều gói); bật lên thì chỉ còn các chai đó, gói gợi ý chọn sẵn', async () => {
    const c = await mount();
    expect(chip(c)?.textContent).toBe('Chưa ghép Refill (3)');
    expect(chip(c)?.getAttribute('aria-pressed')).toBe('false');
    expect(c.querySelector('[data-testid="refill-unpaired-row"]')).toBeNull();

    click(chip(c));
    await flush();
    expect(chip(c)?.getAttribute('aria-pressed')).toBe('true');
    const rows = Array.from(c.querySelectorAll<HTMLElement>('[data-testid="refill-unpaired-row"]'));
    expect(rows.map((r) => r.dataset.status)).toEqual(['size', 'near', 'ambiguous']);
    expect(rowEl(c, B38.name)).toBeUndefined();
    expect(rowEl(c, BGEL.name)).toBeUndefined();
    expect(rowEl(c, B500.name)!.querySelector('select')!.value).toBe('refill-nrc-10l');
    expect(rowEl(c, BLAU.name)!.querySelector('select')!.value).toBe('refill-lau-10l');
    expect(rowEl(c, BLAU.name)!.textContent).toContain('Tên gần giống gói Refill: xác nhận ghép tay');
    expect(rowEl(c, BXA.name)!.querySelector('select')!.value).toBe('');
    expect(pairBtn(rowEl(c, BXA.name)).disabled).toBe(true);
    expect(unnamedControls(c)).toEqual([]);
    expect(unlabeledFields(c)).toEqual([]);
  });

  it('một chạm Ghép: gửi đúng một thao tác ghép (máy chủ gộp vào danh sách đang lưu, không ghi đè); dòng rời danh sách và chip giảm', async () => {
    const c = await mount();
    click(chip(c));
    await flush();
    click(pairBtn(rowEl(c, BLAU.name)));
    await flush();
    expect(api.save).toHaveBeenCalledWith({ add: { bottleSlug: 'nuoc-lau-500ml', refillSlug: 'refill-lau-10l' } });
    expect(c.textContent).toContain('Đã ghép Nước lau đa năng FUWA3E 500ml với Refill Lau đa năng Fuwa3e 10L. Khách thấy thay đổi trong vài phút.');
    expect(rowEl(c, BLAU.name)).toBeUndefined();
    expect(chip(c)?.textContent).toBe('Chưa ghép Refill (2)');
  });

  it('chai nhiều gói Refill: chọn gói trong ô rồi Ghép đúng gói đã chọn', async () => {
    const c = await mount();
    click(chip(c));
    await flush();
    const r = rowEl(c, BXA.name)!;
    selectValue(r.querySelector('select'), 'refill-xa-10l');
    click(pairBtn(r));
    await flush();
    expect(api.save).toHaveBeenCalledWith({ add: { bottleSlug: 'xa-bong', refillSlug: 'refill-xa-10l' } });
  });

  it('máy chủ từ chối (ví dụ ghép vòng): báo lỗi của máy chủ, dòng giữ nguyên', async () => {
    api.save.mockRejectedValueOnce(new ApiError('"Refill Lau đa năng Fuwa3e 10L" là gói Refill, không làm chai được.', 400));
    const c = await mount();
    click(chip(c));
    await flush();
    click(pairBtn(rowEl(c, B500.name)));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('là gói Refill, không làm chai được.');
    expect(rowEl(c, B500.name)).toBeDefined();
  });

  it('không tải được bảng cặp (403 với vai trò không có quyền): không có chip', async () => {
    api.get.mockRejectedValue(new ApiError('Forbidden', 403));
    const c = await mount();
    expect(chip(c)).toBeNull();
  });

  it('không còn chai chờ ghép: chip (0) và lời báo rỗng', async () => {
    api.get.mockResolvedValue({ ...DATA(), rows: [row(B38, R10, 'auto', 2.6)] });
    const c = await mount();
    expect(chip(c)?.textContent).toBe('Chưa ghép Refill (0)');
    click(chip(c));
    await flush();
    expect(c.querySelector('[data-testid="refill-unpaired-empty"]')?.textContent).toBe('Không còn chai nào chờ ghép Refill.');
  });
});

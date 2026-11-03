// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerConfirm, byText, click, confirmDialog, flush, mockFetch, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { CategoryOption, ProductDetail } from '@/lib/product-categories';
import { ProductEditDrawer } from './product-edit-drawer';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  vi.unstubAllGlobals();
});

const product = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  id: 'p1',
  name: 'Nước rửa chén',
  brand: 'Tubu Tree',
  description: 'Mô tả cũ',
  shortDesc: null,
  images: [],
  isActive: true,
  isFeatured: false,
  categoryIds: ['a'],
  basePrice: 50000,
  salePrice: null,
  managedByPancake: true,
  partnerOwned: false,
  cannotShowReason: null,
  ...over,
});
const CATS: CategoryOption[] = [
  { id: 'a', name: 'Nhà bếp' },
  { id: 'b', name: 'Giặt tẩy' },
];

function mount(opts: { cached?: ProductDetail; server: ProductDetail }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (opts.cached) client.setQueryData(['admin-product', 'p1'], opts.cached);
  const m = mockFetch({
    '/admin/catalog-products/p1': (init) => (init?.method === 'PATCH' ? { body: { ...opts.server, ...JSON.parse(String(init.body)) } } : { body: opts.server }),
  });
  vi.stubGlobal('fetch', vi.fn(m.fn));
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const r = render(<ProductEditDrawer id="p1" categories={CATS} onClose={onClose} onSaved={onSaved} />, client);
  mounted.push(r);
  return { m, onClose, onSaved };
}
const patches = (m: ReturnType<typeof mockFetch>) => m.calls.filter((c) => c.init?.method === 'PATCH').map((c) => JSON.parse(String(c.init!.body)));
const textarea = () => document.querySelector('textarea')!;
const saveBtn = () => byText(document.body, 'button[type="submit"]', 'Lưu') as HTMLButtonElement;
const esc = () => act(() => void document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));

describe('ProductEditDrawer: không ghi đè bằng bản cache cũ', () => {
  it('mở lại từ cache cũ [A] khi bản mới là [A,B]: sửa mô tả rồi Lưu chỉ gửi mô tả, không gỡ danh mục B', async () => {
    const { m } = mount({ cached: product({ categoryIds: ['a'] }), server: product({ categoryIds: ['a', 'b'] }) });
    await flush(6);
    expect(saveBtn().disabled).toBe(true);
    typeInto(textarea(), 'Mô tả mới');
    click(saveBtn());
    await flush(6);
    expect(patches(m)).toEqual([{ description: 'Mô tả mới' }]);
  });

  it('bản vừa Pancake cập nhật mô tả: Lưu một trường khác không đè lại mô tả cũ', async () => {
    const { m } = mount({ cached: product({ description: 'Cũ' }), server: product({ description: 'Pancake vừa sửa' }) });
    await flush(6);
    click(document.querySelector('input[type="checkbox"]:not(:checked)'));
    click(saveBtn());
    await flush(6);
    expect(patches(m)).toEqual([{ isFeatured: true }]);
  });

  it('lưu xong thì nút Lưu tắt lại (bản gốc cập nhật theo lần lưu), lưu tiếp không gửi lại trường cũ', async () => {
    const { m } = mount({ server: product() });
    await flush(6);
    typeInto(textarea(), 'Mô tả mới');
    click(saveBtn());
    await flush(8);
    expect(saveBtn().disabled).toBe(true);
    click(document.querySelector('input[type="checkbox"]:not(:checked)'));
    click(saveBtn());
    await flush(8);
    expect(patches(m)).toEqual([{ description: 'Mô tả mới' }, { isFeatured: true }]);
  });

  it('gõ tiếp trong lúc PATCH đang bay: bản gốc chỉ ghi nhận phần đã gửi, Lưu vẫn bật cho phần gõ thêm', async () => {
    const server = product();
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          sent.push(String(init.body));
          await gate;
          return new Response(JSON.stringify({ ...server, ...JSON.parse(String(init.body)) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(server), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    mounted.push(render(<ProductEditDrawer id="p1" categories={CATS} onClose={vi.fn()} onSaved={vi.fn()} />, client));
    await flush(6);
    typeInto(textarea(), 'A');
    click(saveBtn());
    await flush(4);
    typeInto(textarea(), 'AB');
    release();
    await flush(10);
    expect(sent).toEqual(['{"description":"A"}']);
    expect(textarea().value).toBe('AB');
    expect(saveBtn().disabled).toBe(false);
  });
});

describe('ProductEditDrawer: hỏi lại trước khi bỏ thay đổi chưa lưu', () => {
  it('chưa sửa gì: Esc, bấm nền, nút Đóng đều đóng ngay', async () => {
    const { onClose } = mount({ server: product() });
    await flush(6);
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
    click(document.querySelector('[data-drawer-backdrop]'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(confirmDialog()).toBeNull();
  });

  it('đã sửa: Esc và bấm nền hiện hộp "Bỏ thay đổi chưa lưu?"; Tiếp tục sửa giữ ngăn kéo, Bỏ thay đổi mới đóng', async () => {
    const { onClose } = mount({ server: product() });
    await flush(6);
    typeInto(textarea(), 'Mô tả dài đang gõ');
    esc();
    await flush(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(confirmDialog()!.textContent).toContain('Bỏ thay đổi chưa lưu');
    answerConfirm(false);
    await flush(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(textarea().value).toBe('Mô tả dài đang gõ');
    click(document.querySelector('[data-drawer-backdrop]'));
    await flush(2);
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(true);
    await flush(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('nút Đóng trong form và nút X cũng hỏi khi đã sửa', async () => {
    const { onClose } = mount({ server: product() });
    await flush(6);
    typeInto(textarea(), 'x');
    click(byText(document.body, 'form button[type="button"]', 'Đóng'));
    await flush(2);
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush(2);
    click(document.querySelector('button[aria-label="Đóng"]'));
    await flush(2);
    expect(confirmDialog()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('bôi đen chữ trong ô mô tả rồi thả chuột ra nền không đóng ngăn kéo', async () => {
    const { onClose } = mount({ server: product() });
    await flush(6);
    const backdrop = document.querySelector('[data-drawer-backdrop]')!;
    act(() => void textarea().dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => void backdrop.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    act(() => void backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
    expect(onClose).not.toHaveBeenCalled();
  });
});

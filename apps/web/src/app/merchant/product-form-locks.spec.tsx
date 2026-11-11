// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, flush, remount, render, typeInto, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';
import type { MerchantProduct } from '@/lib/merchant-client';
import { CreateProductModal, EditProductModal } from './product-form';

// Wave 96B: cổng đối tác, form "Đăng sản phẩm mới" và "Sửa sản phẩm". Gửi một lần dù bấm đúp (đăng mới không có khoá chống trùng nên bấm đúp là hai sản phẩm
// chờ duyệt), nút giữ focus dùng aria-busy/aria-disabled thay disabled; sửa bị từ chối vì sản phẩm đã đổi/không còn (404/409) thì tải lại danh sách và
// giữ khoá tới khi xong (tối đa 4 giây). 400 là luật nhập liệu (giá, mã Pancake), không phải dữ liệu cũ: không tải lại.

const mocks = vi.hoisted(() => ({ updateProduct: vi.fn(), createProduct: vi.fn() }));
vi.mock('@/lib/merchant-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/merchant-client')>()),
  updateMerchantProduct: (id: string, dto: unknown) => mocks.updateProduct(id, dto),
  createMerchantProduct: (dto: unknown) => mocks.createProduct(dto),
}));

let mounted: Rendered | null = null;
beforeEach(() => {
  mocks.updateProduct.mockReset().mockResolvedValue({});
  mocks.createProduct.mockReset().mockResolvedValue({});
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  document.body.style.overflow = '';
  vi.useRealTimers();
});

const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const PRODUCT: MerchantProduct = {
  id: 'u',
  name: 'Dầu gội bồ kết',
  slug: 'dau-goi',
  description: 'Mô tả',
  shortDesc: 'Mô tả ngắn',
  basePrice: 120000,
  salePrice: null,
  images: [],
  approvalStatus: 'APPROVED',
  isActive: true,
  fulfilment: 'MERCHANT',
  pancakeLinkCode: null,
  linkState: null,
  variations: [{ id: 'vu', sku: 'u', name: 'Mặc định', retailPrice: 120000, salePrice: null, stock: 7 }],
  createdAt: '2026-10-01T03:00:00.000Z',
};
const inputById = (id: string) => document.getElementById(id) as HTMLInputElement;
const submitBtn = (label: RegExp) => byText(document.body, 'button', label) as HTMLButtonElement;
const aria = (b: HTMLElement) => ({ busy: b.getAttribute('aria-busy'), disabled: b.getAttribute('aria-disabled'), dom: (b as HTMLButtonElement).disabled });
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const mountWith = (ui: Parameters<typeof render>[0], client?: QueryClient) => {
  mounted = render(ui, client);
  return mounted;
};
const fillCreate = () => {
  typeInto(inputById('merchant-product-name'), 'Bột giặt');
  typeInto(document.getElementById('merchant-product-description'), 'Bột giặt sinh học');
  typeInto(inputById('merchant-product-price'), '120.000');
  typeInto(inputById('merchant-product-stock'), '5');
};
const editPrice = () => typeInto(inputById('merchant-edit-price'), '95.000');

describe('Đăng sản phẩm mới', () => {
  it('bấm Gửi kiểm duyệt hai lần cùng khung hình chỉ tạo một sản phẩm; nút aria-busy/aria-disabled, không disabled (giữ focus)', async () => {
    const g = gate();
    mocks.createProduct.mockReturnValue(g.promise);
    mountWith(<CreateProductModal onClose={() => undefined} onSuccess={() => undefined} />);
    fillCreate();
    const send = submitBtn(/Gửi kiểm duyệt/);
    send.focus();
    await tap(send, send);
    await flush(1);
    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    expect(aria(submitBtn(/Đang gửi/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(submitBtn(/Đang gửi/));
    await tap(submitBtn(/Đang gửi/));
    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    g.resolve();
    await flush();
  });

  it('bị từ chối (400 luật nhập liệu): lời lỗi hiện ngay, nhả khoá, gửi lại được', async () => {
    mocks.createProduct.mockRejectedValueOnce(new ApiError('Tên sản phẩm đã có.', 400));
    mountWith(<CreateProductModal onClose={() => undefined} onSuccess={() => undefined} />);
    fillCreate();
    await tap(submitBtn(/Gửi kiểm duyệt/));
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Tên sản phẩm đã có.');
    expect(aria(submitBtn(/Gửi kiểm duyệt/)).busy).toBeNull();
    await tap(submitBtn(/Gửi kiểm duyệt/));
    await flush();
    expect(mocks.createProduct).toHaveBeenCalledTimes(2);
  });
});

describe('Đăng sản phẩm mới: khoá đọc từ bộ nhớ đệm dùng chung (Wave 102B)', () => {
  it('hộp bị dựng lại lúc lệnh còn bay (ref khoá của hộp cũ mất): gửi lần hai bị chặn, nút báo bận; lệnh cũ xong thì gửi lại được', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const g = gate();
    mocks.createProduct.mockReturnValueOnce(g.promise);
    const ui = <CreateProductModal onClose={() => undefined} onSuccess={() => undefined} />;
    const r = mountWith(ui, client);
    fillCreate();
    await tap(submitBtn(/Gửi kiểm duyệt/));
    await flush(1);
    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    remount(r, ui, client);
    fillCreate();
    expect(aria(submitBtn(/Đang gửi/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    await tap(submitBtn(/Đang gửi/));
    await flush(1);
    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    await act(async () => g.resolve());
    await flush(4);
    expect(aria(submitBtn(/Gửi kiểm duyệt/)).busy).toBeNull();
    await tap(submitBtn(/Gửi kiểm duyệt/));
    await flush(1);
    expect(mocks.createProduct).toHaveBeenCalledTimes(2);
  });
});

describe('Sửa sản phẩm', () => {
  it('bấm Lưu thay đổi hai lần cùng khung hình chỉ gửi một lệnh; nút aria-busy/aria-disabled, không disabled', async () => {
    const g = gate();
    mocks.updateProduct.mockReturnValue(g.promise);
    mountWith(<EditProductModal product={PRODUCT} onClose={() => undefined} onSuccess={() => undefined} />);
    editPrice();
    const save = submitBtn(/Lưu thay đổi/);
    save.focus();
    await tap(save, save);
    await flush(1);
    expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
    expect(aria(submitBtn(/Đang gửi/))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    expect(document.activeElement).toBe(submitBtn(/Đang gửi/));
    g.resolve();
    await flush();
  });

  it.each([404, 409])('bị từ chối %i (sản phẩm đã đổi/không còn): lời lỗi hiện ngay, tải lại danh sách sản phẩm, khoá giữ tới khi tải xong', async (status) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const reload = gate();
    const spy = vi.spyOn(client, 'invalidateQueries').mockImplementation(() => reload.promise);
    mocks.updateProduct.mockRejectedValueOnce(new ApiError('Sản phẩm đã thay đổi.', status));
    mountWith(<EditProductModal product={PRODUCT} onClose={() => undefined} onSuccess={() => undefined} />, client);
    editPrice();
    await tap(submitBtn(/Lưu thay đổi/));
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Sản phẩm đã thay đổi.');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['merchant-products'] });
    await tap(submitBtn(/Lưu thay đổi|Đang gửi/));
    expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
    reload.resolve();
    await flush();
    expect(aria(submitBtn(/Lưu thay đổi/)).busy).toBeNull();
  });

  it('danh sách tải lại treo: nhả khoá sau 4 giây, không sớm hơn', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    vi.spyOn(client, 'invalidateQueries').mockImplementation(() => new Promise(() => {}));
    mocks.updateProduct.mockRejectedValueOnce(new ApiError('Sản phẩm đã thay đổi.', 409));
    mountWith(<EditProductModal product={PRODUCT} onClose={() => undefined} onSuccess={() => undefined} />, client);
    editPrice();
    await tap(submitBtn(/Lưu thay đổi/));
    await flush();
    await advance(3_500);
    expect(aria(submitBtn(/Lưu thay đổi|Đang gửi/)).busy).toBe('true');
    await advance(700);
    expect(aria(submitBtn(/Lưu thay đổi|Đang gửi/)).busy).toBeNull();
  });

  it('400 (giá/mã Pancake không hợp lệ) và 500: không tải lại danh sách, báo lỗi, nhả khoá', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    mocks.updateProduct.mockRejectedValueOnce(new ApiError('Mã Pancake không dùng được.', 400)).mockRejectedValueOnce(new ApiError('Lỗi máy chủ.', 500));
    mountWith(<EditProductModal product={PRODUCT} onClose={() => undefined} onSuccess={() => undefined} />, client);
    editPrice();
    await tap(submitBtn(/Lưu thay đổi/));
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Mã Pancake không dùng được.');
    expect(aria(submitBtn(/Lưu thay đổi/)).busy).toBeNull();
    await tap(submitBtn(/Lưu thay đổi/));
    await flush();
    expect(mocks.updateProduct).toHaveBeenCalledTimes(2);
    expect(spy).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { StrictMode, act, useState } from 'react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { MerchantProduct } from '@/lib/merchant-client';
import { CreateProductModal, EditProductModal } from './product-form';

// Wave 101B: hộp Đăng/Sửa sản phẩm đóng được lúc lệnh còn bay (X, Hủy, Esc) và mỗi lần mở là một form mới. Lệnh xong muộn của lần mở trước không được đóng
// hộp vừa mở lại và xoá chữ đang gõ, nhưng danh sách sản phẩm vẫn phải được tải lại vì sản phẩm đã được tạo/sửa thật.

const mocks = vi.hoisted(() => ({ updateProduct: vi.fn(), createProduct: vi.fn() }));
vi.mock('@/lib/merchant-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/merchant-client')>()),
  updateMerchantProduct: (id: string, dto: unknown) => mocks.updateProduct(id, dto),
  createMerchantProduct: (dto: unknown) => mocks.createProduct(dto),
}));

const PRODUCT: MerchantProduct = {
  id: 'u', name: 'Dầu gội bồ kết', slug: 'dau-goi', description: 'Mô tả', shortDesc: 'Mô tả ngắn', basePrice: 120000, salePrice: null, images: [],
  approvalStatus: 'APPROVED', isActive: true, fulfilment: 'MERCHANT', pancakeLinkCode: null, linkState: null,
  variations: [{ id: 'vu', sku: 'u', name: 'Mặc định', retailPrice: 120000, salePrice: null, stock: 7 }], createdAt: '2026-10-01T03:00:00.000Z',
};

let mounted: Rendered | null = null;
let client: QueryClient;
let invalidated: unknown[] = [];

/** Giống trang đối tác: mỗi lần mở dựng một form mới; `onSuccess` đóng hộp (nếu còn là hộp đã gửi) và tải lại danh sách. */
function Host() {
  const qc = useQueryClient();
  const [create, setCreate] = useState(false);
  const [editing, setEditing] = useState<MerchantProduct | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['merchant-products'] });
  return (
    <>
      <button type="button" data-open="create" onClick={() => setCreate(true)}>mở đăng</button>
      <button type="button" data-open="edit" onClick={() => setEditing(PRODUCT)}>mở sửa</button>
      {create && (
        <CreateProductModal
          onClose={() => setCreate(false)}
          onSuccess={(stillOpen?: boolean) => {
            if (stillOpen !== false) setCreate(false);
            refresh();
          }}
        />
      )}
      {editing && (
        <EditProductModal
          product={editing}
          onClose={() => setEditing(null)}
          onSuccess={(stillOpen?: boolean) => {
            if (stillOpen !== false) setEditing(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  invalidated = [];
  vi.spyOn(client, 'invalidateQueries').mockImplementation(((f: unknown) => {
    invalidated.push(f);
    return Promise.resolve();
  }) as never);
  mocks.updateProduct.mockReset().mockResolvedValue({});
  mocks.createProduct.mockReset().mockResolvedValue({});
  mounted = render(<Host />, client);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

const gate = () => {
  let release!: (v: unknown) => void;
  let fail!: (e: unknown) => void;
  const p = new Promise((res, rej) => {
    release = res;
    fail = rej;
  });
  return { p, release, fail };
};
const inputById = (id: string) => document.getElementById(id) as HTMLInputElement | null;
const open = async (which: 'create' | 'edit') => {
  await act(async () => document.querySelector<HTMLElement>(`[data-open="${which}"]`)!.click());
  await flush(2);
};
const tap = async (el: HTMLElement | null) => {
  await act(async () => el!.click());
  await flush(2);
};
const dialog = () => document.querySelector('[role="dialog"]');
const closeX = () => tap(document.querySelector('button[aria-label="Đóng"]'));
const send = (label: RegExp) => byText(document.body, 'button', label);
const fillCreate = () => {
  typeInto(inputById('merchant-product-name'), 'Bột giặt');
  typeInto(document.getElementById('merchant-product-description'), 'Bột giặt sinh học');
  typeInto(inputById('merchant-product-price'), '120.000');
  typeInto(inputById('merchant-product-stock'), '5');
};

describe('Đăng sản phẩm mới: đóng rồi mở lại lúc lệnh còn bay', () => {
  it('lệnh cũ xong muộn: hộp mới KHÔNG bị đóng, chữ đang gõ còn, danh sách vẫn được tải lại', async () => {
    const g = gate();
    mocks.createProduct.mockReturnValueOnce(g.p);
    await open('create');
    fillCreate();
    await tap(send(/Gửi kiểm duyệt/));
    expect(mocks.createProduct).toHaveBeenCalledTimes(1);
    await closeX();
    expect(dialog()).toBeNull();
    await open('create');
    typeInto(inputById('merchant-product-name'), 'Chữ đang gõ');
    await act(async () => g.release({}));
    await flush(4);
    expect(dialog()).not.toBeNull();
    expect(inputById('merchant-product-name')!.value).toBe('Chữ đang gõ');
    expect(invalidated).toHaveLength(1);
  });

  it('lệnh cũ bị từ chối muộn: hộp mới không hiện lời lỗi của lần trước', async () => {
    const g = gate();
    mocks.createProduct.mockReturnValueOnce(g.p);
    await open('create');
    fillCreate();
    await tap(send(/Gửi kiểm duyệt/));
    await closeX();
    await open('create');
    await act(async () => g.fail(new Error('Tên đã có')));
    await flush(4);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector('[role="alert"]')).toBeNull();
  });

  it('không đóng chen giữa: xong thì hộp đóng và danh sách được tải lại như trước', async () => {
    const g = gate();
    mocks.createProduct.mockReturnValueOnce(g.p);
    await open('create');
    fillCreate();
    await tap(send(/Gửi kiểm duyệt/));
    await act(async () => g.release({}));
    await flush(4);
    expect(dialog()).toBeNull();
    expect(invalidated).toHaveLength(1);
  });

  it('chạy trong StrictMode (effect mount chạy hai lần): đúng lần mở đã gửi thì hộp vẫn đóng', async () => {
    mounted?.unmount();
    mounted = render(
      <StrictMode>
        <Host />
      </StrictMode>,
      client,
    );
    const g = gate();
    mocks.createProduct.mockReturnValueOnce(g.p);
    await open('create');
    fillCreate();
    await tap(send(/Gửi kiểm duyệt/));
    await act(async () => g.release({}));
    await flush(4);
    expect(dialog()).toBeNull();
    expect(invalidated).toHaveLength(1);
  });

  it('đóng hộp lúc lệnh bay và không mở lại: xong thì hộp vẫn đóng và danh sách được tải lại', async () => {
    const g = gate();
    mocks.createProduct.mockReturnValueOnce(g.p);
    await open('create');
    fillCreate();
    await tap(send(/Gửi kiểm duyệt/));
    await closeX();
    await act(async () => g.release({}));
    await flush(4);
    expect(dialog()).toBeNull();
    expect(invalidated).toHaveLength(1);
  });
});

describe('Sửa sản phẩm: đóng rồi mở lại lúc lệnh còn bay', () => {
  const editPrice = (v: string) => typeInto(inputById('merchant-edit-price'), v);

  it('lệnh cũ xong muộn: hộp sửa mới KHÔNG bị đóng, giá đang gõ còn, danh sách vẫn được tải lại', async () => {
    const g = gate();
    mocks.updateProduct.mockReturnValueOnce(g.p);
    await open('edit');
    editPrice('95.000');
    await tap(send(/Lưu thay đổi/));
    expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
    await closeX();
    await open('edit');
    editPrice('99.000');
    await act(async () => g.release({}));
    await flush(4);
    expect(dialog()).not.toBeNull();
    expect(inputById('merchant-edit-price')!.value).toBe('99.000');
    expect(invalidated).toHaveLength(1);
  });

  it('không đóng chen giữa: xong thì hộp đóng và danh sách được tải lại như trước', async () => {
    const g = gate();
    mocks.updateProduct.mockReturnValueOnce(g.p);
    await open('edit');
    editPrice('95.000');
    await tap(send(/Lưu thay đổi/));
    await act(async () => g.release({}));
    await flush(4);
    expect(dialog()).toBeNull();
    expect(invalidated).toHaveLength(1);
  });
});

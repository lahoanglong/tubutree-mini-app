// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { MerchantProduct } from '@/lib/merchant-client';
import { CreateProductModal, EditProductModal, MerchantProductPrice } from './product-form';

const mocks = vi.hoisted(() => ({ updateProduct: vi.fn(), createProduct: vi.fn() }));
vi.mock('@/lib/merchant-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/merchant-client')>()),
  updateMerchantProduct: (id: string, dto: unknown) => mocks.updateProduct(id, dto),
  createMerchantProduct: (dto: unknown) => mocks.createProduct(dto),
}));

let mounted: Rendered[] = [];
beforeEach(() => {
  mocks.updateProduct.mockReset().mockResolvedValue({});
  mocks.createProduct.mockReset().mockResolvedValue({});
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});
const mount = (ui: Parameters<typeof render>[0]) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
const key = (k: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(e);
  });
  return e;
};

const PRODUCT = (extra: Partial<MerchantProduct> = {}): MerchantProduct => ({
  id: 'u',
  name: 'Dầu gội bồ kết',
  slug: 'dau-goi',
  description: 'Mô tả',
  shortDesc: 'Mô tả ngắn',
  basePrice: 120000,
  salePrice: null,
  images: [],
  approvalStatus: 'APPROVED',
  isActive: false,
  fulfilment: 'MERCHANT',
  pancakeLinkCode: 'PCK-OLD',
  linkState: 'AWAITING',
  variations: [{ id: 'vu', sku: 'u', name: 'Mặc định', retailPrice: 120000, salePrice: 90000, stock: 7 }],
  createdAt: '2026-10-01T03:00:00.000Z',
  ...extra,
});
const inputById = (id: string) => document.getElementById(id) as HTMLInputElement;
const radioOf = (label: string) => byText(document.body, 'label', label)!.querySelector<HTMLInputElement>('input[type="radio"]')!;
const save = async () => {
  click(byText(document.body, 'button', 'Lưu thay đổi'));
  await flush();
};

describe('WEB-1: chuyển sang tự giao gửi cả giá bán và salePrice null', () => {
  it('chưa sửa giá: vẫn gửi basePrice hiện tại và salePrice null, không để server giữ khuyến mãi Pancake cũ', async () => {
    mount(<EditProductModal product={PRODUCT({ salePrice: 90000 })} onClose={() => undefined} onSuccess={() => undefined} />);
    click(radioOf('Chuyển sang gian hàng tự giao'));
    await save();
    expect(mocks.updateProduct).toHaveBeenCalledWith('u', { pancakeCode: null, basePrice: 120000, salePrice: null });
  });

  it('gõ giá mới thấp hơn khuyến mãi cũ: gửi giá mới kèm salePrice null (server không còn so với khuyến mãi cũ)', async () => {
    mount(<EditProductModal product={PRODUCT({ salePrice: 90000 })} onClose={() => undefined} onSuccess={() => undefined} />);
    click(radioOf('Chuyển sang gian hàng tự giao'));
    typeInto(inputById('merchant-edit-price'), '80000');
    typeInto(inputById('merchant-edit-stock'), '12');
    await save();
    expect(mocks.updateProduct).toHaveBeenCalledWith('u', { pancakeCode: null, basePrice: 80000, salePrice: null, stock: 12 });
  });

  it('nhãn/gợi ý ô giá nói rõ đây là giá khách trả sau khi tự giao và khuyến mãi Pancake cũ sẽ bỏ; chỉ hiện ở chế độ tự giao', () => {
    mount(<EditProductModal product={PRODUCT({ salePrice: 90000 })} onClose={() => undefined} onSuccess={() => undefined} />);
    expect(document.getElementById('merchant-edit-price-hint')).toBeNull();
    click(radioOf('Chuyển sang gian hàng tự giao'));
    const hint = document.getElementById('merchant-edit-price-hint')!;
    expect(hint.textContent).toContain('khách trả đúng giá này');
    expect(hint.textContent).toContain('Giá khuyến mãi lấy từ Pancake (90.000đ) sẽ được bỏ');
    expect(inputById('merchant-edit-price').getAttribute('aria-describedby')).toBe('merchant-edit-price-hint');
  });

  it('không có khuyến mãi cũ thì gợi ý không nhắc khuyến mãi', () => {
    mount(<EditProductModal product={PRODUCT()} onClose={() => undefined} onSuccess={() => undefined} />);
    click(radioOf('Chuyển sang gian hàng tự giao'));
    expect(document.getElementById('merchant-edit-price-hint')!.textContent).not.toContain('khuyến mãi');
  });

  it('sản phẩm tự giao bình thường (không có mã) sửa giá vẫn chỉ gửi basePrice, không động tới salePrice', async () => {
    mount(
      <EditProductModal
        product={PRODUCT({ pancakeLinkCode: null, linkState: null, isActive: true })}
        onClose={() => undefined}
        onSuccess={() => undefined}
      />,
    );
    typeInto(inputById('merchant-edit-price'), '110000');
    await save();
    expect(mocks.updateProduct).toHaveBeenCalledWith('u', { basePrice: 110000 });
  });

  it('chọn lại "Giữ mã hiện tại" sau khi đổi ý thì không gửi giá hay salePrice', async () => {
    const onClose = vi.fn();
    mount(<EditProductModal product={PRODUCT({ salePrice: 90000 })} onClose={onClose} onSuccess={() => undefined} />);
    click(radioOf('Chuyển sang gian hàng tự giao'));
    click(radioOf('Giữ mã hiện tại'));
    await save();
    expect(mocks.updateProduct).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('WEB-1: MerchantProductPrice hiện giá khách thực trả', () => {
  const show = (p: Pick<MerchantProduct, 'basePrice' | 'salePrice'>) => {
    const r = mount(
      <div>
        <MerchantProductPrice product={p} />
      </div>,
    );
    return r.container;
  };

  it('có khuyến mãi: hiện giá khuyến mãi, kèm giá gốc gạch ngang', () => {
    const c = show({ basePrice: 120000, salePrice: 90000 });
    expect(c.firstElementChild!.firstChild!.textContent).toBe('90.000đ');
    expect(c.querySelector('del')!.textContent).toBe('120.000đ');
    expect(c.textContent).toContain('Giá gốc');
  });

  it('không khuyến mãi (null/undefined): chỉ hiện giá gốc, không gạch ngang', () => {
    expect(show({ basePrice: 120000, salePrice: null }).textContent).toBe('120.000đ');
    expect(show({ basePrice: 120000 }).querySelector('del')).toBeNull();
  });

  it('khuyến mãi không thấp hơn giá gốc (dữ liệu lạ): vẫn là giá khách trả, không gạch giá gốc', () => {
    const c = show({ basePrice: 100000, salePrice: 100000 });
    expect(c.textContent).toBe('100.000đ');
    expect(c.querySelector('del')).toBeNull();
  });
});

describe('WEB-12: hộp thoại form đối tác', () => {
  it('mở: focus vào hộp và khóa cuộn nền; Esc đóng, trả focus về nút đã mở và mở lại cuộn nền', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const r = mount(<EditProductModal product={PRODUCT()} onClose={onClose} onSuccess={() => undefined} />);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    expect(document.body.style.overflow).toBe('hidden');
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    r.unmount();
    mounted = [];
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });

  it('lớp nền chừa inset trái/phải của tai thỏ, không nhỏ hơn lề 1rem sẵn có', () => {
    mount(<CreateProductModal onClose={() => undefined} onSuccess={() => undefined} />);
    const backdrop = document.querySelector<HTMLElement>('[role="dialog"]')!.parentElement!;
    expect(backdrop.style.paddingLeft).toBe('max(1rem, env(safe-area-inset-left, 0px))');
    expect(backdrop.style.paddingRight).toBe('max(1rem, env(safe-area-inset-right, 0px))');
  });

  it('Esc giống nút Hủy/Đóng: đóng hộp mà không gửi gì (form không có cơ chế giữ bản nháp)', async () => {
    const onClose = vi.fn();
    mount(<CreateProductModal onClose={onClose} onSuccess={() => undefined} />);
    typeInto(inputById('merchant-product-name'), 'Bột giặt');
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.createProduct).not.toHaveBeenCalled();
  });

  it('Tab quay vòng trong hộp: từ nút cuối về ô đầu, Shift+Tab từ hộp xuống nút cuối', () => {
    mount(<CreateProductModal onClose={() => undefined} onSuccess={() => undefined} />);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const all = Array.from(dialog.querySelectorAll<HTMLElement>('button,input,textarea,select')).filter((e) => !(e as HTMLButtonElement).disabled);
    const first = all[0]!;
    const last = all[all.length - 1]!;
    expect(first).toBe(dialog.querySelector('button[aria-label="Đóng"]'));
    expect(last.textContent).toBe('Gửi kiểm duyệt');
    last.focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    dialog.focus();
    expect(key('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('Esc lúc đang gõ tiếng Việt (IME) không đóng hộp', () => {
    const onClose = vi.fn();
    mount(<CreateProductModal onClose={onClose} onSuccess={() => undefined} />);
    key('Escape', { isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });
});

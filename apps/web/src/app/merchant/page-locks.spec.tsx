// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MerchantPage from './page';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';

// Wave 96B: cổng người bán, tab "Đơn qua gian hàng" (quản trị chuyển trạng thái) và "Sản phẩm" (Ngừng bán/Mở bán lại/Gỡ khỏi shop): một việc mỗi lúc, giữ khoá
// tới khi danh sách làm mới về (tối đa 4 giây), bị từ chối vì trạng thái đã đổi (400/404/409) thì tải lại, lời lỗi đứng ở cấp cha.

const mocks = vi.hoisted(() => ({
  auth: { user: { role: 'ADMIN' } as { role: string } | null, status: 'authenticated', initialized: true },
  store: null as unknown,
  getProducts: vi.fn(),
  removeResell: vi.fn(),
  listOrders: vi.fn(),
  setOrderStatus: vi.fn(),
  updateProduct: vi.fn(),
  stopSelling: vi.fn(),
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/merchant-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/merchant-client')>()),
  getMerchantStore: async () => mocks.store,
  getMerchantProducts: (page: number) => mocks.getProducts(page),
  removeResellProduct: (id: string) => mocks.removeResell(id),
  countMerchantOrders: async () => 3,
  listMerchantOrders: (status: string | undefined, page: number) => mocks.listOrders(status, page),
  updateMerchantOrderStatus: (id: string, status: string) => mocks.setOrderStatus(id, status),
  listMerchantReturns: async () => [],
  updateMerchantProduct: (id: string, dto: unknown) => mocks.updateProduct(id, dto),
  stopSellingMerchantProduct: (id: string) => mocks.stopSelling(id),
}));

const STORE = {
  id: 's1', type: 'MERCHANT', slug: 'minh-an', subdomain: 'minhan', title: 'Minh An', headerNote: '', avatarUrl: null, coverUrl: null, theme: 'default', themeColor: null,
  bankName: null, bankBin: null, bankAccountNo: null, bankAccountName: null, warehouseAddress: null, warehouseCity: null, warehouseDistrict: null, warehouseWard: null,
  warehousePhone: null, shippingFee: null, freeShipFrom: null, isPublished: true, isPartner: true,
};
const PRODUCT = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `SP ${id}`, slug: `sp-${id}`, description: 'Mô tả', shortDesc: 'Mô tả ngắn', basePrice: 120000, images: [], approvalStatus: 'APPROVED',
  variations: [{ id: `v${id}`, sku: id, name: 'Mặc định', retailPrice: 120000, stock: 7 }], createdAt: '2026-10-01T03:00:00.000Z', ...extra,
});
const ORDER = (id: string, status: string) => ({
  id, code: `TT${id}`, status, total: 250000, createdAt: '2026-10-01T03:00:00.000Z', user: { fullName: 'Lan Anh', phone: '0900000001' },
  shippingAddress: { recipient: 'Lan', phone: '0900000002', street: '1 Lê Lợi', ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM' },
  items: [{ id: `i${id}`, productName: 'Dầu gội', variationName: '500ml', quantity: 2, unitPrice: 125000 }],
});

const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let ui: Rendered | undefined;
const mount = async () => {
  ui = render(<MerchantPage />);
  await flush();
  return ui.container;
};
const openTab = async (label: string) => {
  click(byText(ui!.container, '[role="tab"]', label));
  await flush();
};
const btn = (root: ParentNode, text: string | RegExp) => byText(root, 'button', text) as HTMLButtonElement;
const row = (root: ParentNode, text: string) => Array.from(root.querySelectorAll('tbody tr')).find((r) => r.textContent?.includes(text))!;
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const aria = (b: HTMLElement) => ({ busy: b.getAttribute('aria-busy'), disabled: b.getAttribute('aria-disabled'), dom: (b as HTMLButtonElement).disabled });
const menuItems = (r: Element) => {
  const trigger = r.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  if (trigger.getAttribute('aria-expanded') !== 'true') click(trigger);
  return Array.from(document.getElementById(trigger.getAttribute('aria-controls')!)!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
};

beforeEach(() => {
  mocks.auth = { user: { role: 'ADMIN' }, status: 'authenticated', initialized: true };
  mocks.store = { ...STORE };
  mocks.getProducts = vi.fn(async () => ({
    ownProducts: [PRODUCT('a'), PRODUCT('b', { isActive: false })],
    resellProducts: [PRODUCT('r1')],
    meta: { page: 1, limit: 20, ownTotal: 2, resellTotal: 1 },
  }));
  mocks.removeResell = vi.fn(async () => ({}));
  mocks.listOrders = vi.fn(async () => ({ data: [ORDER('1', 'CONFIRMED'), ORDER('2', 'PACKED')], meta: { page: 1, limit: 20, total: 2 } }));
  mocks.setOrderStatus = vi.fn(async () => ({}));
  mocks.updateProduct = vi.fn(async () => ({}));
  mocks.stopSelling = vi.fn(async () => ({}));
});
afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
  vi.restoreAllMocks();
  ui?.unmount();
  ui = undefined;
});

describe('Đơn qua gian hàng (quản trị): Đã đóng gói / Bắt đầu giao / Đã giao', () => {
  it('chạm đúp "Đã đóng gói" cùng một khung hình chỉ gửi một lệnh; các nút khác trong bảng aria-disabled, không disabled', async () => {
    const g = gate();
    mocks.setOrderStatus = vi.fn(async () => {
      await g.promise;
      return {};
    });
    const c = await mount();
    await openTab('Đơn qua gian hàng');
    const pack = btn(row(c, 'TT1'), 'Đã đóng gói');
    pack.focus();
    await tap(pack, pack);
    await flush(1);
    expect(mocks.setOrderStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setOrderStatus).toHaveBeenCalledWith('1', 'PACKED');
    expect(aria(btn(row(c, 'TT1'), 'Đã đóng gói'))).toEqual({ busy: 'true', disabled: 'true', dom: false });
    const ship = btn(row(c, 'TT2'), 'Bắt đầu giao');
    expect(aria(ship)).toEqual({ busy: null, disabled: 'true', dom: false });
    click(ship);
    await flush(1);
    expect(mocks.setOrderStatus).toHaveBeenCalledTimes(1);
    g.resolve();
    await flush();
  });

  it('chuyển xong mà danh sách chưa làm mới: nút vẫn bận, chạm tiếp không gửi lệnh thứ hai; danh sách về thì nhả', async () => {
    const list = gate();
    let loads = 0;
    mocks.listOrders = vi.fn(async () => {
      if (++loads > 1) await list.promise;
      return { data: [ORDER('1', 'CONFIRMED'), ORDER('2', 'PACKED')], meta: { page: 1, limit: 20, total: 2 } };
    });
    const c = await mount();
    await openTab('Đơn qua gian hàng');
    click(btn(row(c, 'TT1'), 'Đã đóng gói'));
    await flush();
    expect(mocks.listOrders).toHaveBeenCalledTimes(2);
    click(btn(row(c, 'TT1'), 'Đã đóng gói'));
    await flush(2);
    expect(mocks.setOrderStatus).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
    expect(aria(btn(row(c, 'TT1'), 'Đã đóng gói')).disabled).toBeNull();
  });

  it('danh sách không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    let loads = 0;
    mocks.listOrders = vi.fn(() => (++loads > 1 ? new Promise(() => {}) : Promise.resolve({ data: [ORDER('1', 'CONFIRMED')], meta: { page: 1, limit: 20, total: 1 } })));
    const c = await mount();
    await openTab('Đơn qua gian hàng');
    click(btn(row(c, 'TT1'), 'Đã đóng gói'));
    await advance(3_500);
    expect(aria(btn(row(c, 'TT1'), 'Đã đóng gói')).disabled).toBe('true');
    await advance(700);
    expect(aria(btn(row(c, 'TT1'), 'Đã đóng gói')).disabled).toBeNull();
  });

  it.each([400, 404, 409])('máy chủ từ chối vì đơn đã đổi trạng thái (%i): lời lỗi hiện NGAY, tải lại danh sách, giữ khoá tới khi về', async (status) => {
    const list = gate();
    let loads = 0;
    mocks.listOrders = vi.fn(async () => {
      if (++loads > 1) await list.promise;
      return { data: [ORDER('1', 'CONFIRMED')], meta: { page: 1, limit: 20, total: 1 } };
    });
    mocks.setOrderStatus = vi.fn(async () => {
      throw new HttpError(status, 'Đơn không còn ở trạng thái này.');
    });
    const c = await mount();
    await openTab('Đơn qua gian hàng');
    click(btn(row(c, 'TT1'), 'Đã đóng gói'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Đơn không còn ở trạng thái này.');
    expect(mocks.listOrders).toHaveBeenCalledTimes(2);
    click(btn(row(c, 'TT1'), 'Đã đóng gói'));
    await flush(2);
    expect(mocks.setOrderStatus).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
    expect(aria(btn(row(c, 'TT1'), 'Đã đóng gói')).disabled).toBeNull();
  });

  it('lỗi 500: lời lỗi hiện, KHÔNG tải lại danh sách, nhả khoá ngay để thử lại', async () => {
    mocks.setOrderStatus = vi.fn(async () => {
      throw new HttpError(500, 'Máy chủ đang bận');
    });
    const c = await mount();
    await openTab('Đơn qua gian hàng');
    click(btn(row(c, 'TT1'), 'Đã đóng gói'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Máy chủ đang bận');
    expect(mocks.listOrders).toHaveBeenCalledTimes(1);
    click(btn(row(c, 'TT1'), 'Đã đóng gói'));
    await flush();
    expect(mocks.setOrderStatus).toHaveBeenCalledTimes(2);
  });
});

describe('Sản phẩm: Ngừng bán / Mở bán lại / Gỡ khỏi shop', () => {
  it('mở bán lại xong mà danh sách chưa về: chọn tiếp không gửi lệnh thứ hai; về rồi mới nhả', async () => {
    const list = gate();
    let hold = false;
    mocks.getProducts = vi.fn(async () => {
      if (hold) await list.promise;
      return { ownProducts: [PRODUCT('a'), PRODUCT('b', { isActive: false })], resellProducts: [PRODUCT('r1')], meta: { page: 1, limit: 20, ownTotal: 2, resellTotal: 1 } };
    });
    const c = await mount();
    await openTab('Sản phẩm');
    hold = true;
    const before = mocks.getProducts.mock.calls.length;
    click(menuItems(row(c, 'SP b')).find((b) => b.textContent === 'Mở bán lại')!);
    await flush();
    expect(mocks.getProducts).toHaveBeenCalledTimes(before + 1);
    const again = menuItems(row(c, 'SP b')).find((b) => b.textContent === 'Mở bán lại')!;
    expect(again.disabled).toBe(true);
    click(again);
    await flush(2);
    expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
  });

  it('Ngừng bán bị từ chối 404 (sản phẩm đã bị gỡ): lời lỗi hiện NGAY ở đầu tab, tải lại danh sách, nhả khoá khi danh sách về', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const list = gate();
    let hold = false;
    mocks.getProducts = vi.fn(async () => {
      if (hold) await list.promise;
      return { ownProducts: [PRODUCT('a')], resellProducts: [PRODUCT('r1')], meta: { page: 1, limit: 20, ownTotal: 1, resellTotal: 1 } };
    });
    mocks.stopSelling = vi.fn(async () => {
      throw new HttpError(404, 'Không tìm thấy sản phẩm.');
    });
    const c = await mount();
    await openTab('Sản phẩm');
    hold = true;
    const before = mocks.getProducts.mock.calls.length;
    click(menuItems(row(c, 'SP a')).find((b) => b.textContent === 'Ngừng bán')!);
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Không tìm thấy sản phẩm.');
    expect(mocks.getProducts).toHaveBeenCalledTimes(before + 1);
    click(menuItems(row(c, 'SP a')).find((b) => b.textContent === 'Ngừng bán')!);
    await flush(2);
    expect(mocks.stopSelling).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
  });

  it('Gỡ khỏi shop: xong mà danh sách chưa về thì chọn tiếp bị chặn (mục menu disabled), không gửi lệnh thứ hai', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const list = gate();
    let hold = false;
    mocks.getProducts = vi.fn(async () => {
      if (hold) await list.promise;
      return { ownProducts: [PRODUCT('a')], resellProducts: [PRODUCT('r1')], meta: { page: 1, limit: 20, ownTotal: 1, resellTotal: 1 } };
    });
    const c = await mount();
    await openTab('Sản phẩm');
    click(byText(c, 'button', /Sản phẩm Tubu Tree bán lại/));
    await flush();
    hold = true;
    const before = mocks.getProducts.mock.calls.length;
    const remove = menuItems(row(c, 'SP r1')).find((b) => b.textContent?.includes('Gỡ khỏi shop'))!;
    click(remove);
    await flush();
    expect(mocks.removeResell).toHaveBeenCalledTimes(1);
    expect(mocks.getProducts).toHaveBeenCalledTimes(before + 1);
    const again = menuItems(row(c, 'SP r1')).find((b) => b.textContent?.includes('Đang gỡ'))!;
    expect(again.disabled).toBe(true);
    click(again);
    await flush(2);
    expect(mocks.removeResell).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
  });

  it('Gỡ khỏi shop bị từ chối 404 (sản phẩm bán lại đã bị gỡ): lời lỗi hiện NGAY ở đầu tab, tải lại danh sách, nhả khoá khi danh sách về', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const list = gate();
    let hold = false;
    mocks.getProducts = vi.fn(async () => {
      if (hold) await list.promise;
      return { ownProducts: [PRODUCT('a')], resellProducts: [PRODUCT('r1')], meta: { page: 1, limit: 20, ownTotal: 1, resellTotal: 1 } };
    });
    mocks.removeResell = vi.fn(async () => {
      throw new HttpError(404, 'Sản phẩm này không còn trong shop.');
    });
    const c = await mount();
    await openTab('Sản phẩm');
    click(byText(c, 'button', /Sản phẩm Tubu Tree bán lại/));
    await flush();
    hold = true;
    const before = mocks.getProducts.mock.calls.length;
    click(menuItems(row(c, 'SP r1')).find((b) => b.textContent?.includes('Gỡ khỏi shop'))!);
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Sản phẩm này không còn trong shop.');
    expect(mocks.getProducts).toHaveBeenCalledTimes(before + 1);
    click(menuItems(row(c, 'SP r1')).find((b) => b.disabled || /Gỡ khỏi shop|Đang gỡ/.test(b.textContent ?? ''))!);
    await flush(2);
    expect(mocks.removeResell).toHaveBeenCalledTimes(1);
    list.resolve();
    await flush();
  });
});

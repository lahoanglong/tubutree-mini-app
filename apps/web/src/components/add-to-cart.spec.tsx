// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// BUYERWEB-15: khách bấm "Thêm vào giỏ" khi chưa đăng nhập phải quay lại đúng sản phẩm và món đó được thêm nốt.
// BUYERWEB-9: tồn kho trong HTML là bản ISR cũ; trang hỏi lại tồn kho thật.

const mocks = vi.hoisted(() => ({
  auth: { status: 'idle' as string, initialized: true, user: null as unknown },
  push: vi.fn(),
  addToCart: vi.fn(),
  getProductStock: vi.fn(),
  getActiveFlashSales: vi.fn(),
  getCart: vi.fn(),
  sheetProps: null as null | { onConfirm: (v: { id: string }, qty: number) => void },
}));
// Bọc bảng thật để lấy được onConfirm: hai lần gọi liền nhau chưa kịp render lại, chỉ khoá `confirming` chặn được lần hai.
vi.mock('./variation-sheet', async (importOriginal) => {
  const real = await importOriginal<typeof import('./variation-sheet')>();
  return {
    ...real,
    VariationSheet: (props: Parameters<typeof real.VariationSheet>[0]) => {
      mocks.sheetProps = props;
      return real.VariationSheet(props);
    },
  };
});
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  addToCart: mocks.addToCart,
  getProductStock: mocks.getProductStock,
  getActiveFlashSales: mocks.getActiveFlashSales,
  getCart: mocks.getCart,
}));

import AddToCart from './add-to-cart';
import { reconcileSelection, recallCheckoutSelection } from '@/lib/checkout-selection';
import { resetFlashSales } from '@/lib/use-flash-sales';

const VARIATIONS = [
  { id: 'v1', name: '250ml', retailPrice: 200000, salePrice: 150000, stock: 5 },
  { id: 'v2', name: '500ml', retailPrice: 300000, salePrice: null, stock: 9 },
];
const CART = { items: [], itemCount: 2 };

let mounted: Rendered[] = [];
const mount = (variations = VARIATIONS) => {
  const r = render(<AddToCart slug="dau-goi" variations={variations} />);
  mounted.push(r);
  return r;
};
const addButton = (c: HTMLElement) => byText(c, 'button', /Thêm vào giỏ|Hết hàng|Đang thêm/) as HTMLButtonElement;

beforeEach(() => {
  sessionStorage.clear();
  mocks.auth = { status: 'idle', initialized: true, user: null };
  mocks.push.mockReset();
  mocks.addToCart.mockReset().mockResolvedValue(CART);
  mocks.getProductStock.mockReset().mockResolvedValue({ v1: 5, v2: 9 });
  resetFlashSales();
  mocks.getActiveFlashSales.mockReset().mockResolvedValue([]);
  mocks.getCart.mockReset().mockResolvedValue({ items: [], itemCount: 3 });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('AddToCart — khách chưa đăng nhập', () => {
  it('chuyển sang đăng nhập kèm returnTo về đúng trang sản phẩm và nhớ phân loại + số lượng đã chọn', async () => {
    const { container } = mount();
    await flush();
    click(byText(container, 'button', '500ml'));
    click(container.querySelector('button[aria-label="Tăng số lượng"]'));
    click(container.querySelector('button[aria-label="Tăng số lượng"]'));
    click(addButton(container));
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi');
    expect(JSON.parse(sessionStorage.getItem('tubu_pending_add')!)).toMatchObject({ variationId: 'v2', quantity: 3 });
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('đang khôi phục phiên (initialized=false): nút tạm khoá, không đẩy khách đang đăng nhập sang trang đăng nhập', async () => {
    mocks.auth = { status: 'idle', initialized: false, user: null };
    const { container } = mount();
    await flush();
    expect(addButton(container).disabled).toBe(true);
    click(addButton(container));
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe('AddToCart — quay lại sau đăng nhập', () => {
  it('thêm nốt món đã chọn trước khi đăng nhập và báo "Đã thêm vào giỏ!"', async () => {
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'v2', quantity: 3, at: Date.now() }));
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 3);
    expect(container.textContent).toContain('Đã thêm vào giỏ!');
    expect(sessionStorage.getItem('tubu_pending_add')).toBeNull();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('không có món chờ thì không tự thêm gì', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mount();
    await flush();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('món chờ của sản phẩm khác không bị thêm nhầm vào trang này', async () => {
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'khac', quantity: 1, at: Date.now() }));
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mount();
    await flush();
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('tubu_pending_add')).not.toBeNull();
  });

  it('API từ chối (hết hàng) thì hiện lời nhắn của API thay vì im lặng', async () => {
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'v1', quantity: 2, at: Date.now() }));
    mocks.addToCart.mockRejectedValue(new Error('Chỉ còn 0 sản phẩm trong kho.'));
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Chỉ còn 0 sản phẩm trong kho.');
  });
});

describe('AddToCart — tồn kho thật thay cho bản ISR', () => {
  it('ISR báo còn hàng nhưng tồn thật = 0: nút "Hết hàng" và không cho thêm', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mocks.getProductStock.mockResolvedValue({ v1: 0 });
    const { container } = mount([VARIATIONS[0]!]);
    await flush();
    expect(addButton(container).textContent).toBe('Hết hàng');
    expect(addButton(container).disabled).toBe(true);
  });

  it('ISR báo hết nhưng vừa nhập kho: cho mua lại', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mocks.getProductStock.mockResolvedValue({ v1: 4 });
    const { container } = mount([{ ...VARIATIONS[0]!, stock: 0 }]);
    await flush();
    expect(addButton(container).disabled).toBe(false);
    expect(container.textContent).toContain('Chỉ còn 4 sản phẩm');
  });

  it('phân loại mặc định hết thật mà phân loại khác còn: tự chọn phân loại còn hàng', async () => {
    mocks.getProductStock.mockResolvedValue({ v1: 0, v2: 9 });
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('B-141: bản ISR báo phân loại rẻ nhất hết, tồn thật báo có lại: chọn lại phân loại rẻ nhất, giá khớp thẻ', async () => {
    mocks.getProductStock.mockResolvedValue({ v1: 6, v2: 9 });
    const { container } = mount([{ ...VARIATIONS[0]!, stock: 0 }, VARIATIONS[1]!]);
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 150.000đ');
  });

  it('B-141: khách đã tự chọn thì tồn kho về không đổi lại', async () => {
    mocks.getProductStock.mockImplementation(() => new Promise((r) => setTimeout(() => r({ v1: 6, v2: 9 }), 0)));
    const { container } = mount([{ ...VARIATIONS[0]!, stock: 0 }, VARIATIONS[1]!]);
    click(byText(container, 'button', '500ml'));
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('B-145: bấm Thêm vào giỏ là đã chọn, tồn kho về muộn không đổi phân loại sau đó', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    let release: (v: Record<string, number>) => void = () => undefined;
    mocks.getProductStock.mockImplementation(() => new Promise((r) => { release = r; }));
    const { container } = mount([{ ...VARIATIONS[0]!, stock: 0 }, VARIATIONS[1]!]);
    await flush();
    click(addButton(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 1);
    release({ v1: 6, v2: 9 });
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('khách đã tự chọn phân loại thì không bị đổi ngầm', async () => {
    mocks.getProductStock.mockImplementation(() => new Promise((r) => setTimeout(() => r({ v1: 0, v2: 9 }), 0)));
    const { container } = mount();
    click(byText(container, 'button', '250ml'));
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
  });

  it('số lượng không vượt tồn thật', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mocks.getProductStock.mockResolvedValue({ v1: 2, v2: 9 });
    const { container } = mount();
    await flush();
    for (let i = 0; i < 5; i++) click(container.querySelector('button[aria-label="Tăng số lượng"]'));
    click(addButton(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 2);
  });

  it('không lấy được tồn thật (API lỗi): vẫn dùng bản ISR, không vỡ trang', async () => {
    mocks.getProductStock.mockRejectedValue(new Error('x'));
    const { container } = mount();
    await flush();
    expect(addButton(container).disabled).toBe(false);
  });
});

describe('AddToCart — gian hàng chưa nhận đơn (R3-MERCHANT-3)', () => {
  const mountBlocked = () => {
    const r = render(<AddToCart slug="dau-goi" variations={VARIATIONS} blockedReason="Gốm Minh An đang tạm nghỉ, chưa nhận đơn." />);
    mounted.push(r);
    return r;
  };

  it('nút mua tắt và nói thẳng lý do, bấm cũng không gọi API thêm giỏ', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mountBlocked();
    await flush();
    const btn = byText(container, 'button', 'Tạm thời chưa mua được') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(container.textContent).not.toContain('Thêm vào giỏ');
    click(btn);
    await flush();
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe('AddToCart — giá Giờ vàng khớp giỏ và đơn (R4-BUYER-4)', () => {
  const FLASH_V2 = {
    itemId: 'f2', variationId: 'v2', productSlug: 'dau-goi', flashPrice: 200000, retailPrice: 300000,
    salePrice: null, soldCount: 1, quota: 10, endAt: '2099-10-14T16:00:00.000Z',
  };

  const openedFrom = (search: string) => window.history.replaceState(null, '', `/san-pham/dau-goi${search}`);
  afterEach(() => openedFrom(''));

  it('phân loại có đợt Giờ vàng: nhãn trên nút chọn, giá Giờ vàng ở nút thêm vào giỏ, ghi giá gốc và hạn', async () => {
    openedFrom('?v=v2');
    mocks.getActiveFlashSales.mockResolvedValue([FLASH_V2]);
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    const chip = byText(container, 'button', /500ml/) as HTMLButtonElement;
    expect(chip.textContent).toContain('200.000đ');
    expect(chip.textContent).toContain('Giờ vàng');
    expect((byText(container, 'button', /250ml/) as HTMLButtonElement).textContent).not.toContain('Giờ vàng');
    expect(container.querySelector('[data-testid="flash-price-note"]')!.textContent).toBe(
      'Giá Giờ vàng 200.000đ, giá gốc 300.000đ · đến 23:00 14/10/2099',
    );
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 200.000đ');
  });

  it('vào từ thẻ hay dải Giờ vàng (?v=): mở đúng phân loại đang giảm giá thay vì phân loại mặc định', async () => {
    openedFrom('?v=v2');
    mocks.getActiveFlashSales.mockResolvedValue([FLASH_V2]);
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('vào từ nơi khác: giữ phân loại mặc định dù sản phẩm có Giờ vàng ở phân loại khác', async () => {
    mocks.getActiveFlashSales.mockResolvedValue([FLASH_V2]);
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
  });

  it('vào không kèm ?v= (gợi ý tìm, bài cộng đồng, Đã xem gần đây) mà Giờ vàng ở phân loại khác rẻ hơn giá thẻ: mở phân loại đó, giá bằng giá thẻ', async () => {
    mocks.getActiveFlashSales.mockResolvedValue([{ ...FLASH_V2, flashPrice: 100000 }]);
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 100.000đ');
  });

  it.each([
    ['500ml trước', [{ ...FLASH_V2, flashPrice: 250000, itemId: 'a' }, { ...FLASH_V2, variationId: 'v1', flashPrice: 120000, retailPrice: 200000, salePrice: 150000, itemId: 'b' }]],
    ['250ml trước', [{ ...FLASH_V2, variationId: 'v1', flashPrice: 120000, retailPrice: 200000, salePrice: 150000, itemId: 'b' }, { ...FLASH_V2, flashPrice: 250000, itemId: 'a' }]],
  ])('hai suất, suất 500ml 250.000đ đắt hơn thẻ: mở 250ml theo suất 120.000đ, %s', async (_n, items) => {
    mocks.getActiveFlashSales.mockResolvedValue(items);
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 120.000đ');
  });

  it('?v= của suất Giờ vàng đã hết: về phân loại mặc định', async () => {
    openedFrom('?v=v2');
    mocks.getActiveFlashSales.mockResolvedValue([]);
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
  });

  it('B-140: ?pv= (món gian hàng CTV ghim) mở đúng phân loại ghim dù không có Giờ vàng', async () => {
    openedFrom('?pv=v2');
    mocks.getActiveFlashSales.mockResolvedValue([]);
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('?v= còn Giờ vàng thắng suất khác rẻ hơn ở phân loại khác', async () => {
    openedFrom('?v=v2');
    mocks.getActiveFlashSales.mockResolvedValue([FLASH_V2, { ...FLASH_V2, variationId: 'v1', flashPrice: 120000, retailPrice: 200000, salePrice: 150000, itemId: 'b' }]);
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('?v= trỏ tới phân loại hết hàng hoặc không có: giữ phân loại mặc định', async () => {
    openedFrom('?v=v2');
    mocks.getProductStock.mockResolvedValue({ v1: 5, v2: 0 });
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
    openedFrom('?v=khong-co');
    const other = mount();
    await flush();
    expect(other.container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
  });

  it('khách đã tự chọn phân loại thì đợt Giờ vàng về sau không đổi ngầm lựa chọn', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.getActiveFlashSales.mockImplementation(() => new Promise((r) => (release = r)));
    const { container } = mount();
    await flush();
    click(byText(container, 'button', /250ml/));
    release([FLASH_V2]);
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
  });

  it('phân loại đang giảm hết hàng: không tự chuyển sang nó', async () => {
    mocks.getActiveFlashSales.mockResolvedValue([FLASH_V2]);
    mocks.getProductStock.mockResolvedValue({ v1: 5, v2: 0 });
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
  });

  it('không có đợt nào hoặc API đợt lỗi: giá thường, không nhãn', async () => {
    mocks.getActiveFlashSales.mockRejectedValue(new Error('x'));
    const { container } = mount();
    await flush();
    expect(container.textContent).not.toContain('Giờ vàng');
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 150.000đ');
  });
});

// D5-04: "Mua ngay" + thanh CTA dính đáy trên điện thoại.
describe('AddToCart — Mua ngay', () => {
  const buyButtons = (c: HTMLElement) =>
    Array.from(c.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Mua ngay' || b.textContent === 'Đang xử lý…');
  const bar = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="sticky-bar"]')!;
  const login = () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
  };

  it('đã đăng nhập: thêm vào giỏ rồi chuyển thẳng tới thanh toán, không dừng lại báo "Đã thêm"', async () => {
    login();
    const { container } = mount();
    await flush();
    click(container.querySelector('button[aria-label="Tăng số lượng"]'));
    click(buyButtons(container)[0]!);
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 2);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    expect(container.textContent).not.toContain('Đã thêm vào giỏ!');
  });

  const line = (id: string, variationId: string) => ({ id, variationId, quantity: 1 });

  it('giỏ đã có 3 món cũ: "Mua ngay" món A chỉ thanh toán dòng của A, không kéo cả giỏ sang thanh toán', async () => {
    login();
    const old = [line('old-1', 'x1'), line('old-2', 'x2'), line('old-3', 'x3')];
    mocks.addToCart.mockResolvedValue({ items: [...old, line('line-A', 'v1')], itemCount: 4 });
    const { container } = mount();
    await flush();
    click(buyButtons(container)[0]!);
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    // Đúng cách trang thanh toán đọc lựa chọn: nhớ lại rồi đối chiếu với giỏ thật vừa tải.
    const cartIds = [...old.map((l) => l.id), 'line-A'];
    expect(reconcileSelection(recallCheckoutSelection(), cartIds)).toEqual(['line-A']);
  });

  it('thay lựa chọn một phần giỏ còn nhớ từ lần trước bằng đúng dòng vừa mua', async () => {
    login();
    sessionStorage.setItem('tubu_checkout_selection', JSON.stringify({ itemIds: ['old-1'] }));
    mocks.addToCart.mockResolvedValue({ items: [line('old-1', 'x1'), line('line-A', 'v1')], itemCount: 2 });
    const { container } = mount();
    await flush();
    click(buyButtons(container)[0]!);
    await flush();
    expect(recallCheckoutSelection()).toEqual(['line-A']);
  });

  it('chọn phân loại khác: chỉ dòng của phân loại đó được thanh toán', async () => {
    login();
    mocks.addToCart.mockResolvedValue({ items: [line('line-A', 'v1'), line('line-B', 'v2')], itemCount: 2 });
    const { container } = mount();
    await flush();
    click(byText(container, 'button', '500ml'));
    click(buyButtons(container)[0]!);
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 1);
    expect(recallCheckoutSelection()).toEqual(['line-B']);
  });

  it('giỏ trả về không có dòng của món vừa thêm: để null (thanh toán toàn giỏ), không để lại lựa chọn cũ', async () => {
    login();
    sessionStorage.setItem('tubu_checkout_selection', JSON.stringify({ itemIds: ['old-1'] }));
    mocks.addToCart.mockResolvedValue({ items: [line('old-1', 'x1')], itemCount: 1 });
    const { container } = mount();
    await flush();
    click(buyButtons(container)[0]!);
    await flush();
    expect(recallCheckoutSelection()).toBeNull();
  });

  it('API không trả danh sách dòng (giỏ rỗng/bản cũ): không vỡ, vẫn sang thanh toán', async () => {
    login();
    mocks.addToCart.mockResolvedValue({ itemCount: 1 });
    const { container } = mount();
    await flush();
    click(buyButtons(container)[0]!);
    await flush();
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    expect(recallCheckoutSelection()).toBeNull();
  });

  it('chưa đăng nhập: nhớ phân loại, số lượng và ý định mua ngay rồi sang đăng nhập, quay lại đúng trang sản phẩm', async () => {
    const { container } = mount();
    await flush();
    click(byText(container, 'button', '500ml'));
    click(container.querySelector('button[aria-label="Tăng số lượng"]'));
    click(buyButtons(container)[0]!);
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi');
    expect(JSON.parse(sessionStorage.getItem('tubu_pending_add')!)).toMatchObject({ variationId: 'v2', quantity: 2, buyNow: true });
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('đăng nhập xong quay lại có món "mua ngay" đang chờ: thêm vào giỏ rồi đi tiếp tới thanh toán', async () => {
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'v2', quantity: 2, buyNow: true, at: Date.now() }));
    login();
    mount();
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 2);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
  });

  it('món chờ thêm giỏ thường (không phải mua ngay) vẫn dừng ở trang sản phẩm', async () => {
    sessionStorage.setItem('tubu_pending_add', JSON.stringify({ variationId: 'v2', quantity: 2, at: Date.now() }));
    login();
    mount();
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 2);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('API từ chối (hết hàng): ở lại trang, hiện lời nhắn, nút mở lại để thử tiếp', async () => {
    login();
    mocks.addToCart.mockRejectedValue(new Error('Chỉ còn 1 sản phẩm trong kho.'));
    const { container } = mount();
    await flush();
    click(buyButtons(container)[0]!);
    await flush();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Chỉ còn 1 sản phẩm trong kho.');
    expect(buyButtons(container)[0]!.disabled).toBe(false);
  });

  it('đang xử lý: cả "Thêm vào giỏ" và "Mua ngay" khoá, tránh bấm đôi làm gấp đôi số lượng', async () => {
    login();
    let release: (v: unknown) => void = () => {};
    mocks.addToCart.mockImplementation(() => new Promise((r) => (release = r)));
    const { container } = mount();
    await flush();
    click(buyButtons(container)[0]!);
    await flush(2);
    expect(buyButtons(container)[0]!.textContent).toBe('Đang xử lý…');
    expect(bar(container).querySelector('button[aria-label^="Đang xử lý… · "]')).not.toBeNull();
    expect(buyButtons(container)[0]!.disabled).toBe(true);
    expect(addButton(container).disabled).toBe(true);
    release(CART);
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it('hết hàng: "Mua ngay" khoá', async () => {
    login();
    mocks.getProductStock.mockResolvedValue({ v1: 0 });
    const { container } = mount([VARIATIONS[0]!]);
    await flush();
    expect(buyButtons(container).every((b) => b.disabled)).toBe(true);
  });

  it('đang khôi phục phiên: "Mua ngay" tạm khoá, không đẩy khách sang đăng nhập', async () => {
    mocks.auth = { status: 'idle', initialized: false, user: null };
    const { container } = mount();
    await flush();
    expect(buyButtons(container)[0]!.disabled).toBe(true);
    click(buyButtons(container)[0]!);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('gian hàng tạm nghỉ: không có "Mua ngay" và không có thanh dính', async () => {
    const r = render(<AddToCart slug="dau-goi" variations={VARIATIONS} blockedReason="Tạm nghỉ." />);
    mounted.push(r);
    await flush();
    expect(buyButtons(r.container)).toHaveLength(0);
    expect(r.container.querySelector('[data-testid="sticky-bar"]')).toBeNull();
  });

  describe('thanh CTA dính đáy (điện thoại)', () => {
    it('hiện giá theo phân loại và số lượng đang chọn, kèm "Thêm vào giỏ" và "Mua ngay"', async () => {
      const { container } = mount();
      await flush();
      expect(bar(container).textContent).toContain('150.000đ');
      click(container.querySelector('button[aria-label="Tăng số lượng"]'));
      click(container.querySelector('button[aria-label="Tăng số lượng"]'));
      expect(bar(container).textContent).toContain('450.000đ'); // 150.000đ × 3
      click(byText(container, 'button', '500ml'));
      expect(bar(container).textContent).toContain('300.000đ'); // đổi phân loại thì số lượng về 1
      expect(byText(bar(container), 'button', 'Thêm vào giỏ')).not.toBeNull();
      expect(byText(bar(container), 'button', 'Mua ngay')).not.toBeNull();
    });

    it('như Mini App: nút giỏ có huy hiệu số món, "Thêm vào giỏ" nền nhạt, "Mua ngay" hai dòng (nhãn + giá)', async () => {
      login();
      const { container } = mount();
      await flush();
      const cart = bar(container).querySelector<HTMLAnchorElement>('a[aria-label="Xem giỏ hàng"]')!;
      expect(cart.getAttribute('href')).toBe('/gio-hang');
      expect(cart.textContent).toBe('3');
      expect(byText(bar(container), 'button', 'Thêm vào giỏ')!.className).toContain('max-md:bg-[var(--color-action-secondary-bg)]');
      const buy = bar(container).querySelector<HTMLButtonElement>('button[aria-label="Mua ngay · 150.000đ"]')!;
      expect([...buy.querySelectorAll('span')].map((x) => x.textContent)).toEqual(['Mua ngay', '150.000đ']);
      expect(bar(container).textContent).not.toContain('Tạm tính');
    });

    it('nút "Mua ngay" trên thanh dính làm đúng việc của nút trong trang', async () => {
      login();
      const { container } = mount();
      await flush();
      click(byText(bar(container), 'button', 'Mua ngay'));
      await flush();
      expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1);
      expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    });

    it('nút "Thêm vào giỏ" trên thanh dính thêm giỏ và báo ngay trên thanh (không phải cuộn lên mới thấy)', async () => {
      login();
      const { container } = mount();
      await flush();
      click(byText(bar(container), 'button', 'Thêm vào giỏ'));
      await flush();
      expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1);
      expect(bar(container).textContent).toContain('Đã thêm vào giỏ!');
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it('hết hàng: thanh dính chỉ còn một nút "Hết hàng" đã khoá', async () => {
      mocks.getProductStock.mockResolvedValue({ v1: 0 });
      const { container } = mount([VARIATIONS[0]!]);
      await flush();
      const buttons = Array.from(bar(container).querySelectorAll('button'));
      expect(buttons.map((b) => b.textContent)).toEqual(['Hết hàng']);
      expect(buttons[0]!.disabled).toBe(true);
    });

    it('vùng chạm 44px và mọi nút có tên (cả trong trang lẫn trên thanh dính)', async () => {
      const { container } = mount();
      await flush();
      expect(smallTouchTargets(container)).toEqual([]);
      expect(unnamedControls(container)).toEqual([]);
    });
  });
});

describe('AddToCart — khổ điện thoại, từ 2 phân loại (R-6)', () => {
  const realMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 767px'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never;
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });
  const sheet = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
  // Bảng nạp lười (next/dynamic): chờ tới khi hiện.
  const sheetReady = async () => {
    for (let n = 0; n < 40 && !sheet(); n++) await flush();
  };

  it('Thêm vào giỏ mở bảng chọn, chọn 500ml rồi xác nhận mới thêm giỏ', async () => {
    const { container } = mount();
    await flush();
    click(addButton(container));
    await sheetReady();
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(sheet()).not.toBeNull();
    click(byText(sheet()!, 'button', '500ml'));
    click(byText(sheet()!, 'button', /^Thêm vào giỏ · /));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 1);
  });

  it('xác nhận hai lần liền nhau (chưa kịp vẽ lại) chỉ thêm giỏ một lần', async () => {
    const { container } = mount();
    await flush();
    click(addButton(container));
    await sheetReady();
    const confirm = mocks.sheetProps!.onConfirm;
    confirm({ id: 'v2' }, 1);
    confirm({ id: 'v2' }, 1);
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it('thêm 3 món từ bảng ở phân loại khác: trang và thanh dính giữ số lượng 3, không về 1', async () => {
    const { container } = mount();
    await flush();
    click(addButton(container));
    await sheetReady();
    click(byText(sheet()!, 'button', '500ml'));
    click(sheet()!.querySelector('button[aria-label="Tăng số lượng"]'));
    click(sheet()!.querySelector('button[aria-label="Tăng số lượng"]'));
    click(byText(sheet()!, 'button', /^Thêm vào giỏ · /));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 3);
    expect(container.textContent).toContain('900.000đ');
  });

  it('Mua ngay mở bảng chọn với nhãn Mua ngay', async () => {
    const { container } = mount();
    await flush();
    click(byText(container, 'button', /^Mua ngay/));
    await sheetReady();
    expect(byText(sheet()!, 'button', /^Mua ngay · /)).toBeTruthy();
    expect(mocks.addToCart).not.toHaveBeenCalled();
  });

  it('sản phẩm 1 phân loại thêm thẳng, không bảng chọn', async () => {
    const { container } = mount([VARIATIONS[0]!]);
    await flush();
    click(addButton(container));
    await flush();
    expect(sheet()).toBeNull();
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1);
  });
});

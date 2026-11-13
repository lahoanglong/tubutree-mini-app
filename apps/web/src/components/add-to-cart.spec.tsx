// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { PdpSelectionProvider, usePdpSelection } from './pdp-selection';
import { canPdpQuickAdd } from '@/lib/pdp-quick-add';

// BUYERWEB-15: khách bấm "Thêm vào giỏ" khi chưa đăng nhập phải quay lại đúng sản phẩm và món đó được thêm nốt.
// BUYERWEB-9: tồn kho trong HTML là bản ISR cũ; trang hỏi lại tồn kho thật.

const mocks = vi.hoisted(() => ({
  auth: { status: 'idle' as string, initialized: true, user: null as unknown },
  push: vi.fn(),
  addToCart: vi.fn(),
  applyCoupon: vi.fn(),
  getProductStock: vi.fn(),
  getActiveFlashSales: vi.fn(),
  getFlashAllowance: vi.fn(),
  getCart: vi.fn(),
  sheetProps: null as null | { onConfirm: (v: never, qty: number) => void },
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
  applyCoupon: mocks.applyCoupon,
  getProductStock: mocks.getProductStock,
  getActiveFlashSales: mocks.getActiveFlashSales,
  getFlashAllowance: mocks.getFlashAllowance,
  getCart: mocks.getCart,
}));

import AddToCart from './add-to-cart';
import { reconcileSelection, recallCheckoutSelection } from '@/lib/checkout-selection';
import { FlashSalesSeed, resetFlashSales } from '@/lib/use-flash-sales';

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
// Neo đầu chữ: chip phân loại hết hàng cũng ghi "Tạm hết hàng" nhưng bắt đầu bằng tên phân loại.
const addButton = (c: HTMLElement) => byText(c, 'button', /^(Thêm vào giỏ|Tạm hết hàng|Đang thêm)/) as HTMLButtonElement;

beforeEach(() => {
  sessionStorage.clear();
  mocks.auth = { status: 'idle', initialized: true, user: null };
  mocks.push.mockReset();
  mocks.addToCart.mockReset().mockResolvedValue(CART);
  mocks.getProductStock.mockReset().mockResolvedValue({ v1: 5, v2: 9 });
  resetFlashSales();
  mocks.getActiveFlashSales.mockReset().mockResolvedValue([]);
  mocks.getCart.mockReset().mockResolvedValue({ items: [], itemCount: 3 });
  mocks.getFlashAllowance.mockReset().mockRejectedValue(new Error('404'));
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

describe('AddToCart — chia sẻ trạng thái mua với PdpSelection', () => {
  let shared: ReturnType<typeof usePdpSelection> = null;
  const Probe = () => {
    shared = usePdpSelection();
    return null;
  };
  const mountShared = (props: { blockedReason?: string | null } = {}) => {
    const r = render(
      <PdpSelectionProvider initialId="v1">
        <AddToCart slug="dau-goi" variations={VARIATIONS} {...props} />
        <Probe />
      </PdpSelectionProvider>,
    );
    mounted.push(r);
    return r;
  };

  it('còn hàng ở phân loại đang chọn: buyable true', async () => {
    mountShared();
    await flush();
    expect(shared!.buyable).toBe(true);
  });

  it('hết hàng cả hai phân loại (tồn kho thật): buyable false', async () => {
    mocks.getProductStock.mockResolvedValue({ v1: 0, v2: 0 });
    mountShared();
    await flush();
    expect(shared!.buyable).toBe(false);
  });

  it('gian hàng tạm nghỉ: buyable false dù còn tồn kho', async () => {
    mountShared({ blockedReason: 'Gian hàng tạm nghỉ' });
    await flush();
    expect(shared!.buyable).toBe(false);
  });

  // W42B: nút "Thêm vào giỏ" của lightbox ảnh đánh giá chỉ hiện khi khối mua đăng ký cầu nối; mua không được thì không đăng ký.
  it('cầu nối thêm giỏ của lightbox: còn hàng thì đăng ký, gỡ khi khối mua bị gỡ', async () => {
    const r = mountShared();
    await flush();
    expect(canPdpQuickAdd()).toBe(true);
    r.unmount();
    mounted = mounted.filter((m) => m !== r);
    expect(canPdpQuickAdd()).toBe(false);
  });

  it('cầu nối thêm giỏ của lightbox: hết hàng (tồn thật) hoặc gian hàng tạm nghỉ thì không đăng ký', async () => {
    mocks.getProductStock.mockResolvedValue({ v1: 0, v2: 0 });
    mountShared();
    await flush();
    expect(canPdpQuickAdd()).toBe(false);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.getProductStock.mockResolvedValue({ v1: 5, v2: 5 });
    mountShared({ blockedReason: 'Gian hàng tạm nghỉ' });
    await flush();
    expect(canPdpQuickAdd()).toBe(false);
  });

  it('chọn chip phân loại đánh dấu khách đã tự chọn trên cờ dùng chung', async () => {
    const { container } = mountShared();
    await flush();
    expect(shared!.userPicked.current).toBe(false);
    click(byText(container, 'button', '500ml'));
    expect(shared!.userPicked.current).toBe(true);
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
    mocks.addToCart.mockRejectedValue(new Error('Sản phẩm đã hết hàng.'));
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    expect(container.textContent).toContain('Sản phẩm đã hết hàng.');
  });
});

describe('AddToCart — ô số lượng như Mini App', () => {
  it('hai nút vuông riêng (không gộp trong một khung), ở mức tối thiểu nút giảm chỉ aria-disabled, nhãn và ô số cách nhau trên điện thoại', async () => {
    const { container } = mount();
    await flush();
    const minus = container.querySelector<HTMLButtonElement>('button[aria-label="Giảm số lượng"]')!;
    const plus = container.querySelector<HTMLButtonElement>('button[aria-label="Tăng số lượng"]')!;
    expect(minus.getAttribute('aria-disabled')).toBe('true');
    expect(plus.getAttribute('aria-disabled')).toBe('false');
    for (const b of [minus, plus]) expect(b.className).toContain('border');
    expect(minus.parentElement).toBe(plus.parentElement);
    expect(minus.parentElement!.className).not.toContain('border');
    expect(minus.parentElement!.parentElement!.className).toContain('max-md:justify-between');
    click(minus);
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe('1');
    click(plus);
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe('2');
    expect(minus.getAttribute('aria-disabled')).toBe('false');
  });

  it('từ md hàng Số lượng cho nút "Thêm vào giỏ · giá" xuống hàng riêng khi cột hẹp (nhãn không ngắt dòng, vẫn ≥ 44px), điện thoại không đổi', async () => {
    const { container } = mount();
    await flush();
    const row = container.querySelector<HTMLElement>('[data-section="pdp-quantity"]')!;
    expect(row.className).toMatch(/\bmd:flex-wrap\b/);
    expect(row.className).not.toMatch(/(^|\s)flex-wrap\b/);
    const add = row.querySelector<HTMLButtonElement>('[data-testid="pdp-add-to-cart"]')!;
    expect(add.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(add.className).toMatch(/\bmin-h-11\b/);
    expect(add.className).toMatch(/\bhidden\b/);
    expect(add.className).toMatch(/\bmd:inline-flex\b/);
    expect(add.textContent).toMatch(/^Thêm vào giỏ · /);
  });
});

describe('AddToCart — áp mã mua chung từ ?ma=', () => {
  const CODE = 'GBUY-ABCD1234-WXYZ5678';
  const openedFrom = (search: string) => window.history.replaceState(null, '', `/san-pham/dau-goi${search}`);
  const withLine = (over: Record<string, unknown> = {}) => ({ items: [{ id: 'line-A', variationId: 'v1', quantity: 1 }], itemCount: 1, couponCode: null, discount: 0, ...over });
  const buy = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).find((b) => /^Mua ngay/.test(b.textContent ?? '') && !b.hasAttribute('hidden')) as HTMLButtonElement;
  // Câu báo giữ trên màn rồi mới sang thanh toán: chờ hết để lần chuyển trang đó không rơi vào ca kế tiếp.
  const waitHoldOver = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1900));
    });

  beforeEach(() => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mocks.addToCart.mockResolvedValue(withLine());
    mocks.applyCoupon.mockReset().mockResolvedValue(withLine({ couponCode: CODE, discount: 15000 }));
  });
  afterEach(() => openedFrom(''));

  it('thêm giỏ xong thì áp đúng mã (viết hoa) và báo "Đã áp mã"', async () => {
    openedFrom(`?ma=${encodeURIComponent(CODE.toLowerCase())}`);
    const { container } = mount();
    await flush();
    click(addButton(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v1', 1);
    expect(mocks.applyCoupon).toHaveBeenCalledWith(CODE);
    expect(mocks.addToCart.mock.invocationCallOrder[0]!).toBeLessThan(mocks.applyCoupon.mock.invocationCallOrder[0]!);
    expect(container.textContent).toContain('Đã thêm vào giỏ!');
    expect(container.textContent).toContain(`Đã áp mã ${CODE}`);
  });

  it('mua ngay: áp mã xong mới sang thanh toán', async () => {
    openedFrom(`?ma=${CODE}`);
    const { container } = mount();
    await flush();
    click(buy(container));
    await flush();
    expect(mocks.applyCoupon).toHaveBeenCalledWith(CODE);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    expect(mocks.applyCoupon.mock.invocationCallOrder[0]!).toBeLessThan(mocks.push.mock.invocationCallOrder[0]!);
  });

  it('áp mã lỗi: món vẫn vào giỏ và nói lý do của máy chủ', async () => {
    mocks.applyCoupon.mockRejectedValue(new Error('Mã đã hết hạn'));
    openedFrom(`?ma=${CODE}`);
    const { container } = mount();
    await flush();
    click(addButton(container));
    await flush();
    expect(container.textContent).toContain('Đã thêm vào giỏ!');
    expect(container.textContent).toContain('Mã đã hết hạn');
  });

  it('mua ngay mà áp mã lỗi: giữ câu lý do trên màn rồi mới sang thanh toán, không im lặng chuyển trang', async () => {
    mocks.applyCoupon.mockRejectedValue(new Error('Mã đã hết hạn'));
    openedFrom(`?ma=${CODE}`);
    const { container } = mount();
    await flush();
    click(buy(container));
    await flush();
    expect(container.textContent).toContain('Chưa chọn sẵn được mã: Mã đã hết hạn');
    expect(mocks.push).not.toHaveBeenCalled();
    await waitHoldOver();
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
  });

  it('mua ngay mà máy chủ giữ mã nhưng chưa tính giảm: cũng giữ câu lý do trước khi sang thanh toán', async () => {
    mocks.applyCoupon.mockResolvedValue(withLine({ couponCode: CODE, discount: 0, couponNotice: 'Cần thêm 20.000đ để dùng mã' }));
    openedFrom(`?ma=${CODE}`);
    const { container } = mount();
    await flush();
    click(buy(container));
    await flush();
    expect(container.textContent).toContain('Cần thêm 20.000đ để dùng mã');
    expect(mocks.push).not.toHaveBeenCalled();
    await waitHoldOver();
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
  });

  it('máy chủ giữ mã nhưng chưa tính giảm (đơn tối thiểu): nói lý do thay vì báo đã áp', async () => {
    mocks.applyCoupon.mockResolvedValue(withLine({ couponCode: CODE, discount: 0, couponNotice: 'Cần thêm 20.000đ để dùng mã' }));
    openedFrom(`?ma=${CODE}`);
    const { container } = mount();
    await flush();
    click(addButton(container));
    await flush();
    expect(container.textContent).toContain('Cần thêm 20.000đ để dùng mã');
    expect(container.textContent).not.toContain('Đã áp mã');
  });

  describe('màu câu báo theo kết quả áp mã', () => {
    const lineWith = (c: HTMLElement, re: RegExp) => Array.from(c.querySelectorAll('p')).find((p) => re.test(p.textContent ?? ''));
    const SAVED = /Đã thêm vào giỏ!/;
    const NOT_APPLIED = /Chưa chọn sẵn được mã/;
    const SWITCHED = /Đã đổi sang mã/;

    it('mua ngay mà mã thay mã cũ (áp được): câu "Đã đổi sang mã" màu thành công, không đỏ như lỗi', async () => {
      mocks.addToCart.mockResolvedValue(withLine({ couponCode: 'CU10' }));
      openedFrom(`?ma=${CODE}`);
      const { container } = mount();
      await flush();
      click(buy(container));
      await flush();
      const note = lineWith(container, SWITCHED)!;
      expect(note).toBeTruthy();
      expect(note.className).toContain('text-success-fg');
      expect(note.className).not.toContain('text-danger-fg');
      expect(mocks.push).not.toHaveBeenCalled();
      await waitHoldOver();
      expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    });

    it('mua ngay mà mã chưa áp được: câu lý do màu cảnh báo, không đỏ như lỗi', async () => {
      mocks.applyCoupon.mockRejectedValue(new Error('Mã đã hết hạn'));
      openedFrom(`?ma=${CODE}`);
      const { container } = mount();
      await flush();
      click(buy(container));
      await flush();
      const note = lineWith(container, NOT_APPLIED)!;
      expect(note.className).toContain('text-warning-fg');
      expect(note.className).not.toContain('text-danger-fg');
      await waitHoldOver();
      expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    });

    it('thêm giỏ xong mà mã chưa áp được: "Đã thêm vào giỏ!" vẫn xanh, câu về mã tách ra dòng cảnh báo', async () => {
      mocks.applyCoupon.mockRejectedValue(new Error('Mã đã hết hạn'));
      openedFrom(`?ma=${CODE}`);
      const { container } = mount();
      await flush();
      click(addButton(container));
      await flush();
      const saved = lineWith(container, SAVED)!;
      expect(saved.className).toContain('text-success-fg');
      expect(saved.textContent).not.toMatch(NOT_APPLIED);
      const warn = lineWith(container, NOT_APPLIED)!;
      expect(warn.className).toContain('text-warning-fg');
      expect(warn.textContent).toContain('Mã đã hết hạn');
    });

    it('thêm giỏ xong và mã áp được (kể cả thay mã cũ): cả câu màu thành công, không có dòng cảnh báo', async () => {
      mocks.addToCart.mockResolvedValue(withLine({ couponCode: 'CU10' }));
      openedFrom(`?ma=${CODE}`);
      const { container } = mount();
      await flush();
      click(addButton(container));
      await flush();
      const saved = lineWith(container, SAVED)!;
      expect(saved.className).toContain('text-success-fg');
      expect(saved.textContent).toMatch(SWITCHED);
      expect(container.querySelector('[role="status"] .text-warning-fg')).toBeNull();
    });
  });

  it('chỉ áp một lần mỗi lần mở trang', async () => {
    openedFrom(`?ma=${CODE}`);
    const { container } = mount();
    await flush();
    click(addButton(container));
    await flush();
    click(addButton(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledTimes(2);
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
  });

  it('đã thử áp thì gỡ ?ma= khỏi URL: tải lại hay quay lại trang rồi thêm giỏ không áp lại mã khách có thể đã bỏ chọn ở giỏ', async () => {
    openedFrom(`?ma=${CODE}&v=v1`);
    const first = mount();
    await flush();
    click(addButton(first.container));
    await flush();
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?v=v1');
    first.unmount();
    mounted = mounted.filter((m) => m !== first);

    const reloaded = mount();
    await flush();
    click(addButton(reloaded.container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledTimes(2);
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
  });

  it('chỉ nhận mã của nhóm (GBUY-): ?ma= mang mã khác không thay mã đang chọn ở giỏ, và không bị gỡ khỏi URL', async () => {
    openedFrom('?ma=WELCOME30');
    const { container } = mount();
    await flush();
    click(addButton(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalled();
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?ma=WELCOME30');
  });

  it('không có ?ma= (lối vào thường): không gọi applyCoupon', async () => {
    const { container } = mount();
    await flush();
    click(addButton(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalled();
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });

  it('thêm giỏ lỗi: không áp mã', async () => {
    mocks.addToCart.mockRejectedValue(new Error('Sản phẩm đã hết hàng.'));
    openedFrom(`?ma=${CODE}`);
    const { container } = mount();
    await flush();
    click(addButton(container));
    await flush();
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });
});

describe('AddToCart — tồn kho thật thay cho bản ISR', () => {
  it('ISR báo còn hàng nhưng tồn thật = 0: nút "Tạm hết hàng" và không cho thêm', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mocks.getProductStock.mockResolvedValue({ v1: 0 });
    const { container } = mount([VARIATIONS[0]!]);
    await flush();
    expect(addButton(container).textContent).toBe('Tạm hết hàng');
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

  it('gian hàng tạm nghỉ thì không có dòng tồn kho nào ("Sẵn sàng giao ngay" mâu thuẫn với nút khoá), kể cả tồn ảo', async () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    mocks.getProductStock.mockResolvedValue({ v1: 99_999_988, v2: 7 });
    const { container } = mountBlocked();
    await flush();
    expect(container.querySelector('[data-testid="atc-stock-label"]')).toBeNull();
    expect(container.querySelector('[data-testid="atc-low-stock"]')).toBeNull();
    expect(container.textContent).not.toContain('Sẵn sàng giao ngay');
  });
});

describe('AddToCart — khối mua xếp theo order cùng các khối khác của PDP ở điện thoại (như Mini App)', () => {
  const order = (el: Element | null) => Number(/tubu-pdp-order-(\d+)/.exec(el?.className ?? '')?.[1] ?? 0);

  it('gốc là `contents` để chip và Số lượng thành khối con của cột thông tin: chip 5 → Số lượng 6, không còn dòng "Phân loại ›"', async () => {
    const { container } = mount();
    await flush();
    expect(container.firstElementChild!.className).toContain('max-md:contents');
    const chips = container.querySelector('[data-section="pdp-variation-chips"]')!;
    const qty = container.querySelector('[data-section="pdp-quantity"]')!;
    expect(container.querySelector('[data-section="pdp-variation"]')).toBeNull();
    expect([order(chips), order(qty)]).toEqual([5, 6]);
    for (const el of [chips, qty]) expect(el.className).toContain('max-md:bg-[var(--color-bg-surface)]');
  });

  it('một phân loại: không có dòng "Phân loại ›" và không có chip (không để lại dải rỗng)', async () => {
    const { container } = mount([VARIATIONS[0]!]);
    await flush();
    expect(container.querySelector('[data-section="pdp-variation"]')).toBeNull();
    expect(container.querySelector('[data-section="pdp-variation-chips"]')).toBeNull();
    expect(container.querySelector('[data-section="pdp-quantity"]')).not.toBeNull();
  });
});

describe('AddToCart — chip phân loại hai dòng như Mini App', () => {
  const FLASH_V2 = {
    itemId: 'f2', variationId: 'v2', productSlug: 'dau-goi', flashPrice: 200000, retailPrice: 300000,
    salePrice: null, soldCount: 1, quota: 10, endAt: '2099-10-14T16:00:00.000Z',
  };

  it('chip đang Giờ vàng có ⚡ và chữ đọc "Giờ vàng", giá màu deal; chip thường không có ⚡', async () => {
    mocks.getActiveFlashSales.mockResolvedValue([FLASH_V2]);
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    const flash = byText(container, 'button', /500ml/) as HTMLButtonElement;
    const plain = byText(container, 'button', /250ml/) as HTMLButtonElement;
    expect(flash.querySelector('svg')).not.toBeNull();
    expect(flash.textContent).toContain('Giờ vàng');
    const price = Array.from(flash.querySelectorAll('span')).find((x) => x.textContent?.includes('200.000đ'))!;
    expect(price.className).toContain('max-md:text-[var(--color-text-price-deal)]');
    expect(plain.querySelector('svg')).toBeNull();
    expect(plain.className).toContain('min-h-11');
    expect(flash.className).toContain('max-md:flex-col');
  });

  it('chip hết hàng: ghi "Tạm hết hàng" thay giá, tên gạch ngang', async () => {
    mocks.getProductStock.mockResolvedValue({ v1: 0, v2: 9 });
    const { container } = mount([{ ...VARIATIONS[0]!, stock: 0 }, VARIATIONS[1]!]);
    await flush();
    const out = byText(container, 'button', /250ml/) as HTMLButtonElement;
    expect(out.textContent).toContain('Tạm hết hàng');
    expect(out.textContent).not.toContain('150.000đ');
    expect(out.querySelector('.line-through')!.textContent).toBe('250ml');
  });

  it('chip hết hàng khoá như chip của Mini App: disabled, bấm vào không đổi phân loại đang chọn', async () => {
    mocks.getProductStock.mockResolvedValue({ v1: 0, v2: 9 });
    const { container } = mount([{ ...VARIATIONS[0]!, stock: 0 }, VARIATIONS[1]!]);
    await flush();
    const out = byText(container, 'button', /250ml/) as HTMLButtonElement;
    const other = byText(container, 'button', /500ml/) as HTMLButtonElement;
    expect(out.disabled).toBe(true);
    expect(other.disabled).toBe(false);
    expect(other.getAttribute('aria-pressed')).toBe('true');
    click(out);
    await flush();
    expect(out.getAttribute('aria-pressed')).toBe('false');
    expect(other.getAttribute('aria-pressed')).toBe('true');
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 300.000đ');
  });

  it('"Chỉ còn N sản phẩm" (màu cảnh báo) trong khối mua chỉ hiện từ md (điện thoại dùng dòng ở khối thông tin chính)', async () => {
    mocks.getProductStock.mockResolvedValue({ v1: 3, v2: 9 });
    const { container } = mount();
    await flush();
    const note = container.querySelector('[data-testid="atc-low-stock"]')!;
    expect(note.textContent).toBe('Chỉ còn 3 sản phẩm');
    expect(note.className).toContain('max-md:hidden');
    expect(note.className).toContain('text-warning-fg');
  });

  it('tồn 21–99.999 ghi "Còn hàng", tồn ảo từ 100.000 ghi "Còn hàng — Sẵn sàng giao ngay" không lộ số; cả hai chữ thường, không màu cảnh báo', async () => {
    mocks.getProductStock.mockResolvedValue({ v1: 245, v2: 99_999_988 });
    const { container } = mount();
    await flush();
    const note = () => container.querySelector('[data-testid="atc-stock-label"]')!;
    expect(note().textContent).toBe('Còn hàng');
    expect(note().className).toContain('max-md:hidden');
    expect(note().className).not.toContain('text-warning-fg');
    click(byText(container, 'button', /500ml/));
    await flush();
    expect(note().textContent).toBe('Còn hàng — Sẵn sàng giao ngay');
    expect(note().className).not.toContain('text-warning-fg');
    expect(container.textContent).not.toMatch(/99\.?999/);
  });
});

describe('AddToCart — giá Giờ vàng khớp giỏ và đơn (R4-BUYER-4)', () => {
  const FLASH_V2 = {
    itemId: 'f2', variationId: 'v2', productSlug: 'dau-goi', flashPrice: 200000, retailPrice: 300000,
    salePrice: null, soldCount: 1, quota: 10, endAt: '2099-10-14T16:00:00.000Z',
  };

  const openedFrom = (search: string) => window.history.replaceState(null, '', `/san-pham/dau-goi${search}`);
  afterEach(() => openedFrom(''));

  it('phân loại có đợt Giờ vàng: nhãn trên nút chọn, giá Giờ vàng ở nút thêm vào giỏ', async () => {
    openedFrom('?v=v2');
    mocks.getActiveFlashSales.mockResolvedValue([FLASH_V2]);
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    const chip = byText(container, 'button', /500ml/) as HTMLButtonElement;
    expect(chip.textContent).toContain('200.000đ');
    expect(chip.textContent).toContain('Giờ vàng');
    expect((byText(container, 'button', /250ml/) as HTMLButtonElement).textContent).not.toContain('Giờ vàng');
    // Giá deal, giá gốc và "Kết thúc sau …" nằm ở thanh Giờ vàng dưới ảnh (PdpFlashBar); ở khối mua không lặp lại bằng một câu riêng.
    expect(container.querySelector('[data-testid="flash-price-note"]')).toBeNull();
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 200.000đ');
  });

  it('vào từ thẻ hay dải Giờ vàng (?v=): mở đúng phân loại đang giảm giá thay vì phân loại mặc định', async () => {
    openedFrom('?v=v2');
    mocks.getActiveFlashSales.mockResolvedValue([FLASH_V2]);
    const { container } = mount();
    await flush();
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
  });

  it('trang ISR gieo danh sách rỗng, đợt Giờ vàng ở phân loại ?v= mới bắt đầu sau khi dựng: vẫn chờ danh sách thật rồi mở đúng phân loại đó', async () => {
    openedFrom('?v=v2');
    mocks.getActiveFlashSales.mockResolvedValue([FLASH_V2]);
    const r = render(
      <FlashSalesSeed items={[]} now={Date.now()}>
        <AddToCart slug="dau-goi" variations={VARIATIONS} />
      </FlashSalesSeed>,
    );
    mounted.push(r);
    await flush();
    expect(mocks.getActiveFlashSales).toHaveBeenCalled();
    expect(r.container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('500ml');
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

  it('danh sách ở máy còn suất đã quá hạn: không nhãn Giờ vàng, nút thêm giỏ theo giá thường', async () => {
    openedFrom('?v=v2');
    mocks.getActiveFlashSales.mockResolvedValue([{ ...FLASH_V2, endAt: '2020-01-01T00:00:00.000Z' }]);
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    expect(container.querySelector('[data-testid="flash-price-note"]')).toBeNull();
    expect(container.textContent).not.toContain('Giờ vàng');
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toContain('250ml');
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
    mocks.addToCart.mockRejectedValue(new Error('Chỉ còn 1 sản phẩm.'));
    const { container } = mount();
    await flush();
    click(buyButtons(container)[0]!);
    await flush();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Chỉ còn 1 sản phẩm.');
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
    expect(bar(container).querySelector('button[aria-label^="Đang xử lý… "]')).not.toBeNull();
    // Đang gửi: aria-disabled (không `disabled`) để nút đang giữ focus không mất focus; bấm tiếp không gửi lần hai.
    expect(buyButtons(container)[0]!.getAttribute('aria-disabled')).toBe('true');
    expect(addButton(container).getAttribute('aria-disabled')).toBe('true');
    click(buyButtons(container)[0]!);
    click(addButton(container));
    await flush(2);
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
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

  it('gian hàng tạm nghỉ: khối "Tạm thời chưa mua được" xếp ở điện thoại ngay sau chip (order 6), cùng chỗ Số lượng', async () => {
    const r = render(<AddToCart slug="dau-goi" variations={VARIATIONS} blockedReason="Tạm nghỉ." />);
    mounted.push(r);
    await flush();
    expect(r.container.firstElementChild!.className).toContain('tubu-pdp-order-6');
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
      const buy = Array.from(bar(container).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Mua ngay 150.000đ')!;
      expect(buy.getAttribute('aria-label')).toBe('Mua ngay 150.000đ');
      expect([...buy.querySelectorAll('span')].map((x) => x.textContent)).toEqual(['Mua ngay', '150.000đ']);
      // Như Mini App: giá đổi theo phân loại và số lượng, số tabular giữ nhãn không xô ngang.
      expect(buy.querySelectorAll('span')[1]!.className.split(/\s+/)).toContain('tabular-nums');
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

    it('hết hàng: thanh dính chỉ còn một nút "Tạm hết hàng" đã khoá', async () => {
      mocks.getProductStock.mockResolvedValue({ v1: 0 });
      const { container } = mount([VARIATIONS[0]!]);
      await flush();
      const buttons = Array.from(bar(container).querySelectorAll('button'));
      expect(buttons.map((b) => b.textContent)).toEqual(['Tạm hết hàng']);
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
  // Bảng nạp bằng next/dynamic: lần nạp đầu phải biên dịch, trên máy chậm lâu hơn số nhịp flush(); nạp sẵn để mọi ca không phụ thuộc tốc độ máy.
  beforeAll(async () => {
    await import('./variation-sheet');
  });
  const realMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 767px'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never;
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });
  const sheet = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;
  // Chờ theo thời gian thật (không theo số nhịp): nạp động chậm bao lâu cũng không làm ca đỏ giả.
  const sheetReady = async () => {
    for (const end = Date.now() + 5000; !sheet() && Date.now() < end; ) await flush();
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
    confirm({ id: 'v2' } as never, 1);
    confirm({ id: 'v2' } as never, 1);
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

  it('Mua ngay: khách chưa đăng nhập không có dải ghi chú trống trong bảng; đã đăng nhập thì giữ chỗ từ lúc mở (L5 2)', async () => {
    mocks.auth = { status: 'idle', initialized: true, user: null };
    const guest = mount();
    await flush();
    click(byText(guest.container, 'button', /^Mua ngay/));
    await sheetReady();
    expect(byText(sheet()!, 'button', /^Mua ngay · /)).toBeTruthy();
    expect(sheet()!.querySelector('[role="status"]')).toBeNull();
    guest.unmount();
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const member = mount();
    await flush();
    click(byText(member.container, 'button', /^Mua ngay/));
    await sheetReady();
    expect(sheet()!.querySelector('[role="status"]')).not.toBeNull();
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

describe('AddToCart — bảng chọn Phân loại và hết giờ Giờ vàng (P8)', () => {
  beforeAll(async () => {
    await import('./variation-sheet');
  });
  const rowButton = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="button"]')).find((b) => b.textContent?.startsWith('Phân loại')) ?? null;

  it('nhiều phân loại: không có dòng "Phân loại ›" (chip đủ tên, giá, hết hàng); bảng chọn vẫn mở khi bấm Thêm vào giỏ ở điện thoại', async () => {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes('max-width: 767px'), media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never;
    try {
      mocks.sheetProps = null;
      const { container } = mount();
      await flush();
      expect(rowButton(container)).toBeNull();
      expect(container.querySelector('[data-section="pdp-variation"]')).toBeNull();
      click(addButton(container));
      for (const end = Date.now() + 5000; mocks.sheetProps === null && Date.now() < end; ) await flush();
      expect(mocks.sheetProps).not.toBeNull();
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it('một phân loại: không có dòng "Phân loại ›"', async () => {
    const { container } = mount([VARIATIONS[0]!]);
    await flush();
    expect(rowButton(container)).toBeNull();
  });

  it('hết giờ Giờ vàng khi khách đang xem: giá chip và nút về giá thường, không cần tải lại', async () => {
    mocks.getActiveFlashSales.mockResolvedValue([
      { itemId: 'f1', variationId: 'v2', productSlug: 'dau-goi', flashPrice: 240000, retailPrice: 300000, salePrice: null, soldCount: 1, quota: 10, endAt: new Date(Date.now() + 700).toISOString() },
    ]);
    const { container } = mount();
    await flush();
    click(byText(container, 'button', /^500ml/));
    await flush();
    expect(byText(container, 'button', /^500ml/)!.textContent).toContain('240.000đ');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1000));
    });
    expect(byText(container, 'button', /^500ml/)!.textContent).toContain('300.000đ');
    expect(byText(container, 'button', /^500ml/)!.textContent).not.toContain('Giờ vàng');
    expect(addButton(container).textContent).toContain('300.000đ');
  });
});

describe('AddToCart — tiền nút mua theo luật máy chủ khi vượt giới hạn Giờ vàng mỗi khách', () => {
  const LIMITED = {
    itemId: 'f2', variationId: 'v2', productSlug: 'dau-goi', flashPrice: 240000, retailPrice: 300000,
    salePrice: null, soldCount: 1, quota: 10, perUserLimit: 3, endAt: '2099-10-14T16:00:00.000Z',
  };
  const OVER_4 = 'Giá Giờ vàng tối đa 3 sản phẩm mỗi khách. Mua 4 thì cả dòng tính giá thường.';
  const plus = (c: HTMLElement) => c.querySelector('[data-section="pdp-quantity"] button[aria-label="Tăng số lượng"]');
  const stickyBuy = (c: HTMLElement) => c.querySelector('button[aria-label^="Mua ngay"]') as HTMLButtonElement;

  async function openLimited(flash: object[] = [LIMITED]) {
    mocks.getActiveFlashSales.mockResolvedValue(flash);
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const r = mount();
    await flush();
    click(byText(r.container, 'button', /^500ml/));
    await flush();
    return r;
  }

  it('qty = giới hạn: 3 × 240.000đ; qty 4: cả dòng giá thường 4 × 300.000đ, nút Thêm vào giỏ, Mua ngay và ghi chú khớp nhau', async () => {
    const { container } = await openLimited();
    click(plus(container));
    click(plus(container));
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 720.000đ');
    expect(stickyBuy(container).getAttribute('aria-label')).toBe('Mua ngay 720.000đ');
    expect(container.textContent).not.toContain(OVER_4);
    click(plus(container));
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 1.200.000đ');
    expect(stickyBuy(container).getAttribute('aria-label')).toBe('Mua ngay 1.200.000đ');
    expect(container.textContent).toContain(OVER_4);
    expect(container.querySelector('[role="status"][data-section="pdp-flash-limit"]')!.textContent).toBe(OVER_4);
  });

  it('API cũ không gửi giới hạn: vẫn qty × giá Giờ vàng, không ghi chú', async () => {
    const { container } = await openLimited([{ ...LIMITED, perUserLimit: undefined }]);
    for (let i = 0; i < 3; i += 1) click(plus(container));
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 960.000đ');
    expect(container.textContent).not.toContain('cả dòng tính giá thường');
  });

  it('phân loại không phải Giờ vàng: không ghi chú dù mua nhiều', async () => {
    mocks.getActiveFlashSales.mockResolvedValue([LIMITED]);
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const { container } = mount();
    await flush();
    for (let i = 0; i < 4; i += 1) click(plus(container));
    expect(container.textContent).not.toContain('cả dòng tính giá thường');
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 750.000đ');
  });
});

describe('AddToCart — giỏ đã có sẵn cùng phân loại: thêm giỏ cộng dồn nên máy chủ giá cả dòng', () => {
  const LIMITED = {
    itemId: 'f2', variationId: 'v2', productSlug: 'dau-goi', flashPrice: 240000, retailPrice: 300000,
    salePrice: null, soldCount: 1, quota: 10, perUserLimit: 3, endAt: '2099-10-14T16:00:00.000Z',
  };
  const cartOf = (quantity: number) => ({ items: [{ id: 'ci1', variationId: 'v2', quantity }], itemCount: quantity });
  const IN_CART_2 = 'Giỏ đã có 2. Thêm 2 thì cả 4 sản phẩm tính giá thường.';
  const MERGE_2 = 'Giỏ đã có 2: Mua ngay thanh toán cả 3 sản phẩm.';
  const plus = (c: HTMLElement) => c.querySelector('[data-section="pdp-quantity"] button[aria-label="Tăng số lượng"]');
  const stickyBuy = (c: HTMLElement) => c.querySelector('button[aria-label^="Mua ngay"]') as HTMLButtonElement;

  async function openWithCart(cart: object | Error) {
    mocks.getActiveFlashSales.mockResolvedValue([LIMITED]);
    mocks.getCart.mockImplementation(() => (cart instanceof Error ? Promise.reject(cart) : Promise.resolve(cart)));
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
    const r = mount();
    await flush();
    click(byText(r.container, 'button', /^500ml/));
    await flush();
    return r;
  }

  it('giới hạn 3, giỏ có 2: qty 1 (tổng 3) 3 × 240.000đ; qty 2 (tổng 4) Mua ngay ghi cả dòng 1.200.000đ, Thêm vào giỏ ghi giỏ tăng 720.000đ, ghi chú nói theo giỏ', async () => {
    const { container } = await openWithCart(cartOf(2));
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 240.000đ');
    expect(stickyBuy(container).getAttribute('aria-label')).toBe('Mua ngay 720.000đ');
    // Chưa mất giá nhưng nút ghi cả dòng (3 × 240.000đ) cạnh ô Số lượng đang là 1: nói trước khi bấm.
    const note = () => container.querySelector('[role="status"][data-section="pdp-flash-limit"]')!.textContent;
    expect(note()).toBe(MERGE_2);
    click(plus(container));
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 720.000đ');
    expect(stickyBuy(container).getAttribute('aria-label')).toBe('Mua ngay 1.200.000đ');
    expect(note()).toBe(IN_CART_2);
  });

  it('thêm giỏ thành công rồi nút vẽ lại theo giỏ mới, không đếm số cũ hai lần', async () => {
    const { container } = await openWithCart(cartOf(2));
    mocks.addToCart.mockResolvedValue(cartOf(3));
    click(addButton(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledWith('v2', 1);
    expect(stickyBuy(container).getAttribute('aria-label')).toBe('Mua ngay 1.200.000đ');
    expect(container.querySelector('[role="status"][data-section="pdp-flash-limit"]')!.textContent).toBe('Giỏ đã có 3. Thêm 1 thì cả 4 sản phẩm tính giá thường.');
  });

  it('Mua ngay: giỏ mới có món vừa thêm được ghi vào cache nhưng trang chưa chuyển, số trên nút và câu ghi chú giữ như lúc bấm (không nhảy sang 1.200.000đ)', async () => {
    const { container } = await openWithCart(cartOf(2));
    expect(stickyBuy(container).getAttribute('aria-label')).toBe('Mua ngay 720.000đ');
    mocks.addToCart.mockResolvedValue(cartOf(3));
    // Trang thanh toán chưa tới (router.push thật còn chờ): PDP vẫn vẽ lại theo giỏ mới.
    mocks.push.mockImplementation(() => undefined);
    click(stickyBuy(container));
    await flush(3);
    expect(mocks.push).toHaveBeenCalledWith('/thanh-toan');
    expect(container.querySelector('button[aria-label^="Đang xử lý…"]')!.getAttribute('aria-label')).toBe('Đang xử lý… 720.000đ');
    expect(container.querySelector('[role="status"][data-section="pdp-flash-limit"]')!.textContent).toBe(MERGE_2);
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 240.000đ');
  });

  it('Mua ngay lỗi: ở lại trang thì không kẹt số cũ, thêm giỏ lần sau lại vẽ theo giỏ mới', async () => {
    const { container } = await openWithCart(cartOf(2));
    mocks.addToCart.mockRejectedValueOnce(new Error('Hết hàng'));
    click(stickyBuy(container));
    await flush(3);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(stickyBuy(container).getAttribute('aria-label')).toBe('Mua ngay 720.000đ');
    mocks.addToCart.mockResolvedValue(cartOf(3));
    click(addButton(container));
    await flush(3);
    expect(stickyBuy(container).getAttribute('aria-label')).toBe('Mua ngay 1.200.000đ');
  });

  it('giỏ chưa tải được (lỗi): coi như giỏ rỗng, nút vẫn bấm được và ghi số như khi không có giỏ', async () => {
    const { container } = await openWithCart(new Error('mất mạng'));
    click(plus(container));
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 480.000đ');
    expect(addButton(container).disabled).toBe(false);
    expect(container.textContent).not.toContain('Giỏ đã có');
  });

  it('giỏ chỉ có phân loại khác (v1 đang 4): số như khi giỏ rỗng', async () => {
    const { container } = await openWithCart({ items: [{ id: 'ci9', variationId: 'v1', quantity: 4 }], itemCount: 4 });
    click(plus(container));
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 480.000đ');
    expect(container.textContent).not.toContain('Giỏ đã có');
  });
});

describe('AddToCart — số suất Giờ vàng khách đã dùng ở các đơn trước (perUserLeft)', () => {
  const LIMITED = {
    itemId: 'f2', variationId: 'v2', productSlug: 'dau-goi', flashPrice: 240000, retailPrice: 300000,
    salePrice: null, soldCount: 1, quota: 10, perUserLimit: 3, endAt: '2099-10-14T16:00:00.000Z',
  };
  const SPENT = 'Bạn không còn suất Giờ vàng của sản phẩm này nên tính giá thường.';
  const plus = (c: HTMLElement) => c.querySelector('[data-section="pdp-quantity"] button[aria-label="Tăng số lượng"]');
  const stickyBuy = (c: HTMLElement) => c.querySelector('button[aria-label^="Mua ngay"]') as HTMLButtonElement;
  const note = (c: HTMLElement) => c.querySelector('[role="status"][data-section="pdp-flash-limit"]')!.textContent;

  async function open(status = 'authenticated') {
    mocks.getActiveFlashSales.mockResolvedValue([LIMITED]);
    mocks.auth = { status, initialized: status !== 'loading', user: status === 'authenticated' ? { id: 'u1' } : null };
    const r = mount();
    await flush();
    click(byText(r.container, 'button', /^500ml/));
    await flush();
    return r;
  }

  it('đã dùng hết suất (perUserLeft 0): Thêm vào giỏ và Mua ngay ghi giá thường 300.000đ, ghi chú hết suất; một request cho suất của sản phẩm', async () => {
    mocks.getFlashAllowance.mockResolvedValue({ items: { f2: { perUserLeft: 0, allowance: 0 } } });
    const { container } = await open();
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 300.000đ');
    expect(stickyBuy(container).getAttribute('aria-label')).toBe('Mua ngay 300.000đ');
    expect(note(container)).toBe(SPENT);
    expect(mocks.getFlashAllowance).toHaveBeenCalledTimes(1);
    expect(mocks.getFlashAllowance).toHaveBeenCalledWith(['f2']);
  });

  it('đổi số lượng không gọi lại endpoint', async () => {
    mocks.getFlashAllowance.mockResolvedValue({ items: { f2: { perUserLeft: 0, allowance: 0 } } });
    const { container } = await open();
    click(plus(container));
    click(plus(container));
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 900.000đ');
    expect(mocks.getFlashAllowance).toHaveBeenCalledTimes(1);
  });

  it('còn 1 suất: chọn 1 giá Giờ vàng; chọn 2 cả dòng giá thường kèm "Bạn còn 1 suất"', async () => {
    mocks.getFlashAllowance.mockResolvedValue({ items: { f2: { perUserLeft: 1, allowance: 1 } } });
    const { container } = await open();
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 240.000đ');
    click(plus(container));
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 600.000đ');
    expect(note(container)).toBe('Bạn còn 1 suất Giờ vàng. Mua 2 thì cả dòng tính giá thường.');
  });

  it('endpoint lỗi (API cũ): số như trước, nút vẫn bấm được', async () => {
    const { container } = await open();
    expect(mocks.getFlashAllowance).toHaveBeenCalled();
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 240.000đ');
    expect(addButton(container).disabled).toBe(false);
    expect(container.textContent).not.toContain(SPENT);
  });

  it('giữ chỗ ghi chú từ lần vẽ đầu khi đã đăng nhập đang xem Giờ vàng (allowance chưa về); chưa đăng nhập thì không giữ dải trống', async () => {
    mocks.getFlashAllowance.mockReturnValue(new Promise(() => {}));
    const authed = await open();
    expect(authed.container.querySelector('[data-section="pdp-flash-limit"]')!.className).toContain('tubu-pdp-flash-note');
    expect(note(authed.container)).toBe('');
    authed.unmount();
    const guest = await open('idle');
    expect(guest.container.querySelector('[data-section="pdp-flash-limit"]')!.className).not.toContain('tubu-pdp-flash-note');
  });

  it('phiên đang khôi phục (cờ phiên còn, chưa biết kết quả): giữ chỗ ngay để pha đăng nhập về không chèn thêm dải; không có cờ thì không giữ', async () => {
    mocks.getFlashAllowance.mockReturnValue(new Promise(() => {}));
    window.localStorage.setItem('tubu_web_session', '1');
    try {
      const restoring = await open('loading');
      expect(restoring.container.querySelector('[data-section="pdp-flash-limit"]')!.className).toContain('tubu-pdp-flash-note');
      restoring.unmount();
    } finally {
      window.localStorage.removeItem('tubu_web_session');
    }
    const noMarker = await open('loading');
    expect(noMarker.container.querySelector('[data-section="pdp-flash-limit"]')!.className).not.toContain('tubu-pdp-flash-note');
  });

  it('khách chưa đăng nhập: không gọi endpoint, số như trước', async () => {
    const { container } = await open('idle');
    expect(addButton(container).textContent).toBe('Thêm vào giỏ · 240.000đ');
    expect(mocks.getFlashAllowance).not.toHaveBeenCalled();
  });
});

describe('AddToCart — truy cập (A11Y-02, A11Y-03, A11Y-07)', () => {
  const signedIn = () => {
    mocks.auth = { status: 'authenticated', initialized: true, user: { id: 'u1' } };
  };
  const stickyBuy = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="sticky-bar"] button[aria-label^="Mua ngay"]')!;

  it('A11Y-03: thêm giỏ khi máy chủ chưa trả lời: nút chỉ aria-disabled (không disabled) nên giữ focus; bấm tiếp không gửi lần hai', async () => {
    signedIn();
    mocks.addToCart.mockReturnValue(new Promise(() => undefined));
    const { container } = mount();
    await flush();
    const add = addButton(container);
    add.focus();
    click(add);
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
    const pending = byText(container, 'button', /^Đang thêm/) as HTMLButtonElement;
    expect(pending.getAttribute('aria-disabled')).toBe('true');
    expect(pending.disabled).toBe(false);
    expect(document.activeElement).toBe(pending);
    click(pending);
    click(stickyBuy(container));
    await flush();
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it('A11Y-02: các vùng role=status có sẵn trước khi có lời báo; báo xong vẫn là chính các nút DOM đó, một trong số đó chứa lời báo', async () => {
    signedIn();
    const { container } = mount();
    await flush();
    const regions = Array.from(container.querySelectorAll('[role="status"]'));
    expect(regions.length).toBeGreaterThanOrEqual(2);
    expect(regions.every((r) => r.textContent === '')).toBe(true);
    click(addButton(container));
    await flush();
    expect(regions.every((r) => r.isConnected)).toBe(true);
    expect(Array.from(container.querySelectorAll('[role="status"]'))).toEqual(regions);
    expect(regions.filter((r) => r.textContent!.includes('Đã thêm vào giỏ!')).length).toBeGreaterThanOrEqual(1);
  });

  it('A11Y-07: nút Mua ngay ở thanh dính có tên bắt đầu bằng chữ nhìn thấy, không còn dấu "·" ngăn tên và giá', async () => {
    signedIn();
    const { container } = mount();
    await flush();
    const buy = stickyBuy(container);
    const visible = buy.textContent!.replace(/\s+/g, ' ').trim();
    expect(visible.startsWith('Mua ngay')).toBe(true);
    expect(buy.getAttribute('aria-label')).toBe(`Mua ngay ${buy.textContent!.replace('Mua ngay', '').trim()}`);
    expect(buy.getAttribute('aria-label')!.startsWith('Mua ngay')).toBe(true);
    expect(buy.getAttribute('aria-label')).not.toContain('·');
  });
});

describe('AddToCart — phân loại không có tên (86/154 phân loại trên PROD)', () => {
  const chipNames = (c: HTMLElement) =>
    Array.from(c.querySelectorAll<HTMLElement>('[data-section="pdp-variation-chips"] button')).map((b) => b.firstElementChild!.textContent);

  it('nhiều phân loại, một cái tên trống hoặc toàn khoảng trắng: chip ghi "Mặc định", các chip có tên giữ nguyên', () => {
    const { container } = mount([{ ...VARIATIONS[0]!, name: '' }, { ...VARIATIONS[1]!, name: '  ' }, { id: 'v3', name: '1 lít', retailPrice: 500000, salePrice: null, stock: 4 }]);
    expect(chipNames(container)).toEqual(['Mặc định', 'Mặc định', '1 lít']);
  });

  it('chỉ một phân loại tên trống: không có bộ chọn nào, nút Thêm vào giỏ vẫn có', () => {
    const { container } = mount([{ ...VARIATIONS[0]!, name: '' }]);
    expect(container.querySelector('[data-section="pdp-variation-chips"]')).toBeNull();
    expect(container.querySelector('button[aria-pressed]')).toBeNull();
    expect(addButton(container)).toBeTruthy();
  });

  it('nhiều phân loại, đều có tên: chip ghi đúng tên', () => {
    const { container } = mount();
    expect(chipNames(container)).toEqual(['250ml', '500ml']);
  });
});

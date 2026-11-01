// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// Cùng ý nghĩa product-detail-{coupons,freeship,flash,chat}.spec và phần đặt định kỳ/mua chung/content kit của product-detail.spec (Mini App).

const mocks = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  user: null as { tierId?: string | null } | null,
  push: vi.fn(),
  http: { get: vi.fn(), post: vi.fn() },
  getCart: vi.fn(),
  getProductStock: vi.fn(),
  flash: [] as unknown[],
  config: { freeshipThreshold: 199000, subscribeDiscountPct: 0.12, groupBuy: { discountPct: 15, targetSize: 3 } as unknown, isLoaded: true } as Record<string, unknown>,
  oa: { available: true, openChat: vi.fn() },
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: mocks.http }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: mocks.getCart,
  getProductStock: mocks.getProductStock,
}));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => mocks.config }));
vi.mock('@/lib/platform-bridge', () => ({
  platformBridge: {
    get oa() {
      return mocks.oa;
    },
  },
}));
vi.mock('./subscribe-sheet', () => ({
  SubscribeSheet: (p: { visible: boolean; variationId: string; quantity: number }) =>
    p.visible ? <div data-testid="sub-sheet" data-variation={p.variationId} data-qty={p.quantity} /> : null,
}));
vi.mock('./content-kit-sheet', () => ({
  ContentKitSheet: (p: { visible: boolean; productSlug: string }) => (p.visible ? <div data-testid="kit-sheet" data-slug={p.productSlug} /> : null),
}));

import { PdpSelectionProvider, usePdpSelection } from '@/components/pdp-selection';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PdpChatButton, PdpContentKitRow, PdpPointsEarn, PdpCoupons, PdpFlashBar, PdpFreeship, PdpGroupBuyRow, PdpSubscribeRow } from './pdp-extras';

const VARIATIONS = [
  { id: 'v1', stock: 0 },
  { id: 'v2', stock: 4 },
];
const coupon = (code: string, over: Record<string, unknown> = {}) => ({ code, type: 'AMOUNT', value: 20000, minOrder: null, maxDiscount: null, endAt: '2026-12-01', ...over });

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement, initialId = 'v2') => {
  const r = render(<PdpSelectionProvider initialId={initialId}>{ui}</PdpSelectionProvider>);
  mounted.push(r);
  return r;
};
const writeText = vi.fn();

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.user = null;
  mocks.push.mockReset();
  mocks.http.get.mockReset().mockResolvedValue([]);
  mocks.http.post.mockReset();
  mocks.getCart.mockReset().mockResolvedValue({ items: [], itemCount: 0, freeshipThreshold: 150000 });
  mocks.getProductStock.mockReset().mockResolvedValue({ v1: 0, v2: 4 });
  mocks.flash = [];
  mocks.config = { freeshipThreshold: 199000, subscribeDiscountPct: 0.12, groupBuy: { discountPct: 15, targetSize: 3 }, isLoaded: true };
  mocks.oa = { available: true, openChat: vi.fn() };
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  window.history.replaceState(null, '', '/san-pham/dau-goi');
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('PdpFreeship', () => {
  it('khách đăng nhập: ngưỡng theo hạng lấy từ giỏ', async () => {
    const { container } = mount(<PdpFreeship />);
    await flush();
    expect(container.querySelector('[data-testid="pdp-freeship"]')!.textContent).toBe('Miễn phí giao hàng cho đơn từ 150.000đ');
  });
  it('khách vãng lai: ngưỡng chung từ config; config chưa về thì chưa hứa số nào', async () => {
    mocks.phase = 'guest';
    const { container } = mount(<PdpFreeship />);
    await flush();
    expect(container.querySelector('[data-testid="pdp-freeship"]')!.textContent).toBe('Miễn phí giao hàng cho đơn từ 199.000đ');
    expect(mocks.getCart).not.toHaveBeenCalled();
    mocks.config = { ...mocks.config, isLoaded: false };
    const again = mount(<PdpFreeship />);
    await flush();
    expect(again.container.querySelector('[data-testid="pdp-freeship"]')).toBeNull();
  });
  it('ngưỡng 0 là mọi đơn', async () => {
    mocks.phase = 'guest';
    mocks.config = { ...mocks.config, freeshipThreshold: 0 };
    const { container } = mount(<PdpFreeship />);
    await flush();
    expect(container.textContent).toBe('Miễn phí giao hàng cho mọi đơn hàng');
  });
});

describe('PdpCoupons (dòng "Ưu đãi ›" mở hộp thoại mã)', () => {
  const rowButton = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="button"]')).find((b) => b.textContent?.includes('Ưu đãi'))!;
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  it('có mã dùng được cho sản phẩm này: dòng Ưu đãi ghi số mã; mã chung và mã gắn đúng sản phẩm tính, mã của sản phẩm khác thì không', async () => {
    mocks.http.get.mockResolvedValue([coupon('ALL', { type: 'PERCENT', value: 10, maxDiscount: 30000, minOrder: 100000 }), coupon('MINE', { products: [{ id: 'p1', name: 'a' }] }), coupon('OTHER', { products: [{ id: 'p2', name: 'b' }] })]);
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    expect(mocks.http.get).toHaveBeenCalledWith('/me/coupons');
    const row = rowButton(container);
    expect(row.textContent).toContain('2 mã giảm giá');
    expect(row.tabIndex).toBe(0);
    expect(container.querySelector('ul')).toBeNull();
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
  it('bấm dòng mở hộp thoại "Mã giảm giá" có mỗi mã một nút "Sao chép" và đúng điều kiện đơn tối thiểu', async () => {
    mocks.http.get.mockResolvedValue([coupon('ALL', { type: 'PERCENT', value: 10, maxDiscount: 30000, minOrder: 100000 }), coupon('MINE', { products: [{ id: 'p1', name: 'a' }] })]);
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    click(rowButton(container));
    await flush();
    const d = dialog()!;
    expect(d.getAttribute('aria-label') ?? d.textContent).toContain('Mã giảm giá');
    expect(Array.from(d.querySelectorAll('button')).filter((b) => b.textContent === 'Sao chép')).toHaveLength(2);
    expect(d.textContent).toContain('ALL');
    expect(d.textContent).toContain('Đơn từ 100k');
  });
  it('chép mã và báo mã đã có sẵn trong ví; không chép được thì cho khách tự ghi mã', async () => {
    mocks.http.get.mockResolvedValue([coupon('ALL')]);
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    click(rowButton(container));
    await flush();
    const copy = () => Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent === 'Sao chép') ?? null;
    click(copy());
    await flush();
    expect(writeText).toHaveBeenCalledWith('ALL');
    expect(dialog()!.querySelector('[role="status"]')!.textContent).toContain('Đã chép mã ALL');
    writeText.mockRejectedValue(new Error('denied'));
    click(copy());
    await flush();
    expect(dialog()!.querySelector('[role="status"]')!.textContent).toBe('Mã của bạn: ALL — chọn ở bước thanh toán');
  });
  it('khách chưa đăng nhập không có ví mã: không gọi API, không hiện', async () => {
    mocks.phase = 'guest';
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    expect(mocks.http.get).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });
  it('không có mã nào dùng được: không có dòng Ưu đãi', async () => {
    mocks.http.get.mockResolvedValue([coupon('OTHER', { products: [{ id: 'p2', name: 'b' }] })]);
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    expect(container.innerHTML).toBe('');
  });
});

describe('PdpFlashBar', () => {
  const item = (over: Record<string, unknown> = {}) => ({ itemId: 'i1', variationId: 'v2', productSlug: 'dau-goi', flashPrice: 100000, retailPrice: 150000, soldCount: 30, quota: 40, endAt: new Date(Date.now() + 90 * 60_000 + 20_000).toISOString(), ...over });
  const PRODUCT = { slug: 'dau-goi', basePrice: 150000, salePrice: null, variations: [{ id: 'v1', retailPrice: 150000, salePrice: null }, { id: 'v2', retailPrice: 150000, salePrice: null }] };
  it('đợt gắn đúng phân loại đang chọn: giá deal, giá gạch, -%, "Kết thúc sau …" theo phút và đã bán %', async () => {
    mocks.flash = [item({ perUserLimit: 2 })];
    const { container } = mount(<PdpFlashBar product={PRODUCT} />);
    await flush();
    const bar = container.querySelector('[data-testid="flash-price-bar"]')!;
    const t = bar.textContent!;
    expect(t).toContain('100.000đ');
    expect(t).toContain('150.000đ');
    expect(t).toContain('-33%');
    expect(bar.querySelector('[role="timer"]')!.textContent).toContain('Kết thúc sau 1 giờ 30 phút');
    expect(t).toContain('Đã bán 75%');
    expect(t).toContain('Mỗi khách tối đa 2');
    expect(t).not.toMatch(/Còn \d/);
  });
  it('đợt của phân loại khác thì không hiện; bán quá suất thì thanh ghi "Đã bán hết", không bao giờ quá 100%', async () => {
    mocks.flash = [item({ variationId: 'v1' })];
    expect(mount(<PdpFlashBar product={PRODUCT} />).container.innerHTML).toBe('');
    mocks.flash = [item({ soldCount: 90 })];
    const { container } = mount(<PdpFlashBar product={PRODUCT} />);
    await flush();
    expect(container.textContent).toContain('Đã bán hết');
    expect(container.textContent).not.toMatch(/Đã bán 1\d\d%/);
  });
  it('hết giờ khi khách đang xem: thanh biến mất ngay, không cần tải lại', async () => {
    mocks.flash = [item({ endAt: new Date(Date.now() + 600).toISOString() })];
    const { container } = mount(<PdpFlashBar product={PRODUCT} />);
    await flush();
    expect(container.querySelector('[data-testid="flash-price-bar"]')).not.toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    expect(container.querySelector('[data-testid="flash-price-bar"]')).toBeNull();
  });
});

describe('PdpSubscribeRow', () => {
  it('có dòng Đặt định kỳ với mức giảm từ config khi phân loại đang chọn còn hàng; chạm mở sheet đúng phân loại và số lượng đang chọn', async () => {
    function SetQty() {
      const s = usePdpSelection()!;
      return <button data-testid="q3" onClick={() => s.setQuantity(3)} />;
    }
    const { container } = mount(<><SetQty /><PdpSubscribeRow slug="dau-goi" variations={VARIATIONS} /></>);
    await flush();
    click(container.querySelector('[data-testid="q3"]'));
    const row = byText(container, 'button', /Đặt định kỳ/)!;
    expect(row.textContent).toBe('Đặt định kỳ — tiết kiệm 12%');
    click(row);
    await flush();
    const sheet = container.ownerDocument.querySelector('[data-testid="sub-sheet"]')!;
    expect(sheet.getAttribute('data-variation')).toBe('v2');
    expect(sheet.getAttribute('data-qty')).toBe('3');
  });
  it('ẩn khi phân loại đang chọn hết hàng (kể cả khi tồn kho thật vừa về thấp hơn bản ISR)', async () => {
    expect(mount(<PdpSubscribeRow slug="dau-goi" variations={VARIATIONS} />, 'v1').container.innerHTML).toBe('');
    mocks.getProductStock.mockResolvedValue({ v1: 0, v2: 0 });
    const { container } = mount(<PdpSubscribeRow slug="dau-goi" variations={VARIATIONS} />);
    await flush();
    expect(container.innerHTML).toBe('');
  });
  it('khách chưa đăng nhập: sang đăng nhập, quay lại đúng trang kèm cờ mở lại sheet', async () => {
    mocks.phase = 'guest';
    const { container } = mount(<PdpSubscribeRow slug="dau-goi" variations={VARIATIONS} />);
    await flush();
    click(byText(container, 'button', /Đặt định kỳ/));
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi%3Ftiep%3Ddinh-ky');
  });
  it('quay về sau đăng nhập có cờ ?tiep=dinh-ky thì tự mở sheet và gỡ cờ khỏi địa chỉ', async () => {
    window.history.replaceState(null, '', '/san-pham/dau-goi?ref=A&tiep=dinh-ky');
    const { container } = mount(<PdpSubscribeRow slug="dau-goi" variations={VARIATIONS} />);
    await flush();
    expect(container.ownerDocument.querySelector('[data-testid="sub-sheet"]')).not.toBeNull();
    expect(window.location.search).toBe('?ref=A');
  });
  it('mất kết nối lúc khôi phục phiên: nói rõ thay vì mời đăng nhập lại', async () => {
    mocks.phase = 'unavailable';
    const { container } = mount(<PdpSubscribeRow slug="dau-goi" variations={VARIATIONS} />);
    await flush();
    click(byText(container, 'button', /Đặt định kỳ/));
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Chưa kết nối được tới Tubu Tree');
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe('PdpGroupBuyRow', () => {
  it('đăng nhập: POST /group-buy {productId} rồi sang /mua-chung/<id>', async () => {
    mocks.http.post.mockResolvedValue({ id: 'g1' });
    const { container } = mount(<PdpGroupBuyRow productId="p1" slug="dau-goi" />);
    expect(container.textContent).toContain('Rủ đủ 3 người, mỗi người nhận mã giảm 15% khi nhóm đủ');
    click(byText(container, 'button', /Mở nhóm mua chung/));
    await flush();
    expect(mocks.http.post).toHaveBeenCalledWith('/group-buy', { productId: 'p1' });
    expect(mocks.push).toHaveBeenCalledWith('/mua-chung/g1?moi=1');
  });
  it('bấm hai lần liên tiếp chỉ tạo một nhóm', async () => {
    let resolve!: (v: unknown) => void;
    mocks.http.post.mockReturnValue(new Promise((r) => (resolve = r)));
    const { container } = mount(<PdpGroupBuyRow productId="p1" slug="dau-goi" />);
    click(byText(container, 'button', /Mở nhóm mua chung/));
    await flush(1);
    expect(container.textContent).toContain('Đang mở nhóm…');
    click(container.querySelector('button'));
    await act(async () => resolve({ id: 'g1' }));
    expect(mocks.http.post).toHaveBeenCalledTimes(1);
  });
  it('khách chưa đăng nhập: sang đăng nhập, không tạo nhóm', async () => {
    mocks.phase = 'guest';
    const { container } = mount(<PdpGroupBuyRow productId="p1" slug="dau-goi" />);
    click(container.querySelector('button'));
    expect(mocks.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fdau-goi');
    expect(mocks.http.post).not.toHaveBeenCalled();
  });
  it('API từ chối thì hiện lỗi tại chỗ', async () => {
    mocks.http.post.mockRejectedValue(new Error('Sản phẩm không mở nhóm được'));
    const { container } = mount(<PdpGroupBuyRow productId="p1" slug="dau-goi" />);
    click(container.querySelector('button'));
    await flush();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Sản phẩm không mở nhóm được');
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it('config chưa có thông số mua chung thì không hứa con số', () => {
    mocks.config = { ...mocks.config, groupBuy: undefined };
    const { container } = mount(<PdpGroupBuyRow productId="p1" slug="dau-goi" />);
    expect(container.textContent).toContain('Rủ bạn bè cho đủ nhóm, mỗi người nhận mã giảm giá');
  });
});

describe('PdpContentKitRow', () => {
  it('chỉ cộng tác viên thấy; chạm mở sheet đúng sản phẩm', async () => {
    mocks.http.get.mockResolvedValue({ isAffiliate: true });
    const { container } = mount(<PdpContentKitRow slug="dau-goi" />);
    await flush();
    expect(mocks.http.get).toHaveBeenCalledWith('/affiliate/me');
    click(byText(container, 'button', /Nội dung bán hàng/));
    expect(container.ownerDocument.querySelector('[data-testid="kit-sheet"]')!.getAttribute('data-slug')).toBe('dau-goi');
  });
  it('không phải cộng tác viên hoặc khách chưa đăng nhập thì không hiện và không gọi API', async () => {
    mocks.http.get.mockResolvedValue({ isAffiliate: false });
    expect(mount(<PdpContentKitRow slug="dau-goi" />).container.innerHTML).toBe('');
    mocks.phase = 'guest';
    mocks.http.get.mockClear();
    mount(<PdpContentKitRow slug="dau-goi" />);
    await flush();
    expect(mocks.http.get).not.toHaveBeenCalled();
  });
});

describe('PdpChatButton', () => {
  const chatOn = { enabled: true, hours: { start: '08:00', end: '21:00' } };

  it('mở chat OA kèm câu hỏi về sản phẩm', () => {
    const { container } = mount(<PdpChatButton productName="Dầu gội" productSlug="dau-goi" />);
    click(byText(container, 'button', 'Chat với Tubu Tree'));
    expect(mocks.oa.openChat).toHaveBeenCalledWith('Mình muốn hỏi về sản phẩm: Dầu gội');
  });
  it('OA chưa cấu hình thì không hiện nút', () => {
    mocks.oa.available = false;
    expect(mount(<PdpChatButton productName="Dầu gội" productSlug="dau-goi" />).container.innerHTML).toBe('');
  });

  it('chat bật và đã đăng nhập: nút dẫn tới /ho-tro/chat?product=<slug>, không còn nút OA', () => {
    mocks.config.chat = chatOn;
    const { container } = mount(<PdpChatButton productName="Dầu gội" productSlug="dau-goi" />);
    const link = container.querySelector('a')!;
    expect(link.textContent).toContain('Chat với Tubu Tree');
    expect(link.getAttribute('href')).toBe('/ho-tro/chat?product=dau-goi');
    expect(container.querySelector('button')).toBeNull();
  });

  it('chat bật nhưng chưa đăng nhập: giữ nút OA, thêm lời mời đăng nhập quay lại đúng trang chat', () => {
    mocks.config.chat = chatOn;
    mocks.phase = 'guest';
    const { container } = mount(<PdpChatButton productName="Dầu gội" productSlug="dau-goi" />);
    expect(byText(container, 'button', 'Chat với Tubu Tree')).not.toBeNull();
    const invite = byText(container, 'a', 'Đăng nhập để chat với Tubu Tree')!;
    expect(invite.getAttribute('href')).toBe('/dang-nhap?returnTo=%2Fho-tro%2Fchat%3Fproduct%3Ddau-goi');
  });

  it('chat bật, đang khôi phục phiên: không có nút chat lẫn lời mời', () => {
    mocks.config.chat = chatOn;
    mocks.phase = 'loading';
    const { container } = mount(<PdpChatButton productName="Dầu gội" productSlug="dau-goi" />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('chat tắt: không có lời mời đăng nhập dù chưa đăng nhập', () => {
    mocks.phase = 'guest';
    const { container } = mount(<PdpChatButton productName="Dầu gội" productSlug="dau-goi" />);
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('PdpPointsEarn — nối giá, số lượng, hệ số hạng vào lời hứa Điểm Xanh', () => {
  const PRODUCT = { slug: 'dau-goi', basePrice: 289000, variations: [{ id: 'v2', retailPrice: 289000 }] };
  function Qty({ n }: { n: number }) {
    const sel = usePdpSelection()!;
    return <button type="button" data-testid="qty" onClick={() => sel.setQuantity(n)} />;
  }
  const line = () => document.querySelector('[data-testid="pdp-points-earn"]')?.textContent;
  async function mountEarn(opts: { qty?: number } = {}) {
    const qc = new QueryClient();
    const r = render(
      <QueryClientProvider client={qc}>
        <PdpSelectionProvider initialId="v2">
          <Qty n={opts.qty ?? 1} />
          <PdpPointsEarn product={PRODUCT} />
        </PdpSelectionProvider>
      </QueryClientProvider>,
    );
    mounted.push(r);
    if (opts.qty) click(document.querySelector('[data-testid="qty"]'));
    await flush();
  }
  beforeEach(() => {
    mocks.config = { ...mocks.config, loyalty: { earnPct: 0.02, vndPerPointRedeem: 100, tierMultipliers: { t1: 1, t2: 1.5 }, tierNames: { t1: 'Mầm Xanh', t2: 'Lộc Biếc' } } } as typeof mocks.config;
  });

  it('khách vãng lai (hệ số 1): 289.000đ x 2 ra 115 Điểm Xanh, quy 11.500đ', async () => {
    mocks.phase = 'guest';
    await mountEarn({ qty: 2 });
    expect(line()).toBe('Nhận ~115 Điểm Xanh');
  });

  it('Giờ vàng rẻ hơn: tính theo giá flash, không theo giá lẻ', async () => {
    mocks.phase = 'guest';
    mocks.flash = [{ variationId: 'v2', flashPrice: 200000 }];
    await mountEarn();
    expect(line()).toBe('Nhận ~40 Điểm Xanh');
  });

  it('đã đăng nhập, hạng Lộc Biếc ×1,5 trong bảng config: nhân hệ số và nói rõ hạng, không cần cache loyalty', async () => {
    mocks.user = { tierId: 't2' };
    await mountEarn({ qty: 2 });
    expect(line()).toBe('Nhận ~173 Điểm Xanh');
  });

  it('hạng Mầm Xanh (hệ số 1) hoặc chưa có hạng: số gốc, không có giải thích', async () => {
    mocks.user = { tierId: 't1' };
    await mountEarn({ qty: 2 });
    expect(line()).toBe('Nhận ~115 Điểm Xanh');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.user = { tierId: null };
    await mountEarn({ qty: 2 });
    expect(line()).toBe('Nhận ~115 Điểm Xanh');
  });

  it('đã đăng nhập nhưng chưa biết hạng (phiên cũ, hạng lạ), hoặc đang khôi phục phiên: nói chung, không đoán số', async () => {
    mocks.user = { tierId: 'ghost' };
    await mountEarn({ qty: 2 });
    expect(line()).toBe('Nhận Điểm Xanh khi đơn giao thành công');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.phase = 'loading';
    await mountEarn({ qty: 2 });
    expect(line()).toBe('Nhận Điểm Xanh khi đơn giao thành công');
  });

  describe('popup Cách tính Điểm Xanh', () => {
    const btn = () => document.querySelector<HTMLButtonElement>('[data-testid="pdp-points-earn"]')!;
    const dialog = () => document.querySelector('[role="dialog"]');
    const openPopup = () => {
      btn().focus();
      click(btn());
    };

    it('dòng là nút có nhãn đọc màn hình, vùng bấm ≥ 44px, chữ dòng không đổi', async () => {
      mocks.user = { tierId: 't2' };
      await mountEarn({ qty: 2 });
      expect(btn().tagName).toBe('BUTTON');
      expect(btn().getAttribute('aria-label')).toContain('Xem cách tính Điểm Xanh');
      expect(btn().className).toContain('min-h-11');
      expect(btn().className).not.toMatch(/-mb-/);
      expect(line()).toBe('Nhận ~173 Điểm Xanh');
      expect(dialog()).toBeNull();
    });

    it('có hạng: nói hạng và hệ số theo tierId', async () => {
      mocks.user = { tierId: 't2' };
      await mountEarn();
      openPopup();
      expect(dialog()?.getAttribute('aria-labelledby')).toBeTruthy();
      expect(dialog()?.textContent).toContain('Cách tính Điểm Xanh');
      expect(dialog()?.textContent).toContain('Hạng Lộc Biếc: ×1,5');
    });

    it('khách vãng lai: ×1 và mời đăng nhập', async () => {
      mocks.phase = 'guest';
      await mountEarn();
      openPopup();
      expect(dialog()?.textContent).toMatch(/hệ số ×1\. Đăng nhập/);
    });

    it('có giải thích dấu "~", điểm vào khi giao thành công và liên kết tới trang Điểm Xanh', async () => {
      mocks.user = { tierId: 't1' };
      await mountEarn();
      openPopup();
      const text = dialog()?.textContent ?? '';
      expect(text).toContain('giảm giá, mã giảm giá và điểm dùng lúc thanh toán');
      expect(text).toContain('Nhận Điểm Xanh khi đơn giao thành công');
      expect(dialog()?.querySelector('a[href="/tai-khoan/diem-xanh"]')?.textContent).toBe('Xem các hạng Điểm Xanh');
    });

    it('cờ đơn sàn tắt: không có mục đơn sàn; bật: nguyên câu đơn sàn', async () => {
      mocks.user = { tierId: 't1' };
      await mountEarn();
      openPopup();
      expect(dialog()?.textContent).not.toContain('Đơn sàn');
      mounted.forEach((m) => m.unmount());
      mounted = [];
      mocks.config = { ...mocks.config, loyalty: { ...(mocks.config.loyalty as object), earnPct: 2, marketplaceEarnPct: 1, marketplaceClaimEnabled: true } } as typeof mocks.config;
      await mountEarn();
      openPopup();
      expect(dialog()?.textContent).toContain('Đơn sàn 1% · Mua tại Tubu Tree từ 2%, nhân theo hạng');
    });

    it('từ md: hộp giữa màn hình (Sheet chuẩn), dưới md: sheet đáy', async () => {
      mocks.user = { tierId: 't1' };
      await mountEarn();
      openPopup();
      expect(dialog()?.parentElement?.className).toContain('md:items-center');
      expect(dialog()?.className).toContain('md:max-w-lg');
    });

    it('web chưa có trang gửi đơn sàn: có câu đơn sàn nhưng không có liên kết /points/scan', async () => {
      mocks.user = { tierId: 't1' };
      mocks.config = { ...mocks.config, loyalty: { ...(mocks.config.loyalty as object), earnPct: 2, marketplaceEarnPct: 1, marketplaceClaimEnabled: true } } as typeof mocks.config;
      await mountEarn();
      openPopup();
      expect(dialog()?.textContent).toContain('Đơn sàn 1%');
      expect(dialog()?.querySelector('a[href="/points/scan"]')).toBeNull();
    });

    it('Esc đóng popup và trả focus về dòng; nút Đóng cũng đóng được', async () => {
      mocks.user = { tierId: 't1' };
      await mountEarn();
      openPopup();
      expect(dialog()).not.toBeNull();
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(btn());
      openPopup();
      click(dialog()!.querySelector('button[aria-label="Đóng"]'));
      expect(dialog()).toBeNull();
    });
  });
});

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
import { PdpChatButton, PdpContentKitRow, PdpPointsEarn, PdpCoupons, PdpFlashMeta, PdpFreeship, PdpGroupBuyRow, PdpSubscribeRow } from './pdp-extras';

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

describe('PdpCoupons', () => {
  it('hiện mã dùng được cho sản phẩm này: mã chung và mã gắn đúng sản phẩm, bỏ mã của sản phẩm khác', async () => {
    mocks.http.get.mockResolvedValue([coupon('ALL', { type: 'PERCENT', value: 10, maxDiscount: 30000, minOrder: 100000 }), coupon('MINE', { products: [{ id: 'p1', name: 'a' }] }), coupon('OTHER', { products: [{ id: 'p2', name: 'b' }] })]);
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    expect(mocks.http.get).toHaveBeenCalledWith('/me/coupons');
    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Sao chép mã ALL', 'Sao chép mã MINE']);
    expect(container.textContent).toContain('ALL · Giảm 10% (tối đa 30.000đ)');
    expect(container.textContent).toContain('Đơn từ 100.000đ');
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });
  it('ở điện thoại mã xếp thành hàng cuộn ngang, chip ôm nội dung như Mini App', async () => {
    mocks.http.get.mockResolvedValue([coupon('ALL')]);
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    expect(container.querySelector('ul')!.className).toContain('max-md:overflow-x-auto');
    expect(container.querySelector('ul')!.className).not.toContain('max-md:flex-col');
    expect(container.querySelector('button')!.className).not.toContain('max-md:w-full');
  });
  it('chạm chép mã và báo mã đã có sẵn trong ví; không chép được thì cho khách tự ghi mã', async () => {
    mocks.http.get.mockResolvedValue([coupon('ALL')]);
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    click(container.querySelector('button'));
    await flush();
    expect(writeText).toHaveBeenCalledWith('ALL');
    expect(container.querySelector('[role="status"]')!.textContent).toContain('Đã chép mã ALL');
    writeText.mockRejectedValue(new Error('denied'));
    click(container.querySelector('button'));
    await flush();
    expect(container.querySelector('[role="status"]')!.textContent).toBe('Mã của bạn: ALL — chọn ở bước thanh toán');
  });
  it('khách chưa đăng nhập không có ví mã: không gọi API, không hiện', async () => {
    mocks.phase = 'guest';
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    expect(mocks.http.get).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe('');
  });
  it('chỉ hiện tối đa 6 mã', async () => {
    mocks.http.get.mockResolvedValue(Array.from({ length: 9 }, (_, i) => coupon(`C${i}`)));
    const { container } = mount(<PdpCoupons productId="p1" />);
    await flush();
    expect(container.querySelectorAll('button')).toHaveLength(6);
  });
});

describe('PdpFlashMeta', () => {
  const item = (over: Record<string, unknown> = {}) => ({ itemId: 'i1', variationId: 'v2', productSlug: 'dau-goi', flashPrice: 100000, retailPrice: 150000, soldCount: 30, quota: 40, endAt: new Date(Date.now() + 90 * 60_000).toISOString(), ...over });
  it('đợt gắn đúng phân loại đang chọn: đếm ngược và đã bán %', async () => {
    mocks.flash = [item()];
    const { container } = mount(<PdpFlashMeta />);
    await flush();
    const t = container.querySelector('[data-testid="pdp-flash-meta"]')!.textContent!;
    expect(t).toMatch(/Còn 1h 3\dm|Còn 1h 30m/);
    expect(t).toContain('Đã bán 75%');
  });
  it('đợt của phân loại khác thì không hiện; đã bán quá suất kẹp ở 100%', async () => {
    mocks.flash = [item({ variationId: 'v1' })];
    expect(mount(<PdpFlashMeta />).container.innerHTML).toBe('');
    mocks.flash = [item({ soldCount: 90 })];
    const { container } = mount(<PdpFlashMeta />);
    await flush();
    expect(container.textContent).toContain('Đã bán 100%');
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
    expect(line()).toBe('Nhận tối đa 115 Điểm Xanh (≈11.500đ) khi đơn giao thành công');
  });

  it('Giờ vàng rẻ hơn: tính theo giá flash, không theo giá lẻ', async () => {
    mocks.phase = 'guest';
    mocks.flash = [{ variationId: 'v2', flashPrice: 200000 }];
    await mountEarn();
    expect(line()).toBe('Nhận tối đa 40 Điểm Xanh (≈4.000đ) khi đơn giao thành công');
  });

  it('đã đăng nhập, hạng Lộc Biếc ×1,5 trong bảng config: nhân hệ số và nói rõ hạng, không cần cache loyalty', async () => {
    mocks.user = { tierId: 't2' };
    await mountEarn({ qty: 2 });
    expect(line()).toBe('Nhận tối đa 173 Điểm Xanh · hạng Lộc Biếc ×1,5 (≈17.300đ) khi đơn giao thành công');
  });

  it('hạng Mầm Xanh (hệ số 1) hoặc chưa có hạng: số gốc, không có giải thích', async () => {
    mocks.user = { tierId: 't1' };
    await mountEarn({ qty: 2 });
    expect(line()).toBe('Nhận tối đa 115 Điểm Xanh (≈11.500đ) khi đơn giao thành công');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    mocks.user = { tierId: null };
    await mountEarn({ qty: 2 });
    expect(line()).toBe('Nhận tối đa 115 Điểm Xanh (≈11.500đ) khi đơn giao thành công');
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
});

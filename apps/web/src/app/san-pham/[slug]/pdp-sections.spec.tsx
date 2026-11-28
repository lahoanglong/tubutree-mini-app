// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ http: { get: vi.fn() } }));
vi.mock('@/lib/core-http', () => ({ coreHttp: mocks.http }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [], useRunningFlash: () => ({ flash: ([] as { endAt?: string }[]).filter((f) => !f.endAt || Date.parse(f.endAt) > Date.now()), now: Date.now() }) }));
// Dải gợi ý cá nhân (/products/for-you) chỉ gọi khi đã đăng nhập; đường khách vãng lai có spec riêng ở pdp-rails.spec.tsx.
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
const cfg = vi.hoisted(() => ({ returnWindowDays: undefined as number | undefined }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ isLoaded: cfg.returnWindowDays !== undefined, returnWindowDays: cfg.returnWindowDays }) }));
vi.mock('@/lib/use-catalog-launch-date', () => ({ useCatalogLaunchDate: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

import { PdpDescription, PdpIngredients, PdpPromises, PdpRating } from './pdp-sections';
import { PdpRails } from './pdp-rails';

let mounted: Rendered[] = [];
const mount = (ui: React.ReactElement) => {
  const r = render(ui);
  mounted.push(r);
  return r;
};
afterEach(() => {
  cfg.returnWindowDays = undefined;
  mounted.forEach((m) => m.unmount());
  mounted = [];
  mocks.http.get.mockReset();
});

const card = (n: number) => ({ id: `p${n}`, slug: `sp-${n}`, brand: 'Xanh', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock: true });

describe('PdpRating', () => {
  it('có đánh giá thì ghi điểm trung bình và số đánh giá, sao có tên truy cập', () => {
    const { container } = mount(<PdpRating average={4.5} count={8} />);
    expect(container.textContent).toContain('4,5 · 8 đánh giá');
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('4,5 trên 5 sao');
  });
  it('chưa có đánh giá thì không hiện', () => {
    expect(mount(<PdpRating average={0} count={0} />).container.innerHTML).toBe('');
    expect(mount(<PdpRating average={undefined} count={undefined} />).container.innerHTML).toBe('');
  });
});

const toggleOf = (c: HTMLElement, block: string) => c.querySelector<HTMLButtonElement>(`[data-testid="pdp-${block}-toggle"]`)!;
const bodyOf = (c: HTMLElement, block: string) => c.querySelector<HTMLElement>(`#${CSS.escape(toggleOf(c, block).getAttribute('aria-controls')!)}`)!;

describe('PdpIngredients', () => {
  const ING = [{ name: 'Bồ kết', percentage: '30%', benefit: 'Sạch dịu' }, { name: 'Gừng' }];
  it('dòng gập "Thành phần": gập sẵn kèm gợi ý số thành phần; tên, tỉ lệ, công dụng vẫn nằm trong HTML; bấm mở rồi thu lại', () => {
    const { container } = mount(<PdpIngredients ingredients={ING} />);
    expect(container.querySelector('[data-pdp-block="ingredients"]')).not.toBeNull();
    const toggle = toggleOf(container, 'ingredients');
    expect(toggle.textContent).toBe('Thành phần2 thành phần');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(bodyOf(container, 'ingredients').hidden).toBe(true);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).toContain('Bồ kết');
    expect(container.textContent).toContain('30%');
    expect(container.textContent).toContain('Sạch dịu');
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(bodyOf(container, 'ingredients').hidden).toBe(false);
    expect(toggle.textContent).toBe('Thành phần');
    click(toggle);
    expect(bodyOf(container, 'ingredients').hidden).toBe(true);
    expect(smallTouchTargets(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
    expect(mount(<PdpIngredients ingredients={null} />).container.innerHTML).toBe('');
    expect(mount(<PdpIngredients ingredients={[]} />).container.innerHTML).toBe('');
  });

  it('nhãn INCI đủ 20 tên (trần lưu mới của admin): một nút gập duy nhất, cả 20 tên vẫn nằm trong HTML', () => {
    const inci = Array.from({ length: 20 }, (_, i) => ({ name: `INCI ${i + 1}` }));
    const { container } = mount(<PdpIngredients ingredients={inci} />);
    expect(container.querySelectorAll('[data-testid="pdp-ingredient"]')).toHaveLength(20);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(toggleOf(container, 'ingredients').textContent).toContain('20 thành phần');
    expect(container.textContent).toContain('INCI 20');
  });
});

describe('PdpPromises', () => {
  it('hàng Tubu giao: dải ba trụ cột, nút chat trong dải, các hàng phụ ngay dưới; không còn danh sách "Cam kết Tubu" lặp lại', () => {
    cfg.returnWindowDays = 10;
    const { container } = mount(
      <PdpPromises fulfillerKind="TUBU" rows={<button type="button">Mở nhóm mua chung</button>}>
        <button>Chat</button>
      </PdpPromises>,
    );
    const root = container.querySelector('[data-pdp-block="promises"]')!;
    expect(root).not.toBeNull();
    expect(root.querySelectorAll('li')).toHaveLength(3);
    expect(byText(root.querySelector('[data-section="pdp-promises"]')!, 'button', 'Chat')).not.toBeNull();
    const row = byText(root, 'button', 'Mở nhóm mua chung')!;
    expect(root.querySelector('[data-section="pdp-promises"]')!.contains(row)).toBe(false);
    expect(container.textContent).not.toContain('Cam kết Tubu');
  });

  it('khối cam kết không thêm link chính sách vận chuyển riêng (đã có ở dòng "Vận chuyển ›"): chỉ còn lối xem của dải; vùng chạm 44px', () => {
    cfg.returnWindowDays = 10;
    const withReturns = mount(<PdpPromises fulfillerKind="TUBU" />).container;
    expect(Array.from(withReturns.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/chinh-sach/doi-tra']);
    expect(withReturns.querySelector('[data-testid="pdp-shipping-policy"]')).toBeNull();
    expect(unnamedControls(withReturns)).toEqual([]);
    expect(smallTouchTargets(withReturns)).toEqual([]);
    cfg.returnWindowDays = 0;
    const noReturns = mount(<PdpPromises fulfillerKind="TUBU" />).container;
    expect(Array.from(noReturns.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/chinh-sach/van-chuyen']);
    expect(noReturns.querySelectorAll('li')).toHaveLength(2);
  });

  it('hàng gian hàng tự giao: không có dải ba trụ cột (không hứa thay gian hàng), link chính sách vận chuyển là lối duy nhất, vẫn có nút chat', () => {
    cfg.returnWindowDays = 10;
    const { container } = mount(
      <PdpPromises fulfillerKind="MERCHANT">
        <button>Chat</button>
      </PdpPromises>,
    );
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/chinh-sach/van-chuyen']);
    expect(byText(container, 'button', 'Chat')).not.toBeNull();
    expect(smallTouchTargets(container.querySelector('a')!.parentElement!)).toEqual([]);
  });
});

describe('PdpDescription', () => {
  const body = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-testid="pdp-description-body"]')!;
  it('dòng gập "Mô tả chi tiết": gập sẵn, chữ vẫn nằm trong DOM; không còn nút Xem thêm', () => {
    const { container } = mount(<PdpDescription source="Ngắn gọn" />);
    expect(container.querySelector('[data-pdp-block="description"]')).not.toBeNull();
    expect(toggleOf(container, 'description').textContent).toBe('Mô tả chi tiết');
    expect(bodyOf(container, 'description').hidden).toBe(true);
    expect(container.textContent).toContain('Ngắn gọn');
    expect(byText(container, 'button', /Xem thêm|Thu gọn/)).toBeNull();
  });
  it('mô tả HTML: đoạn, danh sách, chữ đậm vẽ thành phần tử thật; không lộ thẻ thành chữ, thẻ lạ và mã script bị bỏ', () => {
    const { container } = mount(
      <PdpDescription source={'<p>Gội <strong>êm</strong> &amp; thơm</p><ul><li>Bồ kết</li><li>Gừng</li></ul><script>alert(1)</script><img src=x onerror="alert(2)">'} />,
    );
    const el = body(container);
    expect(el.textContent).not.toMatch(/<\/?[a-z]+/i);
    expect(el.textContent).not.toContain('alert');
    expect(el.querySelector('strong')!.textContent).toBe('êm');
    expect(Array.from(el.querySelectorAll('ul li')).map((li) => li.textContent)).toEqual(['Bồ kết', 'Gừng']);
    expect(el.textContent).toContain('Gội êm & thơm');
    expect(el.querySelector('script, img')).toBeNull();
  });
  it('mô tả rỗng sau khi bỏ thẻ: không dựng khối', () => {
    expect(mount(<PdpDescription source="<p> </p>" />).container.innerHTML).toBe('');
    expect(mount(<PdpDescription source={null} />).container.innerHTML).toBe('');
  });
  it('mô tả dài: bấm dòng thì mở đủ, aria-expanded đổi; vùng chạm 44px, nút có tên', () => {
    const text = 'Chữ dài '.repeat(60);
    const { container } = mount(<PdpDescription source={text} />);
    expect(body(container).textContent).toBe(text.trim());
    const toggle = toggleOf(container, 'description');
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(bodyOf(container, 'description').hidden).toBe(false);
    expect(smallTouchTargets(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
  });
});

describe('PdpRails', () => {
  const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => card(from + i));
  const server = (map: Record<string, unknown>) => mocks.http.get.mockImplementation(async (p: string) => map[p] ?? []);

  it('có danh sách server dựng sẵn thì hiện ngay dải Cùng thương hiệu (tên nhãn ở tên đọc), thẻ trỏ /san-pham/<slug>; "Khách thường mua cùng" không nằm ở đây', async () => {
    server({});
    const { container } = mount(<PdpRails productId="cur" slug="dau-goi" brand="Xanh Việt" initialRelated={[card(1)]} />);
    await flush();
    expect(container.querySelector('[data-pdp-block="suggestions"]')).not.toBeNull();
    const titles = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    expect(titles).toEqual(['Cùng thương hiệu']);
    expect(container.querySelector('[aria-label="Cùng thương hiệu Xanh Việt"]')).not.toBeNull();
    expect(Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/san-pham/sp-1']);
    // Dải thương hiệu không bị hỏi lại khi server đã đưa danh sách; dải mua cùng thuộc khối mua kèm nên ở đây không gọi; chỉ "Có thể bạn cũng thích" tải ở trình duyệt.
    expect(mocks.http.get.mock.calls.map((c) => c[0]).filter((p) => p !== '/config/public' && p !== '/me/wishlist/ids')).toEqual(['/products/for-you']);
  });
  it('thiếu dữ liệu server thì tải ở trình duyệt: khung chờ rồi hiện; endpoint như Mini App', async () => {
    server({ '/products/dau-goi/related': [card(1)] });
    const { container } = mount(<PdpRails productId="cur" slug="dau-goi" brand="Xanh" />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await flush();
    expect(mocks.http.get.mock.calls.map((c) => c[0]).filter((p) => p !== '/config/public' && p !== '/me/wishlist/ids').sort()).toEqual(['/products/dau-goi/related', '/products/for-you']);
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(container.querySelector('h2')!.textContent).toBe('Cùng thương hiệu');
  });
  it('lỗi hoặc rỗng thì ẩn dải, không vỡ trang', async () => {
    mocks.http.get.mockRejectedValue(new Error('500'));
    const { container } = mount(<PdpRails productId="cur" slug="dau-goi" brand="Xanh" />);
    await flush();
    expect(container.innerHTML).toBe('');
  });
  it('"Có thể bạn cũng thích" ở cuối: lưới, không có món đang xem, không trùng dải Cùng thương hiệu; dưới 4 món thì ẩn', async () => {
    const brand = [card(20)];
    server({ '/products/for-you': [card(99), brand[0]!, ...many(30, 5)] });
    const { container } = mount(<PdpRails productId="p99" slug="dau-goi" brand="Xanh" initialRelated={brand} />);
    await flush();
    const titles = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    expect(titles).toEqual(['Cùng thương hiệu', 'Có thể bạn cũng thích']);
    const feed = container.querySelector('section[aria-labelledby="pdp-feed-title"]')!;
    const hrefs = Array.from(feed.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/san-pham/sp-30', '/san-pham/sp-31', '/san-pham/sp-32', '/san-pham/sp-33', '/san-pham/sp-34']);
    mounted.pop()!.unmount();
    server({ '/products/for-you': many(30, 3) });
    const few = mount(<PdpRails productId="p99" slug="dau-goi" brand="Xanh" initialRelated={[]} />);
    await flush();
    expect(few.container.querySelector('#pdp-feed-title')).toBeNull();
  });
});

describe('khối nửa dưới là dải trắng cách nhau 8px ở điện thoại (như Mini App)', () => {
  it('Cam kết là dải riêng; Thành phần và Mô tả là dòng gập trong dải "Chi tiết sản phẩm" (lớp CSS dùng chung với Mini App)', () => {
    const promises = mount(<PdpPromises fulfillerKind="TUBU" />).container.querySelector('[data-section="pdp-promises"]')!;
    expect(promises.className).toContain('max-md:mt-2');
    expect(promises.className).toContain('max-md:bg-[var(--color-bg-surface)]');
    expect(promises.className).toContain('max-md:p-4');
    for (const el of [
      mount(<PdpIngredients ingredients={[{ name: 'Gừng' }]} />).container.querySelector('section'),
      mount(<PdpDescription source="Ngắn gọn" />).container.querySelector('section'),
    ]) {
      expect(el!.className).toBe('tubu-pdp-detail');
      expect(el!.querySelector('h2')).toBeNull();
    }
  });
});

describe('tiêu đề khối của trang sản phẩm: Inter 16/700 ở mọi khổ (Q1), không serif từ md', () => {
  const sans = (h: Element | null) => {
    expect(h).not.toBeNull();
    expect(h!.className).toContain('font-ui');
    expect(h!.className).toContain('font-bold');
    expect(h!.className).not.toContain('font-display');
    expect(h!.className).not.toContain('max-md:');
  };
  it('hai dải sản phẩm', async () => {
    mocks.http.get.mockImplementation(async (p: string) => (p === '/products/for-you' ? Array.from({ length: 5 }, (_, i) => card(30 + i)) : []));
    const { container } = mount(<PdpRails productId="cur" slug="dau-goi" brand="Xanh" initialRelated={[card(1)]} />);
    await flush();
    const titles = Array.from(container.querySelectorAll('h2'));
    expect(titles).toHaveLength(2);
    titles.forEach((h) => sans(h));
  });
});

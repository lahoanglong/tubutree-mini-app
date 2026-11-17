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

describe('PdpIngredients', () => {
  const ING = [{ name: 'Bồ kết', percentage: '30%', benefit: 'Sạch dịu' }, { name: 'Gừng' }];
  it('liệt kê tên, tỉ lệ và công dụng; không có thì không dựng mục', () => {
    const { container } = mount(<PdpIngredients ingredients={ING} />);
    expect(container.querySelector('h2')!.textContent).toBe('Thành phần');
    expect(container.querySelector('[data-pdp-block="ingredients"]')).not.toBeNull();
    expect(container.textContent).toContain('Bồ kết');
    expect(container.textContent).toContain('30%');
    expect(container.textContent).toContain('Sạch dịu');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(byText(container, 'button', /Xem đủ|Thu gọn/)).toBeNull();
    expect(mount(<PdpIngredients ingredients={null} />).container.innerHTML).toBe('');
    expect(mount(<PdpIngredients ingredients={[]} />).container.innerHTML).toBe('');
  });

  it('hơn 3 thành phần: mở sẵn 3 dòng, nút "Xem đủ" mở hết rồi thu lại; mọi dòng vẫn nằm trong HTML', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name }));
    const { container } = mount(<PdpIngredients ingredients={five} />);
    const rows = () => Array.from(container.querySelectorAll('[data-testid="pdp-ingredient"]'));
    expect(rows()).toHaveLength(5);
    expect(rows().filter((r) => r.className.split(' ').includes('hidden'))).toHaveLength(2);
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="pdp-ingredients-toggle"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector(`#${toggle.getAttribute('aria-controls')}`)).not.toBeNull();
    click(toggle);
    expect(rows().filter((r) => r.className.split(' ').includes('hidden'))).toHaveLength(0);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    click(toggle);
    expect(rows().filter((r) => r.className.split(' ').includes('hidden'))).toHaveLength(2);
    expect(smallTouchTargets(container)).toEqual([]);
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

  it('lối chính sách vận chuyển (/chinh-sach/van-chuyen) có một lần: dải đã trỏ đổi trả thì thêm lối riêng, dải trỏ vận chuyển thì không lặp; vùng chạm 44px', () => {
    cfg.returnWindowDays = 10;
    const withReturns = mount(<PdpPromises fulfillerKind="TUBU" />).container;
    const hrefs = Array.from(withReturns.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/chinh-sach/doi-tra', '/chinh-sach/van-chuyen']);
    expect(byText(withReturns, 'a', 'Chính sách vận chuyển')).not.toBeNull();
    expect(unnamedControls(withReturns)).toEqual([]);
    expect(smallTouchTargets(withReturns)).toEqual([]);
    cfg.returnWindowDays = 0;
    const noReturns = mount(<PdpPromises fulfillerKind="TUBU" />).container;
    expect(Array.from(noReturns.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/chinh-sach/van-chuyen']);
    expect(noReturns.querySelectorAll('li')).toHaveLength(2);
  });

  it('hàng gian hàng tự giao: không có dải ba trụ cột (không hứa thay gian hàng), vẫn có lối chính sách vận chuyển và nút chat', () => {
    cfg.returnWindowDays = 10;
    const { container } = mount(
      <PdpPromises fulfillerKind="MERCHANT">
        <button>Chat</button>
      </PdpPromises>,
    );
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/chinh-sach/van-chuyen']);
    expect(byText(container, 'button', 'Chat')).not.toBeNull();
  });
});

describe('PdpDescription', () => {
  const body = (c: HTMLElement) => c.querySelector('#pdp-description')!;
  it('mô tả ngắn hiện đủ, không có nút Xem thêm', () => {
    const { container } = mount(<PdpDescription source="Ngắn gọn" />);
    expect(container.querySelector('[data-pdp-block="description"]')).not.toBeNull();
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
  it('mô tả dài thu gọn chừng 4 dòng, Xem thêm/Thu gọn đổi trạng thái aria-expanded; chữ vẫn nằm trong DOM', () => {
    const text = 'Chữ dài '.repeat(60);
    const { container } = mount(<PdpDescription source={text} />);
    expect(body(container).className).toContain('max-h-24');
    expect(body(container).textContent).toBe(text.trim());
    const btn = byText(container, 'button', 'Xem thêm')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('pdp-description');
    click(btn);
    expect(body(container).className).not.toContain('max-h-24');
    expect(byText(container, 'button', 'Thu gọn')!.getAttribute('aria-expanded')).toBe('true');
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
  const band = (el: Element | null, id: string) => {
    expect(el).not.toBeNull();
    expect(el!.getAttribute('data-section')).toBe(id);
    expect(el!.className).toContain('max-md:mt-2');
    expect(el!.className).toContain('max-md:bg-[var(--color-bg-surface)]');
    expect(el!.className).toContain('max-md:p-4');
  };
  it('Thành phần, Cam kết, Mô tả sản phẩm', () => {
    band(mount(<PdpIngredients ingredients={[{ name: 'Gừng' }]} />).container.querySelector('section'), 'pdp-ingredients');
    band(mount(<PdpPromises fulfillerKind="TUBU" />).container.querySelector('[data-section="pdp-promises"]'), 'pdp-promises');
    band(mount(<PdpDescription source="Ngắn gọn" />).container.querySelector('section'), 'pdp-description');
  });
  it('chữ phụ cỡ Mini App: mô tả 14px; "Xem thêm" là chữ thương hiệu không gạch chân', () => {
    const long = mount(<PdpDescription source={'x'.repeat(300)} />).container;
    expect(long.querySelector('#pdp-description')!.className).toContain('max-md:text-sm');
    const more = byText(long, 'button', 'Xem thêm')!;
    expect(more.className).toContain('max-md:no-underline');
    expect(more.className).toContain('max-md:text-[var(--color-text-brand)]');
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
  it('Thành phần, Mô tả sản phẩm', () => {
    sans(mount(<PdpIngredients ingredients={[{ name: 'Gừng' }]} />).container.querySelector('h2'));
    sans(mount(<PdpDescription source="Ngắn gọn" />).container.querySelector('h2'));
  });
  it('hai dải sản phẩm', async () => {
    mocks.http.get.mockImplementation(async (p: string) => (p === '/products/for-you' ? Array.from({ length: 5 }, (_, i) => card(30 + i)) : []));
    const { container } = mount(<PdpRails productId="cur" slug="dau-goi" brand="Xanh" initialRelated={[card(1)]} />);
    await flush();
    const titles = Array.from(container.querySelectorAll('h2'));
    expect(titles).toHaveLength(2);
    titles.forEach((h) => sans(h));
  });
});

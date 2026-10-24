// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ http: { get: vi.fn() } }));
vi.mock('@/lib/core-http', () => ({ coreHttp: mocks.http }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
const cfg = vi.hoisted(() => ({ returnWindowDays: undefined as number | undefined }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => ({ returnWindowDays: cfg.returnWindowDays }) }));
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
    expect(container.textContent).toContain('4.5 · 8 đánh giá');
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('4.5 trên 5 sao');
  });
  it('chưa có đánh giá thì không hiện', () => {
    expect(mount(<PdpRating average={0} count={0} />).container.innerHTML).toBe('');
    expect(mount(<PdpRating average={undefined} count={undefined} />).container.innerHTML).toBe('');
  });
});

describe('PdpIngredients', () => {
  it('liệt kê tên, tỉ lệ và công dụng; không có thì không dựng mục', () => {
    const { container } = mount(<PdpIngredients ingredients={[{ name: 'Bồ kết', percentage: '30%', benefit: 'Sạch dịu' }, { name: 'Gừng' }]} />);
    expect(container.querySelector('h2')!.textContent).toBe('Thành phần');
    expect(container.textContent).toContain('Bồ kết');
    expect(container.textContent).toContain('30%');
    expect(container.textContent).toContain('Sạch dịu');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(mount(<PdpIngredients ingredients={null} />).container.innerHTML).toBe('');
    expect(mount(<PdpIngredients ingredients={[]} />).container.innerHTML).toBe('');
  });
});

describe('PdpPromises', () => {
  it('ba cam kết của Tubu và chỗ cho nút chat', () => {
    const { container } = mount(<PdpPromises><button>Chat</button></PdpPromises>);
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(container.textContent).toContain('Đổi trả nếu sản phẩm lỗi');
    expect(byText(container, 'button', 'Chat')).not.toBeNull();
  });

  it('số ngày đổi trả lấy từ cấu hình; chưa có cấu hình thì không nêu số', () => {
    cfg.returnWindowDays = 10;
    expect(mount(<PdpPromises />).container.textContent).toContain('Đổi trả trong 10 ngày nếu lỗi');
    cfg.returnWindowDays = undefined;
    const text = mount(<PdpPromises />).container.textContent ?? '';
    expect(text).toContain('Đổi trả nếu sản phẩm lỗi');
    expect(text).not.toMatch(/\d+ ngày/);
  });
});

describe('PdpDescription', () => {
  it('mô tả ngắn hiện đủ, không có nút Xem thêm', () => {
    const { container } = mount(<PdpDescription text="Ngắn gọn" />);
    expect(container.textContent).toContain('Ngắn gọn');
    expect(byText(container, 'button', /Xem thêm|Thu gọn/)).toBeNull();
  });
  it('mô tả dài thu gọn 4 dòng, Xem thêm/Thu gọn đổi trạng thái aria-expanded; chữ vẫn nằm trong DOM', () => {
    const text = 'Chữ dài '.repeat(60);
    const { container } = mount(<PdpDescription text={text} />);
    const p = container.querySelector('p')!;
    expect(p.className).toContain('line-clamp-4');
    expect(p.textContent).toBe(text);
    const btn = byText(container, 'button', 'Xem thêm')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    click(btn);
    expect(p.className).not.toContain('line-clamp-4');
    expect(byText(container, 'button', 'Thu gọn')!.getAttribute('aria-expanded')).toBe('true');
    expect(smallTouchTargets(container)).toEqual([]);
    expect(unnamedControls(container)).toEqual([]);
  });
});

describe('PdpRails', () => {
  it('có danh sách server dựng sẵn thì hiện ngay hai dải, tên nhãn trong tiêu đề, thẻ trỏ /san-pham/<slug>', async () => {
    mocks.http.get.mockResolvedValue([]);
    const { container } = mount(<PdpRails slug="dau-goi" brand="Xanh Việt" initialRelated={[card(1)]} initialBoughtTogether={[card(2), card(3)]} />);
    await flush();
    const titles = Array.from(container.querySelectorAll('h2')).map((h) => h.textContent);
    expect(titles).toEqual(['Thường mua kèm', 'Cùng nhà Xanh Việt']);
    expect(Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual(['/san-pham/sp-2', '/san-pham/sp-3', '/san-pham/sp-1']);
    expect(mocks.http.get).not.toHaveBeenCalled();
  });
  it('thiếu dữ liệu server thì tải ở trình duyệt: khung chờ rồi hiện; endpoint như Mini App', async () => {
    mocks.http.get.mockImplementation(async (p: string) => (p === '/products/dau-goi/related' ? [card(1)] : []));
    const { container } = mount(<PdpRails slug="dau-goi" brand="Xanh" />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await flush();
    expect(mocks.http.get.mock.calls.map((c) => c[0]).sort()).toEqual(['/products/dau-goi/bought-together', '/products/dau-goi/related']);
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(container.querySelector('h2')!.textContent).toBe('Cùng nhà Xanh');
  });
  it('lỗi hoặc rỗng thì ẩn dải, không vỡ trang', async () => {
    mocks.http.get.mockRejectedValue(new Error('500'));
    const { container } = mount(<PdpRails slug="dau-goi" brand="Xanh" />);
    await flush();
    expect(container.innerHTML).toBe('');
  });
});

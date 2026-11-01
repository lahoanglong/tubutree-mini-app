// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';

const mocks = vi.hoisted(() => ({ get: vi.fn(), copyText: vi.fn(async (_t: string) => true), push: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, retrySession: vi.fn() }) }));
vi.mock('@/lib/copy-text', () => ({ copyText: mocks.copyText }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }), usePathname: () => '/chien-dich/giua-thu' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { CampaignBody } from './campaign-body';

const DAY = 86_400_000;
const DETAIL = {
  id: 'c1',
  slug: 'giua-thu',
  title: 'Giữa Thu',
  subtitle: 'Giảm sâu mùa trăng',
  image: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  linkType: 'CAMPAIGN_PAGE' as const,
  linkValue: null,
  audience: 'ALL' as const,
  startAt: '2026-10-31T17:00:00.000Z',
  endAt: '2026-11-10T17:30:00.000Z',
  productCount: 3,
  coupons: [{ code: 'THU10', type: 'PERCENT' as const, value: 10, minOrder: 100_000, maxDiscount: 30_000, endAt: new Date(Date.now() + 5 * DAY).toISOString() }],
};
const card = (n: number) => ({ id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 10_000 * n, salePrice: null, isFeatured: false, inStock: true });
const page = (ids: number[], p: number, total: number) => ({ data: ids.map(card), meta: { page: p, limit: 20, total } });

let mounted: Rendered | null = null;
const mount = async (ui: React.ReactElement) => {
  mounted = render(<QueryClientProvider client={newTestClient()}>{ui}</QueryClientProvider>);
  await flush(8);
  return mounted.container;
};
const productCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/campaigns/giua-thu/products');

beforeEach(() => {
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: { page?: number } }) => {
    if (path === '/campaigns/giua-thu/products') return page([1, 2, 3], opts?.query?.page ?? 1, 3);
    throw new Error(`không mock ${path}`);
  });
  mocks.copyText.mockClear().mockResolvedValue(true);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('CampaignBody (web): trang chiến dịch giống Mini App', () => {
  it('khách chưa đăng nhập vẫn thấy đủ: tên chương trình là h1 duy nhất, phụ đề, ảnh đầu trang, ngày theo giờ Việt Nam; không gọi API riêng của tài khoản', async () => {
    const c = await mount(<CampaignBody campaign={DETAIL} initialProducts={page([1, 2, 3], 1, 3)} />);
    expect(c.querySelector('h1')!.textContent).toBe('Giữa Thu');
    expect(c.textContent).toContain('Giảm sâu mùa trăng');
    expect(c.querySelector('img')!.getAttribute('alt')).toBe(''); // trang trí: h1 ngay trên đã gọi tên
    expect(c.textContent).toContain('Từ 01/11 đến 11/11');
    expect(mocks.get.mock.calls.filter(([p]) => String(p).startsWith('/me'))).toEqual([]);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });

  it('ảnh đầu trang giữ tỉ lệ banner nên không nhảy khi ảnh về', async () => {
    const c = await mount(<CampaignBody campaign={DETAIL} initialProducts={page([1], 1, 1)} />);
    expect(c.querySelector('img')!.style.aspectRatio).toBe('var(--banner-ratio)');
  });

  it('từ md ảnh đầu trang giữ 5/2 bằng trần bề rộng (max-w-3xl), không dùng trần chiều cao cắt ảnh còn 3,6:1', async () => {
    const c = await mount(<CampaignBody campaign={DETAIL} initialProducts={page([1], 1, 1)} />);
    const img = c.querySelector('img')!;
    expect(img.className).toContain('md:max-w-3xl');
    expect(img.className).not.toContain('max-h');
  });

  it('mỗi khối có đúng một h2: mã giảm giá và sản phẩm', async () => {
    const c = await mount(<CampaignBody campaign={DETAIL} initialProducts={page([1, 2, 3], 1, 3)} />);
    const h2 = Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);
    expect(h2).toEqual(['Mã giảm giá của chương trình', 'Sản phẩm trong chương trình']);
  });

  it('vé mã có nút "Sao chép mã" chép đúng mã và báo kết quả bằng role=status ngay dưới vé', async () => {
    const c = await mount(<CampaignBody campaign={DETAIL} initialProducts={page([1], 1, 1)} />);
    expect(c.textContent).toContain('THU10');
    click(byText(c, 'button', 'Sao chép mã'));
    await flush(4);
    expect(mocks.copyText).toHaveBeenCalledWith('THU10');
    expect(c.querySelector('[role="status"]')!.textContent).toMatch(/chép/i);
  });

  it('chép không được (trình duyệt chặn): báo lỗi role=alert, không nói đã chép', async () => {
    mocks.copyText.mockResolvedValue(false);
    const c = await mount(<CampaignBody campaign={DETAIL} initialProducts={page([1], 1, 1)} />);
    click(byText(c, 'button', 'Sao chép mã'));
    await flush(4);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(c.querySelector('[role="status"]')).toBeNull();
  });

  it('có dữ liệu trang 1 từ server thì lưới hiện ngay, không gọi lại API', async () => {
    const c = await mount(<CampaignBody campaign={DETAIL} initialProducts={page([1, 2, 3], 1, 3)} />);
    expect(c.textContent).toContain('Sản phẩm 1');
    expect(c.textContent).toContain('Sản phẩm 3');
    expect(productCalls()).toHaveLength(0);
  });

  it('server không tải được sản phẩm: client tự xin trang 1 giới hạn 20', async () => {
    const c = await mount(<CampaignBody campaign={DETAIL} />);
    expect(productCalls()[0]![1]).toEqual({ query: { page: 1, limit: 20 }, anonymous: true });
    expect(c.textContent).toContain('Sản phẩm 2');
  });

  it('còn trang kế: "Xem thêm" nạp thêm trang 2 và nối vào lưới; hết trang thì nút biến mất', async () => {
    mocks.get.mockImplementation(async (path: string, opts?: { query?: { page?: number } }) => {
      if (path !== '/campaigns/giua-thu/products') throw new Error(`không mock ${path}`);
      return (opts?.query?.page ?? 1) === 1 ? page([1, 2], 1, 3) : { data: [card(3)], meta: { page: 2, limit: 2, total: 3 } };
    });
    const c = await mount(<CampaignBody campaign={DETAIL} initialProducts={{ data: [card(1), card(2)], meta: { page: 1, limit: 2, total: 3 } }} />);
    expect(c.textContent).not.toContain('Sản phẩm 3');
    click(byText(c, 'button', 'Xem thêm'));
    await flush(8);
    expect(productCalls().map(([, o]) => (o as { query: { page: number } }).query.page)).toEqual([2]);
    expect(c.textContent).toContain('Sản phẩm 3');
    expect(byText(c, 'button', 'Xem thêm')).toBeNull();
  });

  it('không có mã: không vẽ khối mã (không tiêu đề trơ trọi)', async () => {
    const c = await mount(<CampaignBody campaign={{ ...DETAIL, coupons: [] }} initialProducts={page([1], 1, 1)} />);
    expect(c.textContent).not.toContain('Mã giảm giá của chương trình');
  });

  it('không mã và không sản phẩm: một dòng "Chương trình chưa có sản phẩm", không gọi API sản phẩm', async () => {
    const c = await mount(<CampaignBody campaign={{ ...DETAIL, coupons: [], productCount: 0 }} />);
    expect(c.textContent).toContain('Chương trình chưa có sản phẩm');
    expect(productCalls()).toHaveLength(0);
  });

  it('có mã nhưng không có sản phẩm: chỉ khối mã, không báo "chưa có sản phẩm"', async () => {
    const c = await mount(<CampaignBody campaign={{ ...DETAIL, productCount: 0 }} />);
    expect(c.textContent).toContain('THU10');
    expect(c.textContent).not.toContain('Chương trình chưa có sản phẩm');
    expect(c.textContent).not.toContain('Sản phẩm trong chương trình');
  });

  it('ảnh không phục vụ được (null): bỏ ảnh, trang vẫn đủ nội dung', async () => {
    const c = await mount(<CampaignBody campaign={{ ...DETAIL, image: null }} initialProducts={page([1], 1, 1)} />);
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('h1')!.textContent).toBe('Giữa Thu');
    expect(c.textContent).toContain('THU10');
  });

  it('trang kế lỗi: báo lỗi kèm Thử lại tại chỗ, các món đã có vẫn còn', async () => {
    mocks.get.mockImplementation(async (path: string, opts?: { query?: { page?: number } }) => {
      if (path !== '/campaigns/giua-thu/products') throw new Error(`không mock ${path}`);
      if ((opts?.query?.page ?? 1) === 2) throw new Error('Máy chủ đang bận');
      return page([1, 2], 1, 40);
    });
    const c = await mount(<CampaignBody campaign={DETAIL} initialProducts={{ data: [card(1), card(2)], meta: { page: 1, limit: 20, total: 40 } }} />);
    click(byText(c, 'button', 'Xem thêm'));
    await flush(8);
    expect(c.textContent).toContain('Sản phẩm 1');
    expect(byText(c, 'button', 'Thử lại')).not.toBeNull();
  });
});

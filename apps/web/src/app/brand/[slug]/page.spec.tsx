// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import BrandPage, { generateMetadata, revalidate } from './page';

const mocks = vi.hoisted(() => ({ brand: null as unknown }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => [] }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a data-next-link="" href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getBrand: async () => mocks.brand,
}));

const BRAND = {
  name: 'Bồ Hòn Xanh',
  slug: 'bo-hon',
  followerCount: 12,
  tagline: 'Giặt sạch, nhẹ với đất',
  story: 'Câu chuyện\nnhiều dòng',
  storyImages: [] as string[],
  origin: null as string | null,
  isVerified: true,
  coverUrl: null,
  logoUrl: null,
  certifications: [{ code: 'ORG', label: 'Hữu cơ' }],
  promotions: [
    { id: 'pr1', title: 'Giảm 10%', subtitle: 'Tuần lễ xanh', themeColor: '#123456', endAt: '2099-01-01T00:00:00Z' },
    { id: 'pr2', title: 'Quà tặng', subtitle: null, themeColor: null, couponCode: null, endAt: '2099-01-01T00:00:00Z' },
    { id: 'pr3', title: 'Mã xanh', subtitle: null, themeColor: null, couponCode: 'XANH10', endAt: '2099-01-01T00:00:00Z' },
  ],
  products: [
    { id: 'p1', name: 'Nước rửa chén', slug: 'nuoc-rua-chen', thumbnail: null, basePrice: 90000, salePrice: 80000, sold: 12 },
  ],
  dealerRewards: [{ id: 'd1', title: 'Thưởng quý', description: 'Đạt chỉ tiêu', threshold: 5_000_000, period: 'QUARTER' }],
};

const html = async () => {
  const el = (await BrandPage({ params: Promise.resolve({ slug: 'bo-hon' }) })) as ReactElement;
  const box = document.createElement('div');
  box.innerHTML = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);
  return box;
};

let mounted: Rendered | undefined;
const live = async () => {
  mounted = render((await BrandPage({ params: Promise.resolve({ slug: 'bo-hon' }) })) as ReactElement);
  await flush();
  return mounted.container;
};
const tabBtn = (c: HTMLElement, name: string) => Array.from(c.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => t.textContent === name)!;

beforeEach(() => {
  mocks.brand = BRAND;
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('trang thương hiệu /brand/[slug] — khung shop giống Mini App', () => {
  it('thương hiệu không có trong dữ liệu thì trả 404', async () => {
    mocks.brand = null;
    await expect(BrandPage({ params: Promise.resolve({ slug: 'khong-co' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('h1 là tên; huy hiệu Chính hãng có icon SVG (không dấu ✓); không chính hãng thì không có huy hiệu', async () => {
    const box = await html();
    expect(box.querySelector('h1')!.textContent).toBe('Bồ Hòn Xanh');
    const badge = Array.from(box.querySelectorAll('span')).find((x) => x.textContent === 'Chính hãng')!;
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.textContent).not.toContain('✓');
    mocks.brand = { ...BRAND, isVerified: false };
    expect((await html()).textContent).not.toContain('Chính hãng');
  });

  it('tiêu đề trang vẫn gắn ✓ cho thương hiệu chính hãng (chuỗi <title>, không phải icon)', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'bo-hon' }) });
    expect(meta.title).toBe('Bồ Hòn Xanh ✓ — Tubu Tree');
  });

  it('bìa phẳng token, avatar là biểu tượng lá không chữ cái, không còn gradient', async () => {
    const box = await html();
    expect(box.querySelector('[data-testid="shop-cover"]')!.getAttribute('style')).toContain('var(--color-bg-cover)');
    expect(box.innerHTML).not.toContain('linear-gradient');
    const avatar = box.querySelector('[data-testid="shop-avatar"]')!;
    expect(avatar.querySelector('svg')).not.toBeNull();
    expect(avatar.textContent).toBe('');
  });

  it('hàng số liệu có số sản phẩm và người theo dõi; tab Shop, Sản phẩm (1), Câu chuyện', async () => {
    const box = await html();
    const stats = Array.from(box.querySelectorAll('[data-testid="shop-stat"]')).map((x) => x.textContent ?? '');
    expect(stats.some((t) => t.includes('1') && t.includes('Sản phẩm'))).toBe(true);
    expect(stats.some((t) => t.includes('12'))).toBe(true);
    expect(Array.from(box.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual(['Shop', 'Sản phẩm (1)', 'Câu chuyện']);
  });

  it('có tổng sản phẩm lớn hơn danh sách 30 món: tab và "Tất cả (n)" dùng tổng thật', async () => {
    mocks.brand = { ...BRAND, productCount: 45 };
    const box = await html();
    expect(tabBtn(box, 'Sản phẩm (45)')).toBeDefined();
    expect(box.querySelector('[data-testid="brand-featured"]')!.textContent).toContain('Tất cả (45)');
  });

  it('khung trang rộng như các trang khác (D7-28); ở điện thoại không đệm vì ảnh bìa tràn mép', async () => {
    const main = (await html()).querySelector('main')!;
    expect(main.className).toContain('max-w-frame');
    expect(main.className).not.toContain('max-w-3xl');
    expect(main.className).toContain('max-md:p-0');
  });

  it('chứng nhận là huy hiệu trong hàng cuộn ngang', async () => {
    const box = await html();
    expect(Array.from(box.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Chứng nhận');
    expect(box.querySelector('[role="region"][aria-label="Chứng nhận"]')!.textContent).toBe('Hữu cơ');
  });

  it('khuyến mãi là phiếu chip: có mã thì có nút Sao chép, không mã chỉ là thông tin; mã không in ra', async () => {
    const box = await html();
    const vouchers = box.querySelector('[data-testid="brand-vouchers"]')!;
    expect(vouchers.textContent).toContain('Giảm 10%');
    expect(vouchers.textContent).toContain('Quà tặng');
    expect(Array.from(vouchers.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Sao chép']);
    expect(box.textContent).not.toContain('XANH10');
  });

  // D15-01: themeColor do chủ thương hiệu nhập; phiếu chip dùng token nên chuỗi độc không có đường nào vào style.
  it.each(['red;background:url(https://evil.example/x)', '#123456;background:url(x)', '}body{display:none', 'url(javascript:alert(1))'])(
    'khuyến mãi có themeColor độc %j không xuất hiện trong HTML',
    async (bad) => {
      mocks.brand = { ...BRAND, promotions: [{ id: 'pr1', title: 'Giảm 10%', subtitle: null, themeColor: bad, endAt: '2099-01-01T00:00:00Z' }] };
      const box = await html();
      expect(box.innerHTML).not.toContain('evil.example');
      expect(box.innerHTML).not.toContain('display:none');
    },
  );

  it('thẻ sản phẩm nổi bật là thẻ chung của web: đúng liên kết next/link, giá khuyến mãi, có tim, không in lại tên thương hiệu', async () => {
    const box = await html();
    const link = box.querySelector<HTMLAnchorElement>('a[href="/san-pham/nuoc-rua-chen"]')!;
    expect(link.hasAttribute('data-next-link')).toBe(true);
    const card = link.closest('[data-ds="product-tile"]') as HTMLElement;
    expect(card.textContent).toContain('80.000');
    expect(card.textContent).toContain('Đã bán 12');
    expect(card.querySelector('button[aria-label^="Yêu thích"]')).not.toBeNull();
    expect(card.querySelector('[data-ds-part="brand"]')).toBeNull();
    expect(card.textContent).not.toContain('Bồ Hòn Xanh');
  });

  it('chương trình đại lý và nút "Đăng ký đại lý" cho khách lẻ như Mini App', async () => {
    const box = await html();
    expect(Array.from(box.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(expect.arrayContaining(['Chứng nhận', 'Sản phẩm nổi bật', 'Chương trình đại lý']));
    expect(box.textContent).toContain('Đạt doanh số 5.000.000');
    expect(box.querySelector('a[href="/dai-ly"]')?.textContent).toBe('Đăng ký đại lý');
  });
});

describe('trang thương hiệu — theo dõi và chia sẻ ở đầu shop', () => {
  it('server dựng sẵn nút Theo dõi và Chia sẻ cho khách, trước hàng tab; chưa có dải kiếm tiền', async () => {
    const box = await html();
    const follow = Array.from(box.querySelectorAll('button')).find((b) => b.textContent === 'Theo dõi')!;
    expect(follow).toBeDefined();
    expect(box.querySelector('button[aria-label="Chia sẻ"]')).not.toBeNull();
    expect(box.textContent).not.toContain('hoa hồng');
    expect(follow.compareDocumentPosition(box.querySelector('[role="tablist"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.querySelector('[data-sticky-bar]')).toBeNull();
  });
});

describe('trang thương hiệu — ảnh sản phẩm (D6-05)', () => {
  it('ảnh thẻ sản phẩm có width/height và tải lười không chặn render', async () => {
    mocks.brand = { ...BRAND, products: [{ ...BRAND.products[0], thumbnail: 'https://cdn.example/p.jpg' }] };
    const img = (await html()).querySelector('a[href="/san-pham/nuoc-rua-chen"]')!.closest('[data-ds="product-tile"]')!.querySelector('img')!;
    expect(img.getAttribute('width')).toBe('400');
    expect(img.getAttribute('height')).toBe('400');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });
});

describe('trang thương hiệu — trạng thái rỗng (D5-05)', () => {
  it('chưa có sản phẩm đang bán: thông báo rỗng và nút sang Tubu Tree thay vì để trang trắng', async () => {
    mocks.brand = { ...BRAND, products: [], productCount: 0 };
    const box = await html();
    expect(box.textContent).toContain('Shop chưa có sản phẩm nào để hiện');
    expect(Array.from(box.querySelectorAll('button')).some((b) => b.textContent === 'Xem sản phẩm trên Tubu Tree')).toBe(true);
    expect(Array.from(box.querySelectorAll('h2')).map((h) => h.textContent)).not.toContain('Sản phẩm nổi bật');
  });

  it('có sản phẩm: không hiện thông báo rỗng', async () => {
    expect((await html()).textContent).not.toContain('chưa có sản phẩm nào để hiện');
  });
});

describe('/brand/[slug] — hạn trang dựng sẵn', () => {
  it('trang làm mới tối đa 60 giây để thương hiệu gỡ đăng không còn hiện lâu; vẫn dựng phía server cho SEO', () => {
    expect(revalidate).toBeLessThanOrEqual(60);
    expect(BrandPage.constructor.name).toBe('AsyncFunction');
  });
});

describe('trang thương hiệu — tab Câu chuyện', () => {
  const WITH_STORY = { slug: 'fuwa3e', name: 'Fuwa3e', origin: 'Lâm Đồng, Việt Nam', storyImages: ['https://img.test/a.jpg', 'https://img.test/b.jpg'] };

  it('tab Shop chỉ có đoạn mở đầu và nút "Đọc câu chuyện"; bấm sang tab Câu chuyện thấy xuất xứ, bản đồ và ảnh', async () => {
    mocks.brand = { ...BRAND, ...WITH_STORY };
    const c = await live();
    expect(c.querySelector('[data-testid="brand-story-teaser"]')).not.toBeNull();
    expect(c.textContent).not.toContain('Xuất xứ');
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes('Đọc câu chuyện'))!);
    expect(tabBtn(c, 'Câu chuyện').getAttribute('aria-selected')).toBe('true');
    expect(c.textContent).toContain('Xuất xứ: Lâm Đồng, Việt Nam');
    expect(c.querySelector('a[href="/cau-chuyen?brand=fuwa3e"]')?.textContent).toBe('Xem trên bản đồ');
    const imgs = c.querySelectorAll('[role="region"][aria-label="Ảnh câu chuyện thương hiệu"] img');
    expect(imgs).toHaveLength(2);
    expect(imgs[0]!.getAttribute('alt')).toBe('Fuwa3e, ảnh 1');
  });

  it('chưa có ghim trên bản đồ thì không hiện liên kết "Xem trên bản đồ"', async () => {
    mocks.brand = { ...BRAND, origin: 'Lâm Đồng, Việt Nam' };
    const c = await live();
    click(tabBtn(c, 'Câu chuyện'));
    expect(c.textContent).toContain('Xuất xứ: Lâm Đồng, Việt Nam');
    expect(c.textContent).not.toContain('Xem trên bản đồ');
  });

  it('không có câu chuyện, xuất xứ lẫn ảnh thì không có tab Câu chuyện', async () => {
    mocks.brand = { ...BRAND, story: null };
    const box = await html();
    expect(Array.from(box.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).not.toContain('Câu chuyện');
    expect(box.textContent).not.toContain('Câu chuyện thương hiệu');
  });
});

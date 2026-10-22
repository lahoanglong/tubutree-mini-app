// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: vi.fn() } }));
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
  isVerified: true,
  coverUrl: null,
  logoUrl: null,
  certifications: [{ code: 'ORG', label: 'Hữu cơ' }],
  promotions: [
    { id: 'pr1', title: 'Giảm 10%', subtitle: 'Tuần lễ xanh', themeColor: '#123456' },
    { id: 'pr2', title: 'Quà tặng', subtitle: null, themeColor: null, couponCode: null },
    { id: 'pr3', title: 'Mã xanh', subtitle: null, themeColor: null, couponCode: 'XANH10' },
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

beforeEach(() => {
  mocks.brand = BRAND;
});

describe('trang nhãn hàng /brand/[slug] — DS v2', () => {
  it('nhãn không có trong dữ liệu thì trả 404', async () => {
    mocks.brand = null;
    await expect(BrandPage({ params: Promise.resolve({ slug: 'khong-co' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('huy hiệu Chính hãng dùng icon SVG thay cho dấu ✓, chữ nghiệp vụ giữ nguyên', async () => {
    const box = await html();
    const h1 = box.querySelector('h1')!;
    expect(h1.className).toContain('font-display');
    const badge = Array.from(h1.querySelectorAll('span')).find((s) => s.textContent?.includes('Chính hãng'))!;
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.textContent).not.toContain('✓');
    expect(badge.className).toContain('bg-forest-600');
  });

  it('tiêu đề trang vẫn gắn ✓ cho nhãn chính hãng (chuỗi <title>, không phải icon)', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'bo-hon' }) });
    expect(meta.title).toBe('Bồ Hòn Xanh ✓ — Tubu Tree');
  });

  it('tên nhãn dài ngắt dòng, hàng tên + huy hiệu xuống dòng thay vì tràn ngang ở 390px', async () => {
    const h1 = (await html()).querySelector('h1')!;
    expect(h1.className).toContain('flex-wrap');
    expect(h1.className).toContain('break-words');
  });

  it('khuyến mãi giữ màu chủ đề do nhãn chọn (dữ liệu) và có nền/viền token khi không chọn', async () => {
    const cards = Array.from((await html()).querySelectorAll('section'))
      .find((s) => s.textContent?.includes('Khuyến mãi'))!
      .querySelectorAll<HTMLElement>('.space-y-2 > div');
    expect(cards[0]!.getAttribute('style')).toContain('border-color:#123456');
    expect(cards[1]!.getAttribute('style')).toBeNull();
    expect(cards[1]!.className).toContain('bg-promo-bg');
  });

  it('khuyến mãi có couponCode hiện nút chép mã, khuyến mãi không mã thì không có nút', async () => {
    const section = Array.from((await html()).querySelectorAll('section')).find((s) => s.textContent?.includes('Khuyến mãi'))!;
    const buttons = section.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute('aria-label')).toBe('Sao chép mã XANH10');
  });

  it('thẻ sản phẩm là thẻ chung của web (ProductCard): đúng liên kết, giá khuyến mãi, tên nhãn là nhãn của trang, có tim yêu thích', async () => {
    const box = await html();
    const link = box.querySelector<HTMLAnchorElement>('a[href="/san-pham/nuoc-rua-chen"]')!;
    expect(link.textContent).toContain('80.000');
    expect(link.textContent).toContain('Bồ Hòn Xanh');
    expect(link.textContent).toContain('Đã bán 12');
    const card = link.parentElement!;
    expect(card.className).toContain('rounded-card');
    expect(card.className).toContain('var(--elevation-1)');
    expect(card.querySelector('button[aria-label="Thêm yêu thích"]')).not.toBeNull();
  });

  // D7-28: cùng bề rộng với các trang khác (max-w-5xl), không còn khung hẹp max-w-3xl.
  it('khung trang rộng như các trang khác (D7-28); ở điện thoại không đệm vì ảnh bìa tràn mép', async () => {
    const main = (await html()).querySelector('main')!;
    expect(main.className).toContain('max-w-5xl');
    expect(main.className).not.toContain('max-w-3xl');
    expect(main.className).toContain('max-md:p-0');
  });

  it('không có ảnh bìa: dải xanh đậm 96px (điện thoại) và avatar lá đè lên; huy hiệu Chính hãng nằm dòng riêng dưới tên', async () => {
    const box = await html();
    expect(box.querySelector('[data-testid="brand-cover-band"]')!.className).toContain('max-md:block');
    expect(box.querySelector('[data-testid="brand-avatar-fallback"]')!.className).toContain('max-md:grid');
    expect(box.querySelector('h1')!.className).toContain('max-md:flex-col');
  });

  it('chứng nhận ở điện thoại: không biểu tượng ở tiêu đề, huy hiệu xanh nhạt không viền', async () => {
    const box = await html();
    const h2 = Array.from(box.querySelectorAll('h2')).find((h) => h.textContent === 'Chứng nhận')!;
    expect(h2.querySelector('svg')!.getAttribute('class')).toContain('max-md:hidden');
    const chip = box.querySelector('section .overflow-x-auto > span')!;
    expect(chip.textContent).toBe('Hữu cơ');
    expect(chip.className).toContain('max-md:border-0');
  });

  // D15-01: themeColor do chủ nhãn nhập; chỉ #RGB/#RRGGBB đi vào style.
  it.each([
    'red;background:url(https://evil.example/x)',
    '#123456;background:url(x)',
    '}body{display:none',
    'url(javascript:alert(1))',
    'red',
  ])('khuyến mãi có themeColor độc %j: bỏ màu, không để chuỗi lọt vào style', async (bad) => {
    mocks.brand = { ...BRAND, promotions: [{ id: 'pr1', title: 'Giảm 10%', subtitle: null, themeColor: bad }] };
    const box = await html();
    const card = Array.from(box.querySelectorAll('section')).find((s) => s.textContent?.includes('Khuyến mãi'))!.querySelector<HTMLElement>('.space-y-2 > div')!;
    expect(card.getAttribute('style')).toBeNull();
    expect(box.innerHTML).not.toContain('evil.example');
  });

  it('thẻ sản phẩm dùng next/link (điều hướng trong ứng dụng, không tải lại cả trang) — BUYERWEB-18', async () => {
    const link = (await html()).querySelector<HTMLAnchorElement>('a[href="/san-pham/nuoc-rua-chen"]')!;
    expect(link.hasAttribute('data-next-link')).toBe(true);
  });

  it('khách lẻ thấy chương trình đại lý và nút "Đăng ký đại lý" như Mini App (BUYERWEB-18 cũ ẩn khối này vì /dai-ly chưa có)', async () => {
    const box = await html();
    expect(Array.from(box.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Chứng nhận', 'Khuyến mãi', 'Sản phẩm', 'Chương trình đại lý', 'Câu chuyện thương hiệu']);
    expect(box.textContent).toContain('Đạt doanh số 5.000.000');
    expect(box.querySelector('a[href="/dai-ly"]')?.textContent).toBe('Đăng ký đại lý');
  });
});

describe('trang nhãn hàng — theo dõi và chia sẻ', () => {
  it('server dựng sẵn số người theo dõi, nút Theo dõi và Chia sẻ cho khách; chưa có dải kiếm tiền', async () => {
    const box = await html();
    const buttons = Array.from(box.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toEqual(['Theo dõi', 'Chia sẻ', 'XANH10', '']);
    expect(box.textContent).toContain('12 người theo dõi');
    expect(box.textContent).not.toContain('hoa hồng');
  });

  it('nút nằm ngay sau phần tên nhãn, trước chứng nhận', async () => {
    const box = await html();
    const follow = Array.from(box.querySelectorAll('button')).find((b) => b.textContent === 'Theo dõi')!;
    const certs = Array.from(box.querySelectorAll('h2')).find((h) => h.textContent === 'Chứng nhận')!;
    expect(follow.compareDocumentPosition(certs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('trang nhãn hàng — ảnh sản phẩm (D6-05)', () => {
  it('ảnh thẻ sản phẩm có width/height và tải lười không chặn render', async () => {
    mocks.brand = { ...BRAND, products: [{ ...BRAND.products[0], thumbnail: 'https://cdn.example/p.jpg' }] };
    const img = (await html()).querySelector('a[href="/san-pham/nuoc-rua-chen"] img')!;
    expect(img.getAttribute('width')).toBe('400');
    expect(img.getAttribute('height')).toBe('400');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });
});

describe('trang nhãn hàng — trạng thái rỗng (D5-05)', () => {
  it('nhãn chưa có sản phẩm đang bán: có thông báo rỗng và nút về danh mục thay vì để trang trắng', async () => {
    mocks.brand = { ...BRAND, products: [] };
    const box = await html();
    expect(box.textContent).toContain('Nhãn hàng chưa có sản phẩm đang bán');
    const cta = box.querySelector<HTMLAnchorElement>('a[href="/"]')!;
    expect(cta.textContent).toContain('Xem sản phẩm trên Tubu Tree');
    expect(Array.from(box.querySelectorAll('h2')).map((h) => h.textContent)).not.toContain('Sản phẩm');
  });

  it('nhãn có sản phẩm: không hiện thông báo rỗng', async () => {
    expect((await html()).textContent).not.toContain('Nhãn hàng chưa có sản phẩm đang bán');
  });
});

describe('/brand/[slug] — hạn trang dựng sẵn', () => {
  it('trang nhãn làm mới tối đa 60 giây để nhãn gỡ đăng không còn hiện lâu; vẫn dựng phía server cho SEO', () => {
    expect(revalidate).toBeLessThanOrEqual(60);
    expect(BrandPage.constructor.name).toBe('AsyncFunction');
  });
});

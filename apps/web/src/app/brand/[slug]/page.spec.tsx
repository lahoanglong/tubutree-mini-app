// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import BrandPage, { generateMetadata } from './page';

const mocks = vi.hoisted(() => ({ brand: null as unknown }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
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
  tagline: 'Giặt sạch, nhẹ với đất',
  story: 'Câu chuyện\nnhiều dòng',
  isVerified: true,
  coverUrl: null,
  logoUrl: null,
  certifications: [{ code: 'ORG', label: 'Hữu cơ' }],
  promotions: [
    { id: 'pr1', title: 'Giảm 10%', subtitle: 'Tuần lễ xanh', themeColor: '#123456' },
    { id: 'pr2', title: 'Quà tặng', subtitle: null, themeColor: null },
  ],
  products: [
    { id: 'p1', name: 'Nước rửa chén', slug: 'nuoc-rua-chen', thumbnail: null, basePrice: 90000, salePrice: 80000, sold: 12 },
  ],
  dealerRewards: [{ id: 'd1', title: 'Thưởng quý', description: 'Đạt chỉ tiêu', threshold: 5_000_000, period: 'QUARTER' }],
};

const html = async () => {
  const el = (await BrandPage({ params: Promise.resolve({ slug: 'bo-hon' }) })) as ReactElement;
  const box = document.createElement('div');
  box.innerHTML = renderToStaticMarkup(el);
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
    expect(cards[0]!.getAttribute('style')).toContain('border-color');
    expect(cards[1]!.getAttribute('style')).toBeNull();
    expect(cards[1]!.className).toContain('bg-promo-bg');
  });

  it('thẻ sản phẩm trỏ đúng liên kết, giá là giá khuyến mãi và dùng token thẻ DS v2', async () => {
    const link = (await html()).querySelector<HTMLAnchorElement>('a[href="/san-pham/nuoc-rua-chen"]')!;
    expect(link.className).toContain('rounded-card');
    expect(link.className).toContain('shadow-card');
    expect(link.textContent).toContain('80.000');
  });

  it('thẻ sản phẩm dùng next/link (điều hướng trong ứng dụng, không tải lại cả trang) — BUYERWEB-18', async () => {
    const link = (await html()).querySelector<HTMLAnchorElement>('a[href="/san-pham/nuoc-rua-chen"]')!;
    expect(link.hasAttribute('data-next-link')).toBe(true);
  });

  it('không lộ chương trình đại lý (thưởng/chiết khấu B2B) cho khách lẻ — BUYERWEB-18', async () => {
    const box = await html();
    const text = box.textContent ?? '';
    expect(text).not.toContain('Chương trình đại lý');
    expect(text).not.toContain('Thưởng quý');
    expect(text).not.toContain('Đạt chỉ tiêu');
    expect(text).not.toContain('Đạt doanh số');
    expect(Array.from(box.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Chứng nhận', 'Khuyến mãi', 'Sản phẩm', 'Câu chuyện thương hiệu']);
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

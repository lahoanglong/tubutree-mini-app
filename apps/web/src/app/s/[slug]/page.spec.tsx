// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import StorefrontPage from './page';

const mocks = vi.hoisted(() => ({ sf: null as unknown }));

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
vi.mock('@/components/storefront-tracker', () => ({ StorefrontTracker: () => null }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getStorefront: async () => mocks.sf,
}));

const PRODUCT = { id: 'p1', name: 'Bình nước inox', slug: 'binh-nuoc', brand: 'Tubu', basePrice: 100000, salePrice: null, sold: 3 };
const SF = {
  id: 's1', slug: 'linh', type: 'CTV', isPartner: false, approved: false, title: 'Shop của Linh', headerNote: 'Hàng sống xanh',
  themeColor: '#16a34a', collections: [{ id: 'c1', title: 'Nổi bật', items: [{ id: 'i1', product: PRODUCT }] }],
};

const html = async () => {
  const el = (await StorefrontPage({ params: Promise.resolve({ slug: 'linh' }) })) as ReactElement;
  const box = document.createElement('div');
  box.innerHTML = renderToStaticMarkup(el);
  return box;
};

beforeEach(() => {
  mocks.sf = SF;
});

describe('trang gian hàng /s/[slug] — tin cậy chỉ khi đúng sự thật (D3-02, D5-05)', () => {
  it('gian hàng CTV chưa được admin duyệt: không có tick xanh, không có chữ "CTV tuyển chọn"', async () => {
    const box = await html();
    expect(box.querySelector('[data-verified-mark]')).toBeNull();
    expect(box.textContent).not.toContain('CTV tuyển chọn');
  });

  it('gian hàng CTV đã duyệt: có tick xanh và chữ "CTV tuyển chọn"', async () => {
    mocks.sf = { ...SF, approved: true };
    const box = await html();
    expect(box.querySelector('[data-verified-mark]')).not.toBeNull();
    expect(box.textContent).toContain('CTV tuyển chọn');
  });

  it('API cũ chưa trả cờ approved: coi như chưa duyệt (không tự cấp tick)', async () => {
    const { approved: _omit, ...legacy } = SF;
    mocks.sf = legacy;
    expect((await html()).querySelector('[data-verified-mark]')).toBeNull();
  });

  it('gian hàng đối tác: nhãn "Đối tác của Tubu Tree", không hứa "chính hãng"', async () => {
    mocks.sf = { ...SF, type: 'MERCHANT', isPartner: true, approved: true };
    const box = await html();
    expect(box.textContent).toContain('Đối tác của Tubu Tree');
    expect(box.textContent).not.toContain('CTV tuyển chọn');
    expect(box.textContent).not.toMatch(/chính hãng/i);
  });

  it('dải cam kết không còn lời hứa cứng "100% Chính hãng", "Xuất kho tận gốc", "VietQR Napas247"', async () => {
    for (const sf of [SF, { ...SF, approved: true }, { ...SF, type: 'MERCHANT', isPartner: true, approved: true }]) {
      mocks.sf = sf;
      const text = (await html()).textContent ?? '';
      for (const claim of ['100% Chính hãng', 'Xuất kho tận gốc', 'VietQR', 'Napas']) expect(text).not.toContain(claim);
    }
  });

  it('dải cam kết nói điều luôn đúng: duyệt sản phẩm, thanh toán qua Tubu Tree, theo dõi đơn, đổi trả', async () => {
    const text = (await html()).querySelector('section[aria-labelledby="cam-ket-gian-hang"]')!.textContent ?? '';
    expect(text).toContain('Sản phẩm đã qua duyệt của Tubu Tree');
    expect(text).toContain('Thanh toán qua Tubu Tree');
    expect(text).toContain('Theo dõi đơn trên Tubu Tree');
    expect(text).toContain('Đổi trả 7 ngày (hàng lỗi NSX)');
  });
});

describe('trang gian hàng — trạng thái rỗng (D5-05)', () => {
  it('gian hàng chưa có sản phẩm nào: có thông báo rỗng và nút về danh mục, không tiêu đề bộ sưu tập trống', async () => {
    mocks.sf = { ...SF, collections: [{ id: 'c1', title: 'Nổi bật', items: [] }] };
    const box = await html();
    expect(box.textContent).toContain('Gian hàng chưa có sản phẩm nào để xem');
    const cta = box.querySelector<HTMLAnchorElement>('a[href="/"]')!;
    expect(cta.textContent).toContain('Xem sản phẩm trên Tubu Tree');
    expect(cta.className).toContain('min-h-11');
    expect(Array.from(box.querySelectorAll('h2')).map((h) => h.textContent)).not.toContain('Nổi bật');
  });

  it('thiếu cả danh sách bộ sưu tập (collections undefined): vẫn hiện thông báo rỗng, không vỡ', async () => {
    mocks.sf = { ...SF, collections: undefined };
    expect((await html()).textContent).toContain('Gian hàng chưa có sản phẩm nào để xem');
  });

  it('có sản phẩm: không hiện thông báo rỗng; bộ sưu tập rỗng bị bỏ, bộ có hàng giữ nguyên', async () => {
    mocks.sf = { ...SF, collections: [{ id: 'c0', title: 'Trống', items: [] }, ...SF.collections] };
    const box = await html();
    expect(box.textContent).not.toContain('Gian hàng chưa có sản phẩm nào để xem');
    expect(Array.from(box.querySelectorAll('h2')).map((h) => h.textContent)).toContain('Nổi bật');
    expect(Array.from(box.querySelectorAll('h2')).map((h) => h.textContent)).not.toContain('Trống');
  });
});

describe('trang gian hàng — mô tả khi chia sẻ (D3-02)', () => {
  it('gian hàng không có lời giới thiệu: mô tả mặc định không dùng chữ "tuyển chọn"', async () => {
    mocks.sf = { ...SF, headerNote: null };
    const { generateMetadata } = await import('./page');
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'linh' }) });
    expect(meta.description).toBe('Gian hàng sống xanh trên Tubu Tree');
  });
});

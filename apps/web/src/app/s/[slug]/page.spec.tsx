// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StorefrontPage from './page';

const mocks = vi.hoisted(() => ({ sf: null as unknown }));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  useRouter: () => ({ push: () => undefined }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a data-next-link="" href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/storefront-tracker', () => ({ StorefrontTracker: () => null }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: null, status: 'unauthenticated', initialized: true }) }));
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
  box.innerHTML = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);
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
    expect(text).toContain('Đổi trả nếu sản phẩm lỗi');
  });
});

// Kiểu Mini App ở điện thoại (StorePageShell + ProductTile): bìa tràn mép 84px, đầu trang phẳng không thẻ, không dải cam kết, thẻ sản phẩm chung.
describe('trang gian hàng — kiểu Mini App ở điện thoại', () => {
  it('trang hero: không đệm trang ở điện thoại; bìa 84px tràn mép, màu xanh đậm như Mini App (không theo màu chủ đề)', async () => {
    const box = await html();
    expect(box.querySelector('main')!.className).toContain('max-md:px-0');
    const cover = box.querySelector<HTMLElement>('[data-testid="storefront-cover"]')!;
    expect(cover.className).toContain('max-md:h-[84px]');
    expect(cover.className).toContain('max-md:[--sf-theme:var(--forest-700)]');
    expect(cover.parentElement!.className).toContain('max-md:rounded-none');
  });

  it('đầu trang phẳng ở điện thoại: không viền, không bóng, avatar tròn 58px đè lên bìa', async () => {
    const box = await html();
    const card = box.querySelector<HTMLElement>('[data-testid="storefront-header"]')!;
    expect(card.className).toContain('max-md:border-0');
    expect(card.className).toContain('max-md:bg-transparent');
    expect(card.className).toContain('max-md:shadow-none');
    const avatar = box.querySelector<HTMLElement>('[data-testid="storefront-avatar"]')!;
    expect(avatar.className).toContain('max-md:h-[58px]');
    expect(avatar.className).toContain('max-md:rounded-full');
    expect(avatar.parentElement!.parentElement!.className).toContain('max-md:flex-col');
  });

  it('dải cam kết chỉ cho máy tính; tiêu đề bộ sưu tập không thanh màu, không đếm sản phẩm ở điện thoại', async () => {
    const box = await html();
    expect(box.querySelector('section[aria-labelledby="cam-ket-gian-hang"]')!.className).toContain('max-md:hidden');
    const head = Array.from(box.querySelectorAll('h2')).find((h) => h.textContent === 'Nổi bật')!.parentElement!;
    expect(head.querySelector('[aria-hidden="true"]')!.className).toContain('max-md:hidden');
    expect(Array.from(head.querySelectorAll('span')).find((x) => x.textContent === '(1 sản phẩm)')!.className).toContain('max-md:hidden');
  });

  it('thẻ sản phẩm là thẻ chung của web (có tim); ghi chú của chủ nằm dưới thẻ', async () => {
    mocks.sf = { ...SF, collections: [{ id: 'c1', title: 'Nổi bật', items: [{ id: 'i1', note: 'Mình dùng hằng ngày', product: { ...PRODUCT, reviewCount: 8, ratingAvg: 4.5 } }] }] };
    const box = await html();
    const link = box.querySelector<HTMLAnchorElement>('a[href="/san-pham/binh-nuoc"]')!;
    expect(link.textContent).toContain('4.5 (8)');
    expect(link.parentElement!.querySelector('button[aria-label="Thêm yêu thích"]')).not.toBeNull();
    expect(link.textContent).not.toContain('Mình dùng hằng ngày');
    expect(box.textContent).toContain('Mình dùng hằng ngày');
  });

  // D15-01: màu chủ đề do CTV nhập đi thẳng vào style.
  it.each(['red;background:url(https://evil.example/x)', '}body{display:none', 'url(javascript:alert(1))'])(
    'màu chủ đề độc %j bị bỏ, dùng màu mặc định của token',
    async (bad) => {
      mocks.sf = { ...SF, themeColor: bad };
      const box = await html();
      expect(box.innerHTML).not.toContain('evil.example');
      expect(box.innerHTML).not.toContain('display:none');
      expect(box.innerHTML).toContain('var(--color-action-primary-bg)');
    },
  );
});

describe('trang gian hàng — trạng thái rỗng (D5-05)', () => {
  it('gian hàng chưa có sản phẩm nào: có thông báo rỗng và nút về danh mục, không tiêu đề bộ sưu tập trống', async () => {
    mocks.sf = { ...SF, collections: [{ id: 'c1', title: 'Nổi bật', items: [] }] };
    const box = await html();
    expect(box.textContent).toContain('Gian hàng chưa có sản phẩm nào để xem');
    const cta = Array.from(box.querySelectorAll<HTMLAnchorElement>('a[href="/san-pham"]')).find((a) => a.textContent?.includes('Xem sản phẩm trên Tubu Tree'))!;
    expect(cta).toBeDefined();
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

describe('trang gian hàng /s/[slug] — link subdomain theo cờ (D3-11)', () => {
  it('cờ tắt: không hiện URL subdomain dù dữ liệu có subdomain', async () => {
    mocks.sf = { ...SF, subdomain: 'linh-xanh', subdomainEnabled: false };
    expect((await html()).textContent).not.toContain('tubutree.com');
  });

  it('API cũ chưa trả cờ: coi như tắt', async () => {
    mocks.sf = { ...SF, subdomain: 'linh-xanh' };
    expect((await html()).textContent).not.toContain('linh-xanh');
  });

  it('cờ bật và có subdomain: hiện URL subdomain', async () => {
    mocks.sf = { ...SF, subdomain: 'linh-xanh', subdomainEnabled: true };
    expect((await html()).textContent).toContain('https://linh-xanh.tubutree.com');
  });
});

describe('trang gian hàng /s/[slug] — canonical và thẻ chia sẻ (D3-10)', () => {
  const meta = async (slug = 'linh') => {
    const { generateMetadata } = await import('./page');
    return generateMetadata({ params: Promise.resolve({ slug }) });
  };

  it('canonical là /s/<slug> trên gốc web, dù khách vào bằng subdomain hay chữ hoa/thường khác', async () => {
    const m = await meta('LINH');
    expect(m.alternates?.canonical).toBe('https://app.tubutree.com/s/linh');
    expect((m.openGraph as { url?: string }).url).toBe('https://app.tubutree.com/s/linh');
  });

  it('ảnh chia sẻ do opengraph-image của trang dựng: metadata không nhét ảnh gốc (kể cả base64) vào og:image', async () => {
    mocks.sf = {
      ...SF, coverUrl: 'data:image/png;base64,AAAA',
      collections: [{ id: 'c1', title: 'A', items: [{ id: 'i1', product: { ...PRODUCT, thumbnail: 'data:image/png;base64,BBBB' } }] }],
    };
    const m = await meta();
    expect((m.openGraph as { images?: unknown }).images).toBeUndefined();
    expect((m.twitter as { images?: unknown }).images).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain('base64');
    expect((m.twitter as { card?: string }).card).toBe('summary_large_image');
  });

  it('không có gian hàng: tiêu đề mặc định, không canonical', async () => {
    mocks.sf = null;
    const m = await meta();
    expect(m.title).toBe('Gian hàng — Tubu Tree');
    expect(m.alternates).toBeUndefined();
  });
});

// Ở 640-767px lớp `sm:` thắng `max-md:` (Tailwind sắp khối max-md trước sm), nên bố cục điện thoại chỉ được đổi bằng `md:`.
describe('trang gian hàng — khổ 640-767px vẫn là bố cục điện thoại', () => {
  it('main, bìa, thẻ đầu trang và avatar không dùng lớp sm: đè lên lớp điện thoại', async () => {
    const box = await html();
    const main = box.querySelector('main')!;
    expect(main.className).toContain('max-md:pb-[calc(90px+var(--safe-bottom))]');
    expect(main.className).not.toMatch(/(^|\s)sm:py-/);
    const cover = box.querySelector<HTMLElement>('[data-testid="storefront-cover"]')!;
    expect(cover.className).not.toMatch(/(^|\s)sm:h-/);
    const card = box.querySelector<HTMLElement>('[data-testid="storefront-header"]')!;
    expect(card.className).not.toMatch(/(^|\s)sm:(-mt|p)-/);
    expect(box.querySelector('[data-testid="storefront-avatar"]')!.className).not.toMatch(/(^|\s)sm:(h|w)-/);
  });

  it('bìa ảnh thật cũng không bị sm:h đè lên chiều cao 84px', async () => {
    mocks.sf = { ...SF, coverUrl: 'https://cdn.example/c.jpg' };
    const img = (await html()).querySelector<HTMLElement>('img[src="https://cdn.example/c.jpg"]')!;
    expect(img.className).toContain('max-md:h-[84px]');
    expect(img.className).not.toMatch(/(^|\s)sm:h-/);
  });

  it('không có bộ sưu tập: vẫn chừa 90px đệm đáy và vẫn có thanh dính ở điện thoại như Mini App', async () => {
    mocks.sf = { ...SF, collections: [] };
    const box = await html();
    expect(box.querySelector('main')!.className).toContain('max-md:pb-[calc(90px+var(--safe-bottom))]');
    expect(box.querySelector('[data-testid="storefront-header"] .max-md\\:fixed')).not.toBeNull();
  });

  it('không className nào ghép max-md:<thuộc tính> với sm:<cùng thuộc tính> (sm: thắng ở 640-767px)', async () => {
    const box = await html();
    const bad: string[] = [];
    box.querySelectorAll<HTMLElement>('[class]').forEach((el) => {
      const cls = el.getAttribute('class')!.split(/\s+/);
      const props = (v: string) => cls.filter((c) => c.startsWith(v)).map((c) => c.slice(v.length).replace(/^(\[?[a-z-]+).*$/, '$1').replace(/^(text|py|px|pt|pb|h|w|mt|p|mb)-.*$/, '$1'));
      const m = new Set(props('max-md:'));
      props('sm:').forEach((p) => m.has(p) && bad.push(el.getAttribute('class')!));
    });
    expect(bad).toEqual([]);
  });
});

describe('trang gian hàng — nút chính cùng hàng với khối tên ở máy tính (D7-35)', () => {
  it('StorefrontAction nằm trong hàng chứa tên, không còn hàng riêng bên dưới avatar', async () => {
    const box = await html();
    const row = box.querySelector('h1')!.closest('div.md\\:justify-between')!;
    expect(row.querySelector('a[href="/san-pham"]')).not.toBeNull();
    const card = box.querySelector('[data-testid="storefront-header"]')!;
    expect(card.querySelector(':scope > div.justify-end')).toBeNull();
  });
});

describe('trang gian hàng — avatar chữ cái theo màu chủ đề chỉ từ md', () => {
  it('màu chủ đề đi qua biến CSS, không gán backgroundColor inline đè màu xanh đậm của điện thoại', async () => {
    const avatar = (await html()).querySelector<HTMLElement>('[data-testid="storefront-avatar"]')!;
    expect(avatar.getAttribute('style')).not.toMatch(/background-color/);
    expect(avatar.className).toContain('max-md:bg-[var(--color-action-primary-bg)]');
  });
});

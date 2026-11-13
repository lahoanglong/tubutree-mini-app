import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/site';
import { META_DESCRIPTION_MAX } from '@/lib/product-seo';

// Chặn lệch giữa 5 trang tĩnh công khai chia sẻ qua Zalo/Messenger: mỗi trang phải có canonical + openGraph (url, title có hậu tố, ảnh) và một
// khối JSON-LD WebPage + BreadcrumbList cùng đường dẫn. Phần client của từng trang được thay bằng null: spec chỉ kiểm phần server (metadata + <script>).

vi.mock('./cau-chuyen/brand-story-view', () => ({ BrandStoryView: () => null }));
vi.mock('./gio-vang/flash-slots-view', () => ({ default: () => null }));
vi.mock('@/components/recycle/recycle-rules-view', () => ({ RecycleRulesView: () => null }));
vi.mock('./cong-dong/feed-shell', () => ({ FeedShell: () => null }));
vi.mock('./cong-dong/feed-view', () => ({ FeedView: () => null }));
vi.mock('@/components/community/community-channels', () => ({ CommunityChannels: () => null }));
vi.mock('@/components/community/public-preview-list', () => ({ PublicPreviewList: () => null }));
vi.mock('./gioi-thieu/about-view', () => ({ AboutView: () => null }));
vi.mock('@/lib/core-http-server', () => ({ createServerHttp: () => ({ get: vi.fn().mockRejectedValue(new Error('offline')) }) }));

import BrandStoryPage, { metadata as brandStory } from './cau-chuyen/page';
import CommunityPage, { metadata as community } from './cong-dong/page';
import RecycleRulesPage, { metadata as recycleRules } from './doi-rac/quy-dinh/page';
import AboutPage, { metadata as about } from './gioi-thieu/page';
import FlashSalePage, { metadata as flashSale } from './gio-vang/page';

type PageCase = { path: string; metadata: Metadata; render: () => Promise<string> };
const html = async (page: () => unknown): Promise<string> => renderToStaticMarkup((await page()) as React.ReactElement);

const CASES: PageCase[] = [
  { path: '/cau-chuyen', metadata: brandStory, render: () => html(BrandStoryPage) },
  { path: '/cong-dong', metadata: community, render: () => html(CommunityPage) },
  { path: '/doi-rac/quy-dinh', metadata: recycleRules, render: () => html(RecycleRulesPage) },
  { path: '/gioi-thieu', metadata: about, render: () => html(AboutPage) },
  { path: '/gio-vang', metadata: flashSale, render: () => html(FlashSalePage) },
];

const ldBlocks = (markup: string): Record<string, unknown>[] =>
  [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));

describe.each(CASES)('$path — thẻ chia sẻ và dữ liệu có cấu trúc', ({ path, metadata, render }) => {
  it('canonical, og:url, og:title (có hậu tố), mô tả và ảnh xem trước đầy đủ; được lập chỉ mục', () => {
    expect(typeof metadata.title).toBe('string');
    const title = metadata.title as string;
    expect(metadata.alternates?.canonical).toBe(path);
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'Tubu Tree',
      locale: 'vi_VN',
      url: path,
      title: `${title} — Tubu Tree`,
      description: metadata.description,
    });
    const images = (metadata.openGraph as { images?: { url: string; width: number; height: number; alt: string }[] }).images ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ url: '/opengraph-image.png', width: 1200, height: 630 });
    expect(images[0]!.alt).not.toBe('');
    expect(metadata.description?.length ?? 0).toBeGreaterThan(40);
    expect(metadata.description!.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(metadata.robots).toBeUndefined();
  });

  it('HTML có đúng một khối WebPage + BreadcrumbList trỏ về chính trang (URL tuyệt đối), tên và mô tả khớp metadata', async () => {
    const graphs = ldBlocks(await render()).filter((d) => Array.isArray(d['@graph']));
    expect(graphs).toHaveLength(1);
    const [page, crumbs] = graphs[0]!['@graph'] as Record<string, unknown>[];
    const url = `${SITE_URL}${path}`;
    expect(page).toMatchObject({ '@type': 'WebPage', url, name: metadata.title, description: metadata.description, breadcrumb: { '@id': `${url}#breadcrumb` } });
    expect(crumbs).toMatchObject({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb` });
    const items = (crumbs as { itemListElement: { position: number; item: string }[] }).itemListElement;
    expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i + 1));
    expect(items[0]!.item).toBe(`${SITE_URL}/`);
    expect(items.at(-1)!.item).toBe(url);
    for (const i of items) expect(i.item.startsWith('https://') || i.item.startsWith('http://')).toBe(true);
  });
});

describe('/doi-rac/quy-dinh — vệt breadcrumb', () => {
  it('không chứa /doi-rac (trang noindex) trong dữ liệu có cấu trúc', async () => {
    const graph = ldBlocks(await html(RecycleRulesPage))[0]!['@graph'] as { itemListElement?: { item: string }[] }[];
    const items = graph[1]!.itemListElement!.map((i) => i.item);
    expect(items).toEqual([`${SITE_URL}/`, `${SITE_URL}/doi-rac/quy-dinh`]);
  });
});

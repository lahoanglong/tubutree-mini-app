import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/site';
import { META_DESCRIPTION_MAX } from '@/lib/product-seo';

// Sáu landing tăng trưởng công khai là trang client nên thẻ SEO nằm ở layout của đoạn đường dẫn (riêng /doi-rac ở page). Spec chặn lệch giữa
// metadata, JSON-LD và hành vi kế thừa xuống trang con riêng tư (/ctv/gian-hang, /kho-qua/cua-toi: noindex, không canonical, không JSON-LD của landing).

const segment = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('next/navigation', () => ({ useSelectedLayoutSegment: () => segment.value }));
vi.mock('@/components/recycle/recycle-home', () => ({ RecycleHome: () => <i id="recycle-home" /> }));

import RecyclePage, { metadata as recycle } from './doi-rac/page';
import GameLayout, { metadata as garden } from './vuon-xanh/layout';
import CtvLayout, { metadata as ctv } from './ctv/layout';
import CtvStorefrontLayout, { metadata as ctvStorefront } from './ctv/gian-hang/layout';
import DealerLayout, { metadata as dealer } from './dai-ly/layout';
import RewardsLayout, { metadata as rewards } from './kho-qua/layout';
import MyRewardsLayout, { metadata as myRewards } from './kho-qua/cua-toi/layout';
import AdvisorLayout, { metadata as advisor } from './tu-van/layout';
import { metadata as rootMetadata } from './layout';

type Case = { path: string; metadata: Metadata; render: () => string };
const child = <i id="child" />;
const CASES: Case[] = [
  { path: '/doi-rac', metadata: recycle, render: () => renderToStaticMarkup(<RecyclePage />) },
  { path: '/vuon-xanh', metadata: garden, render: () => renderToStaticMarkup(<GameLayout>{child}</GameLayout>) },
  { path: '/ctv', metadata: ctv, render: () => renderToStaticMarkup(<CtvLayout>{child}</CtvLayout>) },
  { path: '/dai-ly', metadata: dealer, render: () => renderToStaticMarkup(<DealerLayout>{child}</DealerLayout>) },
  { path: '/kho-qua', metadata: rewards, render: () => renderToStaticMarkup(<RewardsLayout>{child}</RewardsLayout>) },
  { path: '/tu-van', metadata: advisor, render: () => renderToStaticMarkup(<AdvisorLayout>{child}</AdvisorLayout>) },
];

const ownTitle = (m: Metadata): string => (typeof m.title === 'string' ? m.title : (m.title as { default: string }).default);
const ldBlocks = (markup: string): Record<string, unknown>[] =>
  [...markup.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));

describe.each(CASES)('$path — thẻ SEO của landing công khai', ({ path, metadata, render }) => {
  it('canonical, og:url, og:title (có hậu tố), mô tả riêng (khác mô tả gốc) và ảnh xem trước; được lập chỉ mục', () => {
    const title = ownTitle(metadata);
    expect(metadata.alternates?.canonical).toBe(path);
    expect(metadata.openGraph).toMatchObject({ type: 'website', siteName: 'Tubu Tree', locale: 'vi_VN', url: path, title: `${title} — Tubu Tree`, description: metadata.description });
    const images = (metadata.openGraph as { images?: { url: string; width: number; height: number; alt: string }[] }).images ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ url: '/opengraph-image.png', width: 1200, height: 630 });
    expect(metadata.description).toBeTruthy();
    expect(metadata.description).not.toBe(rootMetadata.description);
    expect(metadata.description!.length).toBeGreaterThan(40);
    expect(metadata.description!.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(metadata.robots).toBeUndefined();
  });

  it('HTML có đúng một khối WebPage + BreadcrumbList trỏ về URL tuyệt đối của chính trang; nội dung trang vẫn được dựng nguyên vẹn', () => {
    segment.value = null;
    const markup = render();
    expect(markup).toMatch(/<i id="(child|recycle-home)">/);
    const graphs = ldBlocks(markup).filter((d) => Array.isArray(d['@graph']));
    expect(graphs).toHaveLength(1);
    const [page, crumbs] = graphs[0]!['@graph'] as Record<string, unknown>[];
    const url = `${SITE_URL}${path}`;
    expect(page).toMatchObject({ '@type': 'WebPage', url, name: ownTitle(metadata), description: metadata.description });
    expect(crumbs).toMatchObject({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb` });
    const items = (crumbs as { itemListElement: { item: string }[] }).itemListElement;
    expect(items.at(-1)!.item).toBe(url);
  });
});

describe('landing có trang con riêng tư', () => {
  it('layout /ctv và /kho-qua giữ tiêu đề {default, template} để trang con còn hậu tố "— Tubu Tree"', () => {
    for (const m of [ctv, rewards]) expect((m.title as { template: string }).template).toBe('%s — Tubu Tree');
  });

  it.each([
    ['/ctv/gian-hang', CtvLayout, 'gian-hang'],
    ['/kho-qua/cua-toi', RewardsLayout, 'cua-toi'],
  ] as const)('%s: layout cha không in JSON-LD của landing khi đang dựng trang con, children vẫn có', (_path, Layout, childSegment) => {
    segment.value = childSegment;
    const markup = renderToStaticMarkup(<Layout>{child}</Layout>);
    segment.value = null;
    expect(markup).toBe('<i id="child"></i>');
  });

  it('layout con riêng tư: noindex và xoá canonical + openGraph kế thừa từ landing cha (không tín hiệu mâu thuẫn)', () => {
    for (const m of [ctvStorefront, myRewards]) {
      expect(m.robots).toEqual({ index: false, follow: false });
      expect(m.alternates).toBeNull();
      expect(m.openGraph).toBeNull();
    }
    expect(renderToStaticMarkup(<CtvStorefrontLayout>{child}</CtvStorefrontLayout>)).toBe('<i id="child"></i>');
    expect(renderToStaticMarkup(<MyRewardsLayout>{child}</MyRewardsLayout>)).toBe('<i id="child"></i>');
  });
});

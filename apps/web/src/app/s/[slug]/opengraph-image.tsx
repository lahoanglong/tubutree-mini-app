import { ImageResponse } from 'next/og';
import { getStorefront } from '@/lib/api';
import { fetchOgImage } from '@/lib/og-image-fetch';
import { ogCardData } from '@/lib/storefront-og';
import { StorefrontOgCard } from './og-card';

export const alt = 'Gian hàng trên Tubu Tree';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 300;

// Font có đủ dấu tiếng Việt: font mặc định của satori chỉ có Latin cơ bản nên tên gian hàng có dấu sẽ ra ô vuông.
const font = fetch(new URL('../../../assets/fonts/BeVietnamPro-SemiBold.ttf', import.meta.url)).then((r) => r.arrayBuffer());

export default async function Image({ params }: { params: { slug: string } | Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sf = await getStorefront(slug);
  const data = ogCardData(sf ?? { title: 'Tubu Tree', avatarUrl: null, themeColor: null, collections: [] });
  const [avatar, ...thumbs] = await Promise.all([
    data.avatar ? fetchOgImage(data.avatar) : null,
    ...data.thumbnails.map((src) => fetchOgImage(src)),
  ]);
  const images = { avatar, thumbnails: thumbs.filter((t): t is string => t !== null) };
  return new ImageResponse(<StorefrontOgCard data={data} images={images} />, {
    ...size,
    fonts: [{ name: 'BeVietnam', data: await font, weight: 600, style: 'normal' }],
  });
}

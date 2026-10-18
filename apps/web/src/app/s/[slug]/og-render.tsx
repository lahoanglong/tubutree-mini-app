import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { getStorefront } from '@/lib/api';
import { fetchOgImage } from '@/lib/og-image-fetch';
import { ogCardData } from '@/lib/storefront-og';
import { StorefrontOgCard } from './og-card';

export const OG_SIZE = { width: 1200, height: 630 };

// Đọc từ đĩa, không `fetch(new URL(..., import.meta.url))`: cách đó chỉ chạy được trên Edge, còn Node báo "fetch failed" và cả
// route trả 500. Hai tệp này được kéo vào bản standalone qua `outputFileTracingIncludes` trong next.config.mjs.
const ASSETS = path.join(process.cwd(), 'src', 'assets');
const FONT_FILE = path.join(ASSETS, 'fonts', 'BeVietnamPro-SemiBold.ttf');
const DEFAULT_IMAGE_FILE = path.join(ASSETS, 'og-default.png');

// PNG 1x1, chỗ dựa cuối cùng khi cả ảnh mặc định cũng không đọc được: thẻ chia sẻ hỏng thì thiếu ảnh chứ trang không được 500.
const PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const pngHeaders = (maxAgeSeconds: number) => ({
  'content-type': 'image/png',
  'cache-control': `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}`,
});

// Font có đủ dấu tiếng Việt: font mặc định của satori chỉ có Latin cơ bản nên tên gian hàng có dấu sẽ ra ô vuông.
let fontPromise: Promise<Buffer> | null = null;
function loadFont(): Promise<Buffer> {
  fontPromise ??= readFile(FONT_FILE).catch((err: unknown) => {
    fontPromise = null;
    throw err;
  });
  return fontPromise;
}

async function defaultOgImage(): Promise<Response> {
  let bytes = PIXEL_PNG;
  try {
    bytes = await readFile(DEFAULT_IMAGE_FILE);
  } catch (err) {
    console.error('opengraph-image: không đọc được ảnh mặc định, dùng PNG nhúng sẵn', err);
  }
  return new Response(bytes, { headers: pngHeaders(60) });
}

/**
 * Ảnh chia sẻ của gian hàng. Mọi lỗi (API, font, tải ảnh, bộ dựng) và gian hàng không còn hiển thị đều ra ảnh mặc định với mã 200,
 * không bao giờ 500: trang gian hàng không còn og:image nào khác nên Zalo và Facebook sẽ không có ảnh xem trước.
 * Phải đợi bộ dựng ra đủ byte ngay trong hàm này: ImageResponse chỉ dựng khi có người đọc thân phản hồi, lỗi lúc đó nằm ngoài try.
 */
export async function renderStorefrontOgImage(params: { slug: string } | Promise<{ slug: string }>): Promise<Response> {
  try {
    const { slug } = await params;
    const sf = await getStorefront(slug);
    if (!sf) return await defaultOgImage();
    const data = ogCardData(sf);
    const [font, avatar, ...thumbs] = await Promise.all([
      loadFont(),
      data.avatar ? fetchOgImage(data.avatar) : null,
      ...data.thumbnails.map((src) => fetchOgImage(src)),
    ]);
    const images = { avatar, thumbnails: thumbs.filter((t): t is string => t !== null) };
    const png = await new ImageResponse(<StorefrontOgCard data={data} images={images} />, {
      ...OG_SIZE,
      fonts: [{ name: 'BeVietnam', data: font, weight: 600, style: 'normal' }],
    }).arrayBuffer();
    return new Response(png, { headers: pngHeaders(300) });
  } catch (err) {
    console.error('opengraph-image: dùng ảnh mặc định', err);
    return await defaultOgImage();
  }
}

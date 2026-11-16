import path from 'path';
import type { APIRequestContext } from '@playwright/test';
import { seedDatabaseUrl } from './a11y-db';
import { writableTempDb } from './waste-db';

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
/** Bỏ qua 20 sản phẩm đầu của danh sách: các spec web khác dùng sản phẩm đầu danh sách, và đợt Giờ vàng gieo ở `pdp-flash-db` lấy từ cuối. */
const SKIP_FIRST = 20;

export const MEDIA_IMAGES = ['https://img.test/w181-a.svg', 'https://img.test/w181-b.svg', 'https://img.test/w181-c.svg'];
export const MEDIA_VIDEO = 'https://cdn.test/w181-clip.mp4';

export interface MediaPdp {
  slug: string;
  name: string;
  productId: string;
  variations: { id: string; name: string }[];
  /** Giá trị cũ để trả lại sau spec. */
  prior: { images: string[]; thumbnail: string | null; videos: string[]; variationImages: { id: string; imageUrl: string | null }[] };
}

interface Detail {
  id: string;
  slug: string;
  name: string;
  variations: { id: string; name: string; stock: number }[];
}

type Prisma = {
  product: { update: (a: unknown) => Promise<unknown>; findUnique: (a: unknown) => Promise<{ videos: string[]; images: string[]; thumbnail: string | null } | null> };
  variation: { update: (a: unknown) => Promise<unknown>; findMany: (a: unknown) => Promise<{ id: string; imageUrl: string | null }[]> };
  $disconnect: () => Promise<void>;
};

function client(url: string): Prisma {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  return new PrismaClient({ datasources: { db: { url } } }) as Prisma;
}

/**
 * Gieo ảnh (3), một video và ảnh riêng cho phân loại thứ hai vào MỘT sản phẩm có từ 2 phân loại còn hàng (từ vị trí 20 của danh sách), trong DB tạm
 * (writableTempDb); `null` khi không ghi được hay không có sản phẩm hợp. `restoreMediaPdp` trả lại như cũ.
 */
export async function seedMediaPdp(request: APIRequestContext): Promise<MediaPdp | null> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return null;
  const list = await request.get(`${API_ORIGIN}/api/products?limit=50`).catch(() => null);
  if (!list?.ok()) return null;
  const slugs = ((await list.json()) as { data?: { slug: string }[] }).data?.map((x) => x.slug) ?? [];
  let found: Detail | null = null;
  for (const slug of slugs.slice(SKIP_FIRST)) {
    const res = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(slug)}`).catch(() => null);
    const d = res?.ok() ? ((await res.json()) as Detail) : null;
    if (d && d.variations.filter((v) => v.stock > 0).length >= 2) {
      found = d;
      break;
    }
  }
  if (!found) return null;
  const prisma = client(url);
  try {
    const row = await prisma.product.findUnique({ where: { id: found.id }, select: { images: true, thumbnail: true, videos: true } });
    if (!row) return null;
    const vars = await prisma.variation.findMany({ where: { productId: found.id }, select: { id: true, imageUrl: true } });
    await prisma.product.update({ where: { id: found.id }, data: { images: MEDIA_IMAGES, thumbnail: MEDIA_IMAGES[0], videos: [MEDIA_VIDEO] } });
    const inStock = found.variations.filter((v) => v.stock > 0);
    await prisma.variation.update({ where: { id: inStock[1]!.id }, data: { imageUrl: MEDIA_IMAGES[2] } });
    return {
      slug: found.slug,
      name: found.name,
      productId: found.id,
      variations: inStock.map((v) => ({ id: v.id, name: v.name })),
      prior: { images: row.images, thumbnail: row.thumbnail, videos: row.videos, variationImages: vars.map((v) => ({ id: v.id, imageUrl: v.imageUrl })) },
    };
  } finally {
    await prisma.$disconnect();
  }
}

export async function restoreMediaPdp(m: MediaPdp): Promise<void> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return;
  const prisma = client(url);
  try {
    await prisma.product.update({ where: { id: m.productId }, data: { images: m.prior.images, thumbnail: m.prior.thumbnail, videos: m.prior.videos } });
    for (const v of m.prior.variationImages) await prisma.variation.update({ where: { id: v.id }, data: { imageUrl: v.imageUrl } });
  } finally {
    await prisma.$disconnect();
  }
}

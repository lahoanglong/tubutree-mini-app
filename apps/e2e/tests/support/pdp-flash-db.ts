import path from 'path';
import type { APIRequestContext } from '@playwright/test';
import { seedDatabaseUrl } from './a11y-db';
import { writableTempDb } from './waste-db';

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const HOUR = 3_600_000;
const PROBES = 14;

export interface FlashPdp {
  slug: string;
  name: string;
  variationId: string;
  variationName: string;
  retailPrice: number;
  flashPrice: number;
  saleId: string;
  /** Các sản phẩm khác cùng đợt: mỗi lần dò dùng một sản phẩm (trang ISR đã dựng giữ 5 phút) để biết khi nào bản server (bộ nhớ đệm fetch 60 giây của Next) thấy đợt mới, không chạm trang của `slug`. */
  probeSlugs: string[];
}

/**
 * Tạo một đợt Giờ vàng đang chạy cho một phân loại còn hàng của hai sản phẩm CUỐI danh sách (ít spec khác chạm tới nên bản dựng sẵn của trang chưa bị giữ lại không có Giờ vàng),
 * ghi vào DB tạm (writableTempDb); `null` khi không ghi được. `removeFlashPdp` xoá đợt đó để các spec khác không thấy giá Giờ vàng.
 */
export async function seedFlashPdp(request: APIRequestContext): Promise<FlashPdp | null> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return null;
  const list = await request.get(`${API_ORIGIN}/api/products?limit=50`).catch(() => null);
  if (!list?.ok()) return null;
  const slugs = ((await list.json()) as { data?: { slug: string }[] }).data?.map((x) => x.slug) ?? [];
  type Detail = { slug: string; name: string; variations: { id: string; name: string; retailPrice: number; salePrice: number | null; stock: number }[] };
  const found: { d: Detail; v: Detail['variations'][number] }[] = [];
  for (const slug of [...slugs].reverse()) {
    const res = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(slug)}`).catch(() => null);
    const d = res?.ok() ? ((await res.json()) as Detail) : null;
    const v = d?.variations.find((x) => x.stock > 0 && x.retailPrice >= 20_000);
    if (d && v) found.push({ d, v });
    if (found.length === PROBES + 1) break;
  }
  if (found.length < 2) return null;
  const [target, ...probes] = found as [(typeof found)[number], ...(typeof found)[number][]];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const priceOf = (v: { retailPrice: number }) => Math.round((v.retailPrice * 0.7) / 1000) * 1000;
    const now = Date.now();
    const sale = await prisma.flashSale.create({
      data: {
        title: 'E2E CLS Giờ vàng', startAt: new Date(now - HOUR), endAt: new Date(now + 6 * HOUR), isActive: true, createdBy: 'e2e',
        items: {
          create: [target, ...probes].map(({ v }, i) => ({ variationId: v.id, flashPrice: priceOf(v), quota: 100, soldCount: 10, perUserLimit: 3, sortOrder: i })),
        },
      },
    });
    return {
      slug: target.d.slug, name: target.d.name, variationId: target.v.id, variationName: target.v.name, retailPrice: target.v.retailPrice,
      flashPrice: priceOf(target.v), saleId: sale.id, probeSlugs: probes.map((p) => p.d.slug),
    };
  } finally {
    await prisma.$disconnect();
  }
}

export async function removeFlashPdp(saleId: string): Promise<void> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.flashSale.delete({ where: { id: saleId } }).catch(() => undefined);
  } finally {
    await prisma.$disconnect();
  }
}

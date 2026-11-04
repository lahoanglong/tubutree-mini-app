import path from 'path';
import type { APIRequestContext } from '@playwright/test';
import { seedDatabaseUrl } from './a11y-db';
import { writableTempDb } from './waste-db';

const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const HOUR = 3_600_000;

export interface FlashPdp {
  slug: string;
  name: string;
  variationId: string;
  variationName: string;
  retailPrice: number;
  flashPrice: number;
  saleId: string;
}

/**
 * Tạo một đợt Giờ vàng đang chạy cho một phân loại còn hàng của sản phẩm CUỐI danh sách (ít spec khác chạm tới nên bản dựng sẵn của trang chưa bị giữ lại không có Giờ vàng),
 * ghi vào DB tạm (writableTempDb); `null` khi không ghi được. `removeFlashPdp` xoá đợt đó để các spec khác không thấy giá Giờ vàng.
 */
export async function seedFlashPdp(request: APIRequestContext): Promise<FlashPdp | null> {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return null;
  const list = await request.get(`${API_ORIGIN}/api/products?limit=50`).catch(() => null);
  if (!list?.ok()) return null;
  const slugs = ((await list.json()) as { data?: { slug: string }[] }).data?.map((x) => x.slug) ?? [];
  type Detail = { slug: string; name: string; variations: { id: string; name: string; retailPrice: number; salePrice: number | null; stock: number }[] };
  for (const slug of [...slugs].reverse()) {
    const res = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(slug)}`).catch(() => null);
    const d = res?.ok() ? ((await res.json()) as Detail) : null;
    const v = d?.variations.find((x) => x.stock > 0 && x.retailPrice >= 20_000);
    if (!d || !v) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { PrismaClient } = require(path.resolve(__dirname, '../../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    try {
      const flashPrice = Math.round((v.retailPrice * 0.7) / 1000) * 1000;
      const now = Date.now();
      const sale = await prisma.flashSale.create({
        data: {
          title: 'E2E CLS Giờ vàng', startAt: new Date(now - HOUR), endAt: new Date(now + 6 * HOUR), isActive: true, createdBy: 'e2e',
          items: { create: [{ variationId: v.id, flashPrice, quota: 100, soldCount: 10, perUserLimit: 3 }] },
        },
      });
      return { slug: d.slug, name: d.name, variationId: v.id, variationName: v.name, retailPrice: v.retailPrice, flashPrice, saleId: sale.id };
    } finally {
      await prisma.$disconnect();
    }
  }
  return null;
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

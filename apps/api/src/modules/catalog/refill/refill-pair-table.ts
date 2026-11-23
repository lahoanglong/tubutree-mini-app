import type { PrismaService } from '../../../prisma/prisma.service';
import { PUBLIC_PRODUCT_WHERE } from '../public-product';
import { REFILL_PAIRS_BLOCK_KEY, REFILL_PAIRS_OVERRIDE_KEY, pairRefills, parseRefillBlock, parseRefillOverrides } from './refill-pairs';

interface ConfigReader {
  get<T>(key: string, fallback?: T): Promise<T>;
}

/**
 * Bảng cặp hiện hành (id chai → id gói Refill) đọc thẳng từ danh mục công khai và hai khoá ghép tay/chặn. Một nguồn cho
 * `RefillPairsService` (có đệm 60 giây) và job nhắc Refill 21 ngày (module thông báo, không kéo CatalogService vào).
 */
export async function loadRefillPairTable(prisma: PrismaService, config: ConfigReader | undefined): Promise<Map<string, string>> {
  const value = async (key: string): Promise<unknown> => (await config?.get<unknown>(key, [])) ?? [];
  const [products, overrides, block] = await Promise.all([
    prisma.product.findMany({ where: { ...PUBLIC_PRODUCT_WHERE }, select: { id: true, slug: true, name: true, brand: true, isCombo: true } }),
    value(REFILL_PAIRS_OVERRIDE_KEY),
    value(REFILL_PAIRS_BLOCK_KEY),
  ]);
  return pairRefills(products, { overrides: parseRefillOverrides(overrides), block: parseRefillBlock(block) });
}

/**
 * Mọi sản phẩm của bảng cặp: chai có gói Refill và chính các gói Refill, id tăng dần (khoá nhớ ổn định). Một nguồn cho bộ lọc
 * "Có bản Refill" của Danh mục và cờ `hasRefillProducts` của trang thương hiệu.
 */
export function refillPairProductIds(pairs: ReadonlyMap<string, string>): string[] {
  return [...new Set([...pairs.keys(), ...pairs.values()])].sort();
}

import type { MockApi } from './mock-api';

/**
 * Dữ liệu mock chung cho hai spec e2e bộ lọc Yêu thích (Mini App và web). Bốn món: A giảm giá thường, B chỉ giảm nhờ Giờ vàng, C giá thường, D giảm giá thường nhưng hết hàng.
 * Tất cả 4, Đang giảm 3 (A, B, D), Còn hàng 3 (A, B, C).
 */
export const VIEWPORTS_MOBILE = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
] as const;

export const NAME = { a: 'Nước rửa chén', b: 'Xà phòng thảo mộc', c: 'Dầu gội bồ kết', d: 'Nước giặt hữu cơ' } as const;

const card = (key: keyof typeof NAME, over: Record<string, unknown> = {}) => ({
  id: `p-${key}`,
  slug: `sp-${key}`,
  brand: 'Tubu',
  name: NAME[key],
  thumbnail: null,
  basePrice: 100_000,
  salePrice: null,
  isFeatured: false,
  inStock: true,
  ...over,
});

export const CARDS = [card('a', { salePrice: 80_000 }), card('b'), card('c'), card('d', { salePrice: 70_000, inStock: false })];

/** Đồng hồ máy chủ trong mock: `ms` là số mili giây máy chủ đã đi trước giờ máy test (test dùng `page.clock.fastForward` thì tăng theo, như máy chủ thật). */
export interface ServerSkew {
  ms: number;
}

/**
 * Một suất Giờ vàng đang chạy cho món B, hết sau `endAfterMs` tính từ lúc test dựng mock. Giống API thật: `serverNow` là giờ máy chủ (kho Giờ vàng ở web tải lại
 * sau khi đồng hồ trang nhảy và đo độ lệch từ trường này) và suất đã hết hạn theo giờ máy chủ thì không còn trong danh sách.
 */
export function flashForB(endAfterMs: number, skew: ServerSkew = { ms: 0 }) {
  const endAt = Date.now() + endAfterMs;
  return () => {
    const serverNow = Date.now() + skew.ms;
    if (endAt <= serverNow) return [];
    return [
      {
        itemId: 'fi-b',
        variationId: 'var-b',
        productSlug: 'sp-b',
        productName: NAME.b,
        variationName: 'Chai 500ml',
        thumbnail: null,
        flashPrice: 60_000,
        retailPrice: 100_000,
        salePrice: null,
        soldCount: 10,
        quota: 100,
        perUserLimit: 3,
        endAt: new Date(endAt).toISOString(),
        serverNow: new Date(serverNow).toISOString(),
      },
    ];
  };
}

export function mockWishlistData(api: MockApi, opts: { cards?: typeof CARDS; flash?: ReturnType<typeof flashForB> | [] } = {}): void {
  const cards = opts.cards ?? CARDS;
  api.get('/me/wishlist', cards);
  api.get('/me/wishlist/ids', cards.map((c) => c.id));
  api.get('/flash-sales/active', opts.flash ?? []);
}

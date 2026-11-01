import type { FlashSlot, FlashSlotItem, UpcomingFlashItem } from '../../../../packages/app-core/src/api/flash-sale';
import { reply, type MockApi } from './mock-api';

/**
 * Mock trang Giờ vàng theo khung (Mini `/flash-sale`, web `/gio-vang`). Đường NestJS:
 *   GET    /flash-sales/slots                  flash-sale.controller.ts (công khai, bọc { serverNow, slots })
 *   GET    /flash-sales/slots/:id/items        (công khai, bọc { serverNow, slot, items })
 *   GET    /flash-sales/upcoming               (reminded theo khách)
 *   POST   /flash-sales/items/:id/remind
 *   DELETE /flash-sales/items/:id/remind
 *   GET    /categories
 *   POST   /events                             nhật ký sự kiện của app
 *
 * Giờ cố định để nhãn tab ổn định: máy chủ "đang" 13:00 giờ Việt Nam ngày 2026-11-01. Khung 12:00 đang diễn ra,
 * 20:00 cùng ngày sắp diễn ra, 12:00 ngày mai. Hàm KHÔNG gọi mockSession: spec chọn khách đăng nhập hay khách chưa có phiên.
 */

export const FLASH_NOW = '2026-11-01T06:00:00.000Z';

export const SLOT_LIVE: FlashSlot = {
  id: 'slot-12',
  title: 'Giờ vàng 12:00',
  startAt: '2026-11-01T05:00:00.000Z',
  endAt: '2026-11-01T07:00:00.000Z',
  status: 'LIVE',
  itemCount: 14,
};
export const SLOT_NEXT: FlashSlot = {
  id: 'slot-20',
  title: 'Giờ vàng 20:00',
  startAt: '2026-11-01T13:00:00.000Z',
  endAt: '2026-11-01T15:00:00.000Z',
  status: 'UPCOMING',
  itemCount: 3,
};
export const SLOT_TOMORROW: FlashSlot = {
  id: 'slot-12-mai',
  title: 'Giờ vàng 12:00 ngày mai',
  startAt: '2026-11-02T05:00:00.000Z',
  endAt: '2026-11-02T07:00:00.000Z',
  status: 'UPCOMING',
  itemCount: 0,
};
export const SLOTS: FlashSlot[] = [SLOT_LIVE, SLOT_NEXT, SLOT_TOMORROW];

export const CAT_FOOD = { id: 'cat-food', parentId: null, name: 'Thực phẩm', slug: 'thuc-pham', image: null };
export const CAT_HOME = { id: 'cat-home', parentId: null, name: 'Nhà cửa', slug: 'nha-cua', image: null };

export function liveItem(n: number, over: Partial<FlashSlotItem> = {}): FlashSlotItem {
  return {
    itemId: `fi-${n}`,
    variationId: `var-flash-${n}`,
    variationName: null,
    productId: `prod-${n}`,
    productSlug: `san-pham-gio-vang-${n}`,
    productName: `Sản phẩm Giờ vàng ${n}`,
    thumbnail: null,
    categoryIds: [n % 2 === 0 ? CAT_FOOD.id : CAT_HOME.id],
    flashPrice: 49_000 + n * 1_000,
    retailPrice: 99_000,
    salePrice: null,
    soldCount: 10 + n,
    quota: 40,
    soldOut: false,
    perUserLimit: 5,
    ...over,
  };
}

/** 14 món khung đang diễn ra: món 1 và 2 hết suất (server trả lẫn lộn, trang phải đẩy xuống cuối). */
export function liveItems(): FlashSlotItem[] {
  return Array.from({ length: 14 }, (_, i) => liveItem(i + 1, i < 2 ? { soldOut: true, soldCount: 40 } : {}));
}

export function nextItems(): FlashSlotItem[] {
  return [21, 22, 23].map((n) => liveItem(n, { soldCount: 0 }));
}

export interface FlashSlotMockOptions {
  /** Món theo khung; mặc định 14 món khung 12:00, 3 món khung 20:00, khung ngày mai rỗng. */
  items?: Record<string, FlashSlotItem[]>;
  /** itemId đã đặt nhắc sẵn. */
  remindedIds?: string[];
}

/** Đăng ký mọi đường trang Giờ vàng cần; trả về tập itemId đang được nhắc (đổi khi POST/DELETE remind). */
export function mockFlashSlots(api: MockApi, opts: FlashSlotMockOptions = {}): Set<string> {
  const items = opts.items ?? { [SLOT_LIVE.id]: liveItems(), [SLOT_NEXT.id]: nextItems(), [SLOT_TOMORROW.id]: [] };
  const reminded = new Set(opts.remindedIds ?? []);
  const slotOf = (id: string): FlashSlot | undefined => SLOTS.find((s) => s.id === id);

  api.get('/flash-sales/slots', () => ({ serverNow: FLASH_NOW, slots: SLOTS }));
  api.get('/flash-sales/slots/:id/items', ({ params }) => {
    const slot = slotOf(params.id!);
    if (!slot) return reply(404, { message: 'Không tìm thấy khung Giờ vàng' });
    return { serverNow: FLASH_NOW, slot, items: items[slot.id] ?? [] };
  });
  api.get('/flash-sales/upcoming', () =>
    (items[SLOT_NEXT.id] ?? []).map((it): UpcomingFlashItem => ({
      itemId: it.itemId,
      variationId: it.variationId,
      productSlug: it.productSlug,
      productName: it.productName,
      thumbnail: it.thumbnail,
      flashPrice: it.flashPrice,
      retailPrice: it.retailPrice,
      salePrice: it.salePrice,
      startAt: SLOT_NEXT.startAt,
      reminded: reminded.has(it.itemId),
    })),
  );
  api.post('/flash-sales/items/:id/remind', ({ params }) => {
    reminded.add(params.id!);
    return { ok: true };
  });
  api.delete('/flash-sales/items/:id/remind', ({ params }) => {
    reminded.delete(params.id!);
    return { ok: true };
  });
  api.get('/categories', [CAT_FOOD, CAT_HOME]);
  api.post('/events', { accepted: 1 });
  return reminded;
}

/** Khách chưa có phiên: mọi đường đăng nhập từ chối như tài khoản bị khoá, nên app ở trạng thái khách. */
export function mockNoSession(api: MockApi): void {
  const blocked = () => reply(401, { code: 'ACCOUNT_BLOCKED', message: 'Tài khoản không đăng nhập được' });
  api.post('/auth/guest', blocked);
  api.post('/auth/zalo-mini-app', blocked);
  api.post('/auth/refresh', blocked);
}

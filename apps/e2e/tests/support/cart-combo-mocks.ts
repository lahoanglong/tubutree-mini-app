import type { CartLine, CartSummary } from '../../../miniapp/src/services/shop-api';
import { mockPilotCart, PILOT_CART } from './pilot-mocks';
import type { MockApi } from './mock-api';

/**
 * Giỏ giả có combo (K5): hai món cùng một bộ (xen một món lẻ ở giữa để thấy giỏ gom lại), `comboGroups` do "máy chủ" trả, chân dính ghi `comboDiscount`.
 * Cùng bộ số cho Mini App và web để so hai bên. Mock có trạng thái: xoá một dòng thì giỏ trả về không còn dòng đó và bộ hết khớp (như máy chủ thật);
 * `GET /cart?itemIds=` tính lại combo theo đúng phần chọn (bộ chỉ áp khi chọn đủ mọi dòng của nó).
 */
export interface ComboCartOptions {
  title?: string;
  discount?: number;
  /** Số món của bộ (mặc định 2). */
  comboLines?: number;
  /** Số món lẻ (mặc định 1). */
  loose?: number;
  unit?: number;
  /** Tên sản phẩm của món đầu bộ (thử tên dài). */
  firstName?: string;
}

export const COMBO_TITLE = 'Bộ giặt sạch Fuwa3e';
export const COMBO_DISCOUNT = 65_250;

const line = (id: string, name: string, unit: number): CartLine => ({
  ...PILOT_CART.items[0]!,
  id,
  variationId: `${id}-v`,
  slug: `${id}-sp`,
  productName: name,
  variationName: 'Mặc định',
  unitPrice: unit,
  listUnitPrice: unit,
  total: unit,
});

export function comboCart(o: ComboCartOptions = {}): CartSummary {
  const unit = o.unit ?? 120_000;
  const combo = Array.from({ length: o.comboLines ?? 2 }, (_, i) => line(`cb-${i + 1}`, i === 0 && o.firstName ? o.firstName : `Món combo ${i + 1}`, unit));
  const loose = Array.from({ length: o.loose ?? 1 }, (_, i) => line(`lz-${i + 1}`, `Món lẻ ${i + 1}`, unit));
  const items = [combo[0]!, ...loose, ...combo.slice(1)];
  const ids = combo.map((l) => l.id);
  return priced(items, [
    { id: 'collection:fuwa3e', kind: 'STOREFRONT', title: o.title ?? COMBO_TITLE, discount: o.discount ?? COMBO_DISCOUNT, lineIds: ids, keyLineIds: ids },
  ]);
}

function priced(items: CartLine[], groups: NonNullable<CartSummary['comboGroups']>): CartSummary {
  const present = new Set(items.map((l) => l.id));
  const live = groups.filter((g) => g.lineIds.every((id) => present.has(id)));
  const subtotal = items.reduce((s, l) => s + l.total, 0);
  return {
    items,
    couponCode: null,
    subtotal,
    discount: 0,
    comboDiscount: live.reduce((s, g) => s + g.discount, 0),
    comboGroups: live,
    freeship: true,
    freeshipThreshold: 200_000,
    itemCount: items.reduce((s, l) => s + l.quantity, 0),
  };
}

/** `GET /cart`, `GET /cart?itemIds=` và `DELETE /cart/items/:id` có trạng thái; trả hàm đọc giỏ hiện tại và danh sách id đã xoá. */
export function mockComboCartRoutes(api: MockApi, o: ComboCartOptions = {}): { current: () => CartSummary; removed: string[] } {
  let cart = comboCart(o);
  const groups = cart.comboGroups ?? [];
  const removed: string[] = [];
  api.get('/cart', ({ call }) => {
    const ids = call.query.get('itemIds');
    if (!ids) return cart;
    const pick = new Set(ids.split(','));
    return priced(cart.items.filter((l) => pick.has(l.id)), groups);
  });
  api.delete('/cart/items/:id', ({ params }) => {
    removed.push(params.id!);
    cart = priced(cart.items.filter((l) => l.id !== params.id), groups);
    return cart;
  });
  return { current: () => cart, removed };
}

/** Giỏ Mini App có combo. */
export function mockComboCart(api: MockApi, o: ComboCartOptions = {}): ReturnType<typeof mockComboCartRoutes> {
  mockPilotCart(api);
  return mockComboCartRoutes(api, o);
}

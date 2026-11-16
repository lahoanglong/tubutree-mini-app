import { variationLinePreview } from '@tubutree/app-core/commerce/flash-line';
import type { FlashPriceItem } from '@tubutree/app-core/flash-price';
import { qtyPickMax } from '@tubutree/app-core/commerce/stock-text';
import type { ProductDetail } from '../api';
import { pdpUnavailableText } from '../api';
import { GUEST_CART_MAX_QTY, type GuestCartLine } from './store';

type ProductState = { status: 'loading' } | { status: 'error' } | { status: 'missing' } | { status: 'ok'; product: ProductDetail };

/**
 * Trạng thái một dòng giỏ khách: `ok` mua được (tính vào tạm tính); `soldOut` hết hàng; `gone` sản phẩm hay phân loại đã gỡ; `blocked`
 * gian hàng tạm nghỉ/ngừng bán; `loading`/`error` chưa có giá. Chỉ dòng `ok` cộng vào tạm tính và tiến độ Miễn phí giao hàng.
 */
export type GuestRowState = 'loading' | 'error' | 'ok' | 'soldOut' | 'gone' | 'blocked';

export interface GuestCartRow {
  variationId: string;
  slug: string;
  quantity: number;
  state: GuestRowState;
  productName: string | null;
  variationName: string | null;
  thumbnail: string | null;
  unitPrice: number | null;
  /** Giá gạch khi lớn hơn đơn giá đang tính; null thì không gạch. */
  compareAt: number | null;
  isFlash: boolean;
  /** Thành tiền theo luật Giờ vàng của máy chủ (vượt suất thì cả dòng giá thường); 0 khi dòng không mua được. */
  total: number;
  stock: number;
  /** Trần nút + của dòng: tồn kho (khi thấp) và 99. */
  maxQty: number;
  /** Hàng Tubu Tree giao: chỉ phần này tính tiến độ Miễn phí giao hàng khi giỏ có hàng gian hàng tự giao. */
  tubu: boolean;
  blockedText: string | null;
}

export interface GuestCartView {
  rows: GuestCartRow[];
  subtotal: number;
  tubuSubtotal: number;
  hasMerchant: boolean;
  /** Mọi dòng đã có kết quả (không còn dòng đang tải). */
  settled: boolean;
}

function emptyRow(line: GuestCartLine, state: GuestRowState): GuestCartRow {
  return {
    variationId: line.variationId,
    slug: line.slug,
    quantity: line.quantity,
    state,
    productName: null,
    variationName: null,
    thumbnail: null,
    unitPrice: null,
    compareAt: null,
    isFlash: false,
    total: 0,
    stock: 0,
    maxQty: line.quantity,
    tubu: true,
    blockedText: null,
  };
}

export function guestCartView(
  lines: readonly GuestCartLine[],
  products: ReadonlyMap<string, ProductState>,
  flash: readonly FlashPriceItem[],
): GuestCartView {
  const rows = lines.map((line): GuestCartRow => {
    const p = products.get(line.slug) ?? { status: 'loading' as const };
    if (p.status === 'loading' || p.status === 'error') return emptyRow(line, p.status);
    if (p.status === 'missing') return emptyRow(line, 'gone');
    const product = p.product;
    const v = product.variations.find((x) => x.id === line.variationId);
    if (!v) return { ...emptyRow(line, 'gone'), productName: product.name, thumbnail: product.thumbnail ?? product.images?.[0] ?? null };
    const fulfilment = product.fulfiller?.kind ?? (product.fulfilment === 'MERCHANT' ? 'MERCHANT' : 'TUBU');
    const blockedText = pdpUnavailableText(product);
    const preview = variationLinePreview(v, flash, line.quantity, 0);
    const compare = preview.pricing.compareAt;
    const state: GuestRowState = blockedText ? 'blocked' : v.stock <= 0 ? 'soldOut' : 'ok';
    return {
      variationId: line.variationId,
      slug: line.slug,
      quantity: line.quantity,
      state,
      productName: product.name,
      variationName: v.name,
      thumbnail: v.imageUrl ?? product.thumbnail ?? product.images?.[0] ?? null,
      unitPrice: preview.unitPrice,
      compareAt: compare != null && compare > preview.unitPrice ? compare : null,
      isFlash: preview.pricing.isFlash && !preview.overLimit,
      total: state === 'ok' ? preview.lineTotal : 0,
      stock: v.stock,
      maxQty: Math.min(GUEST_CART_MAX_QTY, qtyPickMax(v.stock)),
      tubu: fulfilment === 'TUBU',
      blockedText,
    };
  });
  const ok = rows.filter((r) => r.state === 'ok');
  return {
    rows,
    subtotal: ok.reduce((s, r) => s + r.total, 0),
    tubuSubtotal: ok.reduce((s, r) => s + (r.tubu ? r.total : 0), 0),
    hasMerchant: ok.some((r) => !r.tubu),
    settled: rows.every((r) => r.state !== 'loading'),
  };
}

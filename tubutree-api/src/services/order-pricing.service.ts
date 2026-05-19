/**
 * Order Pricing — Tính tổng tiền authoritative server-side.
 *
 * Fetch giá từ Pancake POS để tránh trust client.
 */
import { getPancakeProductDetail } from './pancake.service';

export interface OrderItem {
  pos_product_id: string;
  variant_id?: string | null;
  qty: number;
}

export interface PricedItem extends OrderItem {
  variation_id: string;
  retail_price: bigint;
  line_total: bigint;
}

/**
 * Fetch giá retail từ Pancake cho từng item.
 * Throw nếu không tìm thấy product/variation.
 */
export async function priceOrderItems(items: OrderItem[]): Promise<{ items: PricedItem[]; subtotal: bigint }> {
  if (!items.length) throw new Error('NO_ITEMS');

  // Dedupe product fetches
  const uniqueIds = [...new Set(items.map(i => i.pos_product_id))];
  const productMap = new Map<string, any>();
  for (const id of uniqueIds) {
    const res = await getPancakeProductDetail(id);
    const product = res?.data || res;
    if (!product || !product.variations) {
      throw new Error(`PRODUCT_NOT_FOUND: ${id}`);
    }
    productMap.set(id, product);
  }

  const priced: PricedItem[] = [];
  let subtotal = 0n;
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0 || item.qty > 1000) {
      throw new Error(`INVALID_QTY for ${item.pos_product_id}: ${item.qty}`);
    }
    const product = productMap.get(item.pos_product_id);
    const variation = item.variant_id
      ? product.variations.find((v: any) => String(v.id) === String(item.variant_id))
      : product.variations[0];
    if (!variation) throw new Error(`VARIATION_NOT_FOUND: ${item.pos_product_id}/${item.variant_id}`);

    const priceNum = Number(variation.retail_price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      throw new Error(`INVALID_PRICE for ${item.pos_product_id}: ${variation.retail_price}`);
    }
    const price = BigInt(Math.floor(priceNum));
    const lineTotal = price * BigInt(item.qty);
    priced.push({
      ...item,
      variation_id: String(variation.id),
      retail_price: price,
      line_total: lineTotal,
    });
    subtotal += lineTotal;
  }

  return { items: priced, subtotal };
}

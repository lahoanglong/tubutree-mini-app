/**
 * Ghi chú của đơn đặt định kỳ. Cron tạo đơn ghi dấu `SUBSCRIPTION_ORDER_NOTE`; kho/Pancake đọc dấu này, và app-core (cùng tên hằng) dựa vào đúng
 * chữ này để hiện nhãn "Đơn định kỳ" thay cho chữ tiếng Anh. Khi khách tự sửa ghi chú, phần của khách nối sau dấu nên dấu không bao giờ mất.
 * File không import gì: plan sửa đơn, chi tiết đơn và cron đều dùng chung.
 */
export const SUBSCRIPTION_ORDER_NOTE = 'Đơn đặt định kỳ (Subscribe & Save)';

export const SUBSCRIPTION_NOTE_SEP = ' · ';

/**
 * Phần khách viết trong ghi chú đơn định kỳ (đã trim): null khi trống hoặc chỉ có dấu; phần sau `dấu · ` khi có dấu ở đầu; nguyên ghi chú khi
 * không mở đầu bằng dấu (dữ liệu cũ hoặc lạ).
 */
export function subscriptionCustomerPart(note: string | null | undefined): string | null {
  const t = (note ?? '').trim();
  if (!t) return null;
  if (!t.startsWith(SUBSCRIPTION_ORDER_NOTE)) return t;
  const rest = t.slice(SUBSCRIPTION_ORDER_NOTE.length);
  if (!rest) return null;
  const sep = SUBSCRIPTION_NOTE_SEP.trimEnd();
  if (!rest.startsWith(sep)) return t;
  const customer = rest.slice(sep.length).trim();
  return customer ? customer : null;
}

/** Ghi chú lưu cho đơn định kỳ: đúng dấu khi khách không viết gì, `dấu · phần của khách` khi có. */
export function composeSubscriptionNote(customer: string | null | undefined): string {
  const c = (customer ?? '').trim();
  return c ? `${SUBSCRIPTION_ORDER_NOTE}${SUBSCRIPTION_NOTE_SEP}${c}` : SUBSCRIPTION_ORDER_NOTE;
}

/**
 * Ghi chú trả cho màn khách. Đơn không phải định kỳ: nguyên `note`. Đơn định kỳ: phần của khách, hoặc đúng dấu khi khách không viết gì
 * (`customerOrderNote` của app-core nhận ra dấu và không hiện như "Ghi chú").
 */
export function customerFacingNote(o: { note: string | null; source?: string | null }): string | null {
  if (o.source !== 'subscription' || !o.note) return o.note;
  return subscriptionCustomerPart(o.note) ?? SUBSCRIPTION_ORDER_NOTE;
}

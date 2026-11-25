/**
 * Khoá cờ MSS trong `system_configs` (seed createOnly + migration INSERT, mặc định TẮT). Tên theo quy ước `module.snake_case`
 * (hợp đồng order-events, Phụ lục T10). Kiểu strangler (quyết định PO số 5): cờ tắt thì Tubu đi đúng đường Pancake trực tiếp như cũ.
 *
 * File chỉ có hằng, không import service: SystemConfigService đọc MSS_CONFIG_RANGES từ đây, import ngược sẽ thành vòng.
 */
export const MSS_FLAG_KEYS = {
  catalogEnrichment: 'mss.catalog_enrichment_enabled',
  orderEvents: 'mss.order_events_enabled',
  customerSync: 'mss.customer_sync_enabled',
  orderPush: 'mss.order_push_enabled',
  orderStatus: 'mss.order_status_enabled',
  invoice: 'mss.invoice_enabled',
  catalogShadow: 'mss.catalog_shadow_enabled',
  stockSync: 'mss.stock_sync_enabled',
  /** Thêm tin giao hàng không kèm giá cho số người nhận (PO A1). Chỉ có tác dụng khi `orderEvents` đang mở. */
  orderRecipient: 'mss.order_recipient_enabled',
  /** Giỏ bỏ quên gửi MSS để nhắc một lần qua Zalo (hợp đồng cart-events v1, w36-01). Độc lập với `orderEvents`. */
  cartAbandonedZalo: 'mss.cart_abandoned_zalo_enabled',
} as const;

export type MssFlag = keyof typeof MSS_FLAG_KEYS;
export const MSS_FLAGS = Object.keys(MSS_FLAG_KEYS) as MssFlag[];

/** Phần trăm đơn (0–100) được phát sự kiện tin Zalo khi `mss.order_events_enabled` bật. */
export const MSS_ORDER_EVENTS_ROLLOUT_PCT_KEY = 'mss.order_events_rollout_pct';
/** Ô đồng ý nhận tin đơn qua Zalo có được tick sẵn ở bước đặt hàng không. Mặc định không tick. */
export const MSS_ORDER_CONSENT_PRECHECKED_KEY = 'mss.order_consent_prechecked';
/** Nguồn SKU/giá/tồn: `pancake` (hiện tại) hoặc `mss` (bật sau cùng, hợp đồng commerce mục 0.4). */
export const MSS_CATALOG_SOURCE_KEY = 'mss.catalog_source';
/**
 * Huỷ đơn chuyển khoản chưa trả khi MSS báo `payment_rescue.state = "overdue"` trên webhook `order-status` (hợp đồng W4-02).
 * Không nằm trong MSS_FLAG_KEYS: không cần năng lực nào ở `GET /health` của MSS, MSS chỉ gửi khối này khi chính nó đã bật.
 */
export const MSS_PAYMENT_RESCUE_CANCEL_KEY = 'mss.payment_rescue_cancel_enabled';

/** Luật ghi của khoá số MSS, trải vào SystemConfigService.RANGES (cùng cách WASTE_RANGES): admin không lưu được giá trị ngoài khoảng. */
export const MSS_CONFIG_RANGES: Record<string, { min: number; max: number; note: string; integer?: true }> = {
  [MSS_ORDER_EVENTS_ROLLOUT_PCT_KEY]: { min: 0, max: 100, note: 'phần trăm đơn được phát sự kiện tin Zalo (0 = không đơn nào)', integer: true },
};

export const MSS_CATALOG_SOURCES = ['pancake', 'mss'] as const;
export type MssCatalogSource = (typeof MSS_CATALOG_SOURCES)[number];

const booleanOnly = (value: unknown): string | null => (typeof value === 'boolean' ? null : 'phải là true hoặc false');

/**
 * Luật ghi của khoá MSS không phải số, trải vào SystemConfigService.JSON_RULES. Chỗ đọc chỉ coi `=== true` là bật,
 * nên chuỗi "true" admin gõ nhầm sẽ âm thầm thành tắt: chặn ngay lúc lưu.
 */
export const MSS_JSON_RULES: Record<string, (value: unknown) => string | null> = {
  ...Object.fromEntries(Object.values(MSS_FLAG_KEYS).map((k) => [k, booleanOnly])),
  [MSS_ORDER_CONSENT_PRECHECKED_KEY]: booleanOnly,
  [MSS_PAYMENT_RESCUE_CANCEL_KEY]: booleanOnly,
  [MSS_CATALOG_SOURCE_KEY]: (value) =>
    (MSS_CATALOG_SOURCES as readonly unknown[]).includes(value) ? null : `phải là một trong: ${MSS_CATALOG_SOURCES.join(', ')}`,
};

/**
 * Tên năng lực MSS công bố ở `GET /health` (hợp đồng commerce mục 5) cho từng cờ. Cờ bật mà MSS chưa công bố năng lực tương ứng
 * thì Tubu coi như tắt (MssHealthService.assertCapability).
 */
export const MSS_FLAG_CAPABILITY: Record<MssFlag, string> = {
  catalogEnrichment: 'catalog.enrichment',
  orderEvents: 'order_events',
  customerSync: 'customers',
  orderPush: 'orders',
  orderStatus: 'orders',
  invoice: 'invoice',
  catalogShadow: 'catalog.source',
  // MSS chỉ công bố `catalog.source` khi đã bật gương Pancake (có SKU, giá, tồn): không có gương thì không có số tồn để đẩy.
  stockSync: 'catalog.source',
  // MSS cũ trả 422 `unexpected_field` cho `recipient.role`: chỉ ghi dòng người nhận khi MSS đã công bố năng lực này.
  orderRecipient: 'order_events.recipient_role',
  // MSS chỉ công bố khi cả công tắc kênh Tubu và công tắc nhắc giỏ (CART_ABANDONED_ZALO_ENABLED) của nó cùng bật.
  cartAbandonedZalo: 'cart.abandoned_zalo',
};

export function clampRolloutPct(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.floor(n)));
}

export function parseCatalogSource(v: unknown): MssCatalogSource {
  return (MSS_CATALOG_SOURCES as readonly unknown[]).includes(v) ? (v as MssCatalogSource) : 'pancake';
}

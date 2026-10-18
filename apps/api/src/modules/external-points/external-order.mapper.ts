import { parseTypedVnPhone } from '../../common/phone';
import { foldVietnamese } from '../catalog/search-text';
import { pancakeEventOrderCode } from '../integrations/pancake/pancake-webhook-dedupe';
import type { OrderSourceMap } from './external-order.config';

/**
 * Hàm thuần nhận biết và đọc đơn Pancake ngoài app. Tên field theo Pancake POS Open API; chưa có payload webhook thật
 * để đối chiếu (xem docs/launch/deploy-rollback-runbook.md, "Bắt payload thật"), nên mọi hàm đọc lỏng và trả null thay vì ném.
 */

type Data = Record<string, unknown>;

export type ExternalOrderKind = 'APP' | 'MARKETPLACE' | 'CHAT' | 'UNKNOWN';
export type ExternalOrderStatusName = 'OPEN' | 'DELIVERED' | 'RETURNING' | 'RETURNED' | 'CANCELLED' | 'PARTIAL_RETURN' | 'DELETED';

export interface OrderClass {
  kind: ExternalOrderKind;
  /** Tên sàn (shopee, lazada, tiktok…) khi biết; luôn null với đơn không phải sàn. */
  channel: string | null;
}

/** Mã đơn Tubu ở custom_id: TUBU/TUBUSUB/DLR + số (cùng tiền tố với common/order-code). */
const TUBU_CUSTOM_ID = /^(TUBU|TUBUSUB|DLR)\d+$/;
const APP_TAGS: ReadonlySet<string> = new Set(['MINIAPP', 'WEB']);

const asRecord = (v: unknown): Data | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : null);

/** Số hữu hạn từ số hoặc chuỗi số (id sàn có thể âm); còn lại null. */
function finiteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? n : null;
}

const part = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Khoá nguồn đơn: `order_sources|account|marketplace_id`. Bảng "nguồn đã thấy" của admin và `chatSources` dùng đúng khoá này. */
export function sourceKeyOf(data: Data): string {
  return `${part(data['order_sources'])}|${part(data['account'])}|${part(data['marketplace_id'])}`;
}

function tagNames(data: Data): string[] {
  const raw = data['tags'];
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return items
    .map((t) => (typeof t === 'string' ? t : (asRecord(t)?.['name'] ?? '')))
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().toUpperCase());
}

function isAppOrder(data: Data): boolean {
  if (pancakeEventOrderCode(data) !== null) return true;
  const customId = data['custom_id'];
  if (typeof customId === 'string' && TUBU_CUSTOM_ID.test(customId.trim())) return true;
  return tagNames(data).some((t) => APP_TAGS.has(t));
}

/**
 * APP (đơn đặt trong app, không bao giờ là đơn ngoài) | MARKETPLACE | CHAT | UNKNOWN. Đơn app thắng mọi dấu hiệu khác:
 * một đơn Tubu mà nhân viên gắn nhầm nguồn sàn vẫn là đơn app.
 */
export function classifyPancakeOrder(data: Data, map: OrderSourceMap): OrderClass {
  if (isAppOrder(data)) return { kind: 'APP', channel: null };
  const marketplaceId = finiteNumber(data['marketplace_id']);
  const channel = marketplaceId === null ? undefined : map.marketplaceIds[String(marketplaceId)];
  if (channel !== undefined) return { kind: 'MARKETPLACE', channel };
  if (data['is_from_ecommerce'] === true) return { kind: 'MARKETPLACE', channel: null };
  if (map.chatSources.includes(sourceKeyOf(data))) return { kind: 'CHAT', channel: null };
  return { kind: 'UNKNOWN', channel: null };
}

/** Chữ hoa, bỏ khoảng trắng, gạch ngang và gạch dưới; chỉ nhận A-Z0-9 dài 8–30, còn lại null. */
export function normalizeTrackingCode(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : null;
  if (text === null) return null;
  const code = text.toUpperCase().replace(/[\s_-]+/g, '');
  return /^[A-Z0-9]{8,30}$/.test(code) ? code : null;
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Mã vận đơn và mã đơn sàn đã chuẩn hoá, không trùng, theo thứ tự ưu tiên (phần tử đầu là mã chính). */
export function extractTrackingCodes(data: Data): string[] {
  const partner = asRecord(data['partner']);
  const raw: unknown[] = [
    partner?.['extend_code'],
    ...asArray(partner?.['extend_update']).map((u) => asRecord(u)?.['tracking_id']),
    data['order_number_vtp'],
    ...asArray(data['invoice_info_list']).map((i) => asRecord(i)?.['order_sn']),
    data['tracking_number'],
  ];
  const codes: string[] = [];
  for (const r of raw) {
    const code = normalizeTrackingCode(r);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Mã đơn trên sàn (invoice_info_list[].order_sn) đã chuẩn hoá; null khi không có. */
export function marketplaceOrderSn(data: Data): string | null {
  for (const i of asArray(data['invoice_info_list'])) {
    const sn = normalizeTrackingCode(asRecord(i)?.['order_sn']);
    if (sn) return sn;
  }
  return null;
}

const GOODS_TOLERANCE = 0.01;
/** Cột Int của Postgres: số lớn hơn làm Prisma ném và sự kiện FAILED mãi. */
const INT4_MAX = 2_147_483_647;

/**
 * Tiền hàng khách trả, không cộng ship: Σ số lượng × (giá lẻ − giảm mỗi món) − total_discount. Đối chiếu với
 * `total_price − total_discount`; thiếu số hoặc lệch quá 1% thì null (đơn vào REVIEW thay vì cộng theo số đoán).
 */
export function goodsValue(data: Data): number | null {
  const items = asArray(data['items']);
  if (items.length === 0) return null;
  let lines = 0;
  for (const item of items) {
    const rec = asRecord(item);
    const qty = finiteNumber(rec?.['quantity']);
    const retail = finiteNumber(asRecord(rec?.['variation_info'])?.['retail_price']);
    if (qty === null || !Number.isInteger(qty) || qty <= 0 || retail === null || retail < 0) return null;
    const each = finiteNumber(rec?.['discount_each_product']) ?? 0;
    if (each < 0 || each > retail) return null;
    lines += qty * (retail - each);
  }
  const discount = finiteNumber(data['total_discount']) ?? 0;
  const totalPrice = finiteNumber(data['total_price']);
  if (totalPrice === null || discount < 0) return null;
  const value = Math.round(lines - discount);
  const reference = totalPrice - discount;
  if (value <= 0 || reference <= 0) return null;
  if (value > INT4_MAX) return null;
  return Math.abs(value - reference) / reference <= GOODS_TOLERANCE ? value : null;
}

/**
 * Mốc Pancake. Chuỗi không mang múi giờ là giờ Việt Nam (+07:00, cần kiểm bằng payload thật); chỉ so với mốc cũng đọc bằng
 * hàm này (Pancake với Pancake), không bao giờ so với đồng hồ máy chủ.
 */
export function pancakeTime(v: unknown): Date | null {
  let d: Date;
  if (typeof v === 'string') {
    const s = v.trim().replace(' ', 'T');
    if (!s) return null;
    d = new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}+07:00`);
  } else if (typeof v === 'number' && Number.isFinite(v)) {
    d = new Date(v > 1e11 ? v : v * 1000);
  } else {
    return null;
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

const DELIVERED_STATUSES: readonly number[] = [3, 16];

/** Mốc sớm nhất trong status_history có status 3 (đã nhận) hoặc 16 (đã thu tiền); null khi lịch sử không có. */
export function deliveredAt(data: Data): Date | null {
  let earliest: Date | null = null;
  for (const h of asArray(data['status_history'])) {
    const rec = asRecord(h);
    const status = finiteNumber(rec?.['status']);
    if (status === null || !DELIVERED_STATUSES.includes(status)) continue;
    const at = pancakeTime(rec?.['updated_at']);
    if (at && (!earliest || at < earliest)) earliest = at;
  }
  return earliest;
}

/** SĐT người mua dạng 0xxxxxxxxx; sàn che số (có dấu *) hoặc không đọc được thì null. */
export function buyerPhone(data: Data): string | null {
  const candidates = [data['bill_phone_number'], asRecord(data['shipping_address'])?.['phone_number']];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const phone = parseTypedVnPhone(c);
    if (phone) return phone;
  }
  return null;
}

export interface PancakeCreatorRef {
  id: string | null;
  /** Tên đã bỏ dấu, hạ thường (so khớp với tên nhân viên Tubu). */
  name: string | null;
}

const CREATOR_FIELDS = ['creator', 'assigning_seller', 'assigning_care'] as const;

/**
 * Người tạo đơn và người phụ trách trên Pancake (id và tên nhân viên, không SĐT hay email). Dùng để chặn người đó tự duyệt điểm cho đơn
 * mình tạo. Tên field theo Open API, chưa kiểm bằng payload thật: thiếu thì trả mảng rỗng (không có gì để so).
 */
export function pancakeCreatorRefs(data: Data): PancakeCreatorRef[] {
  const refs: PancakeCreatorRef[] = [];
  for (const field of CREATOR_FIELDS) {
    const rec = asRecord(data[field]);
    if (!rec) continue;
    const rawId = rec['id'];
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null;
    const name = typeof rec['name'] === 'string' && rec['name'].trim() ? foldVietnamese(rec['name']) : null;
    if (id || name) refs.push({ id, name });
  }
  return refs;
}

/** Id nhân viên TẠO đơn (`creator.id`, không lấy người phụ trách): khoá để áp trần điểm tự cộng theo người tạo. null khi payload không có. */
export function pancakeCreatorId(data: Data): string | null {
  const raw = asRecord(data['creator'])?.['id'];
  const id = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
  return id !== '' && id.length <= 100 ? id : null;
}

const STATUS_BY_CODE: Record<number, ExternalOrderStatusName> = {
  3: 'DELIVERED',
  16: 'DELIVERED',
  4: 'RETURNING',
  5: 'RETURNED',
  6: 'CANCELLED',
  7: 'DELETED',
  15: 'PARTIAL_RETURN',
};

/** Mã trạng thái Pancake → trạng thái đơn ngoài. Mã chưa chốt (mới, đã gửi hàng, chờ in…) là OPEN. */
export function externalStatusOf(data: Data): { pancakeStatus: number | null; status: ExternalOrderStatusName } {
  const code = finiteNumber(data['status']);
  const pancakeStatus = code !== null && Number.isInteger(code) && code >= 0 && code <= INT4_MAX ? code : null;
  return { pancakeStatus, status: (pancakeStatus !== null ? STATUS_BY_CODE[pancakeStatus] : undefined) ?? 'OPEN' };
}

/**
 * Bản payload lưu ở `external_orders.lastPayload`: chỉ các field phục vụ phân loại, tính tiền, trạng thái và mã vận đơn. Không giữ
 * tên khách, SĐT, địa chỉ, ghi chú tự do — bảng này không nằm dưới hạn xoá của pancake_webhook_events nên không được giữ PII vô hạn.
 */
export function payloadForStorage(data: Data): Data {
  const pick = (src: Data | null, keys: readonly string[]): Data => {
    const out: Data = {};
    for (const k of keys) if (src && src[k] !== undefined) out[k] = src[k];
    return out;
  };
  const partner = asRecord(data['partner']);
  const out = pick(data, [
    'id', 'order_id', 'status', 'status_name', 'marketplace_id', 'is_from_ecommerce', 'order_sources', 'account', 'custom_id',
    'tags', 'total_price', 'total_discount', 'total_price_after_sub_discount', 'shipping_fee', 'order_number_vtp',
    'tracking_number', 'inserted_at', 'updated_at',
  ]);
  if (Array.isArray(out['tags'])) out['tags'] = (out['tags'] as unknown[]).map((t) => (typeof t === 'string' ? t : pick(asRecord(t), ['name'])));
  if (data['items'] !== undefined) {
    out['items'] = asArray(data['items']).map((i) => {
      const rec = asRecord(i);
      return { ...pick(rec, ['quantity', 'discount_each_product']), variation_info: pick(asRecord(rec?.['variation_info']), ['retail_price']) };
    });
  }
  if (partner) {
    out['partner'] = {
      ...pick(partner, ['extend_code']),
      extend_update: asArray(partner['extend_update']).map((u) => pick(asRecord(u), ['tracking_id'])),
    };
  }
  // Chỉ id và tên NHÂN VIÊN tạo đơn (không phải khách) để chặn tự duyệt điểm đơn chat; không giữ SĐT hay email của họ.
  for (const field of CREATOR_FIELDS) {
    const rec = asRecord(data[field]);
    if (rec) out[field] = pick(rec, ['id', 'name']);
  }
  if (data['invoice_info_list'] !== undefined) out['invoice_info_list'] = asArray(data['invoice_info_list']).map((i) => pick(asRecord(i), ['order_sn']));
  if (data['status_history'] !== undefined) out['status_history'] = asArray(data['status_history']).map((h) => pick(asRecord(h), ['status', 'updated_at']));
  return out;
}

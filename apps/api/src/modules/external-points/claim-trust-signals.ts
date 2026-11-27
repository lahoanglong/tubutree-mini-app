import { createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AdminRecipientNameMatch } from '@tubutree/shared-types';
import { phoneHmacSecret } from '../../common/crypto/phone-hmac';
import { foldVietnamese } from '../catalog/search-text';

type Data = Record<string, unknown>;

/**
 * "Đơn app đã nhận" của thành viên: đơn bán lẻ chính thành viên đặt, đã giao. Không đếm đơn đại lý (DEALER) và đơn CTV đặt hộ khách cuối
 * (`placedForCustomer`): người nhận các đơn đó không phải thành viên, nên chúng không chứng minh SĐT hay người nhận là của thành viên.
 */
export const DIRECT_APP_DELIVERED_WHERE = { status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false } satisfies Prisma.OrderWhereInput;

const CLOSED_ORDER_STATUSES = ['CANCELLED', 'RETURNED', 'DELETED'] as const;

/**
 * Claim đơn sàn đã cộng và vẫn đứng được: đơn chưa huỷ, hoàn hay xoá và không vướng cờ hoàn một phần. Claim lẽ ra phải đảo điểm
 * (`closedCreditedWhere`, `partialRefundWhere`) không làm thành viên thành khách quen.
 */
export const STANDING_CREDITED_SCAN_WHERE = {
  kind: 'SCAN',
  state: 'CREDITED',
  reviewReason: null,
  externalOrder: { status: { notIn: [...CLOSED_ORDER_STATUSES] } },
} satisfies Prisma.ExternalPointsClaimWhereInput;

/** Cùng điều kiện `STANDING_CREDITED_SCAN_WHERE`, xét trên một claim đã nạp. */
export const isStandingCreditedScan = (c: { kind: string; state: string; reviewReason: string | null; orderStatus: string }): boolean =>
  c.kind === 'SCAN' && c.state === 'CREDITED' && c.reviewReason === null && !(CLOSED_ORDER_STATUSES as readonly string[]).includes(c.orderStatus);

/**
 * Khoá trong `external_orders.lastPayload` giữ dấu vân tay tên người nhận (W45): chỉ mã băm HMAC của từng chữ trong tên đã bỏ dấu, không
 * giữ tên. Người kiểm claim đơn sàn thiếu SĐT (Lazada che `***`) so được tên người nhận với tên thành viên mà bảng đơn không giữ tên khách.
 * Đơn nạp trước W45 không có khoá này (kết luận NO_DATA) tới khi webhook hay lượt kéo dự phòng ghi lại đơn.
 */
export const RECIPIENT_PAYLOAD_KEY = 'tubu_recipient';

/** Ký tự sàn dùng để che tên (`N***n`, `Ng•••`). */
const MASK_CHARS = /[*•●]/;
/** 12 ký tự hex (48 bit) mỗi chữ: đủ để so một tập vài chữ mà không trùng nhầm, payload nhỏ. */
const TOKEN_HASH_LEN = 12;
const MAX_TOKENS = 8;

/**
 * Họ phổ biến và chữ lót "Thị", "Văn": trùng một trong các chữ này không nói lên hai tên là một người (khoảng 4 trên 10 người Việt họ
 * Nguyễn), nên không đủ cho kết luận "gần khớp".
 */
const COMMON_TOKENS: ReadonlySet<string> = new Set([
  'nguyen', 'tran', 'le', 'pham', 'hoang', 'huynh', 'phan', 'vu', 'vo', 'dang', 'bui', 'do', 'ho', 'ngo', 'duong', 'ly', 'thi', 'van',
]);

interface NameTokens {
  tokens: string[];
  /** Tên bị sàn che một phần: các chữ bị che đã bỏ, phần còn lại không đủ để kết luận "khớp". */
  masked: boolean;
}

/** Tên → các chữ đã bỏ dấu, viết thường, chỉ chữ và số, không trùng. Chữ bị che bỏ đi. Không còn chữ nào thì null. */
export function nameTokens(name: unknown): NameTokens | null {
  if (typeof name !== 'string') return null;
  const words = name.trim().split(/\s+/).filter(Boolean);
  let masked = false;
  const tokens: string[] = [];
  for (const w of words) {
    if (MASK_CHARS.test(w)) {
      masked = true;
      continue;
    }
    for (const t of foldVietnamese(w).split(/[^a-z0-9]+/)) if (t && !tokens.includes(t)) tokens.push(t);
  }
  return tokens.length > 0 ? { tokens: tokens.slice(0, MAX_TOKENS), masked } : null;
}

function tokenHasher(secret: string): (token: string) => string {
  // Khoá riêng suy từ bí mật của mã băm SĐT: mã băm tên không dùng lại được để dò SĐT và ngược lại.
  const key = createHmac('sha256', secret).update('recipient-name-hmac|v1').digest();
  return (token) => createHmac('sha256', key).update(token).digest('hex').slice(0, TOKEN_HASH_LEN);
}

/** Tên người nhận trên payload Pancake: tên giao hàng trước, tên hoá đơn sau. Không lấy `customer.name` (hồ sơ người mua, có thể là tên Zalo). */
function recipientNameOf(data: Data): unknown {
  const ship = data['shipping_address'];
  const shipName = ship !== null && typeof ship === 'object' && !Array.isArray(ship) ? (ship as Data)['full_name'] : undefined;
  return typeof shipName === 'string' && shipName.trim() ? shipName : data['bill_full_name'];
}

/** Dấu vân tay tên người nhận để lưu cùng payload: mã băm từng chữ (đã sắp xếp), `m: 1` khi sàn che một phần tên. null khi không có tên. */
export function recipientFingerprint(data: Data, secret: string = phoneHmacSecret()): { t: string[]; m?: 1 } | null {
  const parsed = nameTokens(recipientNameOf(data));
  if (!parsed) return null;
  const hash = tokenHasher(secret);
  const t = [...new Set(parsed.tokens.map(hash))].sort();
  return parsed.masked ? { t, m: 1 } : { t };
}

/**
 * So tên người nhận (dấu vân tay đã lưu) với tên thành viên. MATCH: cùng một tập chữ, tên không bị che. PARTIAL: trùng ít nhất một chữ
 * không phải họ phổ biến hay chữ lót (tên Zalo hay viết ngược "Hoa Nguyễn", hay chỉ có tên gọi). MISMATCH: tên đầy đủ, không trùng chữ
 * riêng nào. NO_DATA: đơn không có tên, thành viên không có tên, hoặc tên bị che mà phần còn thấy không có chữ riêng trùng.
 * Chỉ là tín hiệu cho người kiểm: tên Zalo nhiều khi là biệt danh.
 */
export function recipientNameMatch(stored: unknown, memberName: string | null | undefined, secret: string = phoneHmacSecret()): AdminRecipientNameMatch {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return 'NO_DATA';
  const rec = stored as { t?: unknown; m?: unknown };
  const orderHashes = Array.isArray(rec.t) ? new Set(rec.t.filter((h): h is string => typeof h === 'string')) : new Set<string>();
  const member = nameTokens(memberName);
  if (orderHashes.size === 0 || !member || member.masked) return 'NO_DATA';
  const hash = tokenHasher(secret);
  const shared = member.tokens.filter((tok) => orderHashes.has(hash(tok)));
  const masked = rec.m === 1;
  if (!masked && shared.length === member.tokens.length && shared.length === orderHashes.size) return 'MATCH';
  if (shared.some((tok) => !COMMON_TOKENS.has(tok))) return 'PARTIAL';
  return masked ? 'NO_DATA' : 'MISMATCH';
}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const vnd = (n: number): string => `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
const SUMMARY_LINES = 3;

/**
 * Tóm tắt giỏ hàng của đơn sàn từ `lastPayload.items` (bản lưu chỉ còn số lượng và giá, không có tên món): "3 sản phẩm, 2 dòng: 2 × 150.000đ,
 * 1 × 89.000đ". Người kiểm đối chiếu được với đơn trên Pancake hay lời khách mà màn admin không hiện tên món. Dòng thiếu số thì null.
 */
export function itemSummary(items: unknown): string | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const lines: { qty: number; each: number }[] = [];
  for (const item of items) {
    const rec = item !== null && typeof item === 'object' ? (item as Data) : null;
    const info = rec?.['variation_info'];
    const qty = finite(rec?.['quantity']);
    const retail = finite(info !== null && typeof info === 'object' ? (info as Data)['retail_price'] : null);
    if (qty === null || !Number.isInteger(qty) || qty <= 0 || retail === null || retail < 0) return null;
    const discount = finite(rec?.['discount_each_product']) ?? 0;
    lines.push({ qty, each: Math.max(0, retail - Math.max(0, discount)) });
  }
  const total = lines.reduce((s, l) => s + l.qty, 0);
  const shown = lines.slice(0, SUMMARY_LINES).map((l) => `${l.qty} × ${vnd(l.each)}`);
  if (lines.length > SUMMARY_LINES) shown.push(`+${lines.length - SUMMARY_LINES} dòng`);
  return `${total} sản phẩm${lines.length > 1 ? `, ${lines.length} dòng` : ''}: ${shown.join(', ')}`;
}

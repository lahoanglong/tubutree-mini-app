import { parseTypedVnPhone } from '../../common/phone';

/**
 * SĐT người mua trên đơn sàn để đối chiếu với SĐT Zalo của khách gửi mã (W42). Sàn thường che số (`098*****26`, `******26`,
 * `+84******26`, `09*****126`); `buyerPhone()` chỉ nhận số đầy đủ nên trước W42 mọi đơn che số mất SĐT và luật đối chiếu bị bỏ qua.
 *
 * - FULL: số đầy đủ 0xxxxxxxxx, so bằng tuyệt đối.
 * - MASK: các chữ số nhìn thấy. `lead` là cụm số trước dấu `*` đầu, `tail` là cụm số sau dấu `*` cuối. `positional` chỉ có khi
 *   chuỗi sau chuẩn hoá dài đúng 10 ký tự và bắt đầu bằng 0 (biết chính xác vị trí từng số, gồm cả số nằm giữa hai cụm `*`).
 * - NONE: không có gì đủ tin để so (rỗng, che hết, đuôi < 2 số, ký tự lạ, nhiều số hơn một SĐT).
 */
export type OrderPhonePattern =
  | { kind: 'FULL'; phone: string }
  | { kind: 'MASK'; lead: string; tail: string; positional: string | null; mask: string }
  | { kind: 'NONE' };

export type OrderPhoneMatch = 'MATCH' | 'MISMATCH' | 'NO_DATA';

const VN_PHONE_LENGTH = 10;
/** Ít nhất 2 số cuối nhìn thấy mới so: 1 số cuối trùng ngẫu nhiên 1/10, không đủ để từ chối hay cho qua. */
const MIN_TAIL_DIGITS = 2;
/** Ký tự sàn dùng để che: `x`/`X`/`•`/`●` coi như `*`. */
const MASK_CHARS = /[xX•●]/g;

export function parseOrderPhoneForMatch(raw: unknown): OrderPhonePattern {
  if (typeof raw !== 'string') return { kind: 'NONE' };
  const compact = raw.replace(/[\s.\-()]/g, '').replace(MASK_CHARS, '*');
  if (!compact || !/^[0-9*+]+$/.test(compact)) return { kind: 'NONE' };
  if (!compact.includes('*')) {
    const phone = parseTypedVnPhone(compact);
    return phone ? { kind: 'FULL', phone } : { kind: 'NONE' };
  }
  // `+` chỉ hợp lệ ở đầu và chỉ cho +84. Chuẩn hoá tiền tố quốc gia về 0 để vị trí các số khớp dạng 0xxxxxxxxx.
  if (compact.lastIndexOf('+') > 0) return { kind: 'NONE' };
  let body = compact.startsWith('+') ? compact.slice(1) : compact;
  // `0084` (quay số quốc tế) luôn là mã nước: `0084*****789` thành `0*****789`. Không đổi thì cụm đầu `0084` được tin như đầu số và khách
  // số 09…789 bị chấm lệch.
  if (!compact.startsWith('+') && body.startsWith('0084')) body = `0${body.slice(4)}`;
  else {
    // `84` không có `+` chỉ là mã nước khi chuỗi dài đúng 84 + 9 ký tự; ngắn hơn có thể là số nội địa mất số 0 đầu (`843****26` của
    // 0843xxxx26). Khi đó cụm đầu không bắt đầu bằng 0 nên bên dưới chỉ tin đuôi.
    const countryCode = compact.startsWith('+') || body.length === VN_PHONE_LENGTH + 1;
    if (body.startsWith('84') && countryCode) body = `0${body.slice(2)}`;
    else if (compact.startsWith('+')) return { kind: 'NONE' };
  }
  const first = body.indexOf('*');
  const last = body.lastIndexOf('*');
  let lead = body.slice(0, first);
  const tail = body.slice(last + 1);
  // Cụm đầu không bắt đầu bằng 0 (sàn cắt mất phần đầu) thì không biết nó nằm ở vị trí nào: chỉ tin đuôi.
  const leadTrusted = lead === '' || lead.startsWith('0');
  if (!leadTrusted) lead = '';
  if (tail.length < MIN_TAIL_DIGITS || lead.length + tail.length > VN_PHONE_LENGTH) return { kind: 'NONE' };
  const positional = leadTrusted && body.length === VN_PHONE_LENGTH && body.startsWith('0') ? body : null;
  return { kind: 'MASK', lead, tail, positional, mask: positional ?? `${lead}*${tail}` };
}

/**
 * So SĐT Zalo của khách (dạng 0xxxxxxxxx) với SĐT trên đơn. MISMATCH chỉ khi có số nhìn thấy khác; thiếu dữ liệu ở một phía là NO_DATA
 * (luật đưa claim vào REVIEW thay vì từ chối). Không bao giờ trả lại chữ số của đơn.
 */
export function phoneMatchesOrderMask(userPhone: string | null | undefined, p: OrderPhonePattern): OrderPhoneMatch {
  if (p.kind === 'NONE') return 'NO_DATA';
  const user = typeof userPhone === 'string' ? parseTypedVnPhone(userPhone) : null;
  if (!user) return 'NO_DATA';
  if (p.kind === 'FULL') return p.phone === user ? 'MATCH' : 'MISMATCH';
  if (p.positional) {
    for (let i = 0; i < VN_PHONE_LENGTH; i++) {
      const c = p.positional[i]!;
      if (c !== '*' && c !== user[i]) return 'MISMATCH';
    }
    return 'MATCH';
  }
  if (p.lead && !user.startsWith(p.lead)) return 'MISMATCH';
  if (!user.endsWith(p.tail)) return 'MISMATCH';
  return 'MATCH';
}

/** Số chữ số nhìn thấy (để chọn mẫu tốt nhất khi đơn có nhiều nguồn SĐT). FULL luôn thắng MASK. */
export function visibleDigits(p: OrderPhonePattern): number {
  if (p.kind === 'FULL') return VN_PHONE_LENGTH + 1;
  if (p.kind === 'NONE') return 0;
  return p.positional ? p.positional.replace(/\*/g, '').length : p.lead.length + p.tail.length;
}

/**
 * Đối chiếu SĐT khách với dữ liệu đã lưu của đơn ngoài: số đầy đủ (`phone`) nếu có, không thì mẫu che (`phoneMask`). Số đầy đủ nằm trong
 * `phoneMask` chỉ đến từ hồ sơ khách trên Pancake (ingest, khi đơn che hết SĐT), không phải SĐT của chính đơn: khớp thì MATCH, lệch thì chưa
 * đủ để từ chối (hồ sơ có thể là số của người nhà) nên coi như không có dữ liệu, claim vào REVIEW như trước.
 */
/** Số chữ số nhìn thấy của SĐT đơn mà `orderPhoneMatch` dùng để so (11 = số đầy đủ): cho CSKH biết MATCH mạnh tới đâu (W45). */
export function orderPhoneVisibleDigits(order: { phone: string | null; phoneMask?: string | null }): number {
  return visibleDigits(parseOrderPhoneForMatch(order.phone !== null ? order.phone : (order.phoneMask ?? null)));
}

export function orderPhoneMatch(userPhone: string | null | undefined, order: { phone: string | null; phoneMask?: string | null }): OrderPhoneMatch {
  if (order.phone !== null) return phoneMatchesOrderMask(userPhone, parseOrderPhoneForMatch(order.phone));
  const stored = parseOrderPhoneForMatch(order.phoneMask ?? null);
  const match = phoneMatchesOrderMask(userPhone, stored);
  return stored.kind === 'FULL' && match === 'MISMATCH' ? 'NO_DATA' : match;
}

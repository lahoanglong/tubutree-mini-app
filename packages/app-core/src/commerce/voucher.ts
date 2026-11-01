import type { CouponDTO } from '../api/loyalty';
import { fillCopy } from '../shop-copy';
import { vnd, vndShort } from './money';

const DAY_MS = 86_400_000;
// Việt Nam là UTC+7 quanh năm: cộng cố định 7 giờ rồi đọc bằng getUTC*, nên ngày hiện ra giống nhau dù máy khách đặt múi giờ nào.
const VN_OFFSET_MS = 7 * 3_600_000;
const EXPIRING_DAYS = 3;
const QUOTA_SHOWN_MAX = 10;

export interface VoucherView {
  id: string;
  code: string;
  title: string;
  kind: 'discount' | 'freeship' | 'shop';
  /** "Đơn từ 199k"; rỗng khi không có đơn tối thiểu. */
  condition: string;
  expiry: string;
  /** Tên admin đặt cho mã (đã trim, bỏ phần đầu chép lại nhãn: "Giảm 20k cho 3 đơn" thành "cho 3 đơn"); null khi chưa đặt hoặc chỉ chép lại nhãn. */
  name: string | null;
  /** "Còn 3 lượt": chỉ mã chưa nhận còn 1 đến 10 lượt, để khách thấy gấp mà không lộ số lớn. */
  quota: string | null;
  state: 'collectable' | 'saved' | 'used' | 'expired' | 'soldout' | 'ineligible';
}

/** Ngữ cảnh mà `CouponDTO` không mang; thiếu hết thì là mã đang nằm trong ví. */
export interface VoucherFlags {
  claimed?: boolean;
  used?: boolean;
  soldOut?: boolean;
  ineligible?: boolean;
  /** Số lượt nhận còn lại của mã trong kho; null/thiếu = không giới hạn. */
  remaining?: number | null;
  /** Mã của gian hàng: chỉ gọi nơi có nguồn chắc chắn. `CouponDTO.products` là mã mua chung nên không dùng để suy ra. */
  shop?: boolean;
}

/** Nhãn ngắn của mã giảm giá, một bản cho Mini App và web (gộp bốn bản cũ, giữ nguyên chữ). */
export function couponLabel(c: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount'>): string {
  if (c.type === 'FREESHIP') return fillCopy('coupon.freeship');
  if (c.type === 'PERCENT') {
    return c.maxDiscount ? fillCopy('coupon.percentMax', { pct: c.value, max: vnd(c.maxDiscount) }) : fillCopy('coupon.percent', { pct: c.value });
  }
  return fillCopy('coupon.amount', { amount: vnd(c.value) });
}

/**
 * Nhãn trên thẻ phiếu: cùng ý với `couponLabel` nhưng số rút gọn một kiểu ("50k", "1,5tr") để phiếu không trộn "99.000đ" với "99k", và đủ ngắn để nằm một dòng ở 375px.
 * Số đầy đủ chỉ ở tấm chi tiết (ux-copy `coupon.detailLines`). Mọi nơi vẽ phiếu qua `voucherView` (Ưu đãi, trang Mã giảm giá, chiến dịch, tấm ưu đãi ở trang chi tiết sản phẩm)
 * ghi dạng rút gọn này; chỉ thẻ mã cũ `coupon-card` (ví) và giỏ còn dùng `couponLabel` đầy đủ.
 */
export function couponTitle(c: Pick<CouponDTO, 'type' | 'value' | 'maxDiscount'>): string {
  if (c.type === 'FREESHIP') return fillCopy('coupon.freeship');
  if (c.type === 'PERCENT') {
    return c.maxDiscount ? fillCopy('coupon.titlePercentMax', { pct: c.value, max: vndShort(c.maxDiscount) }) : fillCopy('coupon.percent', { pct: c.value });
  }
  return fillCopy('coupon.amount', { amount: vndShort(c.value) });
}

const fold = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();

// Đơn vị chỉ tính khi không dính chữ cái liền sau ("10 trở lên" không phải "10tr"). Tiền viết bằng chữ ("đồng", "VND", "vnđ") cũng là đơn vị đồng:
// nếu không, "20.000 đồng" bị đọc là số trần và "đồng" ở lại sau số đã rút gọn ("20k đồng"). Đơn vị đôi ("20k vnđ", "1,5tr đồng") là MỘT đơn vị:
// chữ tiền tệ sau k/tr thuộc về con số, không ở lại làm đầu phần đuôi. "đồng" đứng đầu một từ ghép ("đồng hành", "đồng loạt", "đồng giá", "đồng ý"...)
// là chữ thường, không phải tiền: danh sách dưới đây (có dấu và không dấu) thêm khi gặp từ ghép mới.
const DONG_COMPOUNDS = ['hành', 'thời', 'loạt', 'giá', 'ý', 'đều', 'bộ', 'nghiệp', 'hồ', 'phục', 'đội', 'minh', 'bằng', 'cảm', 'lòng', 'tâm', 'thuận', 'nhất', 'dạng', 'chí', 'hương', 'bào', 'hạng', 'tình', 'góp', 'khởi', 'ca'];
const DONG_COMPOUND_SRC = [...new Set([...DONG_COMPOUNDS, ...DONG_COMPOUNDS.map(fold)])].join('|');
const CURRENCY = String.raw`(?:(?:đồng|dong)(?!\p{L})(?!\s+(?:${DONG_COMPOUND_SRC})(?!\p{L}))|(?:vn[đd]|đ)(?!\p{L})|₫)`;
const FIGURE_SRC = String.raw`(\d[\d.,]*)(\s*)(%|(?:tr|k)(?!\p{L})(?:\s*${CURRENCY})?|${CURRENCY})?`;
const FIGURE_RE = new RegExp(FIGURE_SRC, 'giu');
// Mỗi mục là một con số (cả cụm đơn vị) hoặc một từ dính liền: cùng cách chia với FIGURE_RE nên cụm "20k vnđ" không bị tách ở khoảng trắng.
const TOKEN_RE = new RegExp(`${FIGURE_SRC}|\\S+`, 'giu');

/** Một số trong chữ tự do về cùng đơn vị (đồng, hoặc số âm cho phần trăm); số trần không đơn vị dưới 1.000 ("Tặng 5 lần") không phải tiền nên null. */
function figureValue(rawText: string, unitText: string | undefined): number | null {
  const raw = rawText.replace(/[.,]+$/, '');
  const unit = unitText?.toLowerCase();
  const decimal = Number(raw.replace(',', '.'));
  const whole = Number(raw.replace(/[.,]/g, ''));
  let n: number | null = null;
  if (unit === '%') n = -whole;
  else if (unit?.startsWith('tr')) n = Math.round(decimal * 1_000_000);
  else if (unit?.startsWith('k')) n = Math.round(decimal * 1_000);
  else if (unit || whole >= 1_000) n = whole;
  return n !== null && Number.isFinite(n) && n !== 0 ? n : null;
}

/** Các số mà chữ tự do nhắc tới: "99.000đ", "99k", "1,5tr", "99000đ" ra đồng, "10%" ra số âm để không lẫn với tiền. */
function figuresIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(FIGURE_RE)) {
    const n = figureValue(m[1]!, m[3]);
    if (n !== null) out.push(n);
  }
  return out;
}

type CouponTerms = Pick<CouponDTO, 'type' | 'value' | 'maxDiscount' | 'minOrder'>;

/** Số của chính mã (giá trị giảm, trần giảm, đơn tối thiểu), cùng đơn vị với `figuresIn`; không đọc ngược từ chữ. */
function knownFigures(c: CouponTerms): Set<number> {
  return new Set([c.type === 'PERCENT' ? -c.value : c.type === 'AMOUNT' ? c.value : 0, c.maxDiscount ?? 0, c.minOrder ?? 0].filter((n) => n !== 0));
}

// Từ nối và từ đồng nghĩa với nhãn: tên chỉ gồm chúng (cùng từ của nhãn, điều kiện) và số của mã thì không thêm thông tin nào.
const FILLER_WORDS = new Set(['va', 'cho', 'ban', 'tang', 'khi', 'mua', 'voi', 'ap', 'dung', 'freeship', 'ship']);

// Cùng luật đơn vị với FIGURE_RE nhưng trên chữ đã `fold` (đ thành d, bỏ dấu).
const FOLDED_CURRENCY = String.raw`(?:dong\b(?!\s+(?:${DONG_COMPOUNDS.map(fold).join('|')})\b)|vnd\b|d\b)`;
const FOLDED_FIGURE_RE = new RegExp(String.raw`\d[\d.,]*\s*(?:%|(?:tr|k)\b(?:\s*${FOLDED_CURRENCY})?|${FOLDED_CURRENCY})?`, 'g');

const wordsOf = (s: string): string[] => fold(s).replace(FOLDED_FIGURE_RE, ' ').split(/[^a-z]+/).filter(Boolean);

/** Số trần dưới 1.000 không đơn vị ("3 đơn", "khi mua 2", "100 bạn"): không phải tiền nên không có trong nhãn, là số lượng mà tên đang nói. */
function hasPlainSmallNumber(text: string): boolean {
  for (const m of text.matchAll(FIGURE_RE)) if (m[3] === undefined && figureValue(m[1]!, m[3]) === null) return true;
  return false;
}

/**
 * Tên admin đặt là chữ tự do và hay chép lại nhãn và điều kiện ("Giảm 10% tối đa 50.000đ" cạnh "Giảm 10%, tối đa 50k · Đơn từ 300k"): dòng phụ lặp.
 * Chỉ bỏ tên khi nó không còn gì ngoài số của chính mã và từ của nhãn, điều kiện (hoặc giống hệt nhãn). Tên còn từ khác
 * ("Giảm 20k cho đơn đầu tiên", "Giảm 10% riêng mỹ phẩm") hoặc còn số lượng ("Giảm 20k cho 3 đơn", "khi mua 2") mang phạm vi hay giới hạn
 * mà phiếu không có chỗ nào khác để nói, nên giữ.
 */
function restatesCoupon(name: string, c: CouponTerms, texts: readonly string[]): boolean {
  if (texts.some((t) => t !== '' && fold(t) === fold(name))) return true;
  const known = knownFigures(c);
  const mine = figuresIn(name);
  if (mine.length === 0 || !mine.every((n) => known.has(n)) || hasPlainSmallNumber(name)) return false;
  const covered = new Set([...FILLER_WORDS, ...texts.flatMap(wordsOf)]);
  return wordsOf(name).every((w) => covered.has(w));
}

/** Tên được giữ vẫn có thể chép số của mã theo kiểu khác ("20.000đ" cạnh nhãn "Giảm 20k"): ghi lại các số đó theo cách của phiếu, số lạ ("Tặng 5 lần") để nguyên. */
function unifyFigures(name: string, c: CouponTerms): string {
  const known = knownFigures(c);
  return name.replace(FIGURE_RE, (whole, raw: string, gap: string, unit: string | undefined) => {
    const n = figureValue(raw, unit);
    if (n === null || !known.has(n)) return whole;
    const trailing = raw.slice(raw.replace(/[.,]+$/, '').length);
    return `${n < 0 ? `${-n}%` : vndShort(n)}${trailing}${unit ? '' : gap}`;
  });
}

// Từ đồng nghĩa với nhãn mà admin hay mở đầu tên bằng ("Tặng 20k", "Freeship"): cùng loại với từ của nhãn khi cắt phần đầu chép lại.
const LEAD_SYNONYMS = ['tang', 'freeship', 'ship'];

/**
 * Dòng tên trên phiếu rất hẹp (~100px ở 375px, cạnh điều kiện) và đứng ngay dưới nhãn, nên phần đầu chép lại nhãn ("Giảm 20k" của "Giảm 20k cho 3 đơn")
 * chiếm đúng chỗ của phần mới ("cho 3 đơn") và đẩy phần mới ra khỏi tầm nhìn bằng "…". Chỉ cắt khi phần đầu có ít nhất một số của NHÃN và mọi từ
 * đứng trước số đó là từ của nhãn: "Giảm giá khách VIP" (từ "giá" không thuộc nhãn) giữ nguyên, vì cắt "Giảm" ra "giá khách VIP" mất nghĩa.
 * Số của mã mà nhãn không in (trần giảm của freeship, đơn tối thiểu) không đủ: "Freeship 30k cho đơn đầu" cắt ra "cho đơn đầu" thì phiếu không còn "30k" ở đâu cả.
 */
function trimRepeatedLead(name: string, title: string): string {
  const labelFigures = new Set(figuresIn(title));
  const lead = new Set([...LEAD_SYNONYMS, ...wordsOf(title)]);
  let cut = -1;
  for (const m of name.matchAll(TOKEN_RE)) {
    if (!wordsOf(m[0]).every((w) => lead.has(w))) break;
    const figures = figuresIn(m[0]);
    if (figures.length > 0) {
      if (!figures.every((n) => labelFigures.has(n))) break;
      cut = m.index! + m[0].length;
    } else if (/\d/.test(m[0])) break;
  }
  if (cut < 0) return name;
  const tail = name.slice(cut).replace(/^[\s,;:.\-–—·]+/, '');
  return tail === '' ? name : tail;
}

/** Số ngày lịch (giờ Việt Nam) kể từ epoch: hiệu hai số này là số ngày lịch còn lại, không phải cửa sổ 24 giờ. */
function vnDay(ms: number): number {
  return Math.floor((ms + VN_OFFSET_MS) / DAY_MS);
}

/** Chữ hạn dùng: "Dùng đến 30/11", "Còn 2 ngày", "Hết hạn hôm nay"; hạn không đọc được (null) thì rỗng. */
export function expiryText(endMs: number | null, now: number): string {
  if (endMs === null) return '';
  if (endMs - now <= 0) return fillCopy('coupon.expired');
  const days = vnDay(endMs) - vnDay(now);
  if (days <= 0) return fillCopy('coupon.expiresToday');
  if (days <= EXPIRING_DAYS) return fillCopy('coupon.expiresInDays', { n: days });
  const d = new Date(endMs + VN_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return fillCopy('coupon.expires', { date: `${dd}/${mm}` });
}

/**
 * Dữ liệu vẽ một thẻ mã. Trạng thái theo ưu tiên đã dùng > hết hạn > hết lượt > chưa đủ điều kiện > chưa nhận > đã lưu.
 * `kind: 'shop'` chỉ khi nơi gọi báo `shop: true`; API chưa trả phạm vi gian hàng và `products` là mã mua chung.
 * "Hết hạn hôm nay" và "Còn {n} ngày" tính theo ngày lịch giờ Việt Nam.
 * Hạn không đọc được thì không đoán hết hạn: mã vẫn dùng được, chữ hạn rỗng.
 */
export function voucherView(c: CouponDTO & VoucherFlags, now: number): VoucherView {
  const parsed = Date.parse(c.endAt);
  const endMs = Number.isNaN(parsed) ? null : parsed;
  const expired = endMs !== null && endMs <= now;
  const state: VoucherView['state'] = c.used
    ? 'used'
    : expired
      ? 'expired'
      : c.soldOut
        ? 'soldout'
        : c.ineligible
          ? 'ineligible'
          : c.claimed === false
            ? 'collectable'
            : 'saved';
  const title = couponTitle(c);
  const condition = c.minOrder ? fillCopy('coupon.minOrder', { min: vndShort(c.minOrder) }) : '';
  const named = c.title?.trim() || null;
  return {
    id: c.code,
    code: c.code,
    title,
    kind: c.type === 'FREESHIP' ? 'freeship' : c.shop ? 'shop' : 'discount',
    condition,
    expiry: expiryText(endMs, now),
    name: named && !restatesCoupon(named, c, [title, condition]) ? trimRepeatedLead(unifyFigures(named, c), title) : null,
    quota:
      state === 'collectable' && typeof c.remaining === 'number' && c.remaining >= 1 && c.remaining <= QUOTA_SHOWN_MAX
        ? fillCopy('coupon.usesLeft', { n: c.remaining })
        : null,
    state,
  };
}

/** Còn hạn thì sắp hết hạn trước; không hạn (hoặc hạn không đọc được) sau đó; đã hết hạn cuối cùng. Ổn định, không đổi mảng vào. */
export function sortVouchers<T extends { endAt?: string | null }>(list: T[], now: number): T[] {
  const at = (x: T): number | null => {
    const t = x.endAt ? Date.parse(x.endAt) : Number.NaN;
    return Number.isNaN(t) ? null : t;
  };
  const group = (x: T) => {
    const t = at(x);
    return t === null ? 1 : t <= now ? 2 : 0;
  };
  return [...list].sort((a, b) => group(a) - group(b) || (group(a) === 0 ? at(a)! - at(b)! : 0));
}

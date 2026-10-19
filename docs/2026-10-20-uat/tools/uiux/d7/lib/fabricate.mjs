// Dựng dữ liệu giả từ "schema" (do extract-endpoints.mjs trích từ kiểu TypeScript) — tiếng Việt, có
// thể lặp lại (PRNG theo seed). Ba chế độ:
//   normal : danh sách 4 phần tử, văn bản vừa phải
//   empty  : danh sách object ở độ sâu <= 2 rỗng, đếm = 0 (các mảng chuỗi như images giữ nguyên)
//   long   : danh sách object ở độ sâu <= 1 dài 28 phần tử, tên/mô tả dài, số tiền lớn ở phần tử đầu
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artUri } from './art.mjs';

// Trường status kiểu `string` trần: lấy giá trị thật từ enum Prisma theo endpoint, để thấy UI có map nhãn
// tiếng Việt cho giá trị thật hay lộ enum (bản gốc luôn trả 'ACTIVE', không có trong enum nào).
const PRISMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../apps/api/prisma/schema.prisma');
const ENUMS = {};
try {
  const src = fs.readFileSync(PRISMA, 'utf8');
  for (const m of src.matchAll(/^enum (\w+) \{([\s\S]*?)\}/gm)) ENUMS[m[1]] = m[2].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((w) => /^[A-Z_]+$/.test(w));
} catch {
  /* không có schema thì giữ hành vi cũ */
}
const STATUS_BY_PATH = [
  [/^\/admin\/(orders|dashboard)/, 'OrderStatus'],
  [/^\/admin\/dealer-applications/, 'DealerStatus'],
  [/^\/admin\/return-requests/, 'ReturnStatus'],
  [/^\/admin\/payouts/, 'PayoutStatus'],
  [/^\/admin\/customer-refunds/, 'CustomerRefundStatus'],
  [/^\/admin\/cashback/, 'CashbackStatus'],
  [/^\/admin\/external-orders/, 'ExternalOrderStatus'],
  [/^\/admin\/dealer-reward-claims/, 'DealerRewardClaimStatus'],
  [/^\/admin\/merchant-fulfilment\/payouts/, 'MerchantPayoutStatus'],
  [/^\/admin\/merchant-products/, 'ProductApprovalStatus'],
  [/^\/feed\/admin/, 'FeedPostStatus'],
  [/^\/admin\/waste\/requests/, 'WasteRequestStatus'],
  [/^\/admin\/account-deletion/, 'AccountDeletionRequestStatus'],
  [/^\/admin\/(shifts|staff\/shifts)/, 'ShiftStatus'],
  [/^\/admin\/payroll/, 'PayrollMonthStatus'],
];
const KEY_ENUM = { paymentmethod: 'PaymentMethod', role: 'UserRole', userrole: 'UserRole' };
function realKeyEnum(key, seedPath, i) {
  const k = key.toLowerCase();
  let name = KEY_ENUM[k] ?? null;
  if (!name && k === 'type' && /^\/admin\/(orders|dashboard)/.test(seedPath)) name = 'OrderType';
  const v = name && ENUMS[name];
  return v && v.length ? v[i % v.length] : null;
}
function realStatus(key, seedPath, i) {
  const k = key.toLowerCase();
  let name = null;
  if (k === 'paymentstatus') name = 'PaymentStatus';
  else if (k === 'invoicestatus') name = 'InvoiceStatus';
  else if (k === 'approvalstatus') name = 'ProductApprovalStatus';
  else if (k === 'status' || k === 'tostatus' || k === 'fromstatus') name = STATUS_BY_PATH.find(([re]) => re.test(seedPath))?.[1] ?? null;
  const v = name && ENUMS[name];
  return v && v.length ? v[i % v.length] : null;
}

const NOW = Date.parse('2026-10-09T08:00:00+07:00');
const DAY = 86_400_000;

export const PRODUCT_NAMES = [
  'Nước rửa chén sinh học hương chanh gừng 500ml',
  'Dầu tràm cho bé Cobote 50ml',
  'Mật ong rừng nguyên chất BH.Nong 500g',
  'Xà phòng thảo mộc bạc hà Tubu 100g',
  'Kem dưỡng da tay bơ hạt mỡ Hector 50g',
  'Nước lau sàn tinh dầu sả chanh 1L',
  'Bàn chải tre than hoạt tính (bộ 4)',
  'Túi vải canvas tái chế Tubu',
];
const BRANDS = ['BH.Nong', 'Cobote', 'Hector', 'Pơ Lang', 'Fuwa3e', 'Tubu'];
const PEOPLE = ['Nguyễn Thị Hoa', 'Trần Văn Minh', 'Lê Thu Trang', 'Phạm Quốc Anh', 'Võ Ngọc Lan', 'Đặng Hữu Phước'];
const STREETS = ['123 Lê Lợi', '45/6 Nguyễn Trãi', '12 Hai Bà Trưng', '88 Điện Biên Phủ'];
const SENTENCES = [
  'Sản phẩm từ thiên nhiên, an toàn cho cả gia đình và thân thiện với môi trường.',
  'Mình dùng được hai tuần rồi, mùi hương dịu và không để lại cảm giác khô tay.',
  'Giao hàng nhanh, đóng gói cẩn thận, sẽ ủng hộ shop dài dài.',
  'Chiết xuất 100% thực vật, không paraben, không sulfate, đã kiểm định da liễu.',
];
const LONG_TAIL = ' – bộ quà tặng dung tích lớn, hương tự nhiên dịu nhẹ, kèm túi giấy tái chế và thiệp viết tay';
const PROVINCES = ['TP. Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MONEY = ['price', 'amount', 'total', 'subtotal', 'fee', 'balance', 'revenue', 'commission', 'payout', 'discount', 'cost', 'gmv', 'sales', 'spent', 'debt', 'credit', 'limit', 'threshold', 'saving', 'reward', 'cashback', 'income', 'earn', 'withdraw'];
const COUNT = ['count', 'qty', 'quantity', 'stock', 'sold', 'num', 'size', 'orders', 'views', 'clicks', 'likes', 'comments', 'members', 'users', 'days', 'streak', 'level', 'points', 'coins', 'xu', 'exp', 'water', 'seeds', 'trees'];
const LIST_KEYS = /^(data|items|rows|results|list|orders|products|posts|courses|lessons|links|commissions|transactions|notifications|addresses|coupons|vouchers|events|reviews|comments|members|staff|shifts|payouts|claims|entries|records)$/i;

export function createFabricator({ state = 'normal', seed = 'x' } = {}) {
  let counter = 0;
  let s = hash(seed) || 1;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (arr, i) => arr[(i + Math.floor(rnd() * 2)) % arr.length];
  const isLong = state === 'long';

  function listLength(key, ctx, elSchema) {
    const isObjList = ['obj', 'union', 'any', 'rec'].includes(elSchema.k);
    if (!isObjList) return state === 'empty' && ctx.depth <= 1 && LIST_KEYS.test(key) ? 0 : 3;
    if (state === 'empty') return ctx.depth <= 1 ? 0 : 3;
    if (isLong) return ctx.depth === 0 ? 28 : 3;
    return 4;
  }

  function str(key, ctx) {
    const k = key.toLowerCase();
    const i = ctx.index;
    const long = isLong && (i === 0 || ctx.depth <= 2);
    if (/^(id|.*id)$/.test(k) && !/(valid|android)/.test(k)) return `${k.replace(/id$/, '') || 'id'}-${hash(seed + ctx.path.join('.'))
      .toString(36)
      .slice(0, 5)}-${i}`;
    if (k === 'slug' || k.endsWith('slug')) return `san-pham-${i + 1}`;
    if (/(thumbnail|image|avatar|cover|photo|logo|banner|picture|poster)/.test(k) && !/(alt|caption|count)/.test(k))
      return artUri(`${key}${i}${PRODUCT_NAMES[i % PRODUCT_NAMES.length]}`, /avatar|logo/.test(k) ? 'avatar' : 'product');
    if (/(url|link|href|qr)/.test(k)) return /qr/.test(k) ? artUri('QR', 'product') : `https://tubutree.com/example/${i + 1}`;
    if (/(phone|mobile|sdt)/.test(k)) return i === 0 ? '0901234567' : `09012345${String(10 + i).padStart(2, '0')}`;
    if (k.includes('email')) return 'khach@example.com';
    if (/(code)$/.test(k) || k === 'code') return /referral|ref/.test(k) ? 'TUBU2410' : `TUBU2610090${i + 1}`;
    if (/(fullname|ownername|recipient|author|customer|nickname|username|staffname|displayname|buyer|member|creator|reviewer|owner)/.test(k)) return PEOPLE[i % PEOPLE.length];
    if (k === 'name' || k === 'title' || /(productname|itemname|label)$/.test(k)) {
      const base = ctx.parentKey && /(brand|merchant|store|category|tier|course|lesson|collection|event|bank|shift)/.test(ctx.parentKey)
        ? pick(['Tubu Tree', 'Nhãn xanh', 'Gói quà tặng', 'Khoá học CTV cơ bản', 'Ca sáng', 'Vietcombank'], i)
        : PRODUCT_NAMES[i % PRODUCT_NAMES.length];
      return long ? base + LONG_TAIL : base;
    }
    if (/(variation|variant)name/.test(k)) return pick(['Hương chanh gừng', 'Hương sả', 'Chai 500ml', 'Túi refill 1L'], i);
    if (k === 'brand' || k.endsWith('brandname')) return BRANDS[i % BRANDS.length];
    if (/(desc|description|body|content|note|message|text|caption|summary|reason|comment|detail|bio|story|benefit|subtitle)/.test(k))
      return long ? SENTENCES.join(' ') + ' ' + SENTENCES.join(' ') : SENTENCES[i % SENTENCES.length];
    if (/(province)/.test(k)) return PROVINCES[i % PROVINCES.length];
    if (/(district)/.test(k)) return 'Quận 1';
    if (/(ward)/.test(k)) return 'Phường Bến Nghé';
    if (/(street|address)/.test(k)) return STREETS[i % STREETS.length];
    if (/(at|date|time|until|since|expires|from|to|day|start|end)$/.test(k) || k.includes('date')) {
      const future = /(expire|end|until|next|due|deadline|to)/.test(k);
      const t = NOW + (future ? (3 + i) * DAY : -(i * DAY + 2 * 3_600_000));
      return new Date(t).toISOString();
    }
    if (/(month|period)/.test(k)) return '2026-09';
    if (k.includes('status')) return realStatus(key, seed, i + ctx.depth) ?? 'ACTIVE';
    const ke = realKeyEnum(key, seed, i);
    if (ke) return ke;
    if (/(type|kind|method|role|provider|source|channel|platform)/.test(k)) return pick(['RETAIL', 'COD', 'WALLET'], i);
    if (/(color|colour)/.test(k)) return '#2E7D4F';
    if (/(currency)/.test(k)) return 'VND';
    if (/(bank|account)/.test(k)) return 'Vietcombank';
    if (k.includes('tag') || k.includes('category') || k.includes('segment')) return pick(['Chăm sóc da', 'Gia dụng xanh', 'Cho bé'], i);
    // Phần tử thứ hai trở đi mang số thứ tự để danh sách giả không có hai dòng trùng giá trị (React cảnh báo key trùng khi
    // trang dùng chính chữ/số đó làm key, che mất cảnh báo thật).
    const sample = long ? 'Nội dung mẫu rất dài dùng để kiểm tra việc cắt dòng và tràn chữ trong giao diện' : 'Nội dung mẫu';
    return i > 0 ? `${sample} ${i + 1}` : sample;
  }

  function num(key, ctx) {
    const k = key.toLowerCase();
    const i = ctx.index;
    if (ctx.parentKey === 'meta' || ctx.parentKey === 'pagination') {
      if (k === 'page') return 1;
      if (k === 'limit' || k === 'pagesize') return 20;
      if (k === 'total' || k === 'totalpages') return state === 'empty' ? 0 : isLong ? 60 : 4;
    }
    if (k === 'page') return 1;
    if (/^(day|rank|position|step|level|sortorder|order)$/.test(k)) return i + 1;
    if (state === 'empty' && /^(total|count|itemcount|totalcount|unread|unreadcount|badge|pending)$/.test(k)) return 0;
    if (/(rating|avg|average|score)/.test(k)) return 4.6;
    if (/(pct|percent|progress|ratio|rate|soldpct)/.test(k)) return k.includes('discount') ? 0.12 : 60;
    if (/(lat)$/.test(k)) return 10.77;
    if (/(lng|lon)$/.test(k)) return 106.7;
    if (/(multiplier)/.test(k)) return 1.2;
    if (/(price|amount|subtotal|fee|balance|revenue|commission|payout|cost|gmv|sales|spent|debt|credit|saving|reward|cashback|income|withdraw|threshold|limit)/.test(k) || k === 'total' || k === 'discount') {
      const base = [65000, 89000, 130000, 149000, 260000, 1250000][(i + hash(key)) % 6];
      return isLong && i === 0 ? 1_234_567_890 : base;
    }
    if (COUNT.some((c) => k.includes(c))) return isLong && i === 0 ? 12345 : [3, 12, 48, 5][(i + hash(key)) % 4];
    return [2, 5, 12][(i + hash(key)) % 3];
  }

  function bool(key, ctx) {
    const k = key.toLowerCase();
    if (/(blocked|revoked|disabled|locked|deleted|expired|hidden|banned|used|claimed|done|completed|checkedin|isread|read|seen|reported|pinned|liked|followed|saved|wishlisted|subscribed)/.test(k)) {
      return /(isread|read|seen)$/.test(k) ? ctx.index % 2 === 0 : false;
    }
    if (k === 'isfeatured' || k === 'featured') return ctx.index % 2 === 0;
    return true;
  }

  function fab(schema, key = '', ctx = { depth: 0, index: 0, parentKey: '', path: [] }) {
    if (!schema) return null;
    switch (schema.k) {
      case 'str':
        return schema.name === 'date' ? new Date(NOW - ctx.index * DAY).toISOString() : str(key, ctx);
      case 'num':
        return num(key, ctx);
      case 'bool':
        return bool(key, ctx);
      case 'null':
      case 'undef':
        return null;
      case 'lit':
        return schema.v;
      case 'enum': {
        const v = schema.v;
        // Ưu tiên trạng thái "bình thường" cho phần tử đầu, rồi xoay vòng để thấy nhiều trạng thái.
        return v[(ctx.index + counter++) % v.length];
      }
      case 'union':
        return fab(schema.of[ctx.index % schema.of.length], key, ctx);
      case 'arr': {
        const n = listLength(key, ctx, schema.of);
        const out = [];
        for (let i = 0; i < n; i++)
          out.push(fab(schema.of, key, { depth: ctx.depth + 1, index: i, parentKey: key, path: [...ctx.path, key + i] }));
        return out;
      }
      case 'rec': {
        const o = {};
        for (const kk of ['a', 'b', 'c']) o[kk] = fab(schema.of, kk, { ...ctx, depth: ctx.depth + 1, parentKey: key, path: [...ctx.path, kk] });
        return o;
      }
      case 'obj': {
        const o = {};
        for (const [pk, p] of Object.entries(schema.props)) {
          if (p.s.k === 'undef') continue;
          o[pk] = fab(p.s, pk, { depth: ctx.depth + (key ? 0 : 0), index: ctx.index, parentKey: key, path: [...ctx.path, pk] });
        }
        return o;
      }
      default:
        return null;
    }
  }
  return { fab, rnd };
}

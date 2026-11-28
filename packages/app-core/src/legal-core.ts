/** "199.000đ". */
export const legalVnd = (n: number): string => `${n.toLocaleString('vi-VN')}đ`;

export const LEGAL_SLUGS = ['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen', 'thanh-toan'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export const LEGAL_PAGES: Record<LegalSlug, { title: string; footerLabel: string; description: string }> = {
  'dieu-khoan': {
    title: 'Điều khoản sử dụng',
    footerLabel: 'Điều khoản',
    description: 'Điều khoản khi mua hàng và sử dụng tài khoản trên Tubu Tree.',
  },
  'bao-mat': {
    title: 'Chính sách bảo mật',
    footerLabel: 'Bảo mật',
    description: 'Tubu Tree thu thập, dùng và bảo vệ thông tin cá nhân của bạn như thế nào.',
  },
  'doi-tra': {
    title: 'Chính sách đổi trả',
    footerLabel: 'Đổi trả',
    description: 'Điều kiện và cách đổi, trả hàng, hoàn tiền khi mua trên Tubu Tree.',
  },
  'van-chuyen': {
    title: 'Chính sách vận chuyển',
    footerLabel: 'Vận chuyển',
    description: 'Phí, thời gian và cách nhận hàng khi mua trên Tubu Tree.',
  },
  'thanh-toan': {
    title: 'Chính sách và hình thức thanh toán',
    footerLabel: 'Thanh toán',
    description: 'Các hình thức thanh toán, hoàn tiền và bảo mật giao dịch khi mua trên Tubu Tree.',
  },
};

/** Thông tin thương nhân theo Giấy chứng nhận đăng ký doanh nghiệp, dùng khi cấu hình company.* chưa có gì. */
export const TUBU_TREE_MERCHANT = {
  legalName: 'CÔNG TY TNHH TUBU TREE',
  taxCode: '0319585995',
  address: 'Số 33, đường 1B, phường Long Bình, Thành phố Hồ Chí Minh',
} as const;

export interface MerchantIdentityInput {
  legalName?: string | null;
  taxCode?: string | null;
  address?: string | null;
}

/**
 * Admin đã nhập bất kỳ trường nào của company.* thì giữ nguyên đúng những gì họ nhập (không trộn với mặc định, tránh ghép
 * tên công ty này với MST công ty khác); chưa nhập gì thì hiện thông tin thương nhân đã đăng ký của Tubu Tree.
 */
export function merchantIdentityOrDefault(company?: MerchantIdentityInput | null): { legalName?: string; taxCode?: string; address?: string } {
  const clean = (v?: string | null) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
  const own = { legalName: clean(company?.legalName), taxCode: clean(company?.taxCode), address: clean(company?.address) };
  return own.legalName || own.taxCode || own.address ? own : { ...TUBU_TREE_MERCHANT };
}

export interface CompanyRegistrationInput extends MerchantIdentityInput {
  representative?: string | null;
  registrationNumber?: string | null;
  registrationDate?: string | null;
  registrationPlace?: string | null;
}

/**
 * Ngày cấp ĐKDN: nhận dd/mm/yyyy, d/m/yyyy hoặc yyyy-mm-dd, trả dd/mm/yyyy; ngày không có trên lịch, trước 1990 hoặc ở tương lai là null.
 * Cùng luật với `registrationDate` ở company-config.ts của API (API không phụ thuộc app-core); form admin dùng nó để chặn lưu ngày API sẽ bỏ.
 */
export function normalizeRegistrationDate(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const [d, m, y] = vn ? [Number(vn[1]), Number(vn[2]), Number(vn[3])] : iso ? [Number(iso[3]), Number(iso[2]), Number(iso[1])] : [NaN, NaN, NaN];
  if (!Number.isInteger(d) || y < 1990) return null;
  const at = new Date(Date.UTC(y, m - 1, d));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  if (at.getTime() > now.getTime() + 24 * 3_600_000) return null;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

const filled = (v?: string | null): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Tên pháp nhân là doanh nghiệp (công ty TNHH, cổ phần, hợp danh hoặc doanh nghiệp tư nhân), không phải hộ kinh doanh: chỉ khi đó mã số thuế mới đồng thời là số ĐKDN. */
const isEnterpriseName = (name?: string | null): boolean =>
  typeof name === 'string' && /^\s*(c[oô]ng\s+ty|doanh\s+nghi[eệ]p\s+t[uư]\s+nh[aâ]n)(?![\p{L}\p{N}])/iu.test(name.normalize('NFC'));
/** Mã số doanh nghiệp 10 chữ số; mã 13 số (chi nhánh, đơn vị phụ thuộc) không phải số ĐKDN của doanh nghiệp. */
const enterpriseNumber = (taxCode?: string | null): string | null => {
  const code = filled(taxCode);
  return code && /^\d{10}$/.test(code) ? code : null;
};

/**
 * Dòng hồ sơ pháp lý ở chân trang web và trang Về Tubu Tree: "Người đại diện theo pháp luật: X · Giấy chứng nhận đăng ký doanh nghiệp số N
 * do P cấp ngày D". Người đại diện, ngày và nơi cấp chỉ hiện khi admin đã nhập (không bịa). Số ĐKDN admin để trống thì lấy MST của đơn vị
 * vận hành đang hiện ở chân trang, chỉ khi đó là doanh nghiệp (không phải hộ kinh doanh) có MST 10 số: Luật Doanh nghiệp 2020 (Điều 29) quy định
 * mã số doanh nghiệp đồng thời là mã số thuế.
 * Không có gì để nêu thì null để ẩn cả dòng.
 */
export function companyLegalLine(company?: CompanyRegistrationInput | null): string | null {
  const representative = filled(company?.representative);
  const operator = merchantIdentityOrDefault(company);
  const number = filled(company?.registrationNumber) ?? (isEnterpriseName(operator.legalName) ? enterpriseNumber(operator.taxCode) : null);
  const date = filled(company?.registrationDate);
  const place = filled(company?.registrationPlace);
  const parts: string[] = [];
  if (representative) parts.push(`Người đại diện theo pháp luật: ${representative}`);
  if (number || date || place) {
    let reg = 'Giấy chứng nhận đăng ký doanh nghiệp';
    if (number) reg += ` số ${number}`;
    if (place && date) reg += ` do ${place} cấp ngày ${date}`;
    else if (place) reg += ` do ${place} cấp`;
    else if (date) reg += `${number ? ',' : ''} cấp ngày ${date}`;
    parts.push(reg);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Ngày và nơi cấp trên Giấy chứng nhận đăng ký doanh nghiệp của Tubu Tree (MST 0319585995): chân trang dùng khi admin chưa nhập hai ô này. */
export const TUBU_TREE_REGISTRATION = { date: '09/06/2026', place: 'TP.HCM' } as const;

/**
 * Khối pháp lý gọn ở chân trang web: "CÔNG TY TNHH TUBU TREE · MST 0319585995 · Cấp ngày 09/06/2026 tại TP.HCM · <địa chỉ>" (hotline, email nối
 * thêm ở chỗ vẽ). Số ĐKDN chỉ nêu riêng khi khác MST; người đại diện, ngày và nơi cấp lấy theo admin nhập. Admin chưa nhập ngày, nơi cấp mà
 * đơn vị đang hiện chính là Tubu Tree thì dùng ngày, nơi cấp trên giấy chứng nhận của Tubu Tree; đơn vị khác thì không bịa. Không có gì thì null.
 */
export function footerCompanyLine(company?: CompanyRegistrationInput | null): string | null {
  const id = merchantIdentityOrDefault(company);
  const tubu = id.taxCode === TUBU_TREE_MERCHANT.taxCode;
  const number = filled(company?.registrationNumber);
  const date = filled(company?.registrationDate) ?? (tubu ? TUBU_TREE_REGISTRATION.date : null);
  const place = filled(company?.registrationPlace) ?? (tubu ? TUBU_TREE_REGISTRATION.place : null);
  const representative = filled(company?.representative);
  const issued = date && place ? `Cấp ngày ${date} tại ${place}` : date ? `Cấp ngày ${date}` : place ? `Cấp tại ${place}` : null;
  const parts = [
    id.legalName,
    id.taxCode ? `MST ${id.taxCode}` : null,
    number && number !== id.taxCode ? `ĐKDN số ${number}` : null,
    issued,
    representative ? `Người đại diện: ${representative}` : null,
    id.address,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Lối vào chính sách ở chân trang theo danh mục Bộ Công Thương yêu cầu (hướng dẫn mua hàng, thanh toán, vận chuyển, đổi trả, kiểm hàng, bảo
 * mật thông tin), thêm điều khoản sử dụng. Hướng dẫn mua hàng và kiểm hàng là một mục trong trang điều khoản / đổi trả, trỏ thẳng bằng neo
 * (`legalHeadingIds`).
 */
export const FOOTER_POLICY_LINKS: readonly { label: string; slug: LegalSlug; anchor?: string }[] = [
  { label: 'Hướng dẫn mua hàng', slug: 'dieu-khoan', anchor: 'dat-hang' },
  { label: 'Thanh toán', slug: 'thanh-toan' },
  { label: 'Vận chuyển', slug: 'van-chuyen' },
  { label: 'Đổi trả', slug: 'doi-tra' },
  { label: 'Kiểm hàng', slug: 'doi-tra', anchor: 'kiem-hang' },
  { label: 'Bảo mật thông tin', slug: 'bao-mat' },
  { label: 'Điều khoản sử dụng', slug: 'dieu-khoan' },
];

const SECTION_HEADINGS = [
  { id: 'dat-hang', match: /đặt hàng/iu },
  { id: 'kiem-hang', match: /kiểm hàng/iu },
] as const;

/** id cho các tiêu đề của một trang chính sách: tiêu đề ĐẦU TIÊN nhắc "đặt hàng" / "kiểm hàng" nhận id để chân trang trỏ thẳng tới, còn lại không có. */
export function legalHeadingIds(headings: readonly string[]): (string | undefined)[] {
  const used = new Set<string>();
  return headings.map((h) => {
    const text = h.normalize('NFC');
    const hit = SECTION_HEADINGS.find((s) => !used.has(s.id) && s.match.test(text));
    if (hit) used.add(hit.id);
    return hit?.id;
  });
}

/** Link huy hiệu "Đã thông báo Bộ Công Thương" chỉ hợp lệ khi là https tới cổng online.gov.vn hoặc một tên miền *.gov.vn. */
export function isBctNoticeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value || value === '' || value.length > 500) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return u.hostname === 'online.gov.vn' || u.hostname.endsWith('.gov.vn');
}

export const LEGAL_DRAFT_NOTICE = 'BẢN NHÁP — chờ Tubu Tree duyệt';

/** Đường dẫn là input của người lạ: so sánh với danh sách, không tra bằng khoá đối tượng (tránh "constructor"). */
export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}

export interface LegalVars {
  returnWindowDays: number;
  freeshipThreshold: number;
  /** Phí giao cố định cho đơn dưới ngưỡng freeship (shipping.flat_fee_below_threshold). */
  shippingFlatFee?: number;
  /** Lịch kho đang chạy (shipping.warehouse_schedule), cùng lịch tính ngày nhận ở trang sản phẩm và thanh toán. Thiếu thì dùng lịch chuẩn. */
  delivery?: LegalDelivery;
  /** Đơn vị vận hành (company.*); chưa nhập thì không có trường và bản nháp giữ chỗ [ ] để điền. */
  legalName?: string;
  taxCode?: string;
  address?: string;
}

export interface LegalDelivery {
  /** Giờ cắt đơn "HH:mm" theo giờ Việt Nam. */
  cutoff: string;
  /** Ngày kho làm việc: 0 = Chủ nhật … 6 = Thứ 7. */
  workDays: number[];
  /** [ít nhất, nhiều nhất] ngày làm việc tới tay khách ở TP.HCM / tỉnh khác. */
  hcmDays: [number, number];
  provinceDays: [number, number];
}

/** Lịch chuẩn PO duyệt 19/11/2026, khớp DEFAULT_WAREHOUSE_SCHEDULE của API (API không phụ thuộc app-core). */
export const DEFAULT_LEGAL_DELIVERY: LegalDelivery = { cutoff: '15:00', workDays: [1, 2, 3, 4, 5, 6], hcmDays: [1, 2], provinceDays: [2, 4] };

const isDayRange = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 30) && v[0] <= v[1];

/** Lịch kho từ JSON của GET /config/legal/:loai; từng trường hỏng thì về trường của lịch chuẩn (cùng luật với API). */
export function legalDeliveryOf(raw: unknown): LegalDelivery {
  const d = DEFAULT_LEGAL_DELIVERY;
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const days = r.workDays;
  return {
    cutoff: typeof r.cutoff === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.cutoff) ? r.cutoff : d.cutoff,
    workDays:
      Array.isArray(days) && days.length > 0 && days.every((n) => Number.isInteger(n) && n >= 0 && n <= 6)
        ? [...new Set(days as number[])].sort((a, b) => a - b)
        : [...d.workDays],
    hcmDays: isDayRange(r.hcmDays) ? [r.hcmDays[0], r.hcmDays[1]] : [...d.hcmDays],
    provinceDays: isDayRange(r.provinceDays) ? [r.provinceDays[0], r.provinceDays[1]] : [...d.provinceDays],
  };
}

export const DEFAULT_LEGAL_SUPPORT: LegalSupport = { hotline: '0984 606 774', email: 'tubutree@gmail.com' };

export const DEFAULT_LEGAL_VARS: LegalVars = { returnWindowDays: 7, freeshipThreshold: 199000, shippingFlatFee: 19000, delivery: DEFAULT_LEGAL_DELIVERY };

export const LEGAL_DEFAULT_SHIPPING_FLAT_FEE = 19000;

/** Mốc hoàn tiền chung của chính sách đổi trả và thanh toán. */
export const LEGAL_REFUND_WORKING_DAYS = 7;

export interface LegalSupport {
  hotline: string;
  email: string;
}

export const legalCompanyName = (vars: LegalVars) => vars.legalName ?? '[Tên công ty]';

/** Khối "Đơn vị vận hành / Mã số thuế / Địa chỉ / Hotline / Email" của mọi chính sách. */
export function legalOperatorBlock(support: LegalSupport, vars: LegalVars): string {
  return [
    `- Đơn vị vận hành: ${legalCompanyName(vars)}`,
    `- Mã số thuế: ${vars.taxCode ?? '[Mã số thuế]'}`,
    `- Địa chỉ: ${vars.address ?? '[Địa chỉ trụ sở]'}`,
    `- Hotline: ${support.hotline}`,
    `- Email: ${support.email}`,
  ].join('\n');
}

/** Câu "thời hạn báo" của mục kiểm hàng, dùng chung cho đổi trả và vận chuyển để hai trang không nói lệch nhau. */
export function legalInspectionDeadline(days: number): string {
  return days > 0
    ? `Thời hạn báo: nếu hàng có vấn đề, bạn báo cho Tubu Tree trong vòng ${days} ngày kể từ khi đơn được giao thành công, kèm ảnh hoặc video.`
    : 'Thời hạn báo: Tubu Tree chưa nhận yêu cầu đổi trả sau khi giao thành công, vì vậy hãy kiểm tra và báo ngay tại thời điểm nhận hàng, kèm ảnh hoặc video.';
}

/** "1–2 ngày làm việc", "2 ngày làm việc"; khoảng bắt đầu từ 0 là "trong vòng N ngày làm việc", 0–0 là "trong ngày". */
function workingDays([lo, hi]: [number, number]): string {
  if (hi === 0) return 'giao trong ngày';
  if (lo === 0) return `trong vòng ${hi} ngày làm việc`;
  return lo === hi ? `${lo} ngày làm việc` : `${lo}–${hi} ngày làm việc`;
}
const weekdayName = (d: number): string => (d === 0 ? 'Chủ nhật' : `Thứ ${d + 1}`);

/** "Thứ 2 đến Thứ 7" khi các ngày liền nhau (Chủ nhật tính sau Thứ 7), không thì liệt kê "Thứ 2, Thứ 4, Thứ 6". */
function workDaysText(days: number[]): string {
  const order = [...days].map((d) => (d === 0 ? 7 : d)).sort((a, b) => a - b);
  const contiguous = order.length >= 3 && order.every((d, i, all) => i === 0 || d === (all[i - 1] ?? -1) + 1);
  const names = order.map((d) => weekdayName(d % 7));
  return contiguous ? `${names[0]} đến ${names[names.length - 1]}` : names.join(', ');
}

/** Ba dòng thời gian giao (TP.HCM, tỉnh khác, lịch xuất kho) theo lịch kho đang chạy. */
export function legalDeliveryTimes(d: LegalDelivery): string {
  return [
    `- Nội thành Thành phố Hồ Chí Minh: ${workingDays(d.hcmDays)}.`,
    `- Tỉnh thành khác: ${workingDays(d.provinceDays)}.`,
    `- Kho Tubu Tree xuất hàng từ ${workDaysText(d.workDays)}, trừ ngày lễ. Đơn đặt trước ${d.cutoff} của ngày kho làm việc thường được xuất kho trong ngày, đặt sau giờ này thì xuất kho vào ngày làm việc kế tiếp. Ngày nhận dự kiến hiển thị trong ứng dụng chỉ để tham khảo; thời gian giao áp dụng là thời gian ở hai dòng trên.`,
  ].join('\n');
}

/** Đường dẫn bản đầy đủ trên web, vd `app.tubutree.com/chinh-sach/doi-tra` (bỏ giao thức: Mini App chỉ hiện chữ, không mở trang ngoài). */
export function legalWebAddress(slug: LegalSlug, webBaseUrl: string): string {
  return `${webBaseUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}/chinh-sach/${slug}`;
}

/**
 * Bản tóm tắt Mini App hiện khi chưa có nội dung đã duyệt hoặc chưa tải được nội dung đó: các điều khách cần nhất với số liệu đang áp dụng (thời hạn đổi trả,
 * mức miễn phí giao, lịch giao), đơn vị vận hành, liên hệ, liên kết sang chính sách liên quan và địa chỉ bản đầy đủ trên web. Cùng nguồn số liệu với bản nháp
 * đầy đủ ở legal.ts (web dùng), nên hai nơi không nói lệch nhau; Mini không mang bản nháp đầy đủ để gói Zalo nhẹ hơn.
 * `live = false` khi chưa tải được số đang áp dụng: bỏ mọi số lấy từ cấu hình (thời hạn đổi trả, mức miễn phí, phí, lịch giao) để không hứa theo số mặc định,
 * chỉ dẫn tới bản đầy đủ và bước thanh toán.
 */
export function legalSummary(slug: LegalSlug, vars: LegalVars, support: LegalSupport, webBaseUrl: string, live = true): string {
  const days = vars.returnWindowDays;
  const fee = vars.shippingFlatFee ?? LEGAL_DEFAULT_SHIPPING_FLAT_FEE;
  const address = legalWebAddress(slug, webBaseUrl);
  const refund = `Tiền hoàn về Ví Tubu hoặc tài khoản ngân hàng bạn chọn, trong ${LEGAL_REFUND_WORKING_DAYS} ngày làm việc kể từ khi Tubu Tree duyệt yêu cầu (với đổi trả là kể từ khi nhận lại và kiểm tra sản phẩm). Thời gian ghi có còn phụ thuộc ngân hàng.`;
  const contact = `## Liên hệ\n\n${legalOperatorBlock(support, vars)}`;
  const full = `Bản đầy đủ đăng tại ${address}.`;
  const deadline = live ? legalInspectionDeadline(days) : `Thời hạn báo hàng lỗi, thiếu hoặc sai đang áp dụng ghi trong bản đầy đủ tại ${address}.`;
  const returnWindow = !live
    ? `Thời hạn đổi trả đang áp dụng ghi trong bản đầy đủ tại ${address}; yêu cầu gửi ngay trong mục Đơn hàng.`
    : days > 0
      ? `Bạn có thể yêu cầu đổi hoặc trả hàng trong vòng ${days} ngày kể từ khi đơn được giao thành công, ngay trong mục Đơn hàng.`
      : 'Hiện Tubu Tree chưa nhận yêu cầu đổi trả sau khi giao hàng thành công; hãy kiểm tra và báo ngay khi nhận hàng.';
  const shippingFee = !live
    ? '- Mức miễn phí vận chuyển và phí của từng đơn hiện ở giỏ hàng và bước thanh toán, trước khi bạn bấm đặt hàng.'
    : vars.freeshipThreshold > 0
      ? `- Phần hàng do Tubu Tree giao từ ${legalVnd(vars.freeshipThreshold)} được miễn phí vận chuyển. Một số hạng thành viên hoặc chương trình có thể có ngưỡng miễn phí khác, được hiển thị ở giỏ hàng.\n- ${fee > 0 ? `Chưa đạt mức này: phí cố định ${legalVnd(fee)}, không phụ thuộc địa chỉ hay khối lượng.` : 'Chưa đạt mức này cũng không mất phí vận chuyển.'}`
      : '- Mọi phần hàng do Tubu Tree giao đều được miễn phí vận chuyển.';
  const deliveryTimes = live ? legalDeliveryTimes(vars.delivery ?? DEFAULT_LEGAL_DELIVERY) : `Thời gian giao dự kiến của từng đơn hiện ở bước thanh toán; lịch giao đang áp dụng ghi trong bản đầy đủ tại ${address}.`;
  const body: Record<LegalSlug, string> = {
    'dieu-khoan': `## 1. Giới thiệu

Tubu Tree do ${legalCompanyName(vars)} vận hành. Khi dùng website, mini app Zalo hoặc đặt hàng, bạn đồng ý với các điều khoản này.

## 2. Tài khoản và đặt hàng

- Bạn đăng nhập bằng tài khoản Zalo, cung cấp thông tin đúng và tự giữ an toàn cho tài khoản.
- Đơn được xác nhận khi bạn nhận thông báo xác nhận từ Tubu Tree. Giá đã gồm thuế (nếu có); phí vận chuyển hiện trước khi bạn bấm đặt hàng.
- Thanh toán khi nhận hàng (COD), chuyển khoản (quét mã QR) hoặc Ví Tubu; cách khả dụng của từng đơn hiện ở bước thanh toán, xem [Chính sách và hình thức thanh toán](/chinh-sach/thanh-toan).
- Mã giảm giá, Điểm Xanh và ưu đãi áp dụng theo điều kiện của từng chương trình.

## 3. Chính sách liên quan

Giao hàng theo [Chính sách vận chuyển](/chinh-sach/van-chuyen), đổi trả theo [Chính sách đổi trả](/chinh-sach/doi-tra), thông tin cá nhân theo [Chính sách bảo mật](/chinh-sach/bao-mat). Điều khoản tuân theo pháp luật Việt Nam.`,
    'bao-mat': `## 1. Phạm vi

${legalCompanyName(vars)} thu thập, sử dụng và bảo vệ thông tin cá nhân của bạn theo Nghị định 52/2013/NĐ-CP, Nghị định 85/2021/NĐ-CP và Nghị định 13/2023/NĐ-CP.

## 2. Thông tin và mục đích

- Thông tin thu thập: tài khoản, giao hàng, đơn hàng và thanh toán, cùng thông tin sử dụng (thiết bị, trình duyệt, trang đã xem, nguồn truy cập như liên kết giới thiệu).
- Mục đích: xử lý đơn hàng, giao hàng, thanh toán, đổi trả và chăm sóc khách hàng; vận hành tài khoản, điểm thưởng, mã giảm giá và chương trình giới thiệu; gửi thông báo về đơn hàng (tin khuyến mãi chỉ gửi khi bạn đồng ý nhận); phòng ngừa gian lận, bảo đảm an toàn hệ thống và tuân thủ pháp luật.
- Tubu Tree không lưu số thẻ ngân hàng và không bán thông tin cá nhân của bạn.

## 3. Chia sẻ thông tin

Chỉ chia sẻ phần thông tin cần thiết để thực hiện dịch vụ bạn yêu cầu, cho: đơn vị vận chuyển; ngân hàng, cổng thanh toán hoặc đối tác đối soát chuyển khoản; nhà cung cấp hạ tầng, lưu trữ và công cụ vận hành làm việc theo hợp đồng bảo mật; cơ quan nhà nước có thẩm quyền khi có yêu cầu hợp pháp.

## 4. Quyền của bạn

Bạn có quyền được biết, đồng ý hoặc rút lại sự đồng ý, truy cập, chỉnh sửa, yêu cầu xoá dữ liệu và khiếu nại qua thông tin liên hệ bên dưới. Xem thêm [Điều khoản sử dụng](/chinh-sach/dieu-khoan).`,
    'doi-tra': `## 1. Thời hạn đổi trả

${returnWindow}

## 2. Trường hợp được chấp nhận

- Sản phẩm bị lỗi, hư hỏng, đổ vỡ hoặc hết hạn khi nhận hàng.
- Giao sai sản phẩm, sai phân loại, thiếu hàng hoặc không đúng mô tả.
- Không áp dụng cho: sản phẩm đã mở hoặc đã dùng mà không do lỗi sản xuất, vận chuyển; sản phẩm hư hỏng do bảo quản hoặc sử dụng sai cách; quà tặng kèm hoặc sản phẩm thuộc chương trình ghi rõ không đổi trả.

## 3. Hoàn tiền và phí đổi trả

- ${refund}
- Nếu lỗi thuộc về Tubu Tree hoặc đơn vị vận chuyển, Tubu Tree chịu phí vận chuyển đổi trả. Trường hợp khác, chi phí được thông báo trước khi bạn xác nhận.

## 4. Kiểm hàng khi nhận hàng

- Bạn được đồng kiểm ngoại quan và số lượng cùng nhân viên giao hàng trước khi ký nhận, nên quay video lúc mở kiện.
- ${deadline}

Xem thêm [Chính sách vận chuyển](/chinh-sach/van-chuyen) và [Chính sách và hình thức thanh toán](/chinh-sach/thanh-toan).`,
    'van-chuyen': `## 1. Phạm vi giao hàng

Tubu Tree giao tới các khu vực đơn vị vận chuyển phục vụ; địa chỉ ngoài vùng giao được báo ở bước thanh toán.

## 2. Phí vận chuyển

${shippingFee}
- Hàng của gian hàng đối tác giao riêng theo phí của gian hàng đó, hiện ở bước thanh toán.

## 3. Thời gian giao hàng dự kiến

${deliveryTimes}

## Chính sách kiểm hàng khi nhận hàng

- Bạn được đồng kiểm ngoại quan và số lượng cùng nhân viên giao hàng trước khi ký nhận hoặc thanh toán (đơn COD), nên quay video lúc mở kiện.
- ${deadline}
- ${refund} Xem [Chính sách đổi trả](/chinh-sach/doi-tra).`,
    'thanh-toan': `## 1. Các hình thức thanh toán

- Thanh toán khi nhận hàng (COD): trả tiền cho nhân viên giao hàng khi nhận. Một số đơn có thể không áp dụng COD (ví dụ đơn giá trị cao), hệ thống báo ở bước thanh toán.
- Chuyển khoản ngân hàng (quét mã VietQR) đúng số tiền và nội dung hiển thị ở bước thanh toán.
- Ví Tubu, ZaloPay (khi hiện ở bước thanh toán) và Điểm Xanh theo điều kiện hiển thị.

## 2. Thu tiền và hoàn tiền

- Đơn COD không thu tiền trước khi giao. Tubu Tree không yêu cầu chuyển tiền ngoài các hình thức trên.
- ${refund} Trường hợp được hoàn xem [Chính sách đổi trả](/chinh-sach/doi-tra).

## 3. Bảo mật giao dịch

Tubu Tree không lưu số thẻ ngân hàng, không nhận mật khẩu hay mã OTP của bạn. Xem [Chính sách bảo mật](/chinh-sach/bao-mat).`,
  };
  return `${body[slug]}\n\n${contact}\n\n${full}`;
}

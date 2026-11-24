import { productOrigin } from '../brand-origins';
import { fillTemplate } from '../copy-template';
import { parseRichText, type RichBlock } from '../rich-text';

/**
 * Khối "Nguồn gốc & cách dùng" của trang sản phẩm (web `/san-pham/[slug]`, Mini App `/product/:slug`): gập sẵn một dòng, mở ra là các dòng
 * Đến từ, Cách dùng, Bảo quản, Hạn dùng/số lô. Chỉ đọc dữ liệu đã có, không bịa:
 * - Đến từ: nhãn hàng (hay nhà máy làm ra nhãn mượn vùng) và tỉnh của nó trên bản đồ hành trình (`productOrigin`), cùng nguồn với chip xuất xứ
 *   và `/cau-chuyen`. Đây là nơi của NHÃN, không phải nguồn nguyên liệu của từng mẻ hàng, nên chữ không nói "vùng nguyên liệu" hay "xuất xứ"
 *   (bộ chặn tuyên bố coi "xuất xứ" là điều cần giấy tờ).
 * - Cách dùng, Bảo quản: câu chủ hàng đã viết trong mô tả ("Hướng dẫn sử dụng: …", "Bảo quản nơi khô ráo…"). Mô tả không có thì không có dòng.
 *   Chữ dự phòng của catalog (`product-copy-fallback`) cố ý không viết cách dùng hay bảo quản, nên ở đây cũng không tự viết.
 * - Hạn dùng, số lô: không có cột nào trong DB; dòng chỉ nói chỗ khách đọc được (bao bì), không nêu số.
 * Không có nơi làm ra, cách dùng hay bảo quản thì không có khối (một dòng chỉ nói "xem bao bì" không đáng một khối).
 */

/** Chữ riêng của khối (như `GIFT_COMBOS_COPY`): chỉ trang sản phẩm nạp module này, nên chữ không vào gói khởi động. */
export const PDP_ORIGIN_COPY = {
  titleOriginUsage: 'Nguồn gốc & cách dùng',
  titleOriginStorage: 'Nguồn gốc & bảo quản',
  titleOriginLot: 'Nguồn gốc & hạn dùng',
  titleUsageStorage: 'Cách dùng & bảo quản',
  titleUsageLot: 'Cách dùng & hạn dùng',
  titleStorageLot: 'Bảo quản & hạn dùng',
  origin: 'Đến từ',
  originValue: '{brand} · {province}',
  originFactory: 'Nhà máy {brand} · {province}',
  usage: 'Cách dùng',
  storage: 'Bảo quản',
  lot: 'Hạn dùng, số lô',
  lotValue: 'In trên bao bì sản phẩm',
  map: 'Xem trên bản đồ',
  mapSpoken: 'Xem {brand} ở {province} trên bản đồ',
} as const;

export type PdpOriginCopyKey = keyof typeof PDP_ORIGIN_COPY;

/** Số ký tự tối đa khi điền giá trị dài nhất của bảng nhãn ("Khánh Hòa (Nha Trang)", "Le Plateau"): tiêu đề và gợi ý tỉnh cùng nằm một dòng ở 360px. */
export const PDP_ORIGIN_COPY_MAX: Record<PdpOriginCopyKey, number> = {
  titleOriginUsage: 24,
  titleOriginStorage: 24,
  titleOriginLot: 24,
  titleUsageStorage: 24,
  titleUsageLot: 24,
  titleStorageLot: 24,
  origin: 12,
  originValue: 40,
  originFactory: 48,
  usage: 12,
  storage: 12,
  lot: 24,
  lotValue: 28,
  map: 20,
  mapSpoken: 56,
};

export function pdpOriginCopy(key: PdpOriginCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(PDP_ORIGIN_COPY[key], vars, key);
}

/** Mỗi dòng Cách dùng/Bảo quản tối đa bấy nhiêu câu (mục danh sách), mỗi câu tối đa bấy nhiêu ký tự: khối để đọc lướt, đủ chi tiết nằm ở Mô tả. */
export const PDP_GUIDE_LINES_MAX = 3;
export const PDP_GUIDE_LINE_CHARS = 160;

export interface PdpOriginRow {
  key: 'origin' | 'usage' | 'storage' | 'lot';
  label: string;
  /** Một hay vài câu; nhiều câu thì vẽ thành danh sách. */
  lines: string[];
}

export interface PdpOriginView {
  title: string;
  /** Tỉnh của nhãn ở dòng tiêu đề khi khối đang gập, để đọc lướt; null khi không biết nhãn đến từ đâu. */
  hint: string | null;
  rows: PdpOriginRow[];
  /** Lối mở bản đồ câu chuyện ở dòng Đến từ. null khi không biết nhãn đến từ đâu, hoặc chip xuất xứ đầu trang đã trỏ tới đúng điểm đó (một hành động một lối). */
  map: { id: string; spoken: string } | null;
}

type Kind = 'usage' | 'storage';

interface GuideLine {
  text: string;
  /** Dòng đứng như tiêu đề: thẻ h, đoạn in đậm trọn vẹn, chữ in hoa, hay kết thúc bằng dấu hai chấm. */
  heading: boolean;
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/** Bỏ ký tự đầu dòng không phải chữ hay số (gạch đầu dòng, biểu tượng) và khoảng trắng thừa. */
const stripLead = (s: string): string => s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim();

// Nhãn mở đầu dòng, so trên chữ đã bỏ dấu; nhãn dài đứng trước nhãn ngắn cùng đuôi.
const LABELS: { kind: Kind; re: RegExp }[] = [
  { kind: 'usage', re: /^(?:huong dan su dung|cach su dung|cach dung|hdsd)(?![\p{L}\p{N}])/u },
  { kind: 'storage', re: /^(?:huong dan bao quan|cach bao quan|bao quan)(?![\p{L}\p{N}])/u },
];
const SEPARATOR = /^\s*[:：\-–—]\s*/;
/**
 * Không có dấu hai chấm thì "Bảo quản …" chỉ là câu bảo quản khi từ kế tiếp nói nơi hay cách giữ ("Bảo quản nơi khô ráo", "Bảo quản trong tủ
 * lạnh", "Bảo quản sản phẩm ở nơi thoáng mát"); "Bảo quản tự nhiên…", "Bảo quản sản phẩm lâu hơn…" hay "Cách dùng đơn giản…" là câu quảng cáo.
 */
const PLACE = '(?:noi|o|trong|tranh|tai|duoi)';
const STORAGE_INLINE = new RegExp(`^(?:${PLACE}|lanh|kin|san pham ${PLACE})(?![\\p{L}\\p{N}])`, 'u');
/**
 * Dòng mở đầu bằng tên một mục khác của mô tả ("Thành phần", "Công dụng", "Quy cách"…) là tiêu đề khi ngay sau tên là dấu hai chấm, hoặc dòng ngắn
 * không dấu chấm câu, dù không in đậm hay in hoa: dừng phần Cách dùng/Bảo quản đang lấy, không nuốt sang mục sau.
 */
const SECTION = /^(?:thanh phan|cong dung|quy cach|thong so|thong tin|dac diem|uu diem|luu y|chu y|canh bao|xuat xu|nguon goc|han su dung|han dung|mo ta|dung tich|khoi luong|trong luong|san xuat|nha san xuat|phan phoi)(?![\p{L}\p{N}])/u;
const SECTION_MAX_CHARS = 40;
function isSection(text: string): boolean {
  const folded = fold(text);
  const m = SECTION.exec(folded);
  if (!m) return false;
  return /^\s*[:：]/.test(folded.slice(m[0].length)) || (text.length <= SECTION_MAX_CHARS && !/[.!?]$/.test(text));
}

function guideLines(blocks: readonly RichBlock[]): GuideLine[] {
  const out: GuideLine[] = [];
  const push = (raw: string, heading: boolean) => {
    for (const part of raw.split('\n')) {
      const text = stripLead(part);
      if (!text) continue;
      const letters = text.replace(/[^\p{L}]/gu, '');
      const caps = letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
      out.push({ text, heading: heading || caps || /[:：]$/.test(text) || isSection(text) });
    }
  };
  for (const b of blocks) {
    if ('items' in b) for (const item of b.items) push(item.map((x) => x.text).join(''), false);
    else push(b.inlines.map((x) => x.text).join(''), b.kind === 'h' || (b.inlines.length > 0 && b.inlines.every((x) => x.bold || !x.text.trim())));
  }
  return out;
}

/** Cắt câu dài ở ranh giới từ, kèm "…". */
function clip(text: string): string {
  if (text.length <= PDP_GUIDE_LINE_CHARS) return text;
  const cut = text.slice(0, PDP_GUIDE_LINE_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > PDP_GUIDE_LINE_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Dòng có mở đầu bằng nhãn Cách dùng/Bảo quản không; có thì trả phần sau nhãn (rỗng khi dòng chỉ là tiêu đề). */
function matchLabel(text: string): { kind: Kind; rest: string } | null {
  // Chữ dựng sẵn (NFC) bỏ dấu thì dài đúng bằng chữ gốc, nên cắt chữ gốc theo độ dài nhãn đã khớp. Lệch (ký tự lạ) thì bỏ dòng, không cắt sai chữ.
  const original = text.normalize('NFC');
  const folded = fold(original);
  if (folded.length !== original.length) return null;
  for (const { kind, re } of LABELS) {
    const m = re.exec(folded);
    if (!m) continue;
    const after = original.slice(m[0].length);
    const sep = SEPARATOR.exec(after);
    if (sep) return { kind, rest: after.slice(sep[0].length).trim() };
    const rest = after.trim();
    if (!rest) return { kind, rest: '' };
    if (kind === 'storage' && STORAGE_INLINE.test(fold(rest))) return { kind, rest };
    return null;
  }
  return null;
}

/**
 * Câu Cách dùng và Bảo quản mà chủ hàng đã viết trong mô tả (THUẦN). Nhận hai dạng: câu một dòng ("Bảo quản: nơi khô ráo…", "Bảo quản nơi khô
 * ráo…") và tiêu đề đứng riêng ("HƯỚNG DẪN SỬ DỤNG") rồi các dòng hay mục bên dưới, tới tiêu đề kế tiếp. Lấy lần xuất hiện đầu của mỗi loại.
 */
export function descriptionGuide(description: string | null | undefined): Record<Kind, string[] | null> {
  const found: Record<Kind, string[] | null> = { usage: null, storage: null };
  const lines = guideLines(parseRichText(description));
  for (let i = 0; i < lines.length; i++) {
    const hit = matchLabel(lines[i]!.text);
    if (!hit || found[hit.kind]) continue;
    const taken: string[] = [];
    if (hit.rest) taken.push(hit.rest);
    else {
      for (let j = i + 1; j < lines.length && taken.length < PDP_GUIDE_LINES_MAX; j++) {
        const next = lines[j]!;
        if (next.heading || matchLabel(next.text)) break;
        taken.push(next.text);
      }
    }
    if (taken.length > 0) found[hit.kind] = taken.map((t) => capitalize(clip(t)));
  }
  return found;
}

// Tiêu đề nói hai dòng đầu của khối (dòng Hạn dùng luôn có ở cuối nên khối luôn có ít nhất hai dòng): không hứa phần khối không có.
const TITLE: Record<string, PdpOriginCopyKey> = {
  'origin-usage': 'titleOriginUsage',
  'origin-storage': 'titleOriginStorage',
  'origin-lot': 'titleOriginLot',
  'usage-storage': 'titleUsageStorage',
  'usage-lot': 'titleUsageLot',
  'storage-lot': 'titleStorageLot',
};

/**
 * Dạng hiển thị của khối (THUẦN). `originChip`: trang đang có chip xuất xứ ở đầu trang (`pdpOriginLink(product.brand)` khác null); khi đó dòng
 * Đến từ không thêm lối bản đồ thứ hai. Không biết nhãn đến từ đâu, không cách dùng, không bảo quản thì null.
 */
export function pdpOriginView(product: { brand: string; name: string; description?: string | null }, opts: { originChip: boolean }): PdpOriginView | null {
  const origin = productOrigin(product);
  const guide = descriptionGuide(product.description);
  if (!origin && !guide.usage && !guide.storage) return null;
  const rows: PdpOriginRow[] = [];
  if (origin) {
    const value = pdpOriginCopy(origin.viaFactory ? 'originFactory' : 'originValue', { province: origin.province, brand: origin.brand });
    rows.push({ key: 'origin', label: pdpOriginCopy('origin'), lines: [value] });
  }
  if (guide.usage) rows.push({ key: 'usage', label: pdpOriginCopy('usage'), lines: guide.usage });
  if (guide.storage) rows.push({ key: 'storage', label: pdpOriginCopy('storage'), lines: guide.storage });
  rows.push({ key: 'lot', label: pdpOriginCopy('lot'), lines: [pdpOriginCopy('lotValue')] });
  return {
    title: pdpOriginCopy(TITLE[`${rows[0]!.key}-${rows[1]!.key}`]!),
    hint: origin ? origin.province : null,
    rows,
    map: origin && !opts.originChip ? { id: origin.id, spoken: pdpOriginCopy('mapSpoken', { brand: origin.brand, province: origin.province }) } : null,
  };
}

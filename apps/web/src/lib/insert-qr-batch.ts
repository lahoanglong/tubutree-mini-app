import { INSERT_QR_CHANNELS, insertQrUrl, normalizeInsertTag, type InsertQrChannel } from './insert-qr';
import { A6_CARD_MM, insertQrCardSvg, printHtmlInFrame } from './insert-qr-card';

/**
 * In hàng loạt thẻ A6 bỏ hộp (W58-03, chỉ ADMIN, không gọi máy chủ). Một tờ A4 (210 × 297 mm) chứa đúng 2 × 2 thẻ A6 (105 × 148 mm) nên thẻ
 * in đúng cỡ thật, không co. Mã của mỗi thẻ là hàm thuần của (sàn, tên đợt, số thứ tự): in lại cùng ba giá trị ra đúng cùng mã (không ghi gì
 * lên máy chủ nên không có "mã đã cấp" để lệch), và trong một lượt in mỗi số thứ tự chỉ xuất hiện một lần.
 *
 * Đợt thẻ (`card=`) giữ nguyên cho cả lượt: báo cáo nguồn khách gom theo đợt, không thành 200 dòng. Số thứ tự đi riêng ở `n=`, bộ đọc nguồn bỏ qua
 * nó. In tiếp lượt sau cùng đợt thì đặt "Bắt đầu từ số" nối tiếp số cuối của lượt trước.
 */
export const BATCH_MIN = 1;
export const BATCH_MAX = 200;
/** Số thứ tự tối đa: ba chữ số để thẻ in ra gọn và dễ đối chiếu. */
export const BATCH_SERIAL_MAX = 999;
const SERIAL_DIGITS = 3;
export const BATCH_CARDS_PER_SHEET = 4;
export const A4_SHEET_MM = { widthMm: 210, heightMm: 297 } as const;

export type BatchPlanError = 'channel' | 'tag' | 'tag-required' | 'count' | 'start' | 'range';

export const BATCH_ERROR_TEXT: Record<BatchPlanError, string> = {
  channel: 'Chưa chọn sàn bán hàng.',
  tag: 'Tên đợt thẻ chỉ gồm chữ thường không dấu, số, gạch ngang hoặc gạch dưới, bắt đầu bằng chữ hoặc số.',
  'tag-required': 'In hàng loạt cần tên đợt thẻ để mã của các đợt không trùng nhau.',
  count: `Số thẻ từ ${BATCH_MIN} tới ${BATCH_MAX}.`,
  start: `Số bắt đầu từ 1 tới ${BATCH_SERIAL_MAX}.`,
  range: `Thẻ cuối vượt quá số ${BATCH_SERIAL_MAX}: giảm số thẻ hoặc số bắt đầu.`,
};

export type BatchCard = { serial: string; url: string };
export type BatchPlanOk = { ok: true; channel: InsertQrChannel; tag: string; cards: BatchCard[]; sheets: number };
export type BatchPlan = BatchPlanOk | { ok: false; error: BatchPlanError };

export type BatchPlanInput = {
  channel: string;
  tag: string;
  count: number | null;
  start: number | null;
  /** Host của link trong mã; mặc định host chính của bản build (`SITE_URL`, https://tubutree.com trên PROD). */
  base?: string;
};

/** "25" thành 25; rỗng, dấu, số thập phân hay quá 4 chữ số thành `null` (ô nhập chỉ nhận số nguyên không dấu). */
export function parseBatchInt(raw: string): number | null {
  const v = raw.trim();
  return /^\d{1,4}$/.test(v) ? Number(v) : null;
}

export const formatSerial = (n: number): string => String(n).padStart(SERIAL_DIGITS, '0');

export const batchSheetCount = (count: number): number => Math.ceil(count / BATCH_CARDS_PER_SHEET);

/** Kiểm đầu vào rồi dựng danh sách thẻ `{ serial, url }`; mỗi `url` đi qua `insertQrUrl` (cùng luật tên đợt và kênh với thẻ lẻ). */
export function planInsertQrBatch({ channel, tag, count, start, base }: BatchPlanInput): BatchPlan {
  if (!(INSERT_QR_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: 'channel' };
  const t = normalizeInsertTag(tag);
  if (t === null) return { ok: false, error: 'tag' };
  if (!t) return { ok: false, error: 'tag-required' };
  if (count === null || !Number.isInteger(count) || count < BATCH_MIN || count > BATCH_MAX) return { ok: false, error: 'count' };
  if (start === null || !Number.isInteger(start) || start < 1 || start > BATCH_SERIAL_MAX) return { ok: false, error: 'start' };
  if (start + count - 1 > BATCH_SERIAL_MAX) return { ok: false, error: 'range' };

  const cards: BatchCard[] = [];
  for (let i = 0; i < count; i++) {
    const serial = formatSerial(start + i);
    const url = insertQrUrl(channel, t, base, serial);
    if (!url) return { ok: false, error: 'tag' };
    cards.push({ serial, url });
  }
  // Không thể trùng khi số thứ tự tăng dần; chặn ở đây để một lần sửa sai sau này không in ra hai thẻ cùng mã.
  if (new Set(cards.map((c) => c.url)).size !== cards.length) throw new Error('Mã thẻ bị trùng trong cùng một lượt in.');
  return { ok: true, channel: channel as InsertQrChannel, tag: t, cards, sheets: batchSheetCount(count) };
}

/** Dấu cắt đặt đúng trên đường cắt (giữa tờ): bị cắt đi cùng đường, không để lại nét trên thẻ. Viền trắng mỏng để thấy cả trên nền xanh. */
function cropMarksSvg(): string {
  const { widthMm: W } = A4_SHEET_MM;
  const H = A6_CARD_MM.heightMm * 2;
  const cx = W / 2;
  const cy = H / 2;
  const tick = 4;
  const cross = 4;
  const segs = [
    [cx, 0, cx, tick],
    [cx, H - tick, cx, H],
    [0, cy, tick, cy],
    [W - tick, cy, W, cy],
    [cx - cross, cy, cx + cross, cy],
    [cx, cy - cross, cx, cy + cross],
  ];
  const line = (s: number[], stroke: string, w: number) => `<line x1="${s[0]}" y1="${s[1]}" x2="${s[2]}" y2="${s[3]}" stroke="${stroke}" stroke-width="${w}"/>`;
  return (
    `<svg class="marks" data-crop-marks="1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">` +
    segs.map((s) => line(s, '#fff', 0.5)).join('') +
    segs.map((s) => line(s, '#000', 0.2)).join('') +
    `</svg>`
  );
}

/**
 * Trang in: mỗi `<section class="sheet">` là một tờ A4 có tối đa 4 thẻ và dấu cắt, ngắt trang giữa các tờ (tờ cuối không ngắt để khỏi ra tờ trắng).
 * Tờ cao 296,5 mm chứ không 297: đúng 297 mm thì làm tròn của trình duyệt đẩy một tờ trắng ra sau mỗi tờ. `@page` không lề nên Chrome, Safari và
 * Firefox không in đầu trang/chân trang (chúng nằm trong lề).
 */
export function insertQrBatchPrintHtml(plan: BatchPlanOk, { earnPct }: { earnPct?: number | null } = {}): string {
  const { widthMm, heightMm } = A6_CARD_MM;
  const sheets: string[] = [];
  for (let i = 0; i < plan.cards.length; i += BATCH_CARDS_PER_SHEET) {
    const slots = plan.cards
      .slice(i, i + BATCH_CARDS_PER_SHEET)
      .map((c) => `<div class="slot">${insertQrCardSvg(c.url, plan.channel, { unit: 'mm', earnPct, serial: c.serial })}</div>`)
      .join('');
    sheets.push(`<section class="sheet" data-sheet="${sheets.length + 1}"><div class="grid">${slots}</div>${cropMarksSvg()}</section>`);
  }
  return (
    '<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Thẻ A6 Tubu Tree: ' +
    `${plan.cards.length} thẻ</title><style>` +
    `@page{size:${A4_SHEET_MM.widthMm}mm ${A4_SHEET_MM.heightMm}mm;margin:0}` +
    'html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    `.sheet{position:relative;width:${A4_SHEET_MM.widthMm}mm;height:296.5mm;overflow:hidden;break-after:page;page-break-after:always}` +
    '.sheet:last-child{break-after:auto;page-break-after:auto}' +
    `.grid{position:absolute;left:0;top:0.25mm;width:${A4_SHEET_MM.widthMm}mm;height:${heightMm * 2}mm;display:grid;` +
    `grid-template-columns:${widthMm}mm ${widthMm}mm;grid-template-rows:${heightMm}mm ${heightMm}mm}` +
    `.slot{width:${widthMm}mm;height:${heightMm}mm;overflow:hidden}` +
    `.slot svg{display:block;width:${widthMm}mm;height:${heightMm}mm}` +
    `.marks{position:absolute;left:0;top:0.25mm;width:${A4_SHEET_MM.widthMm}mm;height:${heightMm * 2}mm}` +
    `</style></head><body>${sheets.join('')}</body></html>`
  );
}

/** In cả lượt qua khung ẩn cỡ A4. Xem `printHtmlInFrame` về lý do khung ngoài màn hình. */
export function printInsertQrBatch(plan: BatchPlanOk, opts: { earnPct?: number | null } = {}, print?: (w: Window) => void): Promise<void> {
  return printHtmlInFrame(insertQrBatchPrintHtml(plan, opts), { ...A4_SHEET_MM, title: 'Thẻ A6 in hàng loạt' }, print);
}

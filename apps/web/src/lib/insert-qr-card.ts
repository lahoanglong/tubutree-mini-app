import { INSERT_QR_CHANNEL_LABEL, normalizeInsertTag, qrPath, type InsertQrChannel } from './insert-qr';

/**
 * Thẻ A6 bỏ hộp hàng bán trên sàn, sẵn in (W49-02). Một hàm dựng SVG duy nhất là nguồn của cả ba đầu ra: ảnh xem trước, PNG 300 DPI
 * và bản in/PDF (vector, chữ và mã nét ở mọi cỡ giấy). Không gọi máy chủ.
 *
 * A6 dọc = 105 × 148 mm; ở 300 DPI là 1240 × 1748 điểm ảnh, nên hệ toạ độ của SVG chính là điểm ảnh của PNG.
 */
export const A6_CARD_MM = { widthMm: 105, heightMm: 148 } as const;
export const A6_CARD_DPI = 300;
export const A6_CARD_PX = { widthPx: 1240, heightPx: 1748 } as const;

/**
 * Tỉ lệ in trên thẻ. Khớp mặc định `DEFAULT_MARKETPLACE_EARN_PCT` của API (khoá `loyalty.marketplace_earn_pct`); thẻ giấy không đọc cấu hình,
 * đổi tỉ lệ ở cấu hình thì phải in lại thẻ.
 */
export const INSERT_CARD_EARN_PCT = 5;

export type InsertCardStep = { n: number; lines: readonly string[] };

/** Ba bước trên thẻ; `lines` là chữ đã ngắt dòng cho cột hẹp (nối bằng khoảng trắng ra câu đầy đủ). */
export const INSERT_CARD_STEPS: readonly InsertCardStep[] = [
  { n: 1, lines: ['Quét mã'] },
  { n: 2, lines: ['Quét đơn', 'sàn'] },
  { n: 3, lines: [`Nhận ${INSERT_CARD_EARN_PCT}%`, 'Điểm Xanh'] },
];

const FOREST_600 = '#245E3E';
const FOREST_700 = '#1B4B31';
const FOREST_50 = '#EEF4EF';
const LEAF = '#9AD7A8';
const INK = '#1F2A24';
const MUTED = '#5C6B62';
const FONT = "'Be Vietnam Pro','Helvetica Neue',Arial,'Segoe UI',sans-serif";

/** Cạnh vùng mã (kể cả lề lặng) mong muốn; cỡ ô được làm tròn xuống số nguyên điểm ảnh để mép ô không nhoè khi vẽ ra PNG. */
const QR_BOX_PX = 700;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Chữ hiển thị dưới mã cho khách không quét được: chỉ host + đường dẫn, không kèm tham số nguồn. */
export function insertCardShortLink(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
}

export type InsertCardSvgOptions = {
  /** `px`: 1240 × 1748 để vẽ ra PNG và xem trước; `mm`: 105 × 148 mm để in. */
  unit?: 'px' | 'mm';
};

/** SVG thẻ A6: nền xanh Tubu, nhãn sàn, mã QR, ba bước, link rút gọn. `url` phải là link từ `insertQrUrl`. */
export function insertQrCardSvg(url: string, channel: InsertQrChannel, { unit = 'px' }: InsertCardSvgOptions = {}): string {
  const { widthPx: W, heightPx: H } = A6_CARD_PX;
  const { full, d } = qrPath(url);
  const scale = Math.max(1, Math.floor(QR_BOX_PX / full));
  const qrPx = scale * full;
  const qrX = Math.round((W - qrPx) / 2);
  const qrY = 540;

  const badge = `Mua trên ${INSERT_QR_CHANNEL_LABEL[channel]}`;
  const badgeW = Math.round(badge.length * 25 + 80);

  const colX = [260, 620, 980];
  const stepY = 1470;
  const connectors = [0, 1]
    .map((i) => `<line x1="${colX[i]! + 62}" y1="${stepY}" x2="${colX[i + 1]! - 62}" y2="${stepY}" stroke="#B9D4C0" stroke-width="6" stroke-linecap="round"/>`)
    .join('');
  const steps = INSERT_CARD_STEPS.map((step, i) => {
    const cx = colX[i]!;
    const label = step.lines
      .map((line, li) => `<text x="${cx}" y="${stepY + 110 + li * 50}" text-anchor="middle" font-size="42" font-weight="700" fill="${FOREST_700}">${esc(line)}</text>`)
      .join('');
    return (
      `<g data-step="${step.n}"><circle cx="${cx}" cy="${stepY}" r="48" fill="${FOREST_600}"/>` +
      `<text x="${cx}" y="${stepY + 20}" text-anchor="middle" font-size="56" font-weight="800" fill="#fff">${step.n}</text>${label}</g>`
    );
  }).join('');

  const size = unit === 'mm' ? `width="${A6_CARD_MM.widthMm}mm" height="${A6_CARD_MM.heightMm}mm"` : `width="${W}" height="${H}"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" ${size} font-family="${FONT}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>` +
    // Dải đầu xanh Tubu: lá + tên + nhãn sàn.
    `<rect width="${W}" height="330" fill="${FOREST_600}"/>` +
    `<circle cx="1130" cy="40" r="190" fill="#fff" fill-opacity="0.07"/><circle cx="1010" cy="300" r="110" fill="#fff" fill-opacity="0.07"/>` +
    `<path d="M90 190C90 120 140 78 214 70C222 144 178 196 100 198Z" fill="${LEAF}"/>` +
    `<path d="M104 188C130 150 160 122 196 98" stroke="${FOREST_600}" stroke-width="7" fill="none" stroke-linecap="round"/>` +
    `<text x="250" y="178" font-size="124" font-weight="800" fill="#fff">Tubu Tree</text>` +
    `<g data-channel-badge="1"><rect x="90" y="226" width="${badgeW}" height="66" rx="33" fill="#fff"/>` +
    `<text x="${90 + badgeW / 2}" y="272" text-anchor="middle" font-size="38" font-weight="700" fill="${FOREST_700}">${esc(badge)}</text></g>` +
    // Lời cảm ơn.
    `<text x="${W / 2}" y="432" text-anchor="middle" font-size="64" font-weight="800" fill="${INK}">Cảm ơn bạn đã mua Tubu Tree!</text>` +
    `<text x="${W / 2}" y="494" text-anchor="middle" font-size="40" fill="${MUTED}">Quét mã để nhận Điểm Xanh cho đơn này</text>` +
    // Mã QR: khung xanh, nền trắng, ô vẽ ở cỡ nguyên điểm ảnh.
    `<rect x="${qrX - 22}" y="${qrY - 22}" width="${qrPx + 44}" height="${qrPx + 44}" rx="28" fill="none" stroke="${FOREST_600}" stroke-width="8"/>` +
    `<g data-qr="1" transform="translate(${qrX} ${qrY}) scale(${scale})" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path fill="#000" d="${d}"/></g>` +
    `<text x="${W / 2}" y="${qrY + qrPx + 92}" text-anchor="middle" font-size="40" fill="${MUTED}">Mở camera điện thoại và hướng vào mã</text>` +
    // Ba bước.
    connectors +
    steps +
    // Chân thẻ.
    `<rect y="1660" width="${W}" height="${H - 1660}" fill="${FOREST_50}"/>` +
    `<text x="${W / 2}" y="1716" text-anchor="middle" font-size="40" font-weight="700" fill="${FOREST_700}">${esc(insertCardShortLink(url))}</text>` +
    `</svg>`
  );
}

/** `tubu-the-a6-shopee-box-2026-11.png`. */
export function insertQrCardFileName(channel: InsertQrChannel, tag: string): string {
  const t = normalizeInsertTag(tag);
  return `tubu-the-a6-${channel}${t ? `-${t}` : ''}.png`;
}

// ---- PNG 300 DPI -----------------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Chèn khối `pHYs` (điểm ảnh trên mét) ngay sau `IHDR` để phần mềm in hiểu ảnh 1240 × 1748 là 105 × 148 mm. `canvas.toBlob` không ghi khối này,
 * nên không chèn thì trình in coi ảnh là 72/96 DPI và phóng ra cỡ giấy khác. Ảnh đã có `pHYs` hoặc không phải PNG thì trả nguyên.
 */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  if (png.length < ihdrEnd || PNG_SIGNATURE.some((b, i) => png[i] !== b)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const type = (o: number) => String.fromCharCode(png[o]!, png[o + 1]!, png[o + 2]!, png[o + 3]!);
  if (type(12) !== 'IHDR') return png;
  for (let o = 8; o + 8 <= png.length; ) {
    if (type(o + 4) === 'pHYs') return png;
    o += 12 + view.getUint32(o);
  }
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // đơn vị: mét
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image(A6_CARD_PX.widthPx, A6_CARD_PX.heightPx);
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Trình duyệt không dựng được ảnh thẻ.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** PNG 1240 × 1748 (A6, 300 DPI) vẽ từ SVG `unit: 'px'`. Ném lỗi tiếng Việt khi trình duyệt không vẽ được. */
export async function insertQrCardPngBlob(svgPx: string): Promise<Blob> {
  const img = await loadSvgImage(svgPx);
  const canvas = document.createElement('canvas');
  canvas.width = A6_CARD_PX.widthPx;
  canvas.height = A6_CARD_PX.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không vẽ được ảnh.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const raw = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Trình duyệt không xuất được ảnh PNG.'))), 'image/png');
  });
  // `new Uint8Array(...)` sao ra bộ đệm ArrayBuffer thường (không phải SharedArrayBuffer) để khớp kiểu BlobPart.
  return new Blob([new Uint8Array(pngWithDpi(new Uint8Array(await raw.arrayBuffer()), A6_CARD_DPI))], { type: 'image/png' });
}

// ---- In / lưu PDF ----------------------------------------------------------------------------------------------------------------

/** Trang in chỉ chứa thẻ: giấy A6, không lề, để hộp thoại in của trình duyệt mặc định đúng cỡ và "Lưu dưới dạng PDF" ra đúng một trang A6. */
export function insertQrCardPrintHtml(svgMm: string): string {
  return (
    '<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Thẻ A6 Tubu Tree</title><style>' +
    `@page{size:${A6_CARD_MM.widthMm}mm ${A6_CARD_MM.heightMm}mm;margin:0}` +
    `html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `svg{display:block;width:${A6_CARD_MM.widthMm}mm;height:${A6_CARD_MM.heightMm}mm}` +
    `</style></head><body>${svgMm}</body></html>`
  );
}

const PRINT_START_DELAY_MS = 60;
const PRINT_CLEANUP_MS = 120_000;

const defaultPrint = (w: Window) => {
  w.focus();
  w.print();
};

/**
 * Mở hộp thoại in cho thẻ trong một khung ẩn: trang quản trị không bị đụng tới (không cần CSS `@media print` cho cả ứng dụng). Gỡ khung khi
 * in xong (`afterprint`), hoặc sau 2 phút nếu trình duyệt không bắn sự kiện. `print` tách ra để test không gọi hộp thoại thật.
 */
export function printInsertQrCard(svgMm: string, print: (w: Window) => void = defaultPrint): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.title = 'Thẻ A6 sẵn in';
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(frame);
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      reject(new Error('Trình duyệt không mở được trang in.'));
      return;
    }
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      frame.remove();
    };
    win.document.open();
    win.document.write(insertQrCardPrintHtml(svgMm));
    win.document.close();
    win.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, PRINT_CLEANUP_MS);
    setTimeout(() => {
      try {
        print(win);
        resolve();
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error('Trình duyệt không mở được hộp thoại in.'));
      }
    }, PRINT_START_DELAY_MS);
  });
}

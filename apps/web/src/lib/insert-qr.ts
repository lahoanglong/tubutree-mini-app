import QRCode from 'qrcode';
import { normalizeEntryToken } from './entry-source';
import { SITE_URL } from './site';

/**
 * Mã QR in trên thẻ bỏ hộp hàng bán trên sàn (W43). Link trỏ về trang web `/quet-ma`: điện thoại mở bằng camera thường thì trang đó
 * chuyển sang màn quét của Mini App (`/points/scan`, giữ `utm_source` và `card`, xem `miniAppDeepLink`), máy tính thì đọc hướng dẫn.
 * Không gắn mã giảm giá nào (khác thẻ của bảng Đợt phát mã ở tab Mã giảm giá).
 */
export const INSERT_QR_CHANNELS = ['shopee', 'tiktok', 'lazada'] as const;
export type InsertQrChannel = (typeof INSERT_QR_CHANNELS)[number];

export const INSERT_QR_CHANNEL_LABEL: Record<InsertQrChannel, string> = {
  shopee: 'Shopee',
  tiktok: 'TikTok Shop',
  lazada: 'Lazada',
};

/**
 * Bộ đọc nguồn (web, Mini App, API) ghép `card-<tag>` rồi kiểm ENTRY_TOKEN_PATTERN (tối đa 40 ký tự): tag dài hơn 35 bị bỏ âm thầm, nên
 * ô nhập chặn ở đây.
 */
export const INSERT_QR_TAG_MAX = 35;

/** Tag sau khi chuẩn hoá (chữ thường, bỏ khoảng trắng hai đầu); rỗng là không gắn đợt thẻ; `null` khi bộ đọc nguồn sẽ bỏ tag này. */
export function normalizeInsertTag(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return '';
  if (v.length > INSERT_QR_TAG_MAX) return null;
  const tag = normalizeEntryToken(v);
  if (!tag) return null;
  // Cùng luật với cardToken của entry-source: tag đã có tiền tố thì giữ nguyên, không thì ghép thêm.
  return normalizeEntryToken(tag.startsWith('card-') ? tag : `card-${tag}`) ? tag : null;
}

/** Số thứ tự thẻ trong link (`n=042`): chỉ chữ số, 1 tới 4 ký tự. Bộ đọc nguồn không biết tham số này nên báo cáo nguồn vẫn gom theo đợt `card`. */
const SERIAL_PATTERN = /^\d{1,4}$/;

/**
 * `${base}/quet-ma?utm_source=<kênh>&card=<tag>`; tag rỗng thì không có `card`. Kênh lạ hoặc tag bộ đọc nguồn không nhận: `null`.
 * `serial` (in hàng loạt, W58-03) thêm `&n=<số thứ tự>` để mỗi thẻ có mã riêng; số không hợp lệ cũng `null`.
 */
export function insertQrUrl(channel: string, tag: string, base: string = SITE_URL, serial?: string): string | null {
  if (!(INSERT_QR_CHANNELS as readonly string[]).includes(channel)) return null;
  const t = normalizeInsertTag(tag);
  if (t === null) return null;
  if (serial !== undefined && !SERIAL_PATTERN.test(serial)) return null;
  const params = new URLSearchParams({ utm_source: channel });
  if (t) params.set('card', t);
  if (serial !== undefined) params.set('n', serial);
  return `${base.replace(/\/+$/, '')}/quet-ma?${params.toString()}`;
}

/** Tên tệp tải về: `tubu-qr-shopee-box-2026-11.svg`. */
export function insertQrFileName(channel: InsertQrChannel, tag: string, ext: 'svg' | 'png'): string {
  const t = normalizeInsertTag(tag);
  return `tubu-qr-${channel}${t ? `-${t}` : ''}.${ext}`;
}

/** Lề trắng quanh mã theo chuẩn QR (4 ô): máy quét cần khoảng lặng này để tìm ba ô vuông định vị. */
const QUIET_ZONE = 4;

function qrModules(text: string): { size: number; dark: (x: number, y: number) => boolean } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  return { size: modules.size, dark: (x, y) => modules.data[y * modules.size + x] === 1 };
}

/** Đường vẽ các ô đen của mã (đơn vị ô, đã cộng lề lặng): mỗi hàng gom các ô đen liền nhau thành một đoạn, cả mã là MỘT `<path>`. */
export function qrPath(text: string): { full: number; d: string } {
  const { size, dark } = qrModules(text);
  let d = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; ) {
      if (!dark(x, y)) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < size && dark(x + run, y)) run++;
      d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${run}v1h-${run}z`;
      x += run;
    }
  }
  return { full: size + QUIET_ZONE * 2, d };
}

/**
 * SVG để in: `crispEdges` để máy in không làm nhoè mép ô. Kích thước khai bằng đơn vị ô (`viewBox`), phóng to bao nhiêu cũng nét.
 */
export function qrSvg(text: string): string {
  const { full, d } = qrPath(text);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full * 10}" height="${full * 10}" shape-rendering="crispEdges">` +
    `<rect width="${full}" height="${full}" fill="white"/><path fill="black" d="${d}"/></svg>`
  );
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * PNG vuông `px` điểm ảnh. Mỗi ô là một số nguyên điểm ảnh (`floor(px / số ô)`), phần lẻ dồn vào lề trắng hai bên, và tắt làm mịn ảnh:
 * mép ô không bị pha xám nên máy quét đọc được cả khi in nhỏ.
 */
export async function qrPngBlob(text: string, px = 1024): Promise<Blob> {
  const { size, dark } = qrModules(text);
  const full = size + QUIET_ZONE * 2;
  const scale = Math.floor(px / full);
  if (scale < 1) throw new Error('Ảnh quá nhỏ để vẽ mã QR.');
  const offset = Math.floor((px - full * scale) / 2) + QUIET_ZONE * scale;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không vẽ được ảnh.');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = 'black';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (dark(x, y)) ctx.fillRect(offset + x * scale, offset + y * scale, scale, scale);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Trình duyệt không xuất được ảnh PNG.'))), 'image/png');
  });
}

/** Tải tệp về máy (không mở tab mới). Thu hồi link tạm sau một nhịp để trình duyệt kịp bắt đầu tải. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

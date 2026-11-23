/**
 * Ảnh chia sẻ của CTV (Mini App và web): ảnh gian hàng có QR và thẻ giới thiệu từng sản phẩm (tên, giá, nhãn CTV, QR), vẽ trên canvas tại máy.
 * File này chỉ có hình học và chữ: không đụng `document`/`window`, nhận một ngữ cảnh vẽ tối thiểu (`PosterCtx`) và ma trận QR do app tự mã hoá
 * (web dùng thư viện `qrcode`, Mini App dùng `utils/qr-matrix.ts` không phụ thuộc). App tự tạo canvas, gọi `drawPoster` rồi xuất PNG.
 *
 * QR trỏ trang web công khai (`tubutree.com/s/<slug>`, `tubutree.com/san-pham/<slug>?ref=`): quét bằng camera điện thoại hay mở từ link trong
 * phần giới thiệu Facebook/TikTok đều vào thẳng trang, không bắt đăng nhập Zalo như link Mini App.
 */

import { fillCopy } from '../shop-copy';
import { vnd } from './money';
import { PUBLIC_WEB_ORIGIN, posterTarget, type PosterInput } from './share-poster-link';

export { PUBLIC_WEB_ORIGIN, kitReferralCode, posterTarget, posterUrl, type PosterInput } from './share-poster-link';

export const POSTER_W = 1080;
export const POSTER_H = 1350;

/**
 * Màu của ảnh. Canvas không đọc được biến CSS nên chép giá trị từ `packages/design-tokens/src/tokens.css` (spec so từng giá trị):
 * nền dải = forest-700 (`--color-bg-cover`), chữ trên dải = stone-50, chữ phụ trên dải = forest-100, nhãn = forest-50, chữ = stone-900/600.
 * QR luôn đen trên trắng: tương phản tối đa cho máy quét.
 */
export const POSTER_COLORS = {
  band: '#1B4B31',
  onBand: '#F6F4EF',
  soft: '#D6E6DA',
  chip: '#EEF4EF',
  page: '#F6F4EF',
  ink: '#1C1A16',
  muted: '#5A544A',
  card: '#FFFFFF',
  qr: '#000000',
} as const;

const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
/** Phông app chờ tải (`document.fonts.load`) trước khi vẽ, để chữ trên ảnh là Inter như trên trang. */
export const POSTER_FONT_PROBE = '700 64px Inter';
const PAD = 88;
const BAND_H = 900;
const CARD = 600;
const CARD_Y = 590;

/** Phần của `CanvasRenderingContext2D` mà ảnh cần (kiểu cấu trúc để app-core không phụ thuộc thư viện DOM và spec vẽ được bằng bản giả). */
export interface PosterCtx {
  fillStyle: unknown;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  closePath(): void;
  fill(): void;
}

/** Ma trận QR theo hàng: `modules[row * size + col]` khác 0 là module tối (khớp `QrMatrix` của Mini App và `BitMatrix.data` của `qrcode`). */
export interface PosterQr {
  size: number;
  modules: ArrayLike<number>;
}

export interface PosterContent {
  /** Dòng nhỏ trên cùng: thương hiệu của sản phẩm, hoặc "Tubu Tree". */
  kicker: string;
  /** Tên gian hàng hay sản phẩm; dài thì xuống dòng, quá số dòng thì cắt "…". */
  title: string;
  /** Giá đã định dạng ("129.000đ"), vẽ chữ số đều bề rộng như `tabular-nums`. */
  price?: string | null;
  /** Nhãn CTV kèm mã giới thiệu. */
  badge?: string | null;
  /** Lời mời quét dưới QR. */
  scan: string;
  /** Link in dưới lời mời (`posterLinkLabel`). */
  link: string;
}

/** Chữ link in dưới QR: bỏ giao thức, "www." và tham số (mã giới thiệu đã nằm trong QR), bỏ "/" cuối. */
export function posterLinkLabel(url: string): string {
  return url
    .replace(/^https?:\/\/(?:www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

/** Link QR, chữ vẽ trên ảnh và tên tệp tải về: một chỗ dựng cho cả hai app để ảnh giống nhau. */
export function posterContent(input: PosterInput, origin: string = PUBLIC_WEB_ORIGIN): { url: string; content: PosterContent; fileName: string } {
  const { url, ref } = posterTarget(input, origin);
  if (input.kind === 'store') {
    const slug = input.path.split('?')[0]!.split('/').filter(Boolean).pop();
    return {
      url,
      content: {
        kicker: fillCopy('poster.kicker'),
        title: input.title,
        badge: ref ? fillCopy('poster.badgeStore', { code: ref }) : null,
        scan: fillCopy('poster.scanStore'),
        link: posterLinkLabel(url),
      },
      fileName: `tubutree-${slug ?? 'qr'}.png`,
    };
  }
  const price = input.priceVnd ?? 0;
  return {
    url,
    content: {
      kicker: input.brandName?.trim() || fillCopy('poster.kicker'),
      title: input.name,
      price: price > 0 ? vnd(price) : null,
      badge: ref ? fillCopy('poster.badgeCtv', { code: ref }) : null,
      scan: fillCopy('poster.scanProduct'),
      link: posterLinkLabel(url),
    },
    fileName: `tubutree-${input.slug.replace(/[^\w-]+/g, '-')}.png`,
  };
}

/**
 * Ngắt chữ cho vừa `maxWidth`: theo khoảng trắng, từ dài hơn một dòng thì cắt theo ký tự. Thừa dòng thì dòng cuối cắt bớt và thêm "…".
 * `measure` là `ctx.measureText(s).width` với font đang đặt.
 */
export function wrapLines(measure: (s: string) => number, text: string, maxWidth: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = '';
  let cut = false;
  const push = (s: string) => {
    if (out.length < maxLines) out.push(s);
    else cut = true;
  };
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) push(line);
    line = '';
    for (const ch of word) {
      if (line && measure(line + ch) > maxWidth) {
        push(line);
        line = '';
      }
      line += ch;
    }
  }
  if (line) push(line);
  if (cut && maxLines > 0) {
    let last = out[maxLines - 1] ?? '';
    while (last && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
    out[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return out;
}

/** Vẽ chuỗi với mọi chữ số cùng bề rộng (canvas không có `font-variant-numeric`), căn trái tại `x`. */
export function fillTabular(ctx: PosterCtx, text: string, x: number, y: number): void {
  const m = (s: string) => ctx.measureText(s).width;
  const digit = Math.max(...[...'0123456789'].map(m));
  for (const ch of text) {
    const w = m(ch);
    const adv = /\d/.test(ch) ? digit : w;
    ctx.fillText(ch, x + (adv - w) / 2, y);
    x += adv;
  }
}

function roundRect(ctx: PosterCtx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/**
 * Vẽ ảnh 1080×1350 (4:5, khổ bài đăng Facebook/Zalo): dải xanh có dòng nhỏ, tên, giá và nhãn CTV căn giữa theo chiều dọc phía trên thẻ QR;
 * thẻ trắng giữa ảnh chứa QR (lề trắng ≥ 4 module ở mã thường gặp); dưới thẻ là lời mời quét và link.
 */
export function drawPoster(ctx: PosterCtx, c: PosterContent, qr: PosterQr): void {
  const C = POSTER_COLORS;
  const width = POSTER_W - PAD * 2;
  const font = (weight: number, px: number) => {
    ctx.font = `${weight} ${px}px ${FONT}`;
  };
  const measure = (s: string) => ctx.measureText(s).width;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);
  ctx.fillStyle = C.band;
  ctx.fillRect(0, 0, POSTER_W, BAND_H);

  const titlePx = c.price ? 64 : 72;
  const titleLh = Math.round(titlePx * 1.2);
  font(700, titlePx);
  const lines = wrapLines(measure, c.title, width, c.price ? 3 : 2);
  const blockH = 72 + lines.length * titleLh + (c.price ? 104 : 0) + (c.badge ? 88 : 0);
  let y = Math.max(64, (CARD_Y - 40 - blockH) / 2);

  font(600, 34);
  ctx.fillStyle = C.soft;
  ctx.fillText(wrapLines(measure, c.kicker, width, 1)[0] ?? '', PAD, y + 34);
  y += 72;

  font(700, titlePx);
  ctx.fillStyle = C.onBand;
  for (const l of lines) {
    ctx.fillText(l, PAD, y + titlePx);
    y += titleLh;
  }
  if (c.price) {
    font(800, 80);
    fillTabular(ctx, c.price, PAD, y + 96);
    y += 104;
  }
  if (c.badge) {
    font(600, 30);
    const text = wrapLines(measure, c.badge, width - 48, 1)[0] ?? '';
    ctx.fillStyle = C.chip;
    roundRect(ctx, PAD, y + 28, measure(text) + 48, 60, 30);
    ctx.fillStyle = C.band;
    ctx.fillText(text, PAD + 24, y + 68);
  }

  const cardX = (POSTER_W - CARD) / 2;
  ctx.fillStyle = C.card;
  roundRect(ctx, cardX, CARD_Y, CARD, CARD, 40);
  const scale = Math.max(1, Math.floor((CARD - 48) / (qr.size + 4)));
  const qrPx = scale * qr.size;
  const qx = cardX + Math.floor((CARD - qrPx) / 2);
  const qy = CARD_Y + Math.floor((CARD - qrPx) / 2);
  ctx.fillStyle = C.qr;
  for (let r = 0; r < qr.size; r++) {
    for (let col = 0; col < qr.size; col++) {
      if (qr.modules[r * qr.size + col]) ctx.fillRect(qx + col * scale, qy + r * scale, scale, scale);
    }
  }

  ctx.textAlign = 'center';
  font(700, 40);
  ctx.fillStyle = C.ink;
  ctx.fillText(wrapLines(measure, c.scan, width, 1)[0] ?? '', POSTER_W / 2, CARD_Y + CARD + 70);
  font(500, 30);
  ctx.fillStyle = C.muted;
  ctx.fillText(wrapLines(measure, c.link, width, 1)[0] ?? '', POSTER_W / 2, CARD_Y + CARD + 116);
}

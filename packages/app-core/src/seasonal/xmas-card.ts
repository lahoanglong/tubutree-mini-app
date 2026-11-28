import { GIFT_ART, TREE_ART } from './christmas-art';
import { ORNAMENT_ART, xmasTreeCopy as c, type OrnamentId } from './xmas-tree';

/**
 * Thiệp "Khoe cây thông" dạng ảnh PNG cho web (Web Share kèm tệp, hoặc tải về): vẽ lên canvas 2D cùng hình cây và món treo như thẻ đầu Vườn Xanh,
 * kèm lời chúc, tên khách và địa chỉ mời. Mini App không dùng ảnh (Zalo chỉ nhận ảnh thu nhỏ là URL http), nên mô-đun này chỉ nằm trong chunk web.
 * Màu do app đọc từ biến `--xmas-*` của `seasonal-christmas.css`, để ảnh cùng bảng màu với giao diện.
 */
export const XMAS_CARD_SIZE = { w: 720, h: 960 } as const;

export interface XmasCardPalette {
  nightDeep: string;
  night: string;
  pineDeep: string;
  pine: string;
  pineLight: string;
  snow: string;
  berry: string;
  berryDeep: string;
  gold: string;
  bark: string;
  fawn: string;
}

export const XMAS_CARD_PALETTE_VARS: Record<keyof XmasCardPalette, string> = {
  nightDeep: '--xmas-night-deep',
  night: '--xmas-night',
  pineDeep: '--xmas-pine-deep',
  pine: '--xmas-pine',
  pineLight: '--xmas-pine-light',
  snow: '--xmas-snow',
  berry: '--xmas-berry',
  berryDeep: '--xmas-berry-deep',
  gold: '--xmas-gold',
  bark: '--xmas-bark',
  fawn: '--xmas-fawn',
};

/**
 * Phần canvas 2D thiệp cần; `CanvasRenderingContext2D` của trình duyệt khớp kiểu này với `P = Path2D`. Tự khai (app-core không nạp lib DOM),
 * nên test giả được.
 */
export interface XmasCardCtx<P> {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  fill(path: P): void;
  stroke(): void;
  stroke(path: P): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void };
}

export interface XmasCardInput {
  name: string;
  on: readonly OrnamentId[];
  /** Địa chỉ mời đã kèm mã giới thiệu, in ở chân thiệp (bỏ phần giao thức). */
  link: string;
  palette: XmasCardPalette;
}

/** Ngắt dòng theo bề rộng đo được; một từ quá dài vẫn đứng riêng một dòng. */
export function wrapLines(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const TREE_SCALE = 4.4;
// Khung cây của Vườn Xanh là '-22 0 140 120': dời 22 đơn vị để tuần lộc bên trái chậu không bị cắt.
const TREE_X = (XMAS_CARD_SIZE.w - 140 * TREE_SCALE) / 2 + 22 * TREE_SCALE;
const TREE_Y = 64;
const STARS = [
  [60, 70, 2],
  [180, 36, 1.6],
  [640, 54, 2],
  [520, 120, 1.4],
  [90, 300, 1.4],
  [668, 340, 1.8],
] as const;

function dot<P>(ctx: XmasCardCtx<P>, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** Vẽ cả thiệp. `path` đổi chuỗi path SVG ra `Path2D` (trình duyệt: `(d) => new Path2D(d)`). Món chưa treo không vẽ, đúng như cây trên thẻ. */
export function drawXmasCard<P>(ctx: XmasCardCtx<P>, path: (d: string) => P, o: XmasCardInput): void {
  const { w, h } = XMAS_CARD_SIZE;
  const p = o.palette;
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, p.nightDeep);
  sky.addColorStop(0.6, p.night);
  sky.addColorStop(1, p.pineDeep);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  for (const [x, y, r] of STARS) dot(ctx, x, y, r, p.snow);

  ctx.save();
  ctx.translate(TREE_X, TREE_Y);
  ctx.scale(TREE_SCALE, TREE_SCALE);
  const fill = (d: string, color: string) => {
    ctx.fillStyle = color;
    ctx.fill(path(d));
  };
  const line = (d: string, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.stroke(path(d));
  };
  fill(TREE_ART.trunk, p.bark);
  const tiers = [p.pineLight, p.pine, p.pineDeep];
  for (const i of [2, 1, 0]) {
    fill(TREE_ART.tiers[i]!, tiers[i]!);
    line(TREE_ART.snow[i]!, p.snow, 1.8);
  }
  fill(TREE_ART.potRim, p.berryDeep);
  fill(TREE_ART.pot, p.berry);
  fill(TREE_ART.leaf, p.snow);
  const has = (id: OrnamentId) => o.on.includes(id);
  if (has('lights')) for (const [x, y] of TREE_ART.lights) dot(ctx, x, y, 1.8, p.gold);
  if (has('baubles')) for (const [x, y] of TREE_ART.berries) dot(ctx, x, y, 2.4, p.berry);
  if (has('wreath')) {
    const [x, y, r] = ORNAMENT_ART.wreath.ring;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = p.pineLight;
    ctx.lineWidth = 3;
    ctx.stroke();
    fill(ORNAMENT_ART.wreath.bow, p.berry);
  }
  if (has('gifts'))
    for (const [x, y, s] of ORNAMENT_ART.gifts) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s / 40, s / 40);
      fill(GIFT_ART.body, p.berry);
      fill(GIFT_ART.lid, p.berry);
      fill(GIFT_ART.ribbonBody, p.gold);
      fill(GIFT_ART.ribbonLid, p.gold);
      fill(GIFT_ART.bow, p.gold);
      ctx.restore();
    }
  if (has('reindeer')) {
    const r = ORNAMENT_ART.reindeer;
    line(r.legs, p.fawn, 1.6);
    fill(r.body, p.fawn);
    line(r.antlers, p.fawn, 1.2);
    dot(ctx, r.head[0], r.head[1], r.head[2], p.fawn);
    dot(ctx, r.nose[0], r.nose[1], r.nose[2], p.berry);
  }
  if (has('star')) fill(TREE_ART.star, p.gold);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let y = TREE_Y + 120 * TREE_SCALE + 72;
  ctx.fillStyle = p.gold;
  ctx.font = '700 44px Fraunces, Georgia, serif';
  ctx.fillText(c.greeting, w / 2, y);
  ctx.fillStyle = p.snow;
  ctx.font = '600 30px Inter, system-ui, sans-serif';
  for (const l of wrapLines((s) => ctx.measureText(s).width, c.cardLine(o.name, o.on.length), w - 96)) {
    y += 44;
    ctx.fillText(l, w / 2, y);
  }
  ctx.font = '500 26px Inter, system-ui, sans-serif';
  y += 48;
  ctx.fillText(c.cardInvite, w / 2, y);
  ctx.fillStyle = p.gold;
  ctx.font = '600 24px Inter, system-ui, sans-serif';
  ctx.fillText(o.link.replace(/^https?:\/\//, ''), w / 2, h - 40);
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.resolve(here, '..');
const TOKENS_CSS = path.resolve(SRC, '../../../packages/design-tokens/src/tokens.css');

export type Rgb = [number, number, number];

/** Giá trị đầu tiên của một biến CSS trong file (khối :root sáng đứng trước các khối theme tối). */
export function firstDecl(css: string, name: string): string | null {
  const m = new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`).exec(css);
  return m ? m[1]!.trim() : null;
}

export function readText(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

const tokens = () => readText(TOKENS_CSS);

/** Giải chuỗi `var()` lồng nhau qua tokens.css (và `extra` nếu truyền) về một mã màu cuối. */
export function resolveColor(value: string, extra = ''): string {
  let v = value.trim();
  for (let i = 0; i < 8; i++) {
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(v);
    if (!m) return v;
    const next = firstDecl(extra, m[1]!) ?? firstDecl(tokens(), m[1]!);
    if (!next) throw new Error(`không giải được ${m[1]}`);
    v = next;
  }
  return v;
}

export function parseColor(c: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  const rgba = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(c.trim());
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  throw new Error(`không đọc được màu: ${c}`);
}

export function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function lerp(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgb;
}

/** Phủ `top` (có alpha) lên `bottom`. */
export function over(top: { rgb: Rgb; alpha: number }, bottom: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(top.rgb[i]! * top.alpha + bottom[i]! * (1 - top.alpha))) as Rgb;
}

export function tokenRgb(name: string): Rgb {
  const v = firstDecl(tokens(), name);
  if (!v) throw new Error(`không có token ${name}`);
  return parseColor(resolveColor(v)).rgb;
}

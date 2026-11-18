#!/usr/bin/env node
/**
 * So AVIF với WebP đang phát (`/api/img`, sharp webp q78) trên ảnh sản phẩm thật, ở bề rộng 320 và 640: byte, thời gian mã hoá lần đầu và độ
 * giống ảnh gốc (PSNR so với bản đổi cỡ không nén). Chất lượng AVIF được chọn bằng số: mức thấp nhất có PSNR trung vị không kém WebP q78.
 * Chỉ đọc API công khai (GET danh sách sản phẩm) và tải ảnh nguồn công khai; không ghi gì lên máy chủ.
 *
 *   node scripts/perf/avif-compare.mjs --out <thư-mục> [--api https://api.tubutree.com/api] [--n 30]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sharp = createRequire(join(ROOT, 'apps/api/package.json'))('sharp');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const API = args.api ?? 'https://api.tubutree.com/api';
const N = Number(args.n ?? 30);
const OUT = resolve(args.out ?? 'avif-compare');
const SRC = join(OUT, 'src');
mkdirSync(SRC, { recursive: true });
sharp.concurrency(1);

const WIDTHS = [320, 640];
const AVIF_QUALITIES = [40, 45, 50, 55, 60];
const AVIF_EFFORT = Number(args.effort ?? 4);

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

async function sources() {
  const res = await fetch(`${API}/products?limit=${N}&page=1`, { headers: { accept: 'application/json' } });
  const body = await res.json();
  const urls = (body.data ?? []).map((p) => p.thumbnail).filter((u) => typeof u === 'string' && u.startsWith('https://'));
  const files = [];
  for (const [i, u] of urls.slice(0, N).entries()) {
    const file = join(SRC, `${String(i).padStart(2, '0')}.bin`);
    if (!existsSync(file)) writeFileSync(file, Buffer.from(await (await fetch(u)).arrayBuffer()));
    files.push(file);
  }
  return files;
}

/** PSNR (dB) của ảnh đã nén so với ảnh tham chiếu cùng cỡ, trên 3 kênh RGB. */
async function psnr(ref, encoded) {
  const a = await sharp(ref.data, { raw: ref.info }).removeAlpha().raw().toBuffer();
  const b = await sharp(encoded).removeAlpha().raw().toBuffer();
  let se = 0;
  for (let i = 0; i < a.length; i++) se += (a[i] - b[i]) ** 2;
  const mse = se / a.length;
  return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);
}

async function timed(fn) {
  const t = performance.now();
  const data = await fn();
  return { data, ms: performance.now() - t };
}

const files = await sources();
const rows = [];
for (const file of files) {
  const input = readFileSync(file);
  for (const width of WIDTHS) {
    const base = () => sharp(input, { failOn: 'error' }).rotate().resize({ width, withoutEnlargement: true });
    const ref = await base().removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const webp = await timed(() => base().webp({ quality: 78 }).toBuffer());
    const jpeg = await timed(() => base().jpeg({ quality: 80, mozjpeg: true }).toBuffer());
    const row = { file, width, webp: webp.data.length, webpMs: webp.ms, webpPsnr: await psnr(ref, webp.data), jpeg: jpeg.data.length, avif: {} };
    for (const q of AVIF_QUALITIES) {
      const avif = await timed(() => base().avif({ quality: q, effort: AVIF_EFFORT }).toBuffer());
      row.avif[q] = { bytes: avif.data.length, ms: avif.ms, psnr: await psnr(ref, avif.data) };
      if (width === 640 && q === 50 && rows.length < 12) writeFileSync(join(OUT, `${String(rows.length).padStart(2, '0')}-640.avif`), avif.data);
    }
    if (width === 640 && rows.length < 12) writeFileSync(join(OUT, `${String(rows.length).padStart(2, '0')}-640.webp`), webp.data);
    rows.push(row);
  }
}

const summary = {};
for (const width of WIDTHS) {
  const rs = rows.filter((r) => r.width === width);
  const webpPsnr = median(rs.map((r) => r.webpPsnr));
  const perQ = AVIF_QUALITIES.map((q) => ({
    q,
    psnr: median(rs.map((r) => r.avif[q].psnr)),
    savedPct: median(rs.map((r) => (1 - r.avif[q].bytes / r.webp) * 100)),
    ms: median(rs.map((r) => r.avif[q].ms)),
    maxMs: Math.max(...rs.map((r) => r.avif[q].ms)),
  }));
  const pick = perQ.find((p) => p.psnr >= webpPsnr) ?? null;
  summary[width] = {
    images: rs.length,
    webpBytes: median(rs.map((r) => r.webp)),
    jpegBytes: median(rs.map((r) => r.jpeg)),
    webpPsnr,
    webpMs: median(rs.map((r) => r.webpMs)),
    avif: perQ,
    pick,
  };
}
writeFileSync(join(OUT, 'avif-compare.json'), JSON.stringify({ api: API, effort: AVIF_EFFORT, summary, rows }, null, 2));
for (const [width, s] of Object.entries(summary)) {
  console.log(`w=${width}: ${s.images} ảnh, WebP q78 trung vị ${s.webpBytes} B (PSNR ${s.webpPsnr.toFixed(2)} dB, ${s.webpMs.toFixed(0)} ms), JPEG ${s.jpegBytes} B`);
  for (const p of s.avif) console.log(`  AVIF q${p.q} effort ${AVIF_EFFORT}: PSNR ${p.psnr.toFixed(2)} dB, nhỏ hơn WebP ${p.savedPct.toFixed(1)}% (trung vị), mã hoá ${p.ms.toFixed(0)} ms (tối đa ${p.maxMs.toFixed(0)} ms)`);
  console.log(`  → mức AVIF thấp nhất không kém WebP: ${s.pick ? `q${s.pick.q}, nhỏ hơn ${s.pick.savedPct.toFixed(1)}%` : 'không có'}`);
}

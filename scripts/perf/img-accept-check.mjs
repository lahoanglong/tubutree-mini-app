#!/usr/bin/env node
/**
 * Kiểm ảnh sản phẩm hiện đúng trên Chromium và WebKit sau khi `/api/img` thêm AVIF: mỗi trình duyệt gửi `Accept` của chính nó, máy chủ chọn định dạng bằng
 * `negotiateFormat` THẬT của API và mã hoá bằng đúng tham số của ImageResizeService (AVIF q50 effort 2, WebP q78, JPEG q80 mozjpeg), rồi trang kiểm ảnh giải mã
 * được (naturalWidth > 0). Trình duyệt chỉ được nhận AVIF khi nó giải mã được AVIF (kiểm riêng bằng `/probe.avif`).
 *
 *   apps/api/node_modules/.bin/tsx scripts/perf/img-accept-check.mjs --src anh.jpg [--out ket-qua.json]
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sharp = createRequire(join(ROOT, 'apps/api/package.json'))('sharp');
const { chromium, webkit } = createRequire(join(ROOT, 'apps/e2e/package.json'))('@playwright/test');
const { negotiateFormat, FORMAT_MIME } = await import(join(ROOT, 'apps/api/src/modules/catalog/image-resize.ts'));

const arg = (name, fallback = '') => {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const src = readFileSync(arg('--src'));
const out = arg('--out');

async function encode(format) {
  const pipeline = sharp(src).rotate().resize({ width: 320, withoutEnlargement: true });
  if (format === 'avif') return pipeline.avif({ quality: 50, effort: 2 }).toBuffer();
  if (format === 'webp') return pipeline.webp({ quality: 78 }).toBuffer();
  return pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
}
const probe = await encode('avif');

const seen = [];
const server = createServer(async (req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><img id="p" src="/img/p.jpg" width="320">');
    return;
  }
  if (req.url === '/probe.avif') {
    res.writeHead(200, { 'content-type': 'image/avif' });
    res.end(probe);
    return;
  }
  if (req.url?.startsWith('/img/')) {
    const format = negotiateFormat(req.headers.accept);
    const body = await encode(format);
    seen.push({ accept: req.headers.accept ?? '', format, bytes: body.length });
    res.writeHead(200, { 'content-type': FORMAT_MIME[format], vary: 'Accept', 'cache-control': 'public, max-age=31536000, immutable' });
    res.end(body);
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
for (const [name, type] of [
  ['chromium', chromium],
  ['webkit', webkit],
]) {
  const browser = await type.launch();
  const page = await browser.newPage();
  seen.length = 0;
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('p')?.complete === true);
  const naturalWidth = await page.evaluate(() => document.getElementById('p').naturalWidth);
  const avifDecodes = await page.evaluate(
    () =>
      new Promise((r) => {
        const i = new Image();
        i.onload = () => r(i.naturalWidth > 0);
        i.onerror = () => r(false);
        i.src = '/probe.avif';
      }),
  );
  const version = browser.version();
  await browser.close();
  const served = seen[0];
  results.push({ browser: name, version, accept: served?.accept, served: served?.format, bytes: served?.bytes, naturalWidth, avifDecodes });
}
server.close();

for (const r of results) console.log(`${r.browser} ${r.version}: Accept "${r.accept}" → ${r.served} ${r.bytes} B, naturalWidth ${r.naturalWidth}, giải mã được AVIF: ${r.avifDecodes}`);
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
const bad = results.filter((r) => !(r.naturalWidth > 0) || (r.served === 'avif' && !r.avifDecodes));
if (bad.length > 0) {
  console.error(`Ảnh không hiện: ${bad.map((b) => b.browser).join(', ')}`);
  process.exit(1);
}

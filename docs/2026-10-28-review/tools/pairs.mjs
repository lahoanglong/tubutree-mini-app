#!/usr/bin/env node
// Ảnh ghép cặp: Mini App 375 (trái) và web 375 (phải), persona returning, đoạn s1. Ghi screens/pairs/<khoá>.png và pairs/index.html.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../scripts/uiux/lib/pw.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = path.resolve(HERE, '../screens');
const OUT = path.join(SCREENS, 'pairs');
const R = JSON.parse(fs.readFileSync(path.join(HERE, 'routes.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 860, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const made = [];
const missing = [];
for (const key of R.pairs) {
  const route = R.routes.find((r) => r.key === key);
  const left = `mini375/${key}__returning__mini375__s1.png`;
  const right = `web375/${key}__returning__web375__s1.png`;
  if (!fs.existsSync(path.join(SCREENS, left)) || !fs.existsSync(path.join(SCREENS, right))) {
    missing.push(key);
    continue;
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#2b2b2b;font:14px/1.3 system-ui,sans-serif;color:#fff;padding:16px;display:flex;gap:30px;justify-content:center}
figure{margin:0;width:375px}figcaption{font-weight:600;margin-bottom:8px}figcaption small{display:block;font-weight:400;color:#bbb;word-break:break-all}
img{width:375px;height:auto;display:block;border:1px solid #555;background:#fff}</style>
<figure><figcaption>Mini App 375<small>${esc(route.mini)}</small></figcaption><img src="../${left}"></figure>
<figure><figcaption>Web 375<small>${esc(route.web)}</small></figcaption><img src="../${right}"></figure>`;
  const tmp = path.join(OUT, `_${key}.html`);
  fs.writeFileSync(tmp, html);
  await page.goto(`file://${tmp}`);
  await page.waitForLoadState('load');
  await page.screenshot({ path: path.join(OUT, `${key}.png`), fullPage: true });
  fs.unlinkSync(tmp);
  made.push({ key, mini: route.mini, web: route.web });
}
await browser.close();
const idx = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Ảnh ghép Mini App và web</title><style>
body{font:15px system-ui,sans-serif;margin:20px;background:#f4f4f4}h1{font-size:20px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:18px}
a{display:block;background:#fff;padding:10px;border-radius:8px;text-decoration:none;color:#222}img{width:100%}b{display:block;margin-bottom:6px}</style>
<h1>Ảnh ghép Mini App 375 (trái) và web 375 (phải), persona returning, đoạn đầu trang (${made.length} cặp)</h1>
<div class="g">${made.map((m) => `<a href="${m.key}.png"><b>${esc(m.key)}</b><img loading="lazy" src="${m.key}.png"></a>`).join('\n')}</div>
${missing.length ? `<p>Thiếu ảnh nên không ghép: ${missing.map(esc).join(', ')}</p>` : ''}</html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), idx);
fs.writeFileSync(path.join(OUT, 'pairs.json'), JSON.stringify({ made: made.length, missing }, null, 2));
console.log(`ghép ${made.length} cặp, thiếu ${missing.length}: ${missing.join(', ')}`);

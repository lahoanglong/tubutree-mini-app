#!/usr/bin/env node
// Ghép ảnh chụp Mini App với ảnh web theo packages/app-core/src/route-map.json và sinh pairs.json + index.html.
// Dùng: node apps/e2e/scripts/visual-pairs.mjs <VISUAL_DIR>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] || process.env.VISUAL_DIR;
if (!dir) {
  console.error('Thiếu thư mục ảnh: visual-pairs.mjs <VISUAL_DIR>');
  process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const map = JSON.parse(readFileSync(path.join(root, 'packages/app-core/src/route-map.json'), 'utf8'));

function readIndex(app) {
  const f = path.join(dir, app, 'index.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function splitRoute(r) {
  const [p, q] = r.split('?');
  const tab = q ? new URLSearchParams(q).get('tab') : null;
  return { p: p.length > 1 ? p.replace(/\/+$/, '') : p, tab };
}

// Tham số động `:id` hoặc `[code]` khớp đúng một đoạn path.
function toRegex(p) {
  const src = p
    .split('/')
    .map((seg) => (/^:\w+$/.test(seg) || /^\[\.{0,3}\w+\]$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${src}$`);
}

function findImage(entries, route, used) {
  const { p, tab } = splitRoute(route);
  const re = toRegex(p);
  const hits = entries.filter((e) => {
    const s = splitRoute(e.pathname);
    return re.test(s.p) && s.tab === tab;
  });
  hits.forEach((h) => used.add(h.file));
  return hits.length ? hits[0].file : null;
}

const mini = readIndex('miniapp');
const web = readIndex('web');
const usedMini = new Set();
const usedWeb = new Set();
const pairs = [];
const skipped = [];
for (const lane of map.routes) {
  for (const it of lane.items) {
    if (it.skip) {
      skipped.push({ miniapp: it.miniapp, reason: it.skip });
      continue;
    }
    pairs.push({
      lane: lane.lane,
      miniappRoute: it.miniapp,
      webRoute: it.web,
      private: !!it.private,
      miniappImage: findImage(mini, it.miniapp, usedMini),
      webImage: findImage(web, it.web, usedWeb),
    });
  }
}
const unmatched = {
  miniapp: mini.filter((e) => !usedMini.has(e.file)).map((e) => e.pathname),
  web: web.filter((e) => !usedWeb.has(e.file)).map((e) => e.pathname),
};
writeFileSync(path.join(dir, 'pairs.json'), JSON.stringify({ pairs, skipped, unmatched }, null, 2));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cell = (app, file, label) =>
  file
    ? `<a href="${esc(app)}/${esc(file.replace(/\.jpg$/, '.full.jpg'))}" target="_blank" title="Mở ảnh full-page"><img loading="lazy" src="${esc(app)}/${esc(file)}" alt="${esc(label)}"></a>`
    : '<div class="none">Không có ảnh</div>';
const both = pairs.filter((p) => p.miniappImage && p.webImage);
const rows = pairs
  .map(
    (p) => `<section class="row${p.miniappImage && p.webImage ? '' : ' partial'}">
<h2><span>Mini App <code>${esc(p.miniappRoute)}</code></span><span>Web <code>${esc(p.webRoute)}</code></span><small>${esc(p.lane)}${p.private ? ' · cần đăng nhập' : ''}</small></h2>
<div class="cols"><figure><figcaption>Mini App</figcaption>${cell('miniapp', p.miniappImage, p.miniappRoute)}</figure><figure><figcaption>Web</figcaption>${cell('web', p.webImage, p.webRoute)}</figure></div>
</section>`,
  )
  .join('\n');
const li = (a) => (a.length ? a.map((x) => `<li><code>${esc(x)}</code></li>`).join('') : '<li>(không có)</li>');
const onlyMini = pairs.filter((p) => p.miniappImage && !p.webImage);
const onlyWeb = pairs.filter((p) => !p.miniappImage && p.webImage);
const none = pairs.filter((p) => !p.miniappImage && !p.webImage);
const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>So sánh Mini App và web khổ điện thoại</title>
<style>
body{margin:0;padding:16px;font:14px/1.4 system-ui,sans-serif;background:#f3f1ec;color:#222}
h1{font-size:20px}.row{background:#fff;border-radius:8px;padding:12px;margin:0 0 16px;box-shadow:0 1px 3px #0002}
.row.partial{outline:2px solid #e0a030}
h2{font-size:14px;margin:0 0 8px;display:flex;gap:24px;flex-wrap:wrap;align-items:baseline}h2 small{color:#777;font-weight:400}
.cols{display:flex;gap:16px;align-items:flex-start;overflow-x:auto}
figure{margin:0;flex:0 0 390px}figcaption{font-weight:600;margin-bottom:4px}
img{width:390px;display:block;border:1px solid #ccc;border-radius:6px}
.none{width:390px;height:120px;display:flex;align-items:center;justify-content:center;border:1px dashed #bbb;color:#999;border-radius:6px}
code{background:#eee;padding:1px 4px;border-radius:3px}
</style></head><body>
<h1>So sánh Mini App (trái) và web (phải), khổ 390x844</h1>
<p>${pairs.length} route, ${both.length} cặp đủ hai bên. Bấm ảnh để mở ảnh full-page.</p>
${rows}
<section class="row"><h2>Route thiếu ảnh</h2>
<h3>Chỉ có Mini App (thiếu web)</h3><ul>${li(onlyMini.map((p) => `${p.miniappRoute} ↔ ${p.webRoute}`))}</ul>
<h3>Chỉ có web (thiếu Mini App)</h3><ul>${li(onlyWeb.map((p) => `${p.miniappRoute} ↔ ${p.webRoute}`))}</ul>
<h3>Không bên nào có ảnh</h3><ul>${li(none.map((p) => `${p.miniappRoute} ↔ ${p.webRoute}`))}</ul>
<h3>Bỏ qua theo route-map (skip)</h3><ul>${li(skipped.map((s) => `${s.miniapp}: ${s.reason}`))}</ul>
<h3>Ảnh không khớp route nào</h3><ul>${li([...unmatched.miniapp.map((x) => `Mini App ${x}`), ...unmatched.web.map((x) => `web ${x}`)])}</ul>
</section></body></html>
`;
writeFileSync(path.join(dir, 'index.html'), html);
console.log(`miniapp=${mini.length} web=${web.length} cặp đủ hai bên=${both.length}/${pairs.length} -> ${path.join(dir, 'index.html')}`);

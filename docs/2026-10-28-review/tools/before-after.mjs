#!/usr/bin/env node
// Ảnh trước/sau cho một gói: mỗi màn một ảnh 4 cột (Mini App trước | Mini App sau | web trước | web sau), khổ 375.
// Dùng: node before-after.mjs --before <thư mục screens trước> --after <thư mục screens sau> --out <thư mục ra>
//        [--keys home,cart] [--persona returning] [--state ok|error500|...] [--shot s1]
// Thiếu một trong bốn ảnh thì ô đó ghi "không có" (màn chỉ có ở một nền), không bỏ cả màn.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../../../scripts/uiux/lib/pw.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const before = path.resolve(opt('--before', ''));
const after = path.resolve(opt('--after', ''));
const out = path.resolve(opt('--out', ''));
const persona = opt('--persona', 'returning');
const state = opt('--state', 'ok');
const shot = opt('--shot', 's1');
if (!opt('--before') || !opt('--after') || !opt('--out')) {
  console.error('cần --before, --after, --out');
  process.exit(1);
}
const label = (vp) => (state === 'ok' ? vp : `${vp}-${state}`);
const file = (root, vp, key) => path.join(root, label(vp), `${key}__${persona}__${label(vp)}__${shot}.png`);
const keysArg = opt('--keys', '');
const keys = keysArg
  ? keysArg.split(',').filter(Boolean)
  : [...new Set(fs.readdirSync(path.join(after, label('mini375'))).concat(fs.existsSync(path.join(after, label('web375'))) ? fs.readdirSync(path.join(after, label('web375'))) : [])
      .filter((f) => f.includes(`__${persona}__`) && f.endsWith(`__${shot}.png`)).map((f) => f.split('__')[0]))];
fs.mkdirSync(out, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const cell = (title, p) => `<figure><figcaption>${esc(title)}</figcaption>${fs.existsSync(p) ? `<img src="file://${p}">` : '<div class="none">không có</div>'}</figure>`;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1640, height: 900 }, deviceScaleFactor: 1 })).newPage();
const made = [];
for (const key of keys) {
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#2b2b2b;font:14px/1.3 system-ui,sans-serif;color:#fff;padding:16px}
h1{font-size:16px;margin:0 0 10px}.row{display:flex;gap:16px}
figure{margin:0;width:375px}figcaption{font-weight:600;margin-bottom:6px}
img{width:375px;height:auto;display:block;border:1px solid #555;background:#fff}
.none{width:375px;height:200px;border:1px dashed #777;display:flex;align-items:center;justify-content:center;color:#aaa}</style>
<h1>${esc(key)} · ${esc(persona)} · ${esc(state)} · ${esc(shot)}</h1><div class="row">
${cell('Mini App trước', file(before, 'mini375', key))}${cell('Mini App sau', file(after, 'mini375', key))}
${cell('Web trước', file(before, 'web375', key))}${cell('Web sau', file(after, 'web375', key))}</div>`;
  const tmp = path.join(out, `_${key}.html`);
  fs.writeFileSync(tmp, html);
  await page.goto(`file://${tmp}`);
  await page.waitForLoadState('load');
  const name = `${key}__${persona}__${state}__${shot}.png`;
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  fs.unlinkSync(tmp);
  made.push(name);
}
await browser.close();
console.log(`ghép ${made.length} màn vào ${out}`);

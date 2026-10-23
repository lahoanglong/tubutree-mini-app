// Ghép ảnh chụp thành tờ xem nhanh (không có PIL/ImageMagick trên máy): dùng Chromium vẽ lại rồi chụp.
//   node docs/2026-10-20-uat/tools/uiux/sheet.mjs tiles  <id> [state] [engine]  -> cắt ảnh dài thành lát 390x800, tối đa 4 lát/tờ
//   node docs/2026-10-20-uat/tools/uiux/sheet.mjs states <id>                   -> 4 trạng thái empty/loading/error/offline, phần đầu 844px
//   node docs/2026-10-20-uat/tools/uiux/sheet.mjs pair   <id> [state]           -> Chromium | WebKit cạnh nhau, lát 800px
//   node docs/2026-10-20-uat/tools/uiux/sheet.mjs tops   <tên> id1,id2,...       -> 844px đầu của nhiều màn normal, 4 màn/tờ
// Ghi: docs/2026-10-20-uat/screens/sheets/<...>.png
import fs from 'node:fs';
import path from 'node:path';
import { chromium, ROOT } from './lib/pw.mjs';

const SHOTS = path.join(ROOT, 'docs/2026-10-20-uat/screens/miniapp');
const OUT = path.join(ROOT, 'docs/2026-10-20-uat/screens/sheets');
fs.mkdirSync(OUT, { recursive: true });

const pngSize = (f) => {
  const b = fs.readFileSync(f);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const uri = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
const shot = (id, state, engine) => path.join(SHOTS, `${id}__${state}__390${engine === 'webkit' ? '__webkit' : ''}.png`);

/** cells: [{file, y, h, label}] -> một tờ ngang. */
async function compose(browser, cells, outName) {
  const W = 390;
  const GAP = 6;
  const H = Math.max(...cells.map((c) => c.h)) + 18;
  const width = cells.length * W + (cells.length - 1) * GAP;
  const page = await browser.newPage({ viewport: { width, height: H } });
  const html = `<body style="margin:0;background:#888;display:flex;gap:${GAP}px;font:11px sans-serif">${cells
    .map(
      (c) =>
        `<div style="width:${W}px"><div style="height:18px;color:#fff;background:#222;padding:0 4px">${c.label}</div><div style="width:${W}px;height:${c.h}px;background:url(${uri(c.file)}) 0 -${c.y}px no-repeat #fff"></div></div>`,
    )
    .join('')}</body>`;
  await page.setContent(html);
  const out = path.join(OUT, outName);
  await page.screenshot({ path: out });
  await page.close();
  return path.relative(ROOT, out);
}

const [mode, id, a1, a2] = process.argv.slice(2);
const browser = await chromium.launch();
const outs = [];
if (mode === 'tiles') {
  const state = a1 ?? 'normal';
  const engine = a2 ?? 'chromium';
  const f = shot(id, state, engine);
  const { h } = pngSize(f);
  const T = h <= 900 ? h : 800;
  const cells = [];
  for (let y = 0; y < h; y += T) cells.push({ file: f, y, h: Math.min(T, h - y), label: `${id} ${state} ${engine} y=${y}` });
  for (let i = 0; i < cells.length; i += 4) outs.push(await compose(browser, cells.slice(i, i + 4), `${id}__${state}${engine === 'webkit' ? '__webkit' : ''}__p${i / 4 + 1}.png`));
} else if (mode === 'states') {
  const cells = [];
  for (const st of ['empty', 'loading', 'error', 'offline']) {
    const f = shot(id, st);
    if (!fs.existsSync(f)) continue;
    cells.push({ file: f, y: 0, h: Math.min(844, pngSize(f).h), label: `${id} ${st}` });
  }
  if (cells.length) outs.push(await compose(browser, cells, `${id}__states.png`));
} else if (mode === 'tops') {
  // tops <tên tờ> id1,id2,... : phần đầu 844px trạng thái normal của nhiều màn, 4 màn một tờ.
  const ids = (a1 ?? '').split(',').filter(Boolean);
  const cells = ids.filter((x) => fs.existsSync(shot(x, 'normal'))).map((x) => ({ file: shot(x, 'normal'), y: 0, h: Math.min(844, pngSize(shot(x, 'normal')).h), label: `${x} normal` }));
  for (let i = 0; i < cells.length; i += 4) outs.push(await compose(browser, cells.slice(i, i + 4), `${id}__tops${i / 4 + 1}.png`));
} else if (mode === 'pair') {
  const state = a1 ?? 'normal';
  const fc = shot(id, state, 'chromium');
  const fw = shot(id, state, 'webkit');
  const h = Math.min(pngSize(fc).h, pngSize(fw).h, 1600);
  const cells = [];
  for (let y = 0; y < h; y += 800) {
    cells.push({ file: fc, y, h: Math.min(800, h - y), label: `${id} chromium y=${y}` });
    cells.push({ file: fw, y, h: Math.min(800, h - y), label: `${id} webkit y=${y}` });
  }
  outs.push(await compose(browser, cells, `${id}__${state}__pair.png`));
}
await browser.close();
console.log(outs.join('\n'));

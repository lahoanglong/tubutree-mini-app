#!/usr/bin/env node
// Tổng hợp screens/index.jsonl thành screens/SUMMARY.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = path.resolve(HERE, '../screens');
const R = JSON.parse(fs.readFileSync(path.join(HERE, 'routes.json'), 'utf8'));
const lines = fs.readFileSync(path.join(SCREENS, 'index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const pairsInfo = fs.existsSync(path.join(SCREENS, 'pairs/pairs.json')) ? JSON.parse(fs.readFileSync(path.join(SCREENS, 'pairs/pairs.json'), 'utf8')) : null;

const failed = lines.filter((l) => l.error);
const okLines = lines.filter((l) => !l.error);
const imgs = (ls) => ls.reduce((n, l) => n + l.files.length, 0);

const rows = [];
const group = {};
for (const l of okLines) {
  const k = `${l.app} ${l.vp}`;
  (group[k] ||= []).push(l);
}
for (const [k, ls] of Object.entries(group).sort()) {
  const st = {};
  for (const l of ls) st[l.state] = (st[l.state] ?? 0) + 1;
  rows.push(`| ${k} | ${ls.length} | ${imgs(ls)} | ${Object.entries(st).map(([a, b]) => `${a} ${b}`).join(', ')} |`);
}

const normPath = (p) => p.split('?')[0].replace(/[0-9a-f]{20,}|c[a-z0-9]{24}/g, ':id').replace(/TUBU\d{10,}/g, ':code');
const errs = {};
for (const l of okLines.filter((x) => x.state === 'ok' || x.state === 'flagoff')) {
  const seen = new Set();
  for (const c of l.apiErrors) {
    const k = `${c.method} ${normPath(c.path)} ${c.status}`;
    if (seen.has(k)) continue;
    seen.add(k);
    (errs[k] ||= []).push(l.id);
  }
}
const top = Object.entries(errs).sort((a, b) => b[1].length - a[1].length).slice(0, 30);

const ERR_RE = /lỗi|không tải|thử lại|404|something went wrong/i;
const errText = okLines.filter((l) => ERR_RE.test(l.textHead));
const blank = okLines.filter((l) => l.textHead.trim().length < 20);
const snip = (t) => t.slice(0, 110).replace(/\|/g, '/');

const axeTot = {};
for (const l of okLines) if (l.axe?.byRule) for (const [r, n] of Object.entries(l.axe.byRule)) axeTot[r] = (axeTot[r] ?? 0) + n;
const axeTop = Object.entries(axeTot).sort((a, b) => b[1] - a[1]).slice(0, 10);
const small = okLines.filter((l) => l.smallTargets?.count).reduce((n, l) => n + l.smallTargets.count, 0);

const out = [];
out.push('# SUMMARY ảnh chụp review UX', '');
out.push(`Tạo lúc ${new Date().toISOString()} từ screens/index.jsonl (${lines.length} dòng). Lane 4: API 3241, web 3242, Mini App 3243, DB tubutree_uat_l4.`, '');
out.push('## Số ảnh theo app và khổ', '', '| app khổ | ô chụp | ảnh | trạng thái |', '|---|---|---|---|', ...rows, `| Tổng | ${okLines.length} | ${imgs(okLines)} | |`, '');
if (failed.length) {
  out.push(`Ô chụp lỗi (không có ảnh, ${failed.length}):`, '', ...failed.map((l) => `- ${l.id}: ${l.error}`), '');
}
out.push('Ghi chú: ô trạng thái `flagoff` chụp lúc waste.enabled, chat.enabled, loyalty.marketplace_claim_enabled, waste.lane_pickup_enabled TẮT (mặc định của DB mẫu); mọi ô `ok`, `error`, `loading` chụp sau khi BẬT bốn khoá này qua PUT /admin/config. aiAdvisorEnabled không bật được từ DB (cờ server), nên /ai-advisor luôn ở màn tắt.', '');
out.push('## Ảnh ghép cặp', '', pairsInfo ? `${pairsInfo.made} cặp trong screens/pairs/ (index.html để xem nhanh)${pairsInfo.missing.length ? `; thiếu: ${pairsInfo.missing.join(', ')}` : ''}.` : 'Chưa chạy pairs.mjs.', '');
out.push('## Route bỏ qua (skip)', '', '| route | app | lý do |', '|---|---|---|', ...R.skips.map((s) => `| ${s.path} | ${s.app} | ${s.skip.replace(/\|/g, '/')} |`), '');
out.push('Route không có cột web (Mini App có, web không): /points/scan. Route web không có bên Mini App: /dang-nhap, /chinh-sach/*, /merchant. Màn gắn với một đối tượng của khách quay lại (đơn, đơn chuyển khoản, yêu cầu rác) chỉ chụp persona returning.', '');
out.push('## TOP 30 lỗi API (ô ok và flagoff; không tính ô error/loading vì lỗi do mình chặn)', '', '| # | method path | status | số màn gặp | ví dụ |', '|---|---|---|---|---|');
top.forEach(([k, ids], i) => {
  const [m, p, st] = k.split(' ');
  out.push(`| ${i + 1} | ${m} ${p} | ${st} | ${ids.length} | ${ids.slice(0, 2).join(', ')} |`);
});
if (!top.length) out.push('| | (không có lỗi 4xx/5xx) | | | |');
out.push('', '## Màn có chữ lỗi trong textHead (lỗi, không tải, thử lại, 404, Something went wrong)', '');
out.push('Ô trạng thái `error` do mình chặn API nên chữ lỗi là mong đợi; liệt kê riêng.', '');
const e1 = errText.filter((l) => l.state !== 'error');
const e2 = errText.filter((l) => l.state === 'error');
out.push(`Ô ok, flagoff, loading: ${e1.length}`, '', '| ô | url | textHead |', '|---|---|---|', ...e1.map((l) => `| ${l.id} | ${l.url} | ${snip(l.textHead)} |`), '');
out.push(`Ô error (do chặn API): ${e2.length}/${okLines.filter((l) => l.state === 'error').length} ô có chữ lỗi.`, '');
const noErrUi = okLines.filter((l) => l.state === 'error' && !ERR_RE.test(l.textHead));
out.push(`Ô error KHÔNG hiện chữ lỗi nào (có thể im lặng): ${noErrUi.length}`, '', ...noErrUi.map((l) => `- ${l.id}: ${snip(l.textHead)}`), '');
out.push('## Màn trắng (textHead dưới 20 ký tự)', '', ...(blank.length ? ['| ô | url | textHead |', '|---|---|---|', ...blank.map((l) => `| ${l.id} | ${l.url} | ${snip(l.textHead)} |`)] : ['Không có.']), '');
out.push('## Số liệu phụ', '', `- axe: tổng vi phạm theo rule (cộng số node, mọi ô ok/flagoff/error): ${axeTop.map(([r, n]) => `${r} ${n}`).join(', ') || 'không có'}`, `- Phần tử bấm được có cạnh dưới 44 px: ${small} (cộng mọi ô)`, `- Ô có consoleErrors: ${okLines.filter((l) => l.consoleErrors.length).length}/${okLines.length}`, '');
fs.writeFileSync(path.join(SCREENS, 'SUMMARY.md'), out.join('\n'));
console.log(`SUMMARY.md: ${okLines.length} ô, ${imgs(okLines)} ảnh, top lỗi ${top.length}, chữ lỗi ${errText.length}, trắng ${blank.length}`);

#!/usr/bin/env node
// Tổng hợp screens/index-mini*.jsonl thành 01-chup-mini.md (chỉ Mini App).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(HERE, '..');
const SCREENS = path.join(R, 'screens');
const rows = [];
for (const f of fs.readdirSync(SCREENS).filter((f) => /^index-mini.*\.jsonl$/.test(f)))
  for (const l of fs.readFileSync(path.join(SCREENS, f), 'utf8').split('\n').filter(Boolean)) rows.push(JSON.parse(l));

const ok = rows.filter((r) => !r.error);
const failed = rows.filter((r) => r.error);
const imgs = (ls) => ls.reduce((n, r) => n + r.files.length, 0);
const cnt = (arr, fn = (x) => x) => {
  const m = new Map();
  for (const x of arr) m.set(fn(x), (m.get(fn(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const norm = (p) => p.split('?')[0].replace(/[0-9a-f]{20,}|c[a-z0-9]{24}/g, ':id').replace(/TUBU\d{10,}/g, ':code');
const first = (r) => r.files[0] ?? '';
const tag = (r) => `${r.key}/${r.persona}/${r.vp}${r.state === 'ok' ? '' : '/' + r.state}`;
const out = [];
const P = (s = '') => out.push(s);

P('# 01 Chụp Mini App (lane 5)');
P();
P(`Sinh bởi \`tools/summary-mini.mjs\` từ \`screens/index-mini*.jsonl\`.`);
P();
P('## Số ô');
P(`Tổng ${rows.length} ô, ${imgs(ok)} ảnh; ô lỗi công cụ: ${failed.length}.`);
P();
P('| Khổ / trạng thái | Ô | Ảnh |');
P('|---|---|---|');
const grp = cnt(ok, (r) => `mini${r.vp}/${r.state}`).sort((a, b) => a[0].localeCompare(b[0]));
for (const [k] of grp) {
  const ls = ok.filter((r) => `mini${r.vp}/${r.state}` === k);
  P(`| ${k} | ${ls.length} | ${imgs(ls)} |`);
}
for (const r of failed) P(`- LỖI CÔNG CỤ ${r.id}: ${r.error}`);
P();

const okState = ok.filter((r) => r.state === 'ok');
const bad = ok.filter((r) => ['error500', 'offline', 'empty', 'longtext', 'loading', 'slow5s'].includes(r.state));

P('## Màn trắng (blank)');
const blanks = ok.filter((r) => r.blank);
P(blanks.length ? blanks.map((r) => `- ${tag(r)} — ${first(r)}`).join('\n') : 'Không có.');
P('Ghi chú: khi state loading/slow5s, ảnh s1 có thể trắng đúng thiết kế; xem cột trạng thái.');
P();

P('## pageErrors');
const pe = ok.filter((r) => r.pageErrors.length);
P(pe.length ? pe.map((r) => `- ${tag(r)}: ${r.pageErrors.join(' | ').slice(0, 200)}`).join('\n') : 'Không có.');
P();

P('## consoleErrors (gom theo câu; tách trạng thái ok và trạng thái giả lỗi)');
for (const [label, ls] of [['state ok', okState], ['trạng thái giả (error500/offline/empty/...)', bad]]) {
  P(`### ${label}`);
  const g = cnt(ls.flatMap((r) => r.consoleErrors.map((m) => ({ m: m.replace(/\s+/g, ' ').slice(0, 160), id: tag(r) }))), (x) => x.m);
  if (!g.length) P('Không có.');
  for (const [m, n] of g.slice(0, 20)) {
    const scr = new Set(ls.filter((r) => r.consoleErrors.some((c) => c.replace(/\s+/g, ' ').slice(0, 160) === m)).map(tag));
    P(`- ${n}x (${scr.size} ô) ${m}`);
  }
  P();
}

P('## apiErrors (status >= 400, status 0 = request bị abort)');
for (const [label, ls] of [['state ok', okState], ['trạng thái giả', bad]]) {
  P(`### ${label}`);
  const g = cnt(ls.flatMap((r) => r.apiErrors.map((e) => ({ k: `${e.method} ${norm(e.path)} -> ${e.status}`, id: tag(r) }))), (x) => x.k);
  if (!g.length) P('Không có.');
  for (const [k, n] of g.slice(0, 30)) {
    const scr = [...new Set(ls.filter((r) => r.apiErrors.some((e) => `${e.method} ${norm(e.path)} -> ${e.status}` === k)).map(tag))];
    P(`- ${n}x, ${scr.length} ô: ${k}${scr.length <= 4 ? ' [' + scr.join(', ') + ']' : ''}`);
  }
  P();
}

P('## axe (rule, số ô; mức impact không lưu trong index, mức mặc định của axe ghi trong ngoặc)');
const impact = { 'landmark-unique': 'moderate', 'color-contrast': 'serious', 'target-size': 'serious' };
const axeG = new Map();
for (const r of ok) if (r.axe?.byRule) for (const [k, n] of Object.entries(r.axe.byRule)) { const a = axeG.get(k) ?? { cells: [], nodes: 0 }; a.cells.push(tag(r)); a.nodes += n; axeG.set(k, a); }
const axeErr = ok.filter((r) => r.axe?.error);
if (!axeG.size) P('Không vi phạm.');
for (const [k, a] of [...axeG].sort((x, y) => y[1].cells.length - x[1].cells.length)) P(`- ${k} (${impact[k] ?? 'chưa rõ mức'}): ${a.cells.length} ô, ${a.nodes} node: ${a.cells.slice(0, 8).join(', ')}`);
P(`Ô axe báo lỗi chạy: ${axeErr.length}. Ô không chạy axe (loading/slow5s): ${ok.filter((r) => r.axe == null).length}.`);
P('Serious/critical: không có rule nào ở mức này trong các ô đã chạy (kiểm bằng danh sách rule ở trên).');
P();

P('## smallTargets (state ok; top 15 màn theo số mục tiêu < 44px)');
const st = okState.filter((r) => r.smallTargets?.count > 0).sort((a, b) => b.smallTargets.count - a.smallTargets.count);
P(`Tổng ${st.length} ô có mục tiêu nhỏ.`);
for (const r of st.slice(0, 15)) P(`- ${tag(r)}: ${r.smallTargets.count} — ${r.smallTargets.examples.slice(0, 3).map((e) => `"${e.text}" ${e.sel} ${e.w}x${e.h}`).join('; ')} (${first(r)})`);
P();

P('## Trạng thái lỗi / mất mạng KHÔNG có nút "Thử lại"');
for (const s of ['error500', 'offline']) {
  const ls = ok.filter((r) => r.state === s);
  const no = ls.filter((r) => !r.hasRetry);
  P(`### ${s}: ${no.length}/${ls.length} ô không có nút thử lại`);
  for (const r of no) P(`- ${tag(r)} — "${r.textHead.slice(0, 90)}" (${first(r)})`);
  P();
}

P('## Trạng thái tải KHÔNG có skeleton');
for (const s of ['loading', 'slow5s']) {
  const ls = ok.filter((r) => r.state === s);
  const no = ls.filter((r) => !r.hasSkeleton);
  P(`### ${s}: ${no.length}/${ls.length} ô không có skeleton`);
  for (const r of no) P(`- ${tag(r)} — "${r.textHead.slice(0, 70)}" blank=${r.blank} (${first(r)})`);
  P();
}

P('## Chỗ chậm (msToIdle > 10s, bỏ slow5s)');
const slow = ok.filter((r) => r.msToIdle > 10000 && r.state !== 'slow5s');
P(slow.length ? slow.map((r) => `- ${tag(r)}: ${r.msToIdle}ms`).join('\n') : 'Không có.');
P();

fs.writeFileSync(path.join(R, '01-chup-mini.md.gen (ghép tay với phần cuối)'), out.join('\n') + '\n');
console.log(out.join('\n'));

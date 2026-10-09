// Tổng hợp results/*.jsonl thành các bảng markdown (in ra stdout) để dán vào báo cáo 04-uiux.md.
//   node scripts/uiux/build-report-data.mjs coverage|metrics|axe|states|contrast [miniapp|web]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/pw.mjs';

const [, , mode = 'coverage', app = 'miniapp'] = process.argv;
const file = path.join(ROOT, 'scripts/uiux/results', `${app}.jsonl`);
const L = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const by = new Map();
for (const r of L) {
  if (!by.has(r.id)) by.set(r.id, []);
  by.get(r.id).push(r);
}
const find = (id, state, vp) => (by.get(id) ?? []).find((r) => r.state === state && r.vp === vp);
const ids = [...by.keys()];

if (mode === 'coverage') {
  console.log('| route-id | path | persona | ảnh (số) | lỗi chụp |');
  console.log('|---|---|---|---|---|');
  for (const id of ids) {
    const rs = by.get(id);
    const ok = rs.filter((r) => !r.fail).length;
    const f = rs.filter((r) => r.fail).length;
    console.log(`| ${id} | \`${rs[0].path}\` | ${rs[0].persona} | ${ok} | ${f || 0} |`);
  }
  console.log(`\nTổng ảnh: ${L.filter((r) => !r.fail).length}; lỗi: ${L.filter((r) => r.fail).length}`);
}

if (mode === 'metrics') {
  console.log('| route-id | tap<44 @390 (nhỏ/tổng) | tap<44 @1440 | tràn ngang | chữ<12px | h1 | axe (rule×số nút) @390 | lỗi console |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const id of ids) {
    const m = find(id, 'normal', 390) ?? find(id, 'normal', 1440);
    const d = find(id, 'normal', 1440);
    if (!m) continue;
    const axe = Array.isArray(m.axe) ? m.axe.map((v) => `${v.id}×${v.count}`).join(', ') : '-';
    console.log(`| ${id} | ${m.tapSmall}/${m.tapTotal} | ${d ? `${d.tapSmall}/${d.tapTotal}` : '-'} | ${m.hOverflow ? 'CÓ' : '-'} | ${m.tinyText} | ${m.h1} | ${axe} | ${(m.errors ?? []).length} |`);
  }
}

if (mode === 'axe') {
  const agg = {};
  for (const r of L) {
    if (!Array.isArray(r.axe) || r.state !== 'normal') continue;
    if (r.vp !== (app === 'web' ? 1440 : 390)) continue;
    for (const v of r.axe) {
      const a = (agg[v.id] ??= { impact: v.impact, pages: new Set(), nodes: 0 });
      a.pages.add(r.id);
      a.nodes += v.count;
    }
  }
  console.log('| rule | mức | số trang | tổng nút |');
  console.log('|---|---|---|---|');
  for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].pages.size - a[1].pages.size)) console.log(`| ${k} | ${v.impact} | ${v.pages.size} | ${v.nodes} |`);
}

if (mode === 'contrast') {
  for (const r of L) {
    if (r.state !== 'normal' || !Array.isArray(r.axe)) continue;
    const cc = r.axe.find((v) => v.id === 'color-contrast');
    if (cc) console.log(r.id, r.vp, cc.count, JSON.stringify(cc.n.map((x) => x.d && `${x.d.fg}/${x.d.bg} ${x.d.ratio} (cần ${x.d.need}, ${x.d.size})`)));
  }
}

if (mode === 'states') {
  console.log('| route-id | trạng thái | chữ hiển thị (rút gọn) |');
  console.log('|---|---|---|');
  for (const id of ids) {
    for (const st of ['empty', 'error']) {
      const r = find(id, st, 390) ?? find(id, st, 1440);
      if (!r) continue;
      const t = (r.bodyText || '').replace(/\s+/g, ' ').slice(0, 110);
      const flag =
        st === 'error'
          ? /thử lại|tải lại|lỗi|không thể/i.test(r.bodyText || '')
            ? 'có thông báo lỗi'
            : 'KHÔNG có thông báo lỗi'
          : (r.bodyText || '').length < 25
            ? 'gần như trống'
            : '';
      console.log(`| ${id} | ${st} ${flag} | ${t.replace(/\|/g, '/')} |`);
    }
  }
}
